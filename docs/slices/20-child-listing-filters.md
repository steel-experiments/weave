# Child Listing Filters Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Let runtime callers and parent agents filter known child threads by child agent name and thread status.

## Non-goals

- Do not add child cancellation APIs.
- Do not add database-side child listing queries yet.
- Do not add pagination or sorting controls.
- Do not add per-agent scheduling policy.

## User Outcome

As a parent agent or runtime caller, I can ask for only failed children, only completed children, or only children for a specific child agent without manually reading every child projection.

## Architecture Impact

- Extends `ChildrenOptions` / `ListChildrenOptions` with `agentName` and `status` filters.
- Adds `status` to returned `ThreadRef`s when a child projection is available.
- Keeps listing reconstructed from parent `child_thread.spawned` events.

## Implementation Plan

1. Extend child listing option types.
2. Include child projection status in returned refs.
3. Filter by one or many agent names.
4. Filter by one or many thread statuses.
5. Add service and context tests.

## Test Plan

- Service test for filtering by child agent name.
- Service test for filtering by child thread status.
- Context test proving `ctx.children({ status })` passes through the filter.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] `ThreadService.listChildren(parentThreadId, { agentName })` filters by child agent name.
- [x] `ThreadService.listChildren(parentThreadId, { status })` filters by child projection status.
- [x] `ctx.children(options)` supports the same filters.
- [x] Returned child refs expose `status` when a projection exists.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Extend option and ref types.
- [x] Implement filtering.
- [x] Add regression tests.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- `ChildrenOptions` / `ListChildrenOptions` support `agentName` and `status` filters.
- Each filter accepts a single value or an array of values.
- Returned `ThreadRef`s include `status` when a child projection is available.
- `ctx.children(options)` passes the same filters through to `ThreadService.listChildren`.

Changed modules:

- `src/agent-contract.ts`: adds `ThreadRef.status` and child listing filter options.
- `src/thread-service.ts`: filters child refs by agent name and projection status.
- `src/weave-interface.ts`: updates the public boundary sketch.
- `src/tests/replay-authoring.test.ts`: adds service and context filter coverage.
- `docs/declarative-api.md`: documents child listing filters.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- Listing is still reconstructed from parent events and child projection reads; there is no database-side paginated query yet.
- Child cancellation remains a separate follow-up slice.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
