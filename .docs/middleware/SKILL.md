# SKILLS.md — `src/middleware`

## Directory Purpose
Implements reusable cross-cutting request/socket concerns used before controller execution or during global error handling.

## Files and Responsibilities

### `adminAuth.ts`
- Enforces admin-level authorization checks.
- Typically assumes authenticated user context exists.

### `auth.ts`
- Validates auth credentials/tokens for protected routes.
- Attaches user/session identity context to request.

### `errorHandler.ts`
- Centralized Express error middleware.
- Normalizes thrown errors into stable API error responses.

### `logger.ts`
- Request/response logging middleware.
- Provides operational traceability.

### `socketAuth.ts`
- Socket handshake/auth guard.
- Attaches `user`, `userId`, and per-socket `authorizedSessionIds` cache used by websocket authorization paths.

### `rateLimiter.ts`
- Request throttling middleware.
- Protects against abuse/spikes on sensitive endpoints.

### `security.ts`
- Security middleware bundle (headers, sanitization, CORS/policies as configured).

## Removed Middleware
- `activityLogger.ts` was intentionally removed.
- API request history is no longer written to MongoDB by middleware hooks.

## Middleware Ordering Principles
- Security + parsing + logging early.
- Auth before role-based checks.
- Error handler last.
- Socket auth integrated in websocket setup path.

## Typical Change Flows
- New protected endpoint: apply `auth` and possibly `adminAuth` in route chain.
- Token strategy update: align `auth.ts` and `socketAuth.ts` behavior.
- Error contract update: modify `errorHandler.ts` carefully to preserve clients.
- Socket auth cache changes: keep `socketAuth.ts` and `services/websocketService.ts` in sync.

## Risks
- Middleware order regressions can break auth/security silently.
- Divergent auth logic between HTTP and sockets causes hard-to-debug state mismatch.
