export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatbotRequestBody {
  message: string;
  sessionId?: string;
  pageContext?: 'mrf-collection' | 'broker-inventory' | 'municipality' | string;
  history?: ChatMessage[];
}

export interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface ChatbotResponseData {
  reply: string;
  contextUsed: RetrievedChunk[];
}
