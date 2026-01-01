const Post = require('../models/Post');
const User = require('../models/User');

// Helper function to process posts and attach like status + mask anonymous
const processPosts = (posts, userId) => {
    if (!posts) return [];
    return posts.map(post => {
        const postObj = typeof post.toObject === 'function' ? post.toObject() : post;
        
        // Mask author if anonymous
        if (postObj.isAnonymous) {
            postObj.author = {
                _id: null,
                username: 'anonymous',
                name: 'Anonymous',
                avatar: 'https://res.cloudinary.com/pulse/image/upload/v1/defaults/anonymous-avatar.png',
                isVerified: false
            };
        }
        
        return {
            ...postObj,
            isLiked: postObj.likes?.some(id => id.toString() === userId) || false
        };
    });
};

/**
 * @desc    Get the personalized home feed (Follower posts + Own posts)
 * @route   GET /api/v1/feed/home
 * @access  Private
 */
exports.getHomeFeed = async (req, res) => {
    try {
        const { page = 1, limit = 20, lastPostDate } = req.query;
        const userId = req.user.userId;

        const user = await User.findById(userId).select('following');
        const followingIds = user.following || [];

        const posts = await Post.getHomeFeed(userId, followingIds, {
            page: parseInt(page),
            limit: parseInt(limit),
            lastPostDate
        });

        const postsWithLikes = processPosts(posts, userId); // ✅ Now masks anonymous

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

/**
 * @desc    Get all public posts (Global Feed, chronological)
 * @route   GET /api/v1/feed/global
 * @access  Private
 */
exports.getGlobalFeed = async (req, res) => {
    try {
        const { page = 1, limit = 20, lastPostDate } = req.query;
        const userId = req.user.userId;

        const posts = await Post.getGlobalFeed({
            page: parseInt(page),
            limit: parseInt(limit),
            lastPostDate
        });

        const postsWithLikes = processPosts(posts, userId); // ✅ Now masks anonymous

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
        console.error('Get global feed error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get posts based on velocity and recency
 * @route   GET /api/v1/feed/trending
 * @access  Private
 */
exports.getTrendingPosts = async (req, res) => {
    try {
        const { limit = 20, timeRange = 24 } = req.query;
        const userId = req.user.userId;

        const posts = await Post.getTrendingPosts({
            limit: parseInt(limit),
            timeRange: parseInt(timeRange)
        });

        const postsWithLikes = processPosts(posts, userId); // ✅ Now masks anonymous

        res.json({
            success: true,
            data: postsWithLikes
        });
    } catch (error) {
        console.error('Get trending posts error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get posts near the user's location
 * @route   GET /api/v1/feed/nearby
 * @access  Private
 */
exports.getNearbyPosts = async (req, res) => {
    try {
        const { longitude, latitude, maxDistance = 1000, limit = 20 } = req.query;

        if (!longitude || !latitude) {
            return res.status(400).json({ success: false, message: 'Location required' });
        }
        
        const userId = req.user.userId;

        const posts = await Post.getNearbyPosts(
            [parseFloat(longitude), parseFloat(latitude)],
            parseInt(maxDistance),
            { limit: parseInt(limit) }
        );

        const postsWithLikes = processPosts(posts, userId); // ✅ Now masks anonymous

        res.json({
            success: true,
            data: postsWithLikes
        });
    } catch (error) {
        console.error('Get nearby posts error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};
