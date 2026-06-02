# Root Session Agent Dispatch Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Let API-created root sessions target a specific agent by recording `agentName` in `session.started`.

## Non-goals

- Do not add per-agent queues or separate runner daemons.
- Do not validate `agentName` in `ThreadService.startSession` against an app registry.
- Do not change child session dispatch behavior.
- Do not remove the runtime default-agent fallback.

## User Outcome

As a runtime or integration caller, I can start a root session for a specific app agent instead of relying on the runtime's configured default agent.

## Architecture Impact

- Extends `StartSessionInput` with optional `agentName`.
- Root `session.started` events can carry `payload.agentName`, matching child session events.
- Existing `createRuntimeAgentPlanner` dispatch logic already honors `session.started.payload.agentName`.
- Root sessions without `agentName` continue using the runtime default agent.

## Implementation Plan

1. Add `agentName` to service and public boundary start-session types.
2. Persist `agentName` in root `session.started` payload when provided.
3. Add a regression test proving a root session targets a non-default agent.
4. Update public docs and slice index.

## Test Plan

- Service/runtime test that `startSession({ agentName })` records the target agent and runtime dispatches to it.
- Existing default-agent fallback test remains unchanged.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] `ThreadService.startSession({ agentName })` records `session.started.payload.agentName`.
- [x] Runtime planner dispatches targeted root sessions to that agent.
- [x] Root sessions without `agentName` still use the configured default agent.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add `agentName` to start-session input.
- [x] Add regression test.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- `ThreadService.startSession` accepts optional `agentName`.
- Root `session.started` events record `payload.agentName` when provided.
- Existing runtime planner dispatch selects that named agent for root sessions.
- Sessions without `agentName` still fall back to the runtime default agent.

Changed modules:

- `src/thread-service.ts`: adds `agentName` to root start-session input and event payload.
- `src/weave-interface.ts`: updates the public boundary sketch.
- `src/tests/replay-authoring.test.ts`: adds targeted root session dispatch coverage.
- `docs/declarative-api.md`: documents targeted root sessions.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- `ThreadService.startSession` does not validate `agentName` against an app registry.
- Per-agent queues and scheduling remain future work.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
