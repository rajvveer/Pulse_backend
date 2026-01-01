const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

// @desc    Get or Create a conversation with a user
// @route   POST /api/v1/chat/conversation
exports.getOrCreateConversation = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const currentUserId = req.user.userId;

    if (!targetUserId) return res.status(400).json({ success: false, message: 'Target user required' });

    // 1. Try to find existing chat
    let conversation = await Conversation.findOne({
      participants: { $all: [currentUserId, targetUserId], $size: 2 }
    }).populate('participants', 'username name avatar profile.avatar isVerified');

    // 2. Create if not exists
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [currentUserId, targetUserId],
        unreadCounts: { [currentUserId]: 0, [targetUserId]: 0 }
      });
      // Populate immediately
      conversation = await Conversation.findById(conversation._id)
        .populate('participants', 'username name avatar profile.avatar isVerified');
    }

    res.json({ success: true, data: conversation });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all my conversations (Inbox)
// @route   GET /api/v1/chat/conversations
exports.getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.userId
    })
    .sort({ lastMessageAt: -1 })
    .populate('participants', 'username name avatar profile.avatar isVerified')
    .lean();

    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('Get inbox error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get message history
// @route   GET /api/v1/chat/:conversationId/messages
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before } = req.query;

    // Security: Ensure user is part of this conversation
    const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: req.user.userId
    });

    if (!conversation) {
        return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const query = { conversation: conversationId };
    
    // Pagination (Load older messages)
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 }) // Newest first
      .limit(parseInt(limit))
      .populate('sender', 'username name avatar profile.avatar isVerified')
      .lean();

    res.json({ success: true, data: messages });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ NEW FUNCTION: Mark conversation as read
// @desc    Reset unread count for the current user
// @route   POST /api/v1/chat/:conversationId/read
exports.markConversationRead = async (req, res) => {
    try {
      const { conversationId } = req.params;
      const userId = req.user.userId;
  
      // Reset the unread count specifically for this user to 0
      await Conversation.findByIdAndUpdate(conversationId, {
        $set: { [`unreadCounts.${userId}`]: 0 }
      });
  
      res.json({ success: true, message: 'Conversation marked as read' });
    } catch (error) {
      console.error('Mark read error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  };