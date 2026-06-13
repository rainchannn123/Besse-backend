# SKILLS.md — `src/types`

## Directory Purpose
Defines shared TypeScript contracts used across controllers/services/models/utils.

## Files and Responsibilities

### `index.ts`
- Aggregates exported interfaces, type aliases, and domain contracts.
- Helps maintain compile-time consistency across modules.

## Type Management Guidelines
- Add shared domain/request/response types here when reused.
- Prefer explicit, narrow types over `any`.
- Keep naming aligned with domain language used in services/controllers.

## Typical Change Flows
- New API payload shape:
  1. Define or update type in `index.ts`.
  2. Apply in controller signatures/service contracts.
  3. Align runtime validation/utilities if needed.

## Risks
- Silent drift between runtime behavior and static type definitions.
- Overly broad optional fields can hide integration bugs.
