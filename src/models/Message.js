const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // ✅ UPDATE: Added 'gif', 'sticker', 'image'
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'gif', 'sticker', 'system'],
    default: 'text'
  },
  // Content stores the Text OR the URL for media
  content: {
    type: String,
    trim: true
  },
  // ✅ NEW: Media Metadata (Crucial for UI layout)
  media: {
    url: String,       // Backup URL
    thumbnail: String, // For videos
    width: Number,     // Aspect Ratio maintenance
    height: Number,
    mimeType: String
  },
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);