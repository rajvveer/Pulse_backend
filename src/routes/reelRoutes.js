const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const reelController = require('../controllers/reelController');

// 1. Create Reel
router.post('/create', verifyAccessToken, upload.single('file'), reelController.createReel);

// 2. Get Feed
router.get('/feed', verifyAccessToken, reelController.getReelsFeed);

// ✅ 3. Like/Unlike Reel
router.post('/:reelId/like', verifyAccessToken, reelController.toggleLike);

// ✅ 4. Add Comment (Supports replies via body.parentCommentId)
router.post('/:reelId/comments', verifyAccessToken, reelController.addComment);

// ✅ 5. Get Comments (Returns nested structure)
router.get('/:reelId/comments', verifyAccessToken, reelController.getComments);

module.exports = router;