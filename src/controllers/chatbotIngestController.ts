import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/response';
import { chatbotService } from '../services/chatbotService';

function chunkText(text: string, maxLen = 1000): string[] {
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxLen) out.push(p);
    else {
      let i = 0;
      while (i < p.length) {
        const part = p.slice(i, i + maxLen);
        // try to cut at a sentence boundary
        const lastPeriod = part.lastIndexOf('. ');
        const cut = (lastPeriod > Math.floor(maxLen * 0.5)) ? lastPeriod + 1 : part.length;
        out.push(p.slice(i, i + cut).trim());
        i += cut;
      }
    }
  }
  return out;
}

export const ingestDocs = asyncHandler(async (_req: Request, res: Response) => {
  // Read the canonical docs file inside backend/docs
  const docsPath = path.join(process.cwd(), 'docs', 'game_documentation.txt');
  if (!fs.existsSync(docsPath)) {
    return sendResponse(res, 404, 'Documentation file not found', { path: docsPath });
  }

  const text = fs.readFileSync(docsPath, 'utf8');
  const chunks = chunkText(text, 1000);
  const docs = chunks.map((c, i) => ({ id: `doc-${i}`, text: c, metadata: { source: docsPath, chunk_index: i } }));

  // Persist to vectorstore folder inside backend
  try {
    const vectorstoreDir = path.join(process.cwd(), 'vectorstore');
    if (!fs.existsSync(vectorstoreDir)) {
      fs.mkdirSync(vectorstoreDir, { recursive: true });
    }
    const outPath = path.join(vectorstoreDir, 'chroma_docs.json');
    fs.writeFileSync(outPath, JSON.stringify(docs, null, 2), 'utf8');
  } catch (err) {
    // non-fatal
    console.warn('Could not write vectorstore/chroma_docs.json:', err);
  }

  // Ingest into in-memory vectorstore
  chatbotService.ingestSeedDocs(docs);

  return sendResponse(res, 200, 'Docs ingested into chatbot vectorstore', { documentCount: docs.length });
});

export default ingestDocs;
