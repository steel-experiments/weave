# Source Checkpoint Contracts

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-05`
- Owner: `weave-maintainer`

## Goal

Define durable source-code checkpoint contracts for Weave Maintainer so each completed development slice can point at a concrete Git state.

## Non-goals

- Do not create Git commits in this slice.
- Do not add rollback or restore behavior.
- Do not merge branches or create remote pull requests.
- Do not replace existing workflow checkpoints.

## User Outcome

As a maintainer, I can see the durable schema Weave will use to represent a source checkpoint, including the slice, workspace, base commit, checkpoint commit, changed files, verification summary, and reviewer summary.

## Architecture Impact

- Adds a typed `source-checkpoint` payload schema.
- Adds typed development event payloads for source checkpoint lifecycle events.
- Exposes checkpoint contracts from the public development-orchestrator module.
- Keeps Git mutation behind later runner slices.

## Implementation Plan

1. Add a `SourceCheckpointSchema` with slice, workspace, commit, changed file, verification, and review fields.
2. Add source checkpoint event schemas for proposed, created, and failed outcomes.
3. Register the `source-checkpoint` checkpoint name with the existing development checkpoint constants.
4. Add tests that validate complete and failure payloads.
5. Update docs describing source checkpoints as workflow checkpoints backed by Git state.

## Test Plan

- Unit test valid source checkpoint payloads.
- Unit test failed checkpoint payloads.
- Unit test public exports for the new schemas/constants.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] `source-checkpoint` is a first-class checkpoint name.
- [x] A source checkpoint payload can represent one slice commit with `baseSha` and `checkpointSha`.
- [x] Source checkpoint event payloads are schema validated.
- [x] Contracts include changed files, workspace reference, verification summary, and reviewer summary.
- [x] No Git mutation is introduced in this slice.

## Progress

- [x] Add checkpoint constants and schemas.
- [x] Add event payload schemas.
- [x] Add tests.
- [x] Update docs.

## Completion Notes

- Added `DevelopmentCheckpointKeys.sourceCheckpoint` with value `source-checkpoint`.
- Added `SourceCheckpointSchema`, `SourceCheckpointProposedSchema`, and `SourceCheckpointFailedSchema` in `examples/weave-maintainer/src/development-orchestrator.ts`.
- Added source checkpoint verification/review summary contracts.
- Added source checkpoint lifecycle events: `dev.source_checkpoint.proposed`, `dev.source_checkpoint.created`, and `dev.source_checkpoint.failed`.
- Source checkpoint events are valid `ThreadEvent` records and are audit-only for inbox routing.
- Added contract and public export smoke coverage.
- No Git mutation, commit creation, rollback, merge, or PR side effect was added.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `docs/event-taxonomy.md` if the new events become part of the public event taxonomy
