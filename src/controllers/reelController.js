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

// ✅ HELPER: Optimize Cloudinary URL
// Inserts 'f_auto,q_auto,w_720' to force compression and mobile scaling
const getOptimizedVideoUrl = (url) => {
  if (!url || !url.includes('cloudinary')) return url;
  const splitUrl = url.split('/upload/');
  // Insert transformations: 
  // f_auto = Best format for device (MP4/WebM)
  // q_auto = Visual quality compression (reduces size by 60-80%)
  // w_720  = Resize to 720p width (no need for 4K on mobile)
  return `${splitUrl[0]}/upload/f_auto,q_auto,w_720/${splitUrl[1]}`;
};

// 1. CREATE REEL
exports.createReel = async (req, res) => {
  console.log('\n--- 🚀 START: Create Reel Request ---');
  const userId = req.user ? req.user.userId : null;

  if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No video file provided' });

    console.log(`📂 Video Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

    // Using eager transformation to pre-generate the 720p version on upload
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: config.get('media.cloudinary.folder') + '/reels',
        resource_type: 'video',
        // Force the stored video to be reasonably sized
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
            videoUrl: result.secure_url, // We store original, but transform on read
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
// ✅ 2. GET REELS FEED (OPTIMIZED)
// ==========================================
exports.getReelsFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const skip = (page - 1) * limit;
    const userId = req.user ? req.user.userId : null;
    
    // Fetch raw data
    const reels = await Reel.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'username profileData avatar')
      .lean();

    // Map data to include isLiked AND optimized URL
    const processedReels = reels.map(reel => ({
      ...reel,
      // 🚀 CRITICAL FIX: Send the optimized URL to the frontend
      videoUrl: getOptimizedVideoUrl(reel.videoUrl),
      isLiked: userId ? reel.likes.map(id => id.toString()).includes(userId.toString()) : false
    }));

    res.status(200).json({ success: true, data: processedReels });

  } catch (error) {
    console.error('Get Reels Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reels' });
  }
};

// ==========================================
// ✅ 3. TOGGLE REEL LIKE
// ==========================================
exports.toggleLike = async (req, res) => {
  try {
    const { reelId } = req.params;
    const userId = req.user.userId;

    const reel = await Reel.findById(reelId);
    if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

    const isLiked = reel.likes.map(id => id.toString()).includes(userId.toString());

    let updatedReel;
    
    if (isLiked) {
      updatedReel = await Reel.findByIdAndUpdate(reelId, { $pull: { likes: userId } }, { new: true });
    } else {
      updatedReel = await Reel.findByIdAndUpdate(reelId, { $addToSet: { likes: userId } }, { new: true });
    }

    const keys = await redisClient.keys('reels_feed_*');
    if (keys.length > 0) await redisClient.del(keys);

    res.status(200).json({ 
      success: true, 
      data: { isLiked: !isLiked, likesCount: updatedReel.likes.length } 
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
