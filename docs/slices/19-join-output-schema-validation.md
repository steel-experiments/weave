# Join Output Schema Validation Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Validate raw child output returned by `ctx.join` against the child agent output schema when that schema is available from `ctx.spawn`.

## Non-goals

- Do not add persisted schema identifiers or schema registry support.
- Do not validate child refs returned by `ThreadService.listChildren` unless they carry a runtime schema.
- Do not change the persisted `child_thread.completed` event shape.
- Do not remove `outputSummary` fallback behavior.

## User Outcome

As a Weave app author, when I spawn a child agent with an output schema and then join it, Weave rejects mismatched raw child output instead of returning an incorrectly typed `AgentRun.output`.

## Architecture Impact

- `ThreadRef` can carry an optional in-memory output schema.
- `ctx.spawn` attaches the child agent output schema to replayed refs when present.
- `ctx.join` validates `child_thread.completed.payload.output` before returning `AgentRun.output`.
- Invalid joined output uses the existing `ReplayMismatchError`, matching failed stored tool output replay semantics.

## Implementation Plan

1. Add an optional output schema field to `ThreadRef`.
2. Attach `childAgent.output` to refs returned by replayed `ctx.spawn`.
3. In `ctx.join`, validate raw completed output against `thread.outputSchema` when both are present.
4. Add replay tests for valid and invalid joined output.
5. Update slice index when shipped.

## Test Plan

- Replay test where a child output schema accepts mirrored raw output and `ctx.join` returns it.
- Replay test where the mirrored raw output fails the child output schema and `ctx.join` throws `ReplayMismatchError`.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] `ctx.spawn` carries a child agent output schema on replayed `ThreadRef`s when available.
- [x] `ctx.join` returns valid raw output unchanged.
- [x] `ctx.join` throws `ReplayMismatchError` for invalid raw output when the child ref has an output schema.
- [x] Existing no-schema joins continue to work.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add output schema to child refs.
- [x] Validate join output.
- [x] Add regression tests.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- `ThreadRef` can carry an optional in-memory `outputSchema`.
- Replayed `ctx.spawn` refs include the child agent output schema when declared.
- `ctx.join` validates raw `child_thread.completed.payload.output` before returning `AgentRun.output` when a schema is present.
- Invalid joined output throws `ReplayMismatchError`.

Changed modules:

- `src/agent-contract.ts`: adds optional `ThreadRef.outputSchema`.
- `src/weave-interface.ts`: updates the public boundary sketch.
- `src/agent-runner.ts`: attaches spawn output schemas and validates join output.
- `src/tests/replay-authoring.test.ts`: adds valid and invalid structured child output join coverage.
- `docs/declarative-api.md`: documents join output validation.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- Service-created or listed child refs validate only if the caller supplies an output schema on the ref.
- There is still no persisted schema identifier or registry for validating historical joins without in-memory agent contracts.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
