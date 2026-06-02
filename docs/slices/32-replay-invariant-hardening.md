# Replay Invariant Hardening Slice

## Status

- Vertical: `weave-core`
- Status: `Proposed`
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

- [ ] Long thread replay does not miss durable events after page boundaries.
- [ ] Completed agents do not append duplicate terminal response or output events.
- [ ] Current durable effects append once when missing.
- [ ] Current durable effects append nothing while pending where applicable.
- [ ] Current durable effects return recorded values when completed.
- [ ] Changed payloads or effect-kind reuse throw `ReplayMismatchError`.
- [ ] Concurrent durable effects remain rejected with `ParallelDurableEffectError`.

## Progress

- [ ] Inventory existing replay coverage.
- [ ] Add missing invariant tests.
- [ ] Update replay documentation.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

Include:

- invariants covered
- tests added or confirmed existing
- commands run
- known limitations

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] upgrade or migration guide
