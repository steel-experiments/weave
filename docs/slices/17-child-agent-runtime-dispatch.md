# Child Agent Runtime Dispatch Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Run child threads with their intended child agent instead of always using the runtime's default agent.

## Non-goals

- Do not add a separate child runtime daemon.
- Do not add per-agent queues yet.
- Do not add child cancellation or scheduling policy.

## User Outcome

When a parent calls `ctx.spawn("research", researchAgent, input)`, the child thread records `researchAgent.name`. Runner passes for that child execute `researchAgent.run`, while root sessions still use the runtime's configured default agent.

## Architecture Impact

- Adds optional `agentName` to `session.started.payload`.
- `ThreadService.startChildSession` writes the child target agent name into the child session start event.
- `createWeaveRuntime` uses a dispatching planner that selects the thread agent from `session.started.payload.agentName`, falling back to the configured runtime agent.
- Tool worker registration now includes tools declared by all app agents, not just the default runtime agent.

## Acceptance Criteria

- [x] Child session events include `agentName` without changing replay input metadata.
- [x] Runtime planner dispatches child threads to their target agent.
- [x] Root threads still use the configured default agent.
- [x] Existing replay tests and demos still pass.

## Completion Notes

Changed modules:

- `src/events.ts`: optional session `agentName`.
- `src/thread-service.ts`: child sessions record target agent names.
- `src/runtime.ts`: dispatching runtime planner and all-agent tool registration.
- `src/tests/replay-authoring.test.ts`: dispatch regression coverage.

Known follow-ups:

- Per-agent runner/worker scheduling policies.
- Raw child output event support for typed `AgentRun.output`.
- Child cancellation APIs.
