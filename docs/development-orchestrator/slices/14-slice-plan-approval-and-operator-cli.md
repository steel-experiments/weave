# Slice Plan Approval And Operator CLI

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Add a practical operator CLI for inspecting generated initiative plans and resolving approval gates so the dogfood loop does not require raw event spelunking.

## Non-goals

- Do not build the web dashboard in this slice.
- Do not execute approved slices yet.
- Do not bypass existing durable gate semantics.
- Do not add auth.
- Do not push branches or create PRs.

## User Outcome

As a maintainer, I can list pending gates, inspect a proposed slice plan, approve or reject it with a note, and understand what command to run next.

## Architecture Impact

- Reuses existing gate events and resolution behavior.
- Adds operator-facing CLI commands over durable gate/thread state.
- Makes plan approval an explicit prerequisite for automated initiative execution.
- Creates a stable command vocabulary that the later dashboard can mirror.
- Keeps approvals durable and replay-safe.

## Proposed Commands

Initial command names can be adjusted during implementation, but the workflow should cover:

- `npm run gates:list`
- `npm run gates:show -- <gate-id>`
- `npm run gates:approve -- <gate-id> --note <note>`
- `npm run gates:reject -- <gate-id> --note <note>`
- `npm run initiatives:list`
- `npm run initiative:status -- <thread-id>`

## Implementation Plan

1. Add CLI scripts for listing pending gates and recent initiatives.
2. Add a gate detail command that renders plan proposals in a human-readable format.
3. Add approve/reject commands that call the existing gate resolution path.
4. Add initiative status output showing root thread, current slice, child threads, pending gates, and latest terminal state.
5. Add clear command output for next actions.
6. Add tests for formatting and gate resolution request construction.
7. Document the operator flow in the development orchestrator README.

## Test Plan

- Unit test gate list/status formatting.
- Unit test initiative status projection from representative fixtures.
- Integration test approve/reject command through a test runtime or service boundary where practical.
- Failure-path test unknown gate id.
- Failure-path test resolving an already terminal gate.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] Operator can list pending gates.
- [x] Operator can inspect a slice-plan approval gate in readable form.
- [x] Operator can approve a gate durably.
- [x] Operator can reject a gate durably with a note.
- [x] Operator can view initiative status without reading raw events.
- [x] CLI output includes clear next-step guidance.
- [x] Commands are documented.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.
- [x] `git diff --check` passes.

## Progress

- [x] Add gate list/show commands.
- [x] Add gate approve/reject commands.
- [x] Add initiative list/status commands.
- [x] Add tests.
- [x] Update docs.

## Completion Notes

- Added `src/development-operator.ts` with Postgres-backed read helpers for pending gates, gate details, initiative lists, initiative status, latest proposed plan lookup, and gate resolution delegation through `ThreadService.resolveGate`.
- Added formatting helpers for gate lists, gate details, initiative lists, and initiative status output.
- Added `src/scripts/development-operator.ts` as one subcommand entrypoint.
- Added package commands: `gates:list`, `gates:show`, `gates:approve`, `gates:reject`, `initiatives:list`, and `initiative:status`.
- Gate approval/rejection discovers the owning thread from `weave.thread_gate`, then uses the existing durable gate resolution path.
- Gate detail rendering includes a proposed plan summary when the thread has a `proposed-initiative-plan` or legacy `slice-plan` checkpoint.
- Initiative status output shows root status, branch, current slice, child threads, pending gates, and recent events.
- Added `src/tests/development-operator.test.ts` for operator formatting and status rendering.
- Commands run: `npm exec -- tsx src/tests/development-operator.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: this CLI reads directly from Postgres. A later dashboard/API slice can expose the same operator read model over HTTP.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `README.md`
- [x] dashboard slice if command vocabulary changes
