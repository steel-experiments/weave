# PR Draft And Initiative Handoff

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Produce a durable PR draft body and initiative handoff once all approved slices have passed verification and review.

## Non-goals

- Do not merge PRs.
- Do not auto-address external reviewer comments in the first version.
- Do not require GitHub API integration if a local PR draft artifact is enough for the MVP.

## User Outcome

As a maintainer, I can review a concise initiative summary with shipped slices, changed behavior, commands run, known limitations, and follow-ups before deciding whether to open or merge a PR.

## Architecture Impact

- Adds `weave.prAgent` or equivalent final child thread.
- Aggregates slice summaries, verification results, review verdicts, repair attempts, and docs updates.
- Adds optional GitHub PR create/update capability behind policy.
- Adds final human gate before merge.

## PR Draft Contents

The generated PR draft should include:

- initiative title
- base branch and working branch
- shipped slices
- changed behavior
- files or modules changed
- docs updated
- tests and typecheck commands run
- reviewer verdicts
- repair attempts performed
- known limitations
- follow-up suggestions
- human approval checklist

## Implementation Plan

1. Add PR draft input and output schemas.
2. Aggregate completed slice summaries from the initiative thread.
3. Generate a markdown PR body.
4. Store the PR draft as an artifact or checkpoint.
5. Optionally create or update a GitHub PR when `github.pr.create` is granted.
6. Checkpoint `pr-url` when a PR is opened.
7. Emit `dev.pr.opened`, `dev.pr.updated`, or `dev.pr.ready_for_review` events.
8. Add a human gate before merge or before marking the initiative fully accepted.

## Test Plan

- Unit test PR draft generation from fixture slice results.
- Unit test known limitations and failed slices are represented clearly.
- Policy test GitHub PR creation is skipped or denied without capability.
- Integration test completed initiative produces a PR draft artifact.
- Gate test merge remains blocked behind human approval.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Completed initiatives produce a markdown PR draft summary.
- [x] PR draft includes shipped slices, checks, review verdicts, limitations, and follow-ups.
- [x] PR draft is durably available after replay.
- [x] GitHub PR creation is capability-gated.
- [x] Merge is impossible without human approval.
- [x] `dev.pr.ready_for_review` or equivalent event is emitted.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Add PR draft schemas.
- [x] Add summary aggregation.
- [x] Add PR draft artifact/checkpoint.
- [x] Add optional GitHub PR create path.
- [x] Add final human gate.
- [x] Add tests.
- [x] Update docs.

## Completion Notes

- Added completed-slice summary, PR draft input/output, and GitHub PR upsert schemas.
- Added `buildPrDraft(...)` to generate deterministic markdown from shipped slices, implementation summaries, verification commands, reviewer verdicts, repair attempts, limitations, and follow-ups.
- Added `DevelopmentCheckpointKeys.prDraft` so the PR draft is durable before any external GitHub operation or final gate.
- Added `githubPrCreateCapability` and `createGithubPrUpsertTool(...)` as the optional `dev.github.pr.upsert` boundary. It declares `github.pr.create` capability intent and can create or update a draft PR when a real runner is supplied.
- Added `createPrAgent(...)` as `weave.prAgent`. It checkpoints the PR draft, optionally calls the GitHub PR boundary, checkpoints `pr-url`, emits `dev.pr.opened` or `dev.pr.updated` when applicable, emits `dev.pr.ready_for_review`, and opens a `pr-review-approval` human gate.
- No merge tool or merge capability is exposed by the PR agent; merge remains outside this agent after human review.
- Added replay tests for PR draft checkpointing, GitHub PR tool request, `dev.pr.opened`, `dev.pr.ready_for_review`, final human gate, and completed agent output.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm exec -- tsx src/tests/public-api-exports.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: the parent `weave.sliceRunner` still does not automatically aggregate completed slice children into this PR agent. This slice ships the final PR/handoff child boundary and deterministic draft generation.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [ ] GitHub integration docs if a real GitHub runner is implemented
- [ ] auth gateway slice plan if this orchestrator becomes the execution path for auth work
