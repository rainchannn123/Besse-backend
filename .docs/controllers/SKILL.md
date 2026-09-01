# SKILLS.md — `src/controllers`

## Directory Purpose
Controllers are the HTTP adapter layer: they translate requests into service calls and map service results/errors into API responses.

## Files and Responsibilities

### `adminController.ts`
- Admin-facing endpoints.
- Delegates authorization-sensitive operations to admin service logic.
- Handles admin auth, monitor overview, room live overview, player history, and force-exit actions.
- Activity-log fetch handlers were removed.

### `authController.ts`
- Authentication endpoints (login/register/me/refresh/logout patterns as implemented).
- Works with auth service + token utilities.

### `brokerController.ts`
- Broker-related HTTP operations.
- Delegates workflow/business checks to broker service.

### `gameController.ts`
- Game session and progression endpoints.
- Calls game/calculation/lobby services depending on flow.

### `lobbyController.ts`
- Lobby lifecycle endpoints (create/join/transition/state retrieval).
- Thin orchestration over `lobbyService`.

### `mrfController.ts`
- MRF feature endpoints.
- Delegates business rules to `mrfService`.

### `municipalityController.ts`
- Municipality feature endpoints.
- Delegates domain operations to `municipalityService`.

## Controller Standards (for future edits)
- Keep controllers thin: validate/parse input, call service, return response.
- No heavy business rules in controllers.
- Use centralized async/error wrappers (`utils/asyncHandler.ts`, `utils/AppError.ts`).
- Keep response structure consistent with shared response utilities.
- Chatbot controllers should validate message payloads and delegate retrieval/LLM invocation to `chatbotService.ts`.

## Typical Debug Path
Route mismatch or bad payload handling:
1. Confirm route binding in `src/routes/*`.
2. Check controller parameter extraction and validation.
3. Trace service call arguments and returned shape.

## Common Risks
- Duplicating validation/business checks that already exist in services.
- Returning inconsistent response format/status codes.
