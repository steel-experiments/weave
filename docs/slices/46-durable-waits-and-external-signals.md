# Durable Waits And External Signals Slice

## Status

- Vertical: `weave-core`
- Status: `Planned`
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
const payload = await ctx.waitFor("wait-for-webhook", {
  signal: "github.check.completed",
  schema: z.object({ conclusion: z.string() }),
});
```

Final syntax should be chosen during implementation.

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

- [ ] Durable wait helper exists.
- [ ] External signal delivery path exists.
- [ ] Waits are replay-safe and idempotent.
- [ ] Signal payloads are schema-validated.
- [ ] Pending waits do not duplicate events.
- [ ] Received signals resume agent execution.
- [ ] Docs explain waits versus gates, timers, and integrations.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Design wait/signal taxonomy.
- [ ] Implement context helper.
- [ ] Implement signal delivery path.
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
