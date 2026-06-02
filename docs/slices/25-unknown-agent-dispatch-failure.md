# Unknown Agent Dispatch Failure Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Record a specific durable failure when runtime dispatch targets an agent that is not registered in the app.

## Non-goals

- Do not validate `agentName` at `ThreadService.startSession` or `startChildSession`.
- Do not add app-aware service construction.
- Do not add per-agent queues or scheduling policy.
- Do not change default-agent fallback behavior for sessions without `agentName`.

## User Outcome

As an operator, if a thread names an unknown agent, the thread records `agent.failed` with `AGENT_NOT_FOUND` instead of a generic `AGENT_FAILED` lookup error.

## Architecture Impact

- Runtime planner lookup converts missing app agents into `WeaveError("AGENT_NOT_FOUND", ...)`.
- `ThreadRunner` already records `WeaveError.code` in durable `agent.failed`.
- Existing app registry and session event shapes are unchanged.

## Implementation Plan

1. Update runtime agent lookup to throw `AGENT_NOT_FOUND` for missing agents.
2. Add a runner-level regression test for a root session targeting an unknown agent.
3. Update public docs and slice index.

## Test Plan

- Start a root session with unknown `agentName`.
- Run through `ThreadRunner` and `createRuntimeAgentPlanner`.
- Assert durable `agent.failed.payload.errorCode === "AGENT_NOT_FOUND"`.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] Unknown targeted agents record durable `agent.failed` with `AGENT_NOT_FOUND`.
- [x] Unknown targeted agents do not emit terminal response or raw output events.
- [x] Known targeted agents still dispatch correctly.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add specific runtime lookup error.
- [x] Add regression test.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Runtime planner lookup raises `WeaveError("AGENT_NOT_FOUND", ...)` when `session.started.payload.agentName` or the configured default agent is missing from the app registry.
- `ThreadRunner` records the error as durable `agent.failed`.
- Unknown targeted agents do not emit terminal response or raw output events.

Changed modules:

- `src/runtime.ts`: converts missing runtime agent lookups to `AGENT_NOT_FOUND`.
- `src/tests/replay-authoring.test.ts`: adds unknown targeted root-agent dispatch failure coverage.
- `docs/declarative-api.md`: documents unknown-agent dispatch failure semantics.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- `ThreadService.startSession` and `startChildSession` still do not validate `agentName` against an app registry.
- App-aware service validation remains a future slice.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
