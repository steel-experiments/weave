# Start Child Session Service Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Add a service-level API for creating child threads with lineage before adding author-facing `ctx.spawn`.

## Non-goals

- Do not implement `ctx.spawn`.
- Do not implement `ctx.join`.
- Do not add multi-thread append transactions.
- Do not add runtime selection for child agents yet.

## User Outcome

API and integration code can attach a child session to an existing parent thread and get consistent lineage, replay input, and parent timeline evidence.

## Architecture Impact

- Adds `ThreadService.startChildSession(input)`.
- Creates the child thread with lineage via `ThreadEngine.createThread(threadId, options)`.
- Starts the child with normal `session.started` and `prompt.received` events.
- Stores child agent input in `session.started.payload.metadata`, matching the current `agent.run` input path.
- Appends `child_thread.spawned` to the parent thread idempotently.
- Supports deterministic child thread/correlation IDs when `idempotencyKey` is provided.

## Acceptance Criteria

- [x] Child sessions record `parentThreadId`, `rootThreadId`, `parentScopeKey`, and `parentStepKey` in projection lineage.
- [x] Child sessions append `session.started` and `prompt.received` to the child thread.
- [x] Parent threads receive one `child_thread.spawned` event.
- [x] Repeating a child session request with the same `idempotencyKey` returns the same child and does not duplicate events.
- [x] Existing replay tests and demos still pass.

## Completion Notes

Changed modules:

- `src/thread-service.ts`: `StartChildSessionInput`, `StartChildSessionResult`, and `startChildSession`.
- `src/tests/replay-authoring.test.ts`: child session lineage and idempotency tests.
- `src/weave-interface.ts`: public boundary sketch update.
- `docs/declarative-api.md`: service API documentation.

Known follow-ups:

- Runtime support for selecting/starting child agent runners.
- `ctx.spawn` durable effect on top of `startChildSession`.
- `ctx.join` durable effect consuming child lifecycle events.
- Automatic mirroring from child terminal events into parent `child_thread.completed` / `child_thread.failed`.
