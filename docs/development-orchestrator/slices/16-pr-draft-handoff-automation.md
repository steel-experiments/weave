# PR Draft Handoff Automation

## Status

- Vertical: `development-orchestrator`
- Status: `Planned`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Automate the final handoff for completed initiatives by producing a PR-ready summary, validation record, changed-file list, commit list, and optional gated draft PR creation.

## Non-goals

- Do not push or create remote PRs without an explicit human approval gate.
- Do not merge PRs.
- Do not bypass final validation.
- Do not hide failed or skipped verification.
- Do not build the dashboard.

## User Outcome

As a maintainer, I can let a completed initiative produce a clear PR handoff and, after final approval, optionally create a draft PR with the correct title/body and validation summary.

## Architecture Impact

- Extends the existing PR draft and initiative handoff stage into an operator-ready artifact.
- Adds a final approval gate before remote side effects such as push or draft PR creation.
- Keeps local branch state, commit history, changed files, tests, review results, and known gaps visible.
- Provides data the later dashboard can display without inventing a separate PR model.

## Handoff Artifact

The artifact should include:

- initiative title and root thread id
- approved slice list and status per slice
- final branch name
- commit list
- changed-file summary
- validation commands and results
- reviewer findings and resolution notes
- known gaps or follow-up slices
- suggested PR title
- suggested PR body
- whether remote push/PR creation has been approved

## Implementation Plan

1. Define a stable PR handoff artifact schema.
2. Generate the artifact after all approved slices complete and validation passes.
3. Add a final approval gate before push or draft PR creation.
4. Add a local-only handoff mode that prints the summary without remote side effects.
5. Add optional `gh`-backed draft PR creation behind the final gate if repository configuration is available.
6. Record PR URL or remote side-effect result durably when created.
7. Document the handoff and approval process.

## Test Plan

- Unit test handoff artifact generation from completed initiative fixtures.
- Unit test validation failure prevents final PR handoff approval.
- Unit test final approval gate is required before remote side effects.
- Unit test draft PR command construction with a fake `gh` boundary.
- Failure-path test missing remote or `gh` configuration becomes a blocked handoff, not a silent failure.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] Completed initiatives produce a stable PR handoff artifact.
- [ ] Handoff includes branch, commits, changed files, validation results, reviewer summary, and known gaps.
- [ ] Remote push or draft PR creation is gated by explicit human approval.
- [ ] Local-only handoff works without GitHub credentials.
- [ ] Optional draft PR creation records the PR URL durably when used.
- [ ] Failure cases are actionable and do not corrupt initiative state.
- [ ] Tests cover artifact generation and final gate behavior.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Progress

- [ ] Define handoff artifact schema.
- [ ] Generate local handoff summary.
- [ ] Add final approval gate.
- [ ] Add optional draft PR boundary.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `README.md`
- [ ] dashboard slice if PR handoff fields change
