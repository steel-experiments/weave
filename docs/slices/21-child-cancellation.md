# Child Cancellation Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Let parent agents and runtime callers cancel known child threads with durable terminal evidence.

## Non-goals

- Do not add a separate `cancelled` thread status yet.
- Do not interrupt in-flight JavaScript execution or tool processes.
- Do not add cascading cancellation for descendants.
- Do not add per-agent scheduling or cancellation policy.

## User Outcome

As a parent agent, I can cancel child work I no longer need, and later joins observe a structured failed child result with `CHILD_CANCELLED`.

## Architecture Impact

- Adds `ThreadService.cancelChildThread` for service-level cancellation.
- Adds `ctx.cancelChild(key, child, options)` as a replay-safe durable parent effect.
- Records cancellation on the child as terminal `agent.failed` with `errorCode: "CHILD_CANCELLED"`.
- Mirrors the terminal child state into the parent as `child_thread.failed` for the cancellation key.
- Keeps thread projection semantics unchanged: cancelled children are represented as failed threads for now.

## Implementation Plan

1. Add child cancellation option and result types.
2. Implement `ThreadService.cancelChildThread` with parent-child validation.
3. Add replay-safe `ctx.cancelChild`.
4. Add tests proving cancellation records child failure and can be observed through `ctx.join`.
5. Update public docs and slice index.

## Test Plan

- Service/context test that cancellation appends a child `agent.failed` event with `CHILD_CANCELLED`.
- Replay test that `ctx.cancelChild` does not duplicate cancellation on replay.
- Join test that a cancelled child returns a failed join result.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] `ctx.cancelChild` cancels a spawned child with a stable key.
- [x] Child cancellation records terminal `agent.failed` with `CHILD_CANCELLED`.
- [x] Parent receives a `child_thread.failed` event for the cancellation key.
- [x] Joining a cancelled child returns a failed result.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add cancellation service API.
- [x] Add context helper.
- [x] Add regression tests.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- `ThreadService.cancelChildThread` validates the parent-child relationship and records child cancellation.
- `ctx.cancelChild(key, child, options)` is a replay-safe durable effect.
- Cancellation records child `agent.failed` with `errorCode: "CHILD_CANCELLED"` and the provided reason as the message.
- Cancellation mirrors parent `child_thread.failed` under the cancellation key.
- Later joins can mirror and return the cancelled child as a failed join result.

Changed modules:

- `src/thread-service.ts`: adds service-level child cancellation.
- `src/agent-contract.ts`: adds `CancelChildOptions` and `AgentContext.cancelChild`.
- `src/agent-runner.ts`: adds replay-safe cancellation effect.
- `src/weave-interface.ts`: updates the public boundary sketch.
- `src/tests/replay-authoring.test.ts`: adds cancellation and join-cancelled-child coverage.
- `docs/declarative-api.md`: documents `ctx.cancelChild`.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- Cancelled children use failed thread semantics; there is no separate `cancelled` status yet.
- Cancellation does not interrupt currently executing JavaScript or external tool processes.
- Descendant cancellation is not cascaded.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
