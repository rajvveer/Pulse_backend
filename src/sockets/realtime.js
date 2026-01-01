const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

module.exports = (io, socket) => {
  
  // 1. Join Chat Room (SECURED)
  socket.on('join_conversation', async (conversationId) => {
    try {
      // Security Check: Is this user actually in this conversation?
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId // Ensure user is a participant
      });

      if (conversation) {
        socket.join(conversationId);
        console.log(`User ${socket.userId} joined room ${conversationId}`);
      } else {
        console.warn(`User ${socket.userId} attempted to join unauthorized room ${conversationId}`);
        socket.emit('error', { message: "Unauthorized access to conversation" });
      }
    } catch (error) {
      console.error('Join room error:', error);
    }
  });

  // 2. Send Message Event (ROBUST)
  socket.on('send_message', async (data, callback) => {
    try {
      const { conversationId, content, type = 'text', media } = data;

      // A. Create Message
      const newMessage = await Message.create({
        conversation: conversationId,
        sender: socket.userId,
        content,
        type,
        media
      });

      // B. Determine Preview Text
      let previewText = content;
      if (type === 'image') previewText = '📷 Sent an image';
      else if (type === 'gif') previewText = '👾 Sent a GIF';
      else if (type === 'sticker') previewText = '😊 Sent a sticker';

      // C. Safe Update - Calculate target users automatically
      const conversation = await Conversation.findById(conversationId);
      
      // Find all participants who are NOT the sender to increment their unread count
      const otherParticipants = conversation.participants.filter(
        id => String(id) !== String(socket.userId)
      );

      const incUpdate = {};
      otherParticipants.forEach(userId => {
        incUpdate[`unreadCounts.${userId}`] = 1;
      });

      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: newMessage._id,
        lastMessageContent: previewText,
        lastMessageAt: new Date(),
        // ✅ ADDED: Save the sender ID here
        lastMessageSender: socket.userId, 
        $inc: incUpdate 
      });

      // D. Populate Sender (Crucial for Frontend)
      await newMessage.populate('sender', 'username name avatar profile.avatar isVerified');

      // E. Emit to Room
      io.to(conversationId).emit('new_message', newMessage);

      // F. Acknowledge success to the sender (Removes clock icon)
      if (callback) callback({ status: "ok", message: newMessage });

    } catch (error) {
      console.error('Socket error:', error);
      // Acknowledge failure
      if (callback) callback({ status: "error" });
    }
  });

  // 3. Mark as Seen (New)
  // This helps clear the badge if the user is currently looking at the screen
  socket.on('mark_seen', async ({ conversationId, messageId }) => {
      try {
          // Reset unread count for this user
          const updatePath = `unreadCounts.${socket.userId}`;
          await Conversation.findByIdAndUpdate(conversationId, {
              $set: { [updatePath]: 0 }
          });
          
          // Optional: Mark specific message as read (if you want blue ticks)
          // await Message.findByIdAndUpdate(messageId, { $addToSet: { readBy: socket.userId } });

          // Notify others in room (so they see blue ticks)
          io.to(conversationId).emit('messages_seen', { 
              conversationId, 
              userId: socket.userId 
          });
      } catch (error) {
          console.error('Mark seen error:', error);
      }
  });

  // 4. Typing Indicators
  socket.on('typing_start', ({ conversationId }) => {
    socket.to(conversationId).emit('user_typing', { userId: socket.userId, isTyping: true });
  });

  socket.on('typing_stop', ({ conversationId }) => {
    socket.to(conversationId).emit('user_typing', { userId: socket.userId, isTyping: false });
  });
};