# AGENT.md

## Purpose
This file gives fast, practical guidance for future coding tasks in `Besse-backend`, reducing repeated full-repository reads and speeding up safe edits.

## Working Principles (Short Guidelines)
- Prefer **minimal, targeted edits** to preserve existing behavior.
- Follow the current architecture: **route → controller → service → model/utils**.
- Keep business logic in `services/`, not in controllers/routes.
- Reuse shared helpers in `utils/` and shared types in `types/` before creating new abstractions.
- Preserve existing middleware chains (auth, security, rate limiting, error handling).
- Ensure API responses remain consistent with existing response helpers/patterns.
- For socket-related changes, verify handshake/auth consistency with `middleware/socketAuth.ts` and `services/websocketService.ts`.
- Add/update tests for non-trivial logic changes (see `src/services/__tests__/`).
- Avoid broad refactors unless explicitly requested.

## Backend Structure Overview (`src/`)

### `app.ts`
Application bootstrap and global wiring point.
- Initializes Express app.
- Applies middleware and route registration.
- Likely integrates Swagger/config and error handlers.

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
- Logging and centralized error propagation.
- Socket authentication gate.

### `models/`
Persistence/domain data structures.
- Mongoose/ODM models for game, lobby, user, scoring domain entities.

### `routes/`
Route-to-controller bindings by feature.
- Feature-specific routers (auth, game, lobby, admin, etc.).

### `services/`
Core business logic.
- Domain rules, transitions, orchestration, calculations.
- Includes websocket integration service and targeted tests.

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
- Need schema/data constraints? Inspect `models/*` and any validation in `utils/validation.ts`.

## Safe-Change Checklist
- Confirm touched flow in matching route/controller/service chain.
- Keep backward compatibility for API payloads unless asked otherwise.
- Re-run/extend tests around modified business logic.
- Preserve centralized error handling behavior (`utils/AppError.ts`, `middleware/errorHandler.ts`).
- Update `.docs/*/SKILLS.md` if architecture/behavior changes materially.

## Important note for code editing tasks
- You are allowed to run terminal commands and implement the revised code directly into my code files.
- If there is a "/.docs" directory in the code base, you should select and read the appropriate SKILLS.md files within that directory to gain more detailed structure knowledge of the code base you are working on, to better plan your task and enhance your response performance.