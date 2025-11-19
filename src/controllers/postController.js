const Post = require('../models/Post');
const User = require('../models/User');
const Comment = require('../models/Comment');

// Create post
exports.createPost = async (req, res) => {
  try {
    const { text, media, location, visibility, allowComments, isAnonymous } = req.body;

    const post = new Post({
      author: req.user.userId,
      content: { text, media: media || [] },
      location,
      visibility: visibility || 'public',
      allowComments: allowComments !== undefined ? allowComments : true,
      isAnonymous: isAnonymous || false
    });

    await post.save();

    // Update user post count
    await User.findByIdAndUpdate(req.user.userId, {
      $inc: { 'stats.postsCount': 1 }
    });

    await post.populate('author', 'username name avatar isVerified');

    res.status(201).json({
      success: true,
      data: post
    });
  } catch (error) {
    console.error('Create post error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single post
exports.getPost = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findById(postId)
      .populate('author', 'username name avatar isVerified')
      .populate('originalPost');

    if (!post || !post.isActive) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Increment view count
    post.stats.views += 1;
    await post.save();

    const isLiked = post.isLikedBy(req.user.userId);

    res.json({
      success: true,
      data: { ...post.toObject(), isLiked }
    });
  } catch (error) {
    console.error('Get post error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get user posts
exports.getUserPosts = async (req, res) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const posts = await Post.find({
      author: user._id,
      isActive: true
    })
    .sort({ isPinned: -1, createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .populate('author', 'username name avatar isVerified');

    res.json({
      success: true,
      data: posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get user posts error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get home feed
exports.getHomeFeed = async (req, res) => {
  try {
    const { page = 1, limit = 20, lastPostDate } = req.query;
    
    const user = await User.findById(req.user.userId).select('following');
    const followingIds = user.following || [];

    const posts = await Post.getHomeFeed(req.user.userId, followingIds, {
      page: parseInt(page),
      limit: parseInt(limit),
      lastPostDate
    });

    const postsWithLikes = posts.map(post => ({
      ...post,
      isLiked: post.likes?.some(id => id.toString() === req.user.userId)
    }));

    res.json({
      success: true,
      data: postsWithLikes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: posts.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get home feed error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get trending posts
exports.getTrendingPosts = async (req, res) => {
  try {
    const { limit = 20, timeRange = 24 } = req.query;

    const posts = await Post.getTrendingPosts({
      limit: parseInt(limit),
      timeRange: parseInt(timeRange)
    });

    res.json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error('Get trending posts error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get nearby posts
exports.getNearbyPosts = async (req, res) => {
  try {
    const { longitude, latitude, maxDistance = 1000, limit = 20 } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({ success: false, message: 'Location required' });
    }

    const posts = await Post.getNearbyPosts(
      [parseFloat(longitude), parseFloat(latitude)],
      parseInt(maxDistance),
      { limit: parseInt(limit) }
    );

    res.json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error('Get nearby posts error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Like/Unlike post
exports.toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.userId;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const isLiked = post.isLikedBy(userId);

    if (isLiked) {
      post.likes = post.likes.filter(id => id.toString() !== userId);
      post.stats.likes -= 1;
    } else {
      post.likes.push(userId);
      post.stats.likes += 1;
    }

    await post.save();

    res.json({
      success: true,
      data: {
        isLiked: !isLiked,
        likeCount: post.stats.likes
      }
    });
  } catch (error) {
    console.error('Toggle like error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add comment
exports.addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, parentCommentId } = req.body;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (!post.allowComments) {
      return res.status(403).json({ success: false, message: 'Comments disabled' });
    }

    const comment = new Comment({
      post: postId,
      author: req.user.userId,
      content,
      parentComment: parentCommentId || null
    });

    await comment.save();

    post.stats.comments += 1;
    await post.save();

    if (parentCommentId) {
      await Comment.findByIdAndUpdate(parentCommentId, {
        $push: { replies: comment._id }
      });
    }

    await comment.populate('author', 'username name avatar isVerified');

    res.status(201).json({
      success: true,
      data: comment
    });
  } catch (error) {
    console.error('Add comment error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get comments
exports.getComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const comments = await Comment.find({
      post: postId,
      parentComment: null,
      isActive: true
    })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .populate('author', 'username name avatar isVerified')
    .populate({
      path: 'replies',
      populate: { path: 'author', select: 'username name avatar isVerified' }
    });

    res.json({
      success: true,
      data: comments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get comments error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete post
exports.deletePost = async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (post.author.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    post.isActive = false;
    await post.save();

    await User.findByIdAndUpdate(req.user.userId, {
      $inc: { 'stats.postsCount': -1 }
    });

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });
  } catch (error) {
    console.error('Delete post error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update post
exports.updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const { text, visibility, allowComments } = req.body;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (post.author.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (text !== undefined) post.content.text = text;
    if (visibility) post.visibility = visibility;
    if (allowComments !== undefined) post.allowComments = allowComments;
    
    post.isEdited = true;
    post.editedAt = new Date();

    await post.save();

    res.json({
      success: true,
      data: post
    });
  } catch (error) {
    console.error('Update post error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
