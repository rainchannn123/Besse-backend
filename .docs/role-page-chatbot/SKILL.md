# Adding Knowledge to the Chatbot Vectorstore

The chatbot uses a **local in-memory vectorstore** for RAG (Retrieval-Augmented Generation). Here's how to expand its knowledge base:

## Quick Method: Update the Game Documentation

1. **Edit the source file**:  
   Open `Besse-backend/docs/game_documentation.txt`

2. **Add or modify sections** relevant to the game (rules, phases, roles, gameplay).

3. **Trigger re-ingestion** in one of two ways:

   **Option A** (Recommended for dev/testing):
   ```bash
   # In Besse-backend directory
   npm run build && npm start
   ```
   On startup, the app auto-loads `Generation/chroma_docs.json` and re-populates the vectorstore.

   **Option B** (Manual HTTP ingestion):
   ```bash
   curl -X POST http://localhost:5000/api/chatbot/ingest-docs
   ```
   Reads the game documentation, chunks it at 1000-character boundaries with sentence-aware splits, writes the chunks to `Generation/chroma_docs.json`, and ingests into the vectorstore.

4. **Verify ingestion**:
   ```bash
   curl http://localhost:5000/api/chatbot/status
   # Response: { success: true, data: { documentCount: 9 (or updated count) } }
   ```

## How It Works

- **Chunking**: The ingest controller splits `game_documentation.txt` at ~1000 chars per chunk while respecting sentence boundaries.
- **Storage**: Chunks stored in `Generation/chroma_docs.json` and loaded into the in-memory vectorstore.
- **Retrieval**: When a user sends a message, the chatbot retrieves the top 4 most relevant chunks using **token-overlap ranking**, then passes them as context to Azure OpenAI LLM.
- **Response**: LLM generates markdown-formatted reply tailored to the page context (MRF, Broker, or Municipality).

## Next Steps: Persistent Chroma Database

For production with **larger knowledge bases**, integrate the existing Chroma Python script:

```bash
cd Generation
python build_chroma_vectorstore.py
```

This persists embeddings to disk (Chroma DB) and replaces the in-memory vectorstore. Update `chatbotVectorstoreService.ts` to query the Chroma REST endpoint instead of in-memory storage.

---

**Current Setup**: 9 documents, token-overlap ranking, ~320 total tokens of context per query.  
**Scaling**: Add more sections to `game_documentation.txt` (no code changes needed). For 1000+ documents, migrate to Chroma DB.
