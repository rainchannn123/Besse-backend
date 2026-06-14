import { Request, Response } from 'express';
import { z } from 'zod';
import { chatbotService } from '../services/chatbotService';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';

const chatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000),
  sessionId: z.string().optional(),
  pageContext: z.string().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      })
    )
    .optional(),
});

export const postChatMessage = asyncHandler(async (req: Request, res: Response) => {
  const payload = chatRequestSchema.parse(req.body);
  const data = await chatbotService.ask(payload);

  sendResponse(res, 200, 'Chatbot response generated', data);
});

export const getChatbotStatus = asyncHandler(async (_req: Request, res: Response) => {
  const status = chatbotService.getVectorstoreStatus();
  sendResponse(res, 200, 'Chatbot status fetched', status);
});
