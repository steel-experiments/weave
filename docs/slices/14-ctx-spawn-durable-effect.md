# ctx.spawn Durable Effect Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Add the first author-facing child-thread primitive: `ctx.spawn(key, agent, input)`.

## Non-goals

- Do not implement `ctx.join`.
- Do not implement automatic child-agent runner dispatch.
- Do not mirror child terminal events automatically yet.
- Do not add cancellation or capability inheritance semantics yet.

## User Outcome

An agent can durably create a child thread and receive a stable `ThreadRef` on replay.

```ts
const child = await ctx.spawn("research-docs", docsResearchAgent, {
  repo: "acme/docs",
});
```

## Architecture Impact

- Adds `ctx.spawn` to `AgentContext`.
- Adds `ThreadRef` and `SpawnOptions` authoring types.
- Wires `ThreadService` into the run-to-planner adapter through `createAgentPlanner(..., { service })`.
- Runtime binding passes its `ThreadService` into the active agent planner.
- `ctx.spawn` uses `ThreadService.startChildSession` when the durable spawn is missing, then suspends the parent runner pass.
- Existing `child_thread.spawned` events replay to `ThreadRef` without creating duplicate children.
- `child_thread.spawned` wakes the parent runner with resume reason `child-spawned`.
- Adds `inputHash` to `child_thread.spawned` so replay detects input changes without storing raw input on the parent event.

## Acceptance Criteria

- [x] Missing spawn creates a child session and parent `child_thread.spawned` event.
- [x] Replay returns the same child ref and does not duplicate the child.
- [x] Reusing the same key with different child input throws `ReplayMismatchError`.
- [x] Existing replay tests and demos still pass.

## Completion Notes

Changed modules:

- `src/agent-contract.ts`: `ctx.spawn`, `ThreadRef`, and `SpawnOptions`.
- `src/agent-runner.ts`: service-backed durable spawn implementation.
- `src/runtime.ts`: passes `ThreadService` into run-first planner binding.
- `src/thread-service.ts`: child spawn parent event now includes `inputHash`.
- `src/events.ts`: stable JSON hash helper and `inputHash` payload field.
- `src/tests/replay-authoring.test.ts`: spawn creation/replay/mismatch coverage.

Known follow-ups:

- Raw child output event support for typed `AgentRun.output`.
