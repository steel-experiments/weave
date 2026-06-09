# Source Checkpoint Inspection

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-05`
- Owner: `weave-maintainer`

## Goal

Expose source checkpoints through operator commands and the local dashboard so maintainers can inspect slice-level Git states without raw database queries.

## Non-goals

- Do not restore or reset Git state.
- Do not create or merge pull requests.
- Do not replace normal `git diff` workflows.

## User Outcome

As a maintainer, I can list source checkpoints for an initiative, inspect the checkpoint metadata, and copy a ready-to-run diff command for a slice.

## Architecture Impact

- Extends the development operator read model with source checkpoint projections.
- Adds CLI commands for checkpoint list/show/diff guidance.
- Extends the dashboard initiative detail to show source checkpoints next to slices.
- Keeps event/checkpoint data as the source of truth.

## Implementation Plan

1. Add source checkpoint projection helpers in the development operator module.
2. Add `checkpoints:list`, `checkpoints:show`, and `checkpoints:diff` operator commands.
3. Add package scripts for the new commands.
4. Render checkpoint commit SHAs and changed files in the dashboard.
5. Show copyable commands like `git -C <workspace> diff <baseSha>..<checkpointSha>`.

## Test Plan

- Unit test checkpoint projection formatting.
- Unit test CLI output for list/show/diff commands.
- Dashboard state test includes source checkpoints.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] Operators can list checkpoints for an initiative.
- [x] Operators can show a checkpoint by id or SHA.
- [x] Operators can obtain an exact diff command for a checkpoint.
- [x] Dashboard shows source checkpoints with slice association and changed files.
- [x] No Git mutation is introduced in this slice.

## Progress

- [x] Add operator projection.
- [x] Add CLI commands/scripts.
- [x] Add dashboard rendering.
- [x] Add tests.

## Completion Notes

- Added `OperatorSourceCheckpointSummarySchema` and source checkpoint projection helpers in `src/development-operator.ts`.
- Added operator commands and npm scripts: `checkpoints:list`, `checkpoints:show`, and `checkpoints:diff`.
- Checkpoint lookup accepts full checkpoint id, full commit SHA, or commit SHA prefix.
- `checkpoints:diff` prints the exact `git -C <workspace> diff <baseSha>..<checkpointSha> --` command.
- Dashboard state now includes `sourceCheckpoints`, and the UI renders slice id, commit SHA, changed file count, commit message, and diff command.
- Added operator formatting tests and dashboard Postgres state coverage.
- No restore, reset, merge, push, or PR side effect was added.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `README.md`
