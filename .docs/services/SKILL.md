# SKILLS.md — `src/services`

## Directory Purpose
Houses core backend business logic and orchestration. Services should remain the primary source of domain rules.

## Files and Responsibilities

### `adminService.ts`
- Admin-level domain operations and management workflows.

### `authService.ts`
- Authentication workflows (credential handling, token/session logic, user auth state helpers).

### `brokerService.ts`
- Broker domain business operations.

### `calculationService.ts`
- Scoring/calculation algorithms and derived result computations.

### `gameService.ts`
- Game session lifecycle and core game actions.

### `lobbyService.ts`
- Lobby lifecycle orchestration, participant/state transitions.
- High-value file for multiplayer/session flow debugging.

### `mrfService.ts`
- MRF domain business logic.

### `municipalityService.ts`
- Municipality domain business logic.

### `userService.ts`
- User profile/state utilities and domain operations outside pure auth.

### `websocketService.ts`
- Real-time event orchestration and broadcasting logic.
- Works closely with socket auth + lobby/game state changes.

### `__tests__/lobbyService.continueToRoleSelection.test.ts`
- Targeted test coverage for lobby progression behavior.
- Useful template for writing additional service-level tests.

## Service Design Rules
- Keep domain rules centralized here.
- Keep controllers thin and models passive.
- Return predictable structures or throw standardized errors.
- Reuse utility helpers for validation, tokens, and responses where appropriate.

## High-Value Tracing Patterns
- Lobby/game bug: trace `lobbyService.ts` ↔ `gameService.ts` ↔ `websocketService.ts`.
- Score mismatch: inspect `calculationService.ts` input assumptions and model reads.
- Auth propagation issues: inspect `authService.ts` with middleware/token utils.

## Risks
- Service-to-service coupling can create hidden side effects.
- Real-time emits not aligned with persisted state can desync clients.
