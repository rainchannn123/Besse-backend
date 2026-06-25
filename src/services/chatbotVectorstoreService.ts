import { RetrievedChunk } from '../types/chatbot';

interface VectorDoc {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * Simple in-memory vectorstore scaffold.
 * Replace with real embedding + DB later (Pinecone, pgvector, Azure AI Search, etc.).
 */
class ChatbotVectorstoreService {
  private docs: VectorDoc[] = [];

  upsertMany(docs: VectorDoc[]): void {
    const existingIds = new Set(this.docs.map(doc => doc.id));
    const toAppend: VectorDoc[] = [];

    for (const doc of docs) {
      if (!existingIds.has(doc.id)) {
        toAppend.push(doc);
      }
    }

    this.docs = [...this.docs, ...toAppend];
  }

  clear(): void {
    this.docs = [];
  }

  count(): number {
    return this.docs.length;
  }

  retrieve(query: string, topK: number = 3): RetrievedChunk[] {
    if (!query.trim() || this.docs.length === 0) return [];

    const qTokens = this.tokenize(query);
    if (qTokens.length === 0) return [];

    const ranked = this.docs
      .map(doc => {
        const dTokens = this.tokenize(doc.text);
        const overlap = qTokens.filter(token => dTokens.includes(token)).length;
        const score = overlap / Math.max(1, new Set([...qTokens, ...dTokens]).size);

        return {
          id: doc.id,
          text: doc.text,
          score,
          metadata: doc.metadata,
        };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return ranked;
  }

  private tokenize(input: string): string[] {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }
}

export const chatbotVectorstoreService = new ChatbotVectorstoreService();
