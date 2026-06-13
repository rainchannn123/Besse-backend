# SKILLS.md — `src/config`

## Directory Purpose
`src/config` centralizes environment, infrastructure, and tooling configuration for backend bootstrapping.

## Files and Responsibilities

### `database.ts`
**Role:** Database connectivity lifecycle.
- Establishes DB connection (likely MongoDB/Mongoose).
- Encapsulates connection options and retry/connection logging behavior.
- Exposes initialization function used during app startup.

**How to work safely:**
- Keep connection logic isolated; do not mix business logic here.
- Preserve startup failure behavior (fail fast vs retry) unless explicitly changing reliability policy.

### `env.ts`
**Role:** Environment variable source of truth.
- Loads and validates required env vars.
- Exposes typed config object used across app.

**How to work safely:**
- Add new vars here first, with defaults/validation.
- Keep naming consistent and explicit.
- Avoid direct `process.env.*` scattering elsewhere; consume via exported config when possible.

### `swagger.ts`
**Role:** API documentation configuration.
- Defines OpenAPI metadata and route integration.
- Registers docs endpoint and schema references.

**How to work safely:**
- Keep version/title/base path synchronized with actual routes.
- Update docs when request/response contracts change.

## Typical Change Flows
- New infra setting: update `env.ts` → consume in relevant modules.
- DB option tuning: update `database.ts` and verify startup behavior.
- API docs update: adjust `swagger.ts` and any schema references used by controllers/routes.

## Dependencies/Touchpoints
- Used by `src/app.ts` during initialization.
- Influences behavior in services/controllers through exported config.
