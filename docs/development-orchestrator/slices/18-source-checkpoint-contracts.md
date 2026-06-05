# Source Checkpoint Contracts

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
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

- [ ] `source-checkpoint` is a first-class checkpoint name.
- [ ] A source checkpoint payload can represent one slice commit with `baseSha` and `checkpointSha`.
- [ ] Source checkpoint event payloads are schema validated.
- [ ] Contracts include changed files, workspace reference, verification summary, and reviewer summary.
- [ ] No Git mutation is introduced in this slice.

## Progress

- [ ] Add checkpoint constants and schemas.
- [ ] Add event payload schemas.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `docs/event-taxonomy.md` if the new events become part of the public event taxonomy
