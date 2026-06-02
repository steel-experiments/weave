# Replay Invariant Hardening Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Turn the replay semantics introduced by the run-first API into explicit, durable regression tests.

## Non-goals

- Do not add continuation persistence.
- Do not support arbitrary parallel durable effects.
- Do not change stable key semantics unless a bug is found.
- Do not introduce new durable effect kinds.

## User Outcome

As an app author, I can trust that stable-keyed durable effects append once, replay recorded values, reject mismatches, and never duplicate terminal output.

## Architecture Impact

- Hardens `src/agent-runner.ts` replay behavior.
- Hardens `ThreadRunner` full-history reads and terminal idempotency.
- Adds regression coverage for all current durable context effects.
- No event taxonomy changes are expected unless a missing terminal event is discovered.

## Implementation Plan

1. Review existing replay tests and mark already-covered invariants.
2. Add missing terminal idempotency coverage for completed agents.
3. For each durable effect, verify missing, pending, completed, and changed-payload behavior.
4. Verify effect-kind reuse throws `ReplayMismatchError`.
5. Verify full-history replay still reads past page boundaries and sees terminal events after the first page.
6. Verify parallel durable effects continue to throw `ParallelDurableEffectError`.
7. Update docs to describe replay as event-log replay, not JS continuation persistence.

## Test Plan

- `ThreadRunner` test with more than 1000 events and durable events after the first page.
- Terminal idempotency test for `agent.response.produced` and `agent.output.completed`.
- Lifecycle tests for `ctx.tool`, `ctx.gate`, `ctx.checkpoint`, `ctx.emit`, `ctx.spawn`, and `ctx.join`.
- Effect-kind reuse mismatch tests.
- Parallel durable effect rejection tests for homogeneous and mixed effect kinds.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Long thread replay does not miss durable events after page boundaries.
- [x] Completed agents do not append duplicate terminal response or output events.
- [x] Current durable effects append once when missing.
- [x] Current durable effects append nothing while pending where applicable.
- [x] Current durable effects return recorded values when completed.
- [x] Changed payloads or effect-kind reuse throw `ReplayMismatchError`.
- [x] Concurrent durable effects remain rejected with `ParallelDurableEffectError`.

## Progress

- [x] Inventory existing replay coverage.
- [x] Add missing invariant tests.
- [x] Update replay documentation.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Confirmed existing coverage for full-history replay, duplicate tool prevention, effect-kind reuse mismatch, checkpoint/gate/spawn payload mismatch, child join variants, and parallel durable effect rejection.
- Added terminal idempotency coverage proving completed run-first agents do not append duplicate `agent.response.produced` or `agent.output.completed` events on later runner passes.
- Added `ctx.emit` replay coverage proving an already emitted event is treated as a no-op before terminal output is appended.
- Updated the declarative API docs to state terminal response/output replay idempotency explicitly.

Changed modules:

- `src/tests/replay-authoring.test.ts`: adds terminal idempotency and `ctx.emit` replay no-duplicate tests.
- `docs/declarative-api.md`: documents terminal idempotency.

Commands run:

- `npm test`
- `npm run typecheck`

Known limitations:

- V1 still does not support arbitrary parallel durable effects or JavaScript continuation persistence.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [ ] upgrade or migration guide
