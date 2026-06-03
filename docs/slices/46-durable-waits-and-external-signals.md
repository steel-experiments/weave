# Durable Waits And External Signals Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Add a durable wait primitive for external signals so agents can suspend until an external event arrives without polling or holding a JavaScript continuation.

## Non-goals

- Do not add this before durable timers are understood unless a concrete product need requires it.
- Do not add a general workflow engine.
- Do not add arbitrary event bus subscriptions.
- Do not replace integrations.
- Do not add policy/capability semantics beyond checking existing request boundaries if needed.

## User Outcome

As an agent author, I can wait durably for a named external signal and resume the thread when an integration or API records that signal.

## Architecture Impact

- Adds durable wait request and signal received event semantics.
- Extends integrations or thread service APIs to deliver signals into waiting threads.
- Adds replay/idempotency behavior similar to gates and timers.
- May require projection/index support for pending waits.
- Should preserve the thread event log as the source of truth.

## Proposed Public API Sketch

```ts
const payload = await ctx.waitForSignal("wait-for-webhook", {
  signal: "github.check.completed",
  schema: z.object({ conclusion: z.string() }),
});
```

Final syntax is `ctx.waitForSignal(key, { signal, schema })`.

## Implementation Plan

1. Define external signal vocabulary and event taxonomy.
2. Decide how integrations/API calls deliver signals to threads.
3. Add `ctx.waitFor` or equivalent context helper.
4. Add replay semantics for missing, pending, received, and mismatch states.
5. Add schema validation for signal payloads.
6. Add tests for idempotent delivery and replay.
7. Update docs.

## Test Plan

- First wait records durable wait request and suspends.
- Pending wait replays without duplicate events.
- Delivered signal resumes agent and returns typed payload.
- Duplicate signal delivery is idempotent or documented.
- Changed wait key/signal/schema behavior is tested.
- Integration/API signal delivery path is covered where practical.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Durable wait helper exists.
- [x] External signal delivery path exists.
- [x] Waits are replay-safe and idempotent.
- [x] Signal payloads are schema-validated.
- [x] Pending waits do not duplicate events.
- [x] Received signals resume agent execution.
- [x] Docs explain waits versus gates, timers, and integrations.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Design wait/signal taxonomy.
- [x] Implement context helper.
- [x] Implement signal delivery path.
- [x] Add tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- Added `ctx.waitForSignal(key, { signal, schema })` for named external signal waits.
- Added `signal.waiting` and `signal.received` event schemas.
- Added `ThreadService.deliverSignal(...)` as the integration/API delivery path for satisfying a recorded wait.
- Replay behavior matches other durable effects: missing waits record `signal.waiting`, pending waits append nothing, and received signals validate payload data before returning it.
- Duplicate delivery for the same wait and same payload hash is idempotent; different payload delivery for an already satisfied wait raises `ReplayMismatchError`.
- `signal.received` wakes the runner and uses the `signal-received` resume reason.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
- [x] `docs/architecture.md`
- [x] `docs/glossary.md`
