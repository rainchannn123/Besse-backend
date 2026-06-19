import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import {
  ChatbotRequestBody,
  ChatbotResponseData,
  RetrievedChunk,
} from '../types/chatbot';
import { chatbotVectorstoreService } from './chatbotVectorstoreService';

class ChatbotService {
  private readonly provider = env.CHATBOT_PROVIDER;

  private containsCjk(text: string): boolean {
    // CJK Unified Ideographs + Extensions + Compatibility Ideographs
    return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text);
  }

  private isLikelyEnglish(text: string): boolean {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return true;

    // Basic heuristic: detect presence of Latin letters and ratio dominance.
    const latinChars = (cleaned.match(/[A-Za-z]/g) || []).length;
    const letters = (cleaned.match(/\p{L}/gu) || []).length;

    if (letters === 0) return true;
    return latinChars / letters >= 0.6;
  }

  async ask(body: ChatbotRequestBody): Promise<ChatbotResponseData> {
    if (!env.CHATBOT_ENABLED) {
      throw new AppError('Chatbot is disabled', 503);
    }

    const message = body.message?.trim();
    if (!message) {
      throw new AppError('Message is required', 400);
    }

    // Hard block for Chinese/CJK characters
    if (this.containsCjk(message)) {
      return {
        reply: 'This chat only support English conversation. Please ask again in English.',
        contextUsed: [],
      };
    }

    if (!this.isLikelyEnglish(message)) {
      return {
        reply: 'This chat only support English conversation. Please ask again in English.',
        contextUsed: [],
      };
    }

    const contextChunks = chatbotVectorstoreService.retrieve(message, 4);

    // If no API key and not using Azure, provide graceful local response so UI can still function.
    if (!env.OPENAI_API_KEY && this.provider !== 'azure') {
      return {
        reply: this.buildFallbackReply(message, body.pageContext, contextChunks),
        contextUsed: contextChunks,
      };
    }

    const reply = await this.askOpenAI(message, body.pageContext, contextChunks);
    return { reply, contextUsed: contextChunks };
  }

  ingestSeedDocs(docs: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>): void {
    chatbotVectorstoreService.upsertMany(docs);
  }

  getVectorstoreStatus(): { documentCount: number } {
    return { documentCount: chatbotVectorstoreService.count() };
  }

  private buildFallbackReply(
    message: string,
    pageContext?: string,
    chunks: RetrievedChunk[] = []
  ): string {
    const contextHint = pageContext ? ` for ${pageContext}` : '';
    if (chunks.length > 0) {
      return `I can help${contextHint}. Based on available references, here is a quick answer: ${chunks[0].text.slice(0, 220)}. You asked: "${message}".`;
    }
    return `I can help${contextHint}. I do not have local knowledge indexed yet, but your chatbot pipeline is connected. Please add vector documents later. You asked: "${message}".`;
  }

  private async askOpenAI(
    message: string,
    pageContext?: string,
    chunks: RetrievedChunk[] = []
  ): Promise<string> {
    const contextBlock = chunks.length
      ? chunks
          .map((c, idx) => `(${idx + 1}) ${c.text}`)
          .join('\n')
      : 'No retrieved context available.';

    // If provider is Azure, call Azure OpenAI REST endpoint with api-key header
    if (this.provider === 'azure' && env.AZURE_OPENAI_KEY && env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT) {
      const url = `${env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, '')}/openai/deployments/${env.AZURE_OPENAI_DEPLOYMENT}/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': env.AZURE_OPENAI_KEY,
        },
        body: JSON.stringify({
          model: env.CHATBOT_MODEL,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: `${env.CHATBOT_SYSTEM_PROMPT}\nYou are assisting players in Clash of the Cities - Mission Net Zero game. Keep responses concise and actionable.`,
            },
            {
              role: 'system',
              content: `Page context: ${pageContext || 'unknown'}\nRetrieved context:\n${contextBlock}`,
            },
            {
              role: 'user',
              content: message,
            },
          ],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new AppError(`Chatbot provider error: ${text}`, 502);
      }

      const data: any = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || 'I could not generate a response at the moment.';
    }

    // Default: OpenAI-compatible endpoint
    const response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.CHATBOT_MODEL,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: `${env.CHATBOT_SYSTEM_PROMPT}\nYou are assisting players in Clash of the Cities - Mission Net Zero game. Keep responses concise and actionable.`,
          },
          {
            role: 'system',
            content: `Page context: ${pageContext || 'unknown'}\nRetrieved context:\n${contextBlock}`,
          },
          {
            role: 'user',
            content: message,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new AppError(`Chatbot provider error: ${text}`, 502);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content?.trim() || 'I could not generate a response at the moment.';
  }
}

export const chatbotService = new ChatbotService();
