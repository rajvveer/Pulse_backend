const User = require('../models/User');
const cloudinary = require('cloudinary').v2;
const config = require('../config');

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.get('media.cloudinary.cloudName'),
  api_key: config.get('media.cloudinary.apiKey'),
  api_secret: config.get('media.cloudinary.apiSecret')
});

// Get current user profile
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('-passwordHash -authMethods')
      .lean();

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get user by username
exports.getUserByUsername = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.userId;

    const user = await User.findOne({ username })
      .select('-passwordHash -authMethods -email -phone')
      .lean();

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Check if current user is following this profile
    const isFollowing = user.followers?.some(
      id => id.toString() === currentUserId
    ) || false;

    const isOwnProfile = user._id.toString() === currentUserId;

    res.json({
      success: true,
      data: {
        ...user,
        isFollowing,
        isOwnProfile
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const updates = {};
    const allowedFields = [
      'bio',
      'avatar',
      'name'
    ];

    // Build update object
    Object.keys(req.body).forEach(key => {
      if (allowedFields.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-passwordHash -authMethods');

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Upload avatar
exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    // Upload to Cloudinary using buffer
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'pulse/avatars',
        resource_type: 'auto',
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face' }
        ]
      },
      async (error, result) => {
        if (error) {
          return res.status(500).json({ 
            success: false, 
            message: 'Upload failed',
            error: error.message
          });
        }

        const user = await User.findByIdAndUpdate(
          req.user.userId,
          { avatar: result.secure_url },
          { new: true }
        ).select('-passwordHash -authMethods');

        res.json({
          success: true,
          data: { avatar: user.avatar }
        });
      }
    );

    require('stream').Readable.from(req.file.buffer).pipe(uploadStream);

  } catch (error) {
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// Toggle follow
exports.toggleFollow = async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.userId;

    const targetUser = await User.findOne({ username });
    if (!targetUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    if (targetUser._id.toString() === currentUserId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot follow yourself' 
      });
    }

    const isFollowing = targetUser.followers?.includes(currentUserId) || false;

    if (isFollowing) {
      // Unfollow
      await User.findByIdAndUpdate(targetUser._id, {
        $pull: { followers: currentUserId }
      });
      await User.findByIdAndUpdate(currentUserId, {
        $pull: { following: targetUser._id }
      });
    } else {
      // Follow
      await User.findByIdAndUpdate(targetUser._id, {
        $addToSet: { followers: currentUserId }
      });
      await User.findByIdAndUpdate(currentUserId, {
        $addToSet: { following: targetUser._id }
      });
    }

    res.json({
      success: true,
      data: { isFollowing: !isFollowing }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
