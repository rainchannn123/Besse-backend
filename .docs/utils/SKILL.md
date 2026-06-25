# SKILLS.md — `src/utils`

## Directory Purpose
Reusable low-level helpers that standardize cross-module behavior and reduce duplication.

## Files and Responsibilities

### `AppError.ts`
- Custom application error abstraction.
- Encodes status/metadata consumed by error middleware.

### `asyncHandler.ts`
- Wraps async route handlers to forward thrown errors safely.

### `jwt.ts`
- JWT creation/verification helper utilities.
- Shared by auth middleware/services/controllers.

### `lobbyCode.ts`
- Lobby code generation/format utilities.

### `logger.ts`
- Logging utility abstraction for internal module logs.

### `response.ts`
- Standardized API success/error response helpers.

### `validation.ts`
- Input/domain validation helpers reused by controllers/services.

## Utility Usage Guidelines
- Use utilities to keep service/controller code focused on domain intent.
- Keep utilities stateless and deterministic where practical.
- Avoid placing business workflow logic in utilities.

## Typical Change Flows
- Need new shared formatter/validator: add here, then reuse across modules.
- Error response changes: align `AppError.ts`, `response.ts`, and `middleware/errorHandler.ts`.
- Auth token changes: update `jwt.ts` + dependent auth middleware/service flows.

## Risks
- Changing utility behavior can have wide cross-cutting impact.
- Over-generalized utility functions can reduce readability and hide domain intent.
