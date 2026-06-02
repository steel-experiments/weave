# ctx.join Child Terminal Mirroring Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Add `ctx.join` so parent agents can durably wait for child threads to complete or fail.

## Non-goals

- Do not implement automatic child-agent runtime dispatch.
- Do not add raw child output persistence yet.
- Do not add child listing or cancellation APIs yet.

## User Outcome

An agent can spawn a child thread, wait for it, and branch on structured completion or failure.

```ts
const child = await ctx.spawn("research", researchAgent, input);
const result = await ctx.join("wait-research", child);

if (result.status === "failed") {
  return result.message;
}

return result.outputSummary;
```

## Architecture Impact

- Adds `ctx.join` to `AgentContext`.
- Adds `AgentRun`, `JoinOptions`, and `ChildThreadFailedError`.
- Adds `ThreadService.mirrorChildTerminalEvent`.
- Child completed/failed parent events are keyed by the join step, not the spawn step.
- `child_thread.completed` and `child_thread.failed` wake the parent runner with `child-completed` / `child-failed` resume reasons.
- `ctx.join` returns structured status by default and throws only with `throwOnFailure: true`.

## Acceptance Criteria

- [x] Joining a completed child returns a completed result with `outputSummary`.
- [x] Joining a failed child returns a failed result with error metadata.
- [x] Missing child terminal events are mirrored from child projection when possible.
- [x] Pending children suspend the parent runner pass.
- [x] Existing replay tests and demos still pass.

## Completion Notes

Changed modules:

- `src/agent-contract.ts`: `ctx.join`, `AgentRun`, and `JoinOptions`.
- `src/agent-runner.ts`: durable join replay and pending semantics.
- `src/thread-service.ts`: terminal mirroring helper.
- `src/errors.ts`: `ChildThreadFailedError`.
- `src/events.ts` / `src/runner.ts`: child terminal resume reasons.
- `src/tests/replay-authoring.test.ts`: completed and failed join coverage.

Known follow-ups:

- Raw child output event support for typed `AgentRun.output`.
- Cancellation and detached-child policy semantics.
