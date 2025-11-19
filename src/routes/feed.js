const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const postController = require('../controllers/post.controller');

// Home feed (posts from following)
router.get('/home', authenticate, postController.getHomeFeed);

// Trending posts
router.get('/trending', authenticate, postController.getTrendingPosts);

// Nearby posts (location-based)
router.get('/nearby', authenticate, postController.getNearbyPosts);

module.exports = router;
