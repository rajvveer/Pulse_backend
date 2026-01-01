const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth'); // Assuming 'authenticate' is 'verifyAccessToken' based on your middleware
const feedController = require('../controllers/feedController'); // <--- NEW CONTROLLER IMPORTED

// NEW: Global feed (fixes the bug, shows all public posts)
router.get('/global', verifyAccessToken, feedController.getGlobalFeed);

// Home feed (personalized feed from following users - EXISTING)
router.get('/home', verifyAccessToken, feedController.getHomeFeed);

// Trending posts (EXISTING)
router.get('/trending', verifyAccessToken, feedController.getTrendingPosts);

// Nearby posts (location-based - EXISTING)
router.get('/nearby', verifyAccessToken, feedController.getNearbyPosts);

module.exports = router;