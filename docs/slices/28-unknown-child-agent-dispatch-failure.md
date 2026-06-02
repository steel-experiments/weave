# Unknown Child Agent Dispatch Failure Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Prove and document that child sessions targeting unknown agents record durable `AGENT_NOT_FOUND` failures.

## Non-goals

- Do not add app-aware validation to `ThreadService.startChildSession`.
- Do not change runtime dispatch implementation unless the regression test exposes a gap.
- Do not add per-agent queues or scheduling policy.
- Do not change root session dispatch behavior.

## User Outcome

As an operator, if a child thread names an unknown agent, the child thread records `agent.failed` with `AGENT_NOT_FOUND`, matching targeted root session behavior.

## Architecture Impact

- No new event shape.
- No new public API.
- Adds explicit regression coverage for child sessions through the existing `session.started.payload.agentName` dispatch path.

## Implementation Plan

1. Add a regression test that starts a child session targeting an unregistered agent.
2. Run the child thread through `ThreadRunner` with `createRuntimeAgentPlanner`.
3. Assert durable `agent.failed` with `AGENT_NOT_FOUND`.
4. Update docs and slice index.

## Test Plan

- Child session with unknown `agentName` records `agent.failed.payload.errorCode === "AGENT_NOT_FOUND"`.
- No terminal response or raw output events are emitted.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] Unknown child target agents record durable `agent.failed` with `AGENT_NOT_FOUND`.
- [x] Unknown child target agents do not emit terminal response or raw output events.
- [x] Existing root unknown-agent coverage still passes.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add regression test.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Unknown child target agents use the same runtime dispatch failure path as unknown root target agents.
- The child thread records durable `agent.failed` with `AGENT_NOT_FOUND`.
- No terminal response or raw output events are emitted for the unknown child agent.

Changed modules:

- `src/tests/replay-authoring.test.ts`: adds unknown child target dispatch failure coverage.
- `docs/declarative-api.md`: documents child-session `AGENT_NOT_FOUND` behavior.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- `ThreadService.startChildSession` still does not validate `agentName` against an app registry.
- App-aware service validation remains a future slice.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
