import express from 'express';
import { getChatbotStatus, postChatMessage } from '../controllers/chatbotController';
import ingestDocs from '../controllers/chatbotIngestController';

const router = express.Router();

router.get('/status', getChatbotStatus);
router.post('/message', postChatMessage);
// Admin/dev endpoint to ingest local documentation into the vectorstore
router.post('/ingest-docs', ingestDocs);

export default router;
