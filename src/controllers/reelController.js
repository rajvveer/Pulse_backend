const Reel = require('../models/Reel');
const ReelComment = require('../models/ReelComment');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const redisClient = require('../config/redisClient'); 
const config = require('../config'); 

cloudinary.config({
  cloud_name: config.get('media.cloudinary.cloudName'),
  api_key: config.get('media.cloudinary.apiKey'),
  api_secret: config.get('media.cloudinary.apiSecret')
});

// 1. CREATE REEL
exports.createReel = async (req, res) => {
  console.log('\n--- 🚀 START: Create Reel Request ---');
  
  const userId = req.user ? req.user.userId : null;

  if (!userId) {
    console.error('❌ ERROR: Authentication failed. User ID missing.');
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No video file provided' });

    console.log(`📂 Video Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: config.get('media.cloudinary.folder') + '/reels',
        resource_type: 'video',
        eager: [{ width: 720, crop: 'limit', quality: 'auto:good' }],
        eager_async: true, 
      },
      async (error, result) => {
        if (error) {
          console.error('❌ Cloudinary Error:', error);
          return res.status(500).json({ success: false, message: 'Cloudinary upload failed' });
        }

        try {
          const newReel = await Reel.create({
            user: userId,
            videoUrl: result.secure_url,
            publicId: result.public_id,
            caption: req.body.caption || ''
          });
          
          const keys = await redisClient.keys('reels_feed_*');
          if (keys.length > 0) await redisClient.del(keys);

          console.log('--- ✅ END: Reel Created ---\n');
          res.status(201).json({ success: true, data: newReel });

        } catch (dbError) {
          console.error('❌ Database Save Error:', dbError);
          res.status(500).json({ success: false, message: 'Database error' });
        }
      }
    );

    Readable.from(req.file.buffer).pipe(uploadStream);

  } catch (error) {
    console.error('❌ General Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ==========================================
// ✅ 2. GET REELS FEED (Updated to return isLiked)
// ==========================================
exports.getReelsFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const skip = (page - 1) * limit;
    const userId = req.user ? req.user.userId : null; // Get current user ID
    
    // We intentionally skip Redis caching here because 'isLiked' is specific to the current user.
    // (To add caching back, you would cache the raw list and map 'isLiked' afterwards).
    
    const reels = await Reel.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'username profileData avatar')
      .lean();

    // Add 'isLiked' property for the current user
    const reelsWithLikeStatus = reels.map(reel => ({
      ...reel,
      isLiked: userId ? reel.likes.map(id => id.toString()).includes(userId.toString()) : false
    }));

    res.status(200).json({ success: true, data: reelsWithLikeStatus });

  } catch (error) {
    console.error('Get Reels Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reels' });
  }
};

// ==========================================
// ✅ 3. TOGGLE REEL LIKE (Updated to Atomic Operations)
// ==========================================
exports.toggleLike = async (req, res) => {
  try {
    const { reelId } = req.params;
    const userId = req.user.userId;

    const reel = await Reel.findById(reelId);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

    // Check if user already liked
    const isLiked = reel.likes.map(id => id.toString()).includes(userId.toString());

    let updatedReel;
    
    if (isLiked) {
      // Unlike: Atomic $pull prevents race conditions
      updatedReel = await Reel.findByIdAndUpdate(
        reelId,
        { $pull: { likes: userId } },
        { new: true }
      );
    } else {
      // Like: Atomic $addToSet prevents duplicates
      updatedReel = await Reel.findByIdAndUpdate(
        reelId,
        { $addToSet: { likes: userId } },
        { new: true }
      );
    }

    // Invalidate cache
    const keys = await redisClient.keys('reels_feed_*');
    if (keys.length > 0) await redisClient.del(keys);

    res.status(200).json({ 
      success: true, 
      data: { 
        isLiked: !isLiked, 
        likesCount: updatedReel.likes.length 
      } 
    });

  } catch (error) {
    console.error('Like Reel Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 4. ADD COMMENT
exports.addComment = async (req, res) => {
  try {
    const { reelId } = req.params;
    const { content, parentCommentId } = req.body;
    const userId = req.user.userId;

    if (!content) return res.status(400).json({ success: false, message: 'Content required' });

    const reel = await Reel.findById(reelId);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

    const newComment = await ReelComment.create({
      reel: reelId,
      author: userId,
      content,
      parentComment: parentCommentId || null
    });

    await newComment.populate('author', 'username avatar isVerified');

    reel.commentsCount += 1;
    await reel.save();

    res.status(201).json({ success: true, data: newComment });

  } catch (error) {
    console.error('Add Comment Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 5. GET COMMENTS
exports.getComments = async (req, res) => {
  try {
    const { reelId } = req.params;
    const comments = await ReelComment.find({ reel: reelId, parentComment: null })
      .sort({ createdAt: -1 })
      .populate({
        path: 'replies', 
        populate: { path: 'author', select: 'username avatar isVerified' }
      })
      .lean({ virtuals: true });

    res.status(200).json({ success: true, data: comments });

  } catch (error) {
    console.error('Get Comments Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};