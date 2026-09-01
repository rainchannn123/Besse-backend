# SKILLS.md — `src/models`

## Directory Purpose
Defines persistent domain entities and schema-level rules used by services.

## Files and Responsibilities

### `GameSession.ts`
- Represents game session state and progression data.
- Stores lifecycle fields relevant to rounds/stages/results.

### `Lobby.ts`
- Represents lobby-level orchestration state.
- Tracks participants, stage transitions, and readiness conditions.

### `PairScore.ts`
- Represents score data at pair/team granularity.
- Supports ranking/scoring workflows in calculation/game services.

### `User.ts`
- Represents user identity/profile/auth-related persisted fields.

### `AdminMonitorTelemetry.ts`
- Stores aggregated live-monitor telemetry snapshots for admin dashboards.

### `MatchmakingRoom.ts`
- Stores room/team/player seating for matchmaking flows.

## Removed Model
- `ActivityLog.ts` was removed to stop API activity-history persistence growth.

## Model Editing Guidelines
- Keep schemas aligned with service assumptions and API contracts.
- Add indexes/constraints thoughtfully for query paths used in services.
- Avoid embedding transient computation-only fields unless required.

## Typical Change Flows
- New persisted field:
  1. Add to model schema.
  2. Update related service create/update/read logic.
  3. Update types and response mappings if externally visible.

## Risks
- Schema changes without migration/default handling may break existing data.
- Renaming/removing fields can cascade failures in services/controllers.
