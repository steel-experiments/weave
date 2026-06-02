# Child Listing Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Let runtime callers and parent agents list known child threads.

## Non-goals

- Do not implement child-agent runtime dispatch.
- Do not add child cancellation APIs.
- Do not add filtering by status or agent yet.

## User Outcome

An agent can inspect the child threads it has spawned:

```ts
const children = await ctx.children();
```

Runtime code can do the same:

```ts
const children = await service.listChildren(parentThreadId);
```

## Architecture Impact

- Adds `ThreadService.listChildren(parentThreadId, options)`.
- Adds `ctx.children(options)` to `AgentContext`.
- Reconstructs `ThreadRef`s from parent `child_thread.spawned` events and child projections.
- Excludes detached children by default; `{ includeDetached: true }` includes them.

## Acceptance Criteria

- [x] Attached children are returned by default.
- [x] Detached children are excluded by default.
- [x] Detached children are included when requested.
- [x] `ctx.children()` returns child refs from the current parent thread.
- [x] Existing replay tests and demos still pass.

## Completion Notes

Changed modules:

- `src/thread-service.ts`: `listChildren` and `ListChildrenOptions`.
- `src/agent-contract.ts`: `ctx.children` and `ChildrenOptions`.
- `src/agent-runner.ts`: service-backed context helper.
- `src/tests/replay-authoring.test.ts`: service and context listing coverage.

Known follow-ups:

- Runtime support for dispatching child threads to the intended child agent.
- Child status filtering.
- Child cancellation APIs.
