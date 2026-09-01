# AGENT.md

## Purpose
This file gives fast, practical guidance for future coding tasks in `Besse-backend`, reducing repeated full-repository reads and speeding up safe edits.

## Working Principles (Short Guidelines)
- Prefer **minimal, targeted edits** to preserve existing behavior.
- Follow the current architecture: **route → controller → service → model/utils**.
- Keep business logic in `services/`, not in controllers/routes.
- Reuse shared helpers in `utils/` and shared types in `types/` before creating new abstractions.
- Preserve existing middleware chains (auth, security, rate limiting, error handling).
- Keep API-level activity-history logging **disabled** unless explicitly requested to reintroduce it.
- Ensure API responses remain consistent with existing response helpers/patterns.
- For socket-related changes, verify handshake/auth consistency with `middleware/socketAuth.ts` and `services/websocketService.ts`.
- Add/update tests for non-trivial logic changes (see `src/services/__tests__/`).
- Avoid broad refactors unless explicitly requested.

## Backend Structure Overview (`src/`)

### `app.ts`
Application bootstrap and global wiring point.
- Initializes Express app.
- Applies middleware and route registration.
- Integrates Swagger/config and error handlers.
- Configures Socket.IO ping resilience + websocket traffic controls from `env.ts`.

### `config/`
Environment and platform configuration.
- `database.ts`: DB connection and setup logic.
- `env.ts`: environment variable loading/validation.
- `swagger.ts`: API docs configuration.

### `constants/`
Shared constant values.
- `constants.ts`: static config values/enums/limits used across modules.

### `controllers/`
HTTP boundary layer.
- Parses request data.
- Delegates to services.
- Returns standardized responses/errors.

### `middleware/`
Cross-cutting request/socket concerns.
- Auth/admin checks.
- Security/rate limiting.
- Request logging and centralized error propagation.
- Socket authentication gate.
- `activityLogger.ts` was removed; API activity-history persistence is intentionally shut down.

### `models/`
Persistence/domain data structures.
- Mongoose/ODM models for game, lobby, user, scoring domain entities.

### `routes/`
Route-to-controller bindings by feature.
- Feature-specific routers (auth, game, lobby, admin, etc.).
- `adminRoutes.ts` no longer exposes activity-log endpoints.
- **Chatbot routes** (`chatbotRoutes.ts`): Three endpoints—
  - `GET /api/chatbot/status`: Returns vectorstore doc count (diagnostic).
  - `POST /api/chatbot/message`: Accepts `{message, pageContext, sessionId, history}`, returns `{success, reply}` with markdown LLM response.
  - `POST /api/chatbot/ingest-docs`: Reads `docs/game_documentation.txt`, chunks at 1000 chars, writes to `Generation/chroma_docs.json`, populates in-memory vectorstore.

### `services/`
- Core business logic.
- Domain rules, transitions, orchestration, calculations.
- Includes websocket integration service and targeted tests.
- `websocketService.ts` includes session auth caching, team-chat flood controls, and coalesced game-state emits.
- `activityLogService.ts` was removed; no DB writes for API history should occur.
- **Chatbot services** (`chatbotService.ts`, `chatbotVectorstoreService.ts`):
  - `chatbotService.ts`: Orchestrates RAG pipeline—retrieves 4 context chunks from vectorstore, sends to Azure OpenAI REST endpoint with page-specific system prompt, returns markdown-formatted response. Gracefully falls back if keys absent.
  - `chatbotVectorstoreService.ts`: In-memory vectorstore using token-overlap ranking. Methods: `upsertMany(docs)`, `retrieve(query, topK)`, `count()`, `clear()`.

### `types/`
Shared TypeScript type contracts.
- `index.ts`: common interfaces/types for services/controllers.

### `utils/`
Reusable primitives.
- Error wrappers, async helpers, JWT utilities, code generators, response helpers, validation helpers.

## High-Value Navigation Heuristics
- Need endpoint behavior? Start at `routes/*` → `controllers/*` → `services/*`.
- Need game/lobby lifecycle logic? Prioritize `services/lobbyService.ts` and `services/gameService.ts`.
- Need auth bugs? Inspect `middleware/auth.ts`, `middleware/adminAuth.ts`, `controllers/authController.ts`, `services/authService.ts`, `utils/jwt.ts`.
- Need socket issues? Inspect `middleware/socketAuth.ts` + `services/websocketService.ts`.
- Need disconnect/timeout/flood issues? Inspect `config/env.ts` websocket knobs + `app.ts` Socket.IO config + `services/websocketService.ts` rate/coalesce logic.
- Need schema/data constraints? Inspect `models/*` and any validation in `utils/validation.ts`.
- **Chatbot/RAG issue**: Check `services/chatbotService.ts` (LLM calls, context retrieval) → `services/chatbotVectorstoreService.ts` (document ranking, retrieval) → `routes/chatbotRoutes.ts` (endpoint handlers) → `config/env.ts` (Azure credentials, CHATBOT_PROVIDER setting).

## Safe-Change Checklist
- Confirm touched flow in matching route/controller/service chain.
- Keep backward compatibility for API payloads unless asked otherwise.
- Re-run/extend tests around modified business logic.
- Preserve centralized error handling behavior (`utils/AppError.ts`, `middleware/errorHandler.ts`).
- Update `/.docs/*/SKILL.md` if architecture/behavior changes materially.

## Important note for code editing tasks
- You are allowed to run terminal commands and implement the revised code directly into my code files.
- If there is a `/.docs` directory in the code base, read the relevant `SKILL.md` files first to align with local structure and conventions before editing.
