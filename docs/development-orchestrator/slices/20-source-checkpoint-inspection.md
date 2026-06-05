# Source Checkpoint Inspection

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
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

- [ ] Operators can list checkpoints for an initiative.
- [ ] Operators can show a checkpoint by id or SHA.
- [ ] Operators can obtain an exact diff command for a checkpoint.
- [ ] Dashboard shows source checkpoints with slice association and changed files.
- [ ] No Git mutation is introduced in this slice.

## Progress

- [ ] Add operator projection.
- [ ] Add CLI commands/scripts.
- [ ] Add dashboard rendering.
- [ ] Add tests.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `README.md`
