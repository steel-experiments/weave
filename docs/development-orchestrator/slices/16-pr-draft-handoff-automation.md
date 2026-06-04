# PR Draft Handoff Automation

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
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

- [x] Completed initiatives produce a stable PR handoff artifact.
- [x] Handoff includes branch, commits, changed files, validation results, reviewer summary, and known gaps.
- [x] Remote push or draft PR creation is gated by explicit human approval.
- [x] Local-only handoff works without GitHub credentials.
- [x] Optional draft PR creation records the PR URL durably when used.
- [x] Failure cases are actionable and do not corrupt initiative state.
- [x] Tests cover artifact generation and final gate behavior.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.
- [x] `git diff --check` passes.

## Progress

- [x] Define handoff artifact schema.
- [x] Generate local handoff summary.
- [x] Add final approval gate.
- [x] Add optional draft PR boundary.
- [x] Add tests.
- [x] Update docs.

## Completion Notes

- Added `PrHandoffArtifactSchema` for stable PR-ready handoff data: initiative, repo, branch, title/body, shipped slices, commits, changed files, docs, validation commands, reviewers, repair attempts, known limitations, follow-ups, and remote PR state.
- Added `buildPrHandoffArtifact(...)`, which rejects failed validation commands before a handoff can be produced for approval.
- Added checkpoints `pr-handoff` and `pr-remote-handoff`.
- Updated `createPrAgent(...)` so it now produces a local handoff and emits `dev.pr.ready_for_review` before asking for `pr-review-approval`.
- Remote PR create/update through `dev.github.pr.upsert` now happens only after the final `pr-review-approval` gate is approved.
- Denied final approval returns without remote side effects.
- Local-only handoff mode works with `github.mode: "none"` and records `remote.status: "not-requested"` or `"skipped"`.
- Missing GitHub runner after approval records a blocked remote handoff instead of silently pretending a PR was created.
- Optional draft PR creation records the PR URL via the existing `pr-url` checkpoint and `dev.pr.opened` / `dev.pr.updated` events.
- Added contract tests for handoff artifact generation, failed-validation rejection, no remote tool before approval, denied approval without side effects, and approved remote PR creation.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: commit list is present in the artifact but populated conservatively as an empty list until a git-summary provider is added.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `README.md`
- [x] dashboard slice if PR handoff fields change
