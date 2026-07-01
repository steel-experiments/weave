# Agent Output Schema Validation Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Validate `agent.run` return values against declared agent output schemas before storing raw agent output events.

## Non-goals

- Do not validate historical `agent.output.completed` events during normal replay.
- Do not add persisted schema identifiers or a schema registry.
- Do not change planner-first agent behavior.
- Do not remove support for agents without output schemas.

## User Outcome

As a Weave app author, if I declare `agent({ output })`, invalid returned values fail the thread durably instead of being stored as canonical raw output.

## Architecture Impact

- `createAgentPlanner` validates run-first agent output when `agent.output` is present.
- Valid parsed output is used for response formatting and `agent.output.completed`.
- Invalid output raises `WeaveError` with `AGENT_OUTPUT_INVALID`, which `ThreadRunner` records as `agent.failed`.

## Implementation Plan

1. Add output validation to the run-first planner adapter.
2. Use parsed output for terminal response/output event creation.
3. Add tests for invalid output producing durable `agent.failed` through `ThreadRunner`.
4. Update public docs and slice index.

## Test Plan

- Direct or runner-level replay test for invalid `agent.run` output.
- Verify the failed event preserves `AGENT_OUTPUT_INVALID`.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] Valid declared outputs continue to emit `agent.reply.produced` and `agent.output.completed`.
- [x] Invalid declared outputs do not emit `agent.output.completed`.
- [x] Invalid declared outputs become durable `agent.failed` with `AGENT_OUTPUT_INVALID` through `ThreadRunner`.
- [x] Agents without output schemas keep current behavior.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add output validation.
- [x] Add regression tests.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Run-first agents with declared `output` schemas validate returned values before terminal output events are planned.
- Valid parsed output is used for response formatting and raw `agent.output.completed` storage.
- Invalid output raises `WeaveError` with `AGENT_OUTPUT_INVALID`; `ThreadRunner` records it as durable `agent.failed`.
- Agents without output schemas keep current behavior.

Changed modules:

- `src/agent-runner.ts`: validates `agent.run` output in the run-first adapter.
- `src/tests/replay-authoring.test.ts`: adds invalid agent output failure coverage.
- `docs/declarative-api.md`: documents output validation semantics.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- Historical `agent.output.completed` events are not revalidated during normal replay.
- There is no persisted schema identifier or registry for validating output outside the active agent contract.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
