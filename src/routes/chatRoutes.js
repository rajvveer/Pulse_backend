const express = require('express');
const router = express.Router();
const { verifyAccessToken } = require('../middlewares/auth');
const chatController = require('../controllers/chatController');

router.post('/conversation', verifyAccessToken, chatController.getOrCreateConversation);
router.get('/conversations', verifyAccessToken, chatController.getConversations);
router.get('/:conversationId/messages', verifyAccessToken, chatController.getMessages);

// ✅ NEW ROUTE for resetting unread badge
router.post('/:conversationId/read', verifyAccessToken, chatController.markConversationRead);

module.exports = router;