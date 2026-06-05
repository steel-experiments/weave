# Weave Development Orchestrator Slices

This directory contains the implementation slices for the `Weave Maintainer` development loop.

These slices are intentionally separate from `../../slices/51-auth-gateway-thread-start.md` through `../../slices/56-auth-provider-adapter-boundary.md`. The auth gateway slice line should remain intact until this orchestrator is ready to run it.

## Slice Index

| Slice | Status | Document | Primary outcome |
| --- | --- | --- | --- |
| 1. Workflow Contracts And Events | Shipped | `01-workflow-contracts-and-events.md` | Stable inputs, outputs, typed events, checkpoints, and role schemas exist for the orchestrator. |
| 2. Initiative Planner And Approval Gate | Shipped | `02-initiative-planner-and-approval-gate.md` | An initiative thread can produce a slice plan and pause for human approval before implementation. |
| 3. Slice Runner Branch Control | Shipped | `03-slice-runner-branch-control.md` | A slice thread can confirm the working branch and run one slice through explicit lifecycle states. |
| 4. OpenCode Implementer Boundary | Shipped | `04-opencode-implementer-boundary.md` | OpenCode can implement one bounded slice and return a schema-validated summary. |
| 5. Verification And Reviewer Threads | Shipped | `05-verification-and-reviewer-threads.md` | Test/typecheck verification and read-only review run as child threads with structured results. |
| 6. Repair Loop And Human Stop Gates | Shipped | `06-repair-loop-and-human-stop-gates.md` | Failed slices can enter bounded repair attempts or pause for human decision without drift. |
| 7. PR Draft And Initiative Handoff | Shipped | `07-pr-draft-and-initiative-handoff.md` | Completed initiatives produce a reviewable PR draft, test summary, and handoff artifact. |
| 8. Parent Slice Loop Composition | Shipped | `08-parent-slice-loop-composition.md` | One approved slice runs through implement, verify, review, bounded repair, and completion with state-driven replay. |
| 9. Initiative-Level Sequencing | Shipped | `09-initiative-level-sequencing.md` | Approved plans execute slices serially and stop on failure before producing a PR draft. |
| 10. Workspace Lifecycle Ownership | Shipped | `10-workspace-lifecycle-ownership.md` | Initiatives explicitly allocate, reuse, preserve, and clean up workspaces through `WorkspaceRef`. |
| 11. Real OpenCode Runner Adapter | Shipped | `11-real-opencode-runner-adapter.md` | OpenCode implementation and repair runners execute in selected workspaces behind existing boundaries. |
| 12. Initiative Spec And Plan Contracts | Shipped | `12-initiative-spec-and-plan-contracts.md` | Stable PRD/SOW input and initiative-plan contracts define what automation stores, proposes, approves, and executes. |
| 13. PRD To Slices Compiler | Shipped | `13-prd-to-slices-compiler.md` | A compiler turns a pasted PRD/SOW into schema-valid proposed slices without executing them. |
| 14. Slice Plan Approval And Operator CLI | Shipped | `14-slice-plan-approval-and-operator-cli.md` | Operator commands list initiatives and gates, inspect proposed plans, and durably approve or reject them. |
| 15. Resumable Initiative Runner Command | Shipped | `15-resumable-initiative-runner-command.md` | One command creates/resumes PRD-backed initiatives, waits for approval, then runs approved slices sequentially. |
| 16. PR Draft Handoff Automation | Shipped | `16-pr-draft-handoff-automation.md` | Completed initiatives produce PR-ready handoff artifacts and optional gated draft PR creation. |
| 17. Local Workflow Dashboard | Shipped | `17-local-workflow-dashboard.md` | A localhost operator dashboard shows initiatives, slice threads, gates, progress, and events using `DESIGN.md`. |
| 18. Source Checkpoint Contracts | Shipped | `18-source-checkpoint-contracts.md` | Durable schemas and events describe source-code checkpoints without mutating Git. |
| 19. Per-Slice Git Commit Checkpoints | Shipped | `19-per-slice-git-commit-checkpoints.md` | Passing slices create Git commits and store their SHAs as source checkpoints. |
| 20. Source Checkpoint Inspection | Shipped | `20-source-checkpoint-inspection.md` | Operator CLI and dashboard expose per-slice checkpoint metadata and diff commands. |
| 21. Guarded Source Checkpoint Restore | Shipped | `21-guarded-source-checkpoint-restore.md` | Maintainers can restore an initiative worktree to a checkpoint through guarded, auditable commands. |
| 22. Finalization Git Side Effects | Proposed | `22-finalization-git-side-effects.md` | Explicit finalization modes can merge or open PRs only after final approval. |
| 23. Auth Gateway Epic PRD | Proposed | `23-auth-gateway-epic-prd.md` | A multi-slice auth PRD lets Maintainer execute remaining auth slices as one epic after checkpointing. |

## Auth Execution Readiness Path

The development-orchestrator prerequisite slices through the local dashboard are shipped. Slice `51` and `52` have been dogfooded individually. Before asking Weave Maintainer to complete the remaining auth gateway epic autonomously, ship source checkpoints so each accepted slice has an inspectable Git commit boundary.

## Backfill Rule

Each shipped slice should record:

- implemented modules
- event and checkpoint behavior
- policy and capability behavior
- tests added
- commands run
- known gaps
- follow-up slices
