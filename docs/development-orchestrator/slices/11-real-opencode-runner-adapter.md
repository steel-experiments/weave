# Real OpenCode Runner Adapter

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Implement real OpenCode-backed runners for `dev.opencode.implement` and `dev.opencode.repair` after the parent slice loop, initiative sequencing, and workspace lifecycle are deterministic.

## Non-goals

- Do not change the orchestrator control model.
- Do not let OpenCode own slice sequencing.
- Do not let OpenCode merge, open PRs, switch branches, or bypass verification.
- Do not trust OpenCode claims without verifier and reviewer reruns.
- Do not run the full auth gateway initiative unattended in this slice.

## User Outcome

As a maintainer, I can replace fake implementation and repair runners with real OpenCode execution inside a selected `WorkspaceRef`, while Weave still owns orchestration, policy, verification, review, repair bounds, and human gates.

## Architecture Impact

- Adds concrete `OpenCodeImplementationRunner` and `RepairRunner` implementations.
- Executes OpenCode inside the configured workspace path only.
- Preserves existing schema-validated tool boundaries.
- Adds timeout, prompt, output parsing, and failure handling around OpenCode execution.
- Keeps OpenCode as a bounded worker rather than a control plane.

## Required Constraints

- Workspace-scoped execution only.
- Explicit working directory from `WorkspaceRef.path`.
- Refuse branch mismatches before execution.
- Timeout per run.
- Max turns or max tool-call budget where supported.
- Bounded command/tool profile.
- Structured JSON result required.
- No merge.
- No uncontrolled branch switching.
- No writes outside workspace.
- No secret access through this runner.
- Verification and review required after every implementation or repair run.

## Runner Inputs

Implementation runner receives existing `OpenCodeImplementerInput`:

- slice id/title
- objective
- acceptance criteria
- allowed files
- constraints
- branch
- `WorkspaceRef`

Repair runner receives existing `RepairAgentInput`:

- branch
- `WorkspaceRef`
- slice constraints
- attempt number
- max attempts
- failing commands
- reviewer findings

## Implementation Plan

1. Add an OpenCode runner module behind the existing runner interfaces.
2. Build implementation prompts from slice objective, acceptance criteria, constraints, allowed files, and workspace path.
3. Build repair prompts only from failing commands, reviewer findings, and slice constraints.
4. Run OpenCode with cwd set to `WorkspaceRef.path`.
5. Enforce timeout and capture bounded stdout/stderr.
6. Require structured JSON output matching the existing schemas.
7. Parse changed files from the structured result and, if needed, workspace diff.
8. Reject or block outputs that report out-of-scope file changes.
9. Surface runner failures as structured blocked/failed outputs.
10. Add fixtures or fake OpenCode command tests before enabling real invocation in integration tests.
11. Document required local OpenCode installation/configuration.

## Test Plan

- Unit test prompt construction for implementation.
- Unit test prompt construction for repair.
- Unit test branch/workspace mismatch refusal.
- Unit test invalid JSON output becomes structured failure.
- Unit test timeout becomes structured failure.
- Unit test out-of-scope changes are blocked.
- Integration test with a fake OpenCode executable returning valid JSON.
- Integration test fake executable returning invalid JSON.
- Optional manual test against real OpenCode in a temporary workspace.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] Real implementation runner satisfies `OpenCodeImplementationRunner`.
- [ ] Real repair runner satisfies `RepairRunner`.
- [ ] Runners execute only inside `WorkspaceRef.path`.
- [ ] Runners enforce timeout and bounded output capture.
- [ ] Runners require schema-valid structured output.
- [ ] Runners refuse branch/workspace mismatches.
- [ ] Runners do not expose merge, PR, secret, or branch-switching capabilities.
- [ ] Verification and review remain mandatory after every run.
- [ ] Fake executable integration tests cover success and failure.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Progress

- [ ] Add runner module.
- [ ] Add prompt builders.
- [ ] Add command invocation wrapper.
- [ ] Add output parser.
- [ ] Add timeout/failure handling.
- [ ] Add fake executable tests.
- [ ] Add local configuration docs.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `README.md`
- [ ] `../../agent-adapters.md`
- [ ] local development setup docs if OpenCode configuration is required
