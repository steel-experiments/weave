# Weave Development Orchestrator Slices

This directory contains the implementation slices for the `Weave Maintainer` development loop.

These slices are intentionally separate from `../../slices/51-auth-gateway-thread-start.md` through `../../slices/56-auth-provider-adapter-boundary.md`. The auth gateway slice line should remain intact until this orchestrator is ready to run it.

## Slice Index

| Slice | Status | Document | Primary outcome |
| --- | --- | --- | --- |
| 1. Workflow Contracts And Events | Shipped | `01-workflow-contracts-and-events.md` | Stable inputs, outputs, typed events, checkpoints, and role schemas exist for the orchestrator. |
| 2. Initiative Planner And Approval Gate | In Progress | `02-initiative-planner-and-approval-gate.md` | An initiative thread can produce a slice plan and pause for human approval before implementation. |
| 3. Slice Runner Branch Control | Proposed | `03-slice-runner-branch-control.md` | A slice thread can confirm the working branch and run one slice through explicit lifecycle states. |
| 4. OpenCode Implementer Boundary | Proposed | `04-opencode-implementer-boundary.md` | OpenCode can implement one bounded slice and return a schema-validated summary. |
| 5. Verification And Reviewer Threads | Proposed | `05-verification-and-reviewer-threads.md` | Test/typecheck verification and read-only review run as child threads with structured results. |
| 6. Repair Loop And Human Stop Gates | Proposed | `06-repair-loop-and-human-stop-gates.md` | Failed slices enter bounded repair attempts or pause for human decision without drift. |
| 7. PR Draft And Initiative Handoff | Proposed | `07-pr-draft-and-initiative-handoff.md` | Completed initiatives produce a reviewable PR draft, test summary, and handoff artifact. |

## Backfill Rule

Each shipped slice should record:

- implemented modules
- event and checkpoint behavior
- policy and capability behavior
- tests added
- commands run
- known gaps
- follow-up slices
