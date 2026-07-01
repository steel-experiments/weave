# Agent Output Raw Join Output Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Store raw `agent.run` return values durably and expose child raw output through `ctx.join`.

## Non-goals

- Do not remove `agent.reply.produced`.
- Do not persist `undefined` return values as raw output.
- Do not add output schema validation on join yet.

## User Outcome

Joining a completed child can return its typed domain output:

```ts
const result = await ctx.join("wait-child", child);
if (result.status === "completed") {
  return result.output;
}
```

## Architecture Impact

- Adds `agent.output.completed` with raw `output` and optional `summary`.
- Run-first agents append `agent.reply.produced` for display and `agent.output.completed` for raw non-`undefined` outputs.
- `child_thread.completed` can carry raw `output` alongside `outputSummary`.
- `ThreadService.mirrorChildTerminalEvent` copies child raw output into the parent terminal event.
- `ctx.join` returns `AgentRun.output` when the parent completion event contains raw output.

## Acceptance Criteria

- [x] Successful run-first agents emit `agent.output.completed` for non-`undefined` outputs.
- [x] Existing response event behavior remains intact.
- [x] Child completion mirroring copies raw output into `child_thread.completed`.
- [x] `ctx.join` exposes raw child output as `AgentRun.output`.
- [x] Existing replay tests and demos still pass.

## Completion Notes

Changed modules:

- `src/events.ts`: `agent.output.completed` and child completion raw output.
- `src/agent-runner.ts`: raw output event emission and join output return.
- `src/thread-service.ts`: child output mirroring.
- `src/postgres-engine.ts`: output event projection/routing handling.
- `src/tests/replay-authoring.test.ts`: raw output and join coverage.

Known follow-ups:

- Validate joined output against the child agent output schema when available.
- Better display summaries for non-response custom outputs.
