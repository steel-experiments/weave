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
| 13. PRD To Slices Compiler | Planned | `13-prd-to-slices-compiler.md` | A compiler turns a pasted PRD/SOW into schema-valid proposed slices without executing them. |
| 14. Slice Plan Approval And Operator CLI | Planned | `14-slice-plan-approval-and-operator-cli.md` | Operator commands list initiatives and gates, inspect proposed plans, and durably approve or reject them. |
| 15. Resumable Initiative Runner Command | Planned | `15-resumable-initiative-runner-command.md` | One command creates/resumes PRD-backed initiatives, waits for approval, then runs approved slices sequentially. |
| 16. PR Draft Handoff Automation | Planned | `16-pr-draft-handoff-automation.md` | Completed initiatives produce PR-ready handoff artifacts and optional gated draft PR creation. |
| 17. Local Workflow Dashboard | Planned | `17-local-workflow-dashboard.md` | A localhost operator dashboard shows initiatives, slice threads, gates, progress, and events using `DESIGN.md`. |

## Auth Execution Readiness Path

The development-orchestrator prerequisite slices are shipped. Start with a dry run of `../../slices/51-auth-gateway-thread-start.md` only before asking Weave Maintainer to build auth gateway slices `51` through `56`.

Start with a dry run of `../../slices/51-auth-gateway-thread-start.md` only. Expand to the full auth sequence after that single slice has completed implementation, verification, review, and human approval through the orchestrator.

## Backfill Rule

Each shipped slice should record:

- implemented modules
- event and checkpoint behavior
- policy and capability behavior
- tests added
- commands run
- known gaps
- follow-up slices
