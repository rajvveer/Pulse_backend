const mongoose = require('mongoose');

const reelSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  videoUrl: {
    type: String,
    required: true
  },
  publicId: {
    type: String, // Storing this helps if you ever need to delete the video from Cloudinary
    required: true
  },
  caption: {
    type: String,
    maxlength: 2200 // Instagram limit is 2200
  },
  // ✅ UPDATED: Support for Likes
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // ✅ UPDATED: Support for Comment Counts
  commentsCount: {
    type: Number,
    default: 0
  },
  // Optimizes query speed
  createdAt: {
    type: Date,
    default: Date.now,
    index: true 
  }
}, { timestamps: true });

module.exports = mongoose.model('Reel', reelSchema);