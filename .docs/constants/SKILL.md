# SKILLS.md — `src/constants`

## Directory Purpose
Holds shared static values to avoid magic numbers/strings across the codebase.

## Files and Responsibilities

### `constants.ts`
**Role:** Canonical constant registry.
- Stores reusable values (status labels, limits, stage names, timing values, error codes, etc.).
- Supports consistency across services, controllers, and middleware.

## Usage Guidelines
- Prefer adding reusable values here over inline literals in business logic.
- Group constants by domain (auth/game/lobby/system) for readability.
- Use descriptive names reflecting intent, not implementation details.

## Typical Change Flows
- New game rule threshold: define/update constant here, then consume in calculation/game services.
- New response label/status: define once and reuse in controllers/services.

## Risk Notes
- Changing existing constants may silently alter business behavior globally; assess all references.
- If values are environment-dependent, prefer `config/env.ts` instead.
