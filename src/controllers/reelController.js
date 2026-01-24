const Reel = require('../models/Reel');
const ReelComment = require('../models/ReelComment');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const config = require('../config'); 

cloudinary.config({
  cloud_name: config.get('media.cloudinary.cloudName'),
  api_key: config.get('media.cloudinary.apiKey'),
  api_secret: config.get('media.cloudinary.apiSecret')
});

// ✅ HELPER: Optimize Cloudinary URL
const getOptimizedVideoUrl = (url) => {
  if (!url || !url.includes('cloudinary')) return url;
  const splitUrl = url.split('/upload/');
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

// 2. GET REELS FEED (FIXED & NORMALIZED)
exports.getReelsFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const skip = (page - 1) * limit;
    const userId = req.user ? req.user.userId : null;
    
    const reels = await Reel.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      // ✅ FIX 1: Populate 'authMethods' so we can access the hidden avatar
      .populate('user', 'username profile authMethods avatar isVerified') 
      .lean(); 

    const processedReels = reels.map(reel => {
      const user = reel.user || {};

      // ✅ FIX 2: Find the avatar logic
      const cleanAvatarUrl = 
        user.profile?.avatar || 
        (user.authMethods && user.authMethods.length > 0 ? user.authMethods[0].profile?.avatar : null) || 
        user.avatar || 
        null;

      return {
        ...reel,
        videoUrl: getOptimizedVideoUrl(reel.videoUrl),
        isLiked: userId ? reel.likes.map(id => id.toString()).includes(userId.toString()) : false,
        // ✅ FIX 3: Send a clean user object to frontend
        user: {
          _id: user._id,
          username: user.username,
          isVerified: user.isVerified,
          avatar: cleanAvatarUrl 
        }
      };
    });

    res.status(200).json({ success: true, data: processedReels });

  } catch (error) {
    console.error('Get Reels Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reels' });
  }
};

// 3. TOGGLE REEL LIKE
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

    res.status(200).json({ 
      success: true, 
      data: { isLiked: !isLiked, likesCount: updatedReel.likes.length } 
    });

  } catch (error) {
    console.error('Like Reel Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 4. ADD COMMENT (FIXED POPULATE)
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

    // ✅ FIX: Populate 'authMethods' and 'profile' here too so the new comment shows the pic instantly
    await newComment.populate('author', 'username profile authMethods avatar isVerified');  
    
    // Optional: Normalize the single comment response if you want consistency immediately
    const author = newComment.author;
    const cleanAvatarUrl = author.profile?.avatar || (author.authMethods?.[0]?.profile?.avatar) || author.avatar || null;
    
    const responseData = newComment.toObject();
    responseData.author = {
        _id: author._id,
        username: author.username,
        isVerified: author.isVerified,
        avatar: cleanAvatarUrl
    };

    reel.commentsCount += 1;
    await reel.save();

    res.status(201).json({ success: true, data: responseData });

  } catch (error) {
    console.error('Add Comment Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
  
// 5. GET COMMENTS (FIXED & NORMALIZED)
exports.getComments = async (req, res) => {
  try {
    const { reelId } = req.params;

    // Helper to clean up user objects (extract avatar)
    const normalizeUser = (user) => {
      if (!user) return null;
      const cleanAvatarUrl =
        user.profile?.avatar ||
        (user.authMethods && user.authMethods.length > 0 ? user.authMethods[0].profile?.avatar : null) ||
        user.avatar ||
        null;
      
      return {
        _id: user._id,
        username: user.username,
        isVerified: user.isVerified,
        avatar: cleanAvatarUrl 
      };
    };

    const comments = await ReelComment.find({ reel: reelId, parentComment: null })
      .sort({ createdAt: -1 })
      .populate('author', 'username profile authMethods avatar isVerified')
      .populate({
        path: 'replies', 
        populate: { path: 'author', select: 'username profile authMethods avatar isVerified' }
      })
      .lean({ virtuals: true });

    const processedComments = comments.map(comment => ({
      ...comment,
      author: normalizeUser(comment.author),
      replies: comment.replies ? comment.replies.map(reply => ({
        ...reply,
        author: normalizeUser(reply.author)
      })) : []
    }));

    res.status(200).json({ success: true, data: processedComments });

  } catch (error) {
    console.error('Get Comments Error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// const Reel = require('../models/Reel');
// const ReelComment = require('../models/ReelComment');
// const cloudinary = require('cloudinary').v2;
// const { Readable } = require('stream');
// // const redisClient = require('../config/redisClient'); // Redis temporarily disabled for feed logic
// const config = require('../config'); 

// cloudinary.config({
//   cloud_name: config.get('media.cloudinary.cloudName'),
//   api_key: config.get('media.cloudinary.apiKey'),
//   api_secret: config.get('media.cloudinary.apiSecret')
// });

// // ✅ HELPER: Optimize Cloudinary URL
// const getOptimizedVideoUrl = (url) => {
//   if (!url || !url.includes('cloudinary')) return url;
//   const splitUrl = url.split('/upload/');
//   // f_auto: Best format (WebM for Android, MP4 for iOS)
//   // q_auto: Smart compression (visual quality vs size)
//   // w_720: Resize to 720p (perfect for mobile)
//   return `${splitUrl[0]}/upload/f_auto,q_auto,w_720/${splitUrl[1]}`;
// };

// // 1. CREATE REEL
// exports.createReel = async (req, res) => {
//   console.log('\n--- 🚀 START: Create Reel Request ---');
//   const userId = req.user ? req.user.userId : null;

//   if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

//   try {
//     if (!req.file) return res.status(400).json({ success: false, message: 'No video file provided' });

//     console.log(`📂 Video Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

//     const uploadStream = cloudinary.uploader.upload_stream(
//       {
//         folder: config.get('media.cloudinary.folder') + '/reels',
//         resource_type: 'video',
//         // Eager transform creates a 720p copy immediately on upload
//         eager: [{ width: 720, crop: 'limit', quality: 'auto:good' }],
//         eager_async: true, 
//       },
//       async (error, result) => {
//         if (error) {
//           console.error('❌ Cloudinary Error:', error);
//           return res.status(500).json({ success: false, message: 'Cloudinary upload failed' });
//         }

//         try {
//           const newReel = await Reel.create({
//             user: userId,
//             videoUrl: result.secure_url, 
//             publicId: result.public_id,
//             caption: req.body.caption || ''
//           });
          
//           // ✅ OPTIMIZATION: Only invalidate cache on NEW POSTS, not likes
//           // const keys = await redisClient.keys('reels_feed_*');
//           // if (keys.length > 0) await redisClient.del(keys);

//           console.log('--- ✅ END: Reel Created ---\n');
//           res.status(201).json({ success: true, data: newReel });

//         } catch (dbError) {
//           console.error('❌ Database Save Error:', dbError);
//           res.status(500).json({ success: false, message: 'Database error' });
//         }
//       }
//     );

//     Readable.from(req.file.buffer).pipe(uploadStream);

//   } catch (error) {
//     console.error('❌ General Error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// // 2. GET REELS FEED (OPTIMIZED)
// exports.getReelsFeed = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = 5;
//     const skip = (page - 1) * limit;
//     const userId = req.user ? req.user.userId : null;
    
//     const reels = await Reel.find()
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       // ✅ FIX 1: Populate 'authMethods' so we can access the hidden avatar
//       // We also get 'profile' and 'isVerified' just in case.
//       .populate('user', 'username profile authMethods avatar isVerified') 
//       .lean(); 

//     const processedReels = reels.map(reel => {
//       const user = reel.user || {};

//       // ✅ FIX 2: Find the avatar logic
//       // This checks all possible locations for the image.
//       const cleanAvatarUrl = 
//         user.profile?.avatar || 
//         (user.authMethods && user.authMethods.length > 0 ? user.authMethods[0].profile?.avatar : null) || 
//         user.avatar || 
//         null;

//       return {
//         ...reel,
//         videoUrl: getOptimizedVideoUrl(reel.videoUrl),
//         isLiked: userId ? reel.likes.map(id => id.toString()).includes(userId.toString()) : false,
//         // ✅ FIX 3: Send a clean user object to frontend
//         user: {
//           _id: user._id,
//           username: user.username,
//           isVerified: user.isVerified,
//           avatar: cleanAvatarUrl // <--- Frontend now gets a simple URL string here!
//         }
//       };
//     });

//     res.status(200).json({ success: true, data: processedReels });

//   } catch (error) {
//     console.error('Get Reels Error:', error);
//     res.status(500).json({ success: false, message: 'Failed to fetch reels' });
//   }
// };

// exports.getReelsFeed = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = 5;
//     const skip = (page - 1) * limit;
//     const userId = req.user ? req.user.userId : null;
    
//     const reels = await Reel.find()
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       // ✅ FIX 1: Populate 'authMethods' so we can access the hidden avatar
//       // We also get 'profile' and 'isVerified' just in case.
//       .populate('user', 'username profile authMethods avatar isVerified') 
//       .lean(); 

//     const processedReels = reels.map(reel => {
//       const user = reel.user || {};

   
//       const cleanAvatarUrl = 
//         user.profile?.avatar || 
//         (user.authMethods && user.authMethods.length > 0 ? user.authMethods[0].profile?.avatar : null) || 
//         user.avatar || 
//         null;

//       return {
//         ...reel,
//         videoUrl: getOptimizedVideoUrl(reel.videoUrl),
//         isLiked: userId ? reel.likes.map(id => id.toString()).includes(userId.toString()) : false,
//         // ✅ FIX 3: Send a clean user object to frontend
//         user: {
//           _id: user._id,
//           username: user.username,
//           isVerified: user.isVerified,
//           avatar: cleanAvatarUrl // <--- Frontend now gets a simple URL string here!
//         }
//       };
//     });

//     res.status(200).json({ success: true, data: processedReels });

//   } catch (error) {
//     console.error('Get Reels Error:', error);
//     res.status(500).json({ success: false, message: 'Failed to fetch reels' });
//   }
// };

// // 3. TOGGLE REEL LIKE
// exports.toggleLike = async (req, res) => {
//   try {
//     const { reelId } = req.params;
//     const userId = req.user.userId;

//     const reel = await Reel.findById(reelId);
//     if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });

//     const isLiked = reel.likes.map(id => id.toString()).includes(userId.toString());
//     let updatedReel;
    
//     if (isLiked) {
//       updatedReel = await Reel.findByIdAndUpdate(reelId, { $pull: { likes: userId } }, { new: true });
//     } else {
//       updatedReel = await Reel.findByIdAndUpdate(reelId, { $addToSet: { likes: userId } }, { new: true });
//     }

//     // ⚠️ REMOVED REDIS INVALIDATION HERE
//     // Do not wipe cache on likes. It kills performance.

//     res.status(200).json({ 
//       success: true, 
//       data: { isLiked: !isLiked, likesCount: updatedReel.likes.length } 
//     });

//   } catch (error) {
//     console.error('Like Reel Error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };

// // ... (addComment and getComments remain the same, they are good) ...
// exports.addComment = async (req, res) => {
//     try {
//       const { reelId } = req.params;
//       const { content, parentCommentId } = req.body;
//       const userId = req.user.userId;
  
//       if (!content) return res.status(400).json({ success: false, message: 'Content required' });
  
//       const reel = await Reel.findById(reelId);
//       if (!reel) return res.status(404).json({ success: false, message: 'Reel not found' });
  
//       const newComment = await ReelComment.create({
//         reel: reelId,
//         author: userId,
//         content,
//         parentComment: parentCommentId || null
//       });
  
//       await newComment.populate('author', 'username avatar isVerified');  
      
//       reel.commentsCount += 1;
//       await reel.save();
  
//       res.status(201).json({ success: true, data: newComment });
  
//     } catch (error) {
//       console.error('Add Comment Error:', error);
//       res.status(500).json({ success: false, message: 'Server error' });
//     }
//   };
  
//   // 5. GET COMMENTS
//  exports.getComments = async (req, res) => {
//   try {
//     const { reelId } = req.params;

//     // Helper to clean up user objects (extract avatar)
//     const normalizeUser = (user) => {
//       if (!user) return null;
//       const cleanAvatarUrl =
//         user.profile?.avatar ||
//         (user.authMethods && user.authMethods.length > 0 ? user.authMethods[0].profile?.avatar : null) ||
//         user.avatar ||
//         null;
      
//       return {
//         _id: user._id,
//         username: user.username,
//         isVerified: user.isVerified,
//         avatar: cleanAvatarUrl // <--- The clean URL the frontend expects
//       };
//     };

//     const comments = await ReelComment.find({ reel: reelId, parentComment: null })
//       .sort({ createdAt: -1 })
//       .populate('author', 'username profile authMethods avatar isVerified')
//       .populate({
//         path: 'replies',
//         populate: { path: 'author', select: 'username profile authMethods avatar isVerified' }
//       })
//       .lean({ virtuals: true });

//     const processedComments = comments.map(comment => ({
//       ...comment,
//       author: normalizeUser(comment.author),
//       replies: comment.replies ? comment.replies.map(reply => ({
//         ...reply,
//         author: normalizeUser(reply.author)
//       })) : []
//     }));

//     res.status(200).json({ success: true, data: processedComments });

//   } catch (error) {
//     console.error('Get Comments Error:', error);
//     res.status(500).json({ success: false, message: 'Server error' });
//   }
// };
