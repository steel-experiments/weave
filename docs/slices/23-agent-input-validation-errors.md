# Agent Input Validation Errors Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Convert invalid run-first agent replay input into a durable, specific `AGENT_INPUT_INVALID` failure.

## Non-goals

- Do not change how session input is stored.
- Do not validate input at `ThreadService.startSession` or `startChildSession` yet.
- Do not add schema identifiers or registry support.
- Do not change planner-first agent behavior.

## User Outcome

As an operator, if a run-first agent cannot decode its thread input, the thread records `agent.failed` with `AGENT_INPUT_INVALID` instead of a generic `AGENT_FAILED` error.

## Architecture Impact

- `createAgentPlanner` decodes `session.started.payload.metadata` through `agent.input.safeParse`.
- Invalid input raises `WeaveError` with `AGENT_INPUT_INVALID`.
- `ThreadRunner` already records `WeaveError.code` in durable `agent.failed`.

## Implementation Plan

1. Replace direct `agent.input.parse` with `safeParse` in run-first input reading.
2. Throw `WeaveError("AGENT_INPUT_INVALID", ...)` when parsing fails.
3. Add a runner-level test proving durable `agent.failed` uses `AGENT_INPUT_INVALID`.
4. Update public docs and slice index.

## Test Plan

- Runner-level replay test where invalid session metadata fails with `AGENT_INPUT_INVALID`.
- Assert no terminal output event is emitted for invalid input.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] Invalid run-first agent input records durable `agent.failed` with `AGENT_INPUT_INVALID` through `ThreadRunner`.
- [x] Invalid input does not emit `agent.response.produced` or `agent.output.completed`.
- [x] Valid inputs keep current behavior.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add input validation error conversion.
- [x] Add regression test.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Run-first input decoding uses `agent.input.safeParse`.
- Invalid input raises `WeaveError` with `AGENT_INPUT_INVALID`.
- `ThreadRunner` records the failure as durable `agent.failed`.
- Invalid input does not produce terminal response or raw output events.

Changed modules:

- `src/agent-runner.ts`: converts invalid run-first input into `AGENT_INPUT_INVALID`.
- `src/tests/replay-authoring.test.ts`: adds durable invalid-input failure coverage.
- `docs/declarative-api.md`: documents input validation failure semantics.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- Session creation still accepts metadata without validating it against a target agent contract.
- There is no persisted schema identifier or registry for validation outside the active agent contract.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
