# Subthread Lineage Foundation Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Prepare Weave for real child threads by adding the durable lineage fields and parent thread lifecycle events before implementing `ctx.spawn`.

## Non-goals

- Do not implement `ctx.spawn`.
- Do not implement `ctx.join`.
- Do not add child-session service APIs yet.
- Do not mirror child lifecycle events automatically yet.

## User Outcome

Runtime and storage code can now represent parent-child thread relationships consistently, and future subthread APIs have typed event contracts to build on.

## Architecture Impact

- Adds optional lineage to thread creation: `parentThreadId`, `rootThreadId`, `parentScopeKey`, and `parentStepKey`.
- Adds lineage fields to `ThreadProjection`.
- Persists lineage columns in `weave.thread` and indexes parent/root lookups.
- Adds child thread parent events:
  - `child_thread.spawned`
  - `child_thread.completed`
  - `child_thread.failed`
- Routes child completion/failure events to the parent runner inbox for future `ctx.join` wakeups.

## Acceptance Criteria

- [x] Existing root session creation still works and defaults `rootThreadId` to the thread id.
- [x] `ThreadProjection` exposes lineage fields.
- [x] Child-thread event schemas parse through `ThreadEventSchema`.
- [x] Existing replay tests and demos still pass.

## Completion Notes

Changed modules:

- `src/contracts.ts`: `CreateThreadOptions`.
- `src/events.ts`: child-thread event schemas and projection lineage fields.
- `src/migrate.ts`: lineage columns and indexes.
- `src/postgres-engine.ts`: lineage persistence/projection read model and child lifecycle inbox routing.
- `src/tests/replay-authoring.test.ts`: schema regression coverage.

Known follow-ups:

- `ctx.spawn` durable effect.
- `ctx.join` durable effect.
- Parent lifecycle mirroring when child threads complete or fail.
