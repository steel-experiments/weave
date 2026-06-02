# Child Thread Integrity Audit Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Prove that child threads preserve lineage, ownership, terminal mirroring, listing, join, and cancellation semantics before more features depend on them.

## Non-goals

- Do not add cascading cancellation.
- Do not add a separate `cancelled` thread status.
- Do not add per-agent scheduling policy.
- Do not change child dispatch semantics unless an integrity gap requires it.

## User Outcome

As a parent agent author, I can spawn, inspect, join, and cancel child work without accidentally affecting unrelated threads or duplicating terminal evidence.

## Architecture Impact

- Hardens `ThreadService.startChildSession`, `mirrorChildTerminalEvent`, `cancelChildThread`, and `listChildren`.
- Hardens replay-safe `ctx.spawn`, `ctx.join`, `ctx.children`, and `ctx.cancelChild`.
- Validates projection lineage fields: `parentThreadId`, `rootThreadId`, `parentScopeKey`, and `parentStepKey`.
- No new event shape is expected.

## Implementation Plan

1. Verify spawned children persist parent, root, scope, and step lineage.
2. Verify `ctx.join` and terminal mirroring reject unrelated child threads.
3. Verify detached children retain lineage but do not block parent completion.
4. Verify attached child cancellation records durable child failure and parent mirror events.
5. Verify repeated cancellation and repeated terminal mirroring are idempotent where intended.
6. Verify filtering by agent name and status still works after terminal transitions.
7. Document child-thread integrity rules and known gaps.

## Test Plan

- Lineage test for child sessions from root and nested parents.
- Unrelated-child join and mirror rejection test.
- Detached child test proving parent can complete while child remains nonterminal.
- Cancellation tests for existing, already terminal, repeated, and unrelated child cases.
- Terminal mirroring idempotency test proving `child_thread.completed` or `child_thread.failed` is appended once.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Spawned child projections contain correct parent and root lineage.
- [x] Parent scope and step keys identify the parent durable spawn effect.
- [x] Parents cannot join or mirror unrelated child threads.
- [x] Detached children retain lineage and do not block parent completion.
- [x] Cancellation rejects unrelated children and handles repeated requests safely.
- [x] Child terminal mirroring is idempotent.
- [x] Child listing filters still work after status changes.

## Progress

- [x] Inventory existing child-thread coverage.
- [x] Add missing lineage and ownership tests.
- [x] Add missing detached and cancellation tests.
- [x] Add mirroring idempotency tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Confirmed existing coverage for root child lineage, parent scope/step identity, unrelated child join rejection, listing filters, basic cancellation, and failed/completed joins.
- Added nested child session coverage proving descendants retain the original root thread.
- Added detached spawn coverage proving detached children retain lineage and do not block parent completion.
- Added terminal mirroring idempotency coverage proving repeated mirroring does not duplicate `child_thread.completed`.
- Added cancellation edge coverage proving unrelated child cancellation is rejected, repeated cancellation is idempotent, and already completed children cannot be cancelled.
- Updated declarative API docs with the verified child-thread integrity rules.

Changed modules:

- `src/tests/replay-authoring.test.ts`: adds nested lineage, detached completion, terminal mirroring idempotency, and cancellation edge tests.
- `docs/declarative-api.md`: documents nested lineage, detached behavior, mirroring idempotency, and cancellation rejection/idempotency.

Commands run:

- `npm test`
- `npm run typecheck`

Known limitations:

- Cancellation still does not interrupt currently executing JavaScript or external tool processes.
- Cancelled children still use failed thread semantics; there is no separate `cancelled` thread status.
- Descendant cancellation is not cascaded.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
