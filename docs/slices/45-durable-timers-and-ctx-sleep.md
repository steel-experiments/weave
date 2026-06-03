# Durable Timers And ctx.sleep Slice

## Status

- Vertical: `weave-core`
- Status: `Planned`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Add a durable timer primitive, starting with `ctx.sleep`, so agents can suspend and resume after a time boundary without relying on in-process timers.

## Non-goals

- Do not add arbitrary workflow scheduling.
- Do not add cron or recurring schedules.
- Do not add external signal waits.
- Do not change tool execution semantics.
- Do not require a new storage backend.

## User Outcome

As an agent author, I can wait durably until a future time using a stable key and have the runner resume the thread after the timer fires.

## Architecture Impact

- Adds timer request and fired event semantics.
- Extends runnable inbox or daemon behavior to wake threads after timers fire.
- Adds `ctx.sleep(key, durationOrUntil)` or equivalent public helper.
- Requires replay/idempotency behavior similar to `ctx.tool`, `ctx.gate`, and `ctx.spawn`.
- May require database indexes or migration for due timers if timers are stored outside normal event scans.

## Proposed Public API Sketch

```ts
await ctx.sleep("wait-for-cooldown", { seconds: 30 });

await ctx.sleep("wait-until-window", { until: "2026-06-03T15:00:00.000Z" });
```

Final syntax should be chosen during implementation.

## Implementation Plan

1. Define timer event taxonomy and projection behavior.
2. Decide whether timers use regular thread events plus inbox or a dedicated due-timer table.
3. Add `ctx.sleep` replay semantics and mismatch checks.
4. Add daemon or service behavior to mark due timers fired and wake the runner.
5. Add tests for missing, pending, fired, replay, and mismatch states.
6. Update docs.

## Test Plan

- First `ctx.sleep` call records a durable timer request and suspends.
- Pending timer replays without duplicate events.
- Fired timer lets agent continue.
- Same key with changed timer target raises `ReplayMismatchError`.
- Runner wakes after timer fire path in integration test where practical.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] `ctx.sleep` or equivalent durable timer helper exists.
- [ ] Timer identity is stable and replay-safe.
- [ ] Pending timers do not duplicate events.
- [ ] Fired timers resume agent execution.
- [ ] Timer mismatch raises `ReplayMismatchError`.
- [ ] Docs explain durable timer limitations.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Design timer event taxonomy.
- [ ] Implement context helper.
- [ ] Implement wake/resume path.
- [ ] Add tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/event-taxonomy.md`
- [ ] `docs/architecture.md`
- [ ] `docs/glossary.md`
