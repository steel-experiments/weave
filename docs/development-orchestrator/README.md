# Weave Development Orchestrator

## Purpose

The Weave Development Orchestrator is an internal dogfood workflow for managing durable implementation initiatives before handing work to OpenCode-backed coding agents.

Its first product name is `Weave Maintainer`.

The goal is not to create an unbounded autonomous coding agent. The goal is to let Weave own the development control loop:

```txt
initiative / branch
  -> slice plan
  -> OpenCode implementation child thread
  -> tests and typecheck
  -> reviewer child threads
  -> bounded repair loop or human gate
  -> docs update
  -> PR draft summary
  -> human approval
```

OpenCode remains a reasoning and patching component. Weave owns orchestration, policy, child-thread structure, durable waits, typed events, checkpoints, verification, review, and audit.

## Why This Comes Before Auth Gateway

The auth gateway work is already represented by proposed core slices `51` through `56` under `../slices/`.

This vertical should ship first so the auth gateway initiative can become the first serious dogfood run:

```txt
Root thread: initiative/auth-gateway
  -> slice: 51-auth-gateway-thread-start
  -> slice: 52-auth-context-runtime-policy
  -> slice: 53-authenticated-thread-actions
  -> slice: 54-authenticated-integration-ingress
  -> slice: 55-auth-decision-audit-trail
  -> slice: 56-auth-provider-adapter-boundary
  -> PR thread
```

## Product Shape

Given an initiative, Weave manages a durable line of implementation slices, delegates bounded coding work to OpenCode-backed child agents, verifies each slice with deterministic checks and independent reviewer agents, and produces a PR draft when the branch satisfies the acceptance criteria.

The orchestrator should prove these Weave primitives together:

- child threads
- typed events
- policies
- capabilities
- durable waits
- external signals
- checkpoints
- OpenCode adapter
- review agents
- PR workflow
- human gates

## Thread Model

```txt
Root thread: initiative/<initiative-slug>
  -> slice thread: <slice-id>
     -> implementation thread: opencode-implement
     -> verification thread: tests-typecheck
     -> review thread: architecture-review
     -> review thread: docs-review
     -> repair thread: opencode-repair
  -> PR thread: open-pr-and-respond-to-review
```

The initiative thread owns the line of work. Each slice thread owns one durable unit of progress. Implementation, verification, review, and repair threads are bounded child tasks with specific roles.

## Roles

### Initiative Planner

Reads repo guidance, docs, existing slice history, and the current architecture. Produces a slice plan, acceptance criteria, and ordering. Emits proposed-slice events and asks for human approval before work starts.

This role must not write code.

### Slice Runner

Owns one slice. Confirms branch/worktree state, spawns the OpenCode implementer, runs verification, spawns reviewers, evaluates results, and either marks the slice completed, starts a bounded repair attempt, or asks for human input.

### OpenCode Implementer

Implements a single bounded slice on the working branch. Receives slice objective, acceptance criteria, constraints, allowed files when present, and expected output schema. Returns a structured summary of files changed, tests added, behavior changed, limitations, and follow-ups.

OpenCode output is a claim, not the source of truth. Weave verifies it independently.

### Verification Agent

Runs deterministic checks such as `npm test`, `npm run typecheck`, `git diff --check`, and targeted examples. Emits structured command results and parsed failures.

### Reviewer Agents

Read-only agents that inspect the diff, relevant source, docs, tests, and acceptance criteria. Initial reviewers should cover architecture, replay safety, compatibility, docs, and security when security-sensitive files change.

### Repair Agent

Receives only failing checks and reviewer findings. Fixes only those issues. The slice runner reruns verification and review after each repair attempt.

### PR Agent

Generates a PR draft body containing shipped slices, test output, known limitations, and follow-ups. It may open or update a PR when policy allows, but merge remains behind a human gate.

## Capability Boundaries

Initial capabilities:

- `repo.read`
- `repo.write.branch`
- `repo.createBranch`
- `repo.runTests`
- `github.pr.create`
- `github.pr.comment`
- `github.pr.read`
- `github.pr.merge`
- `opencode.run`

Default policy intent:

- OpenCode implementers can read the repo, write only to the current working branch, run bounded commands, and cannot merge PRs or access secrets.
- Reviewer agents can read repo state and diffs but cannot write code or run mutating commands.
- Verification agents can run bounded checks and read output but cannot edit files.
- PR agents can create or update PRs but cannot merge without a human gate.
- Writes to `main` are denied.
- Writes outside a slice `allowedFiles` list require human approval.
- Changes touching auth, credentials, capabilities, tokens, policy enforcement, replay reconciliation, Postgres migrations, or `ThreadEngine` require extra review.

## MVP Boundary

The first shipped version should accept:

- initiative title
- base branch
- working branch
- slice markdown files or inline slice list

The first workflow should:

- approve a slice plan before execution
- process slices in order
- allocate or receive a `WorkspaceRef` for each slice before implementation
- spawn one OpenCode implementer per slice
- run test, typecheck, and diff-whitespace checks
- spawn at least one read-only reviewer
- stop for human input when checks or review fail
- emit structured development events
- produce a branch summary and PR draft body

The repair agent boundary, stop-gate policy, and PR handoff boundary are shipped. The remaining path to using this for auth work is integration and hardening: parent slice-loop composition, initiative-level sequencing, explicit workspace lifecycle ownership, and the real OpenCode runner adapter.

## Current Slice Index

| Slice | Status | Document | Primary outcome |
| --- | --- | --- | --- |
| 1. Workflow Contracts And Events | Shipped | `slices/01-workflow-contracts-and-events.md` | Stable inputs, outputs, typed events, checkpoints, and role schemas exist for the orchestrator. |
| 2. Initiative Planner And Approval Gate | Shipped | `slices/02-initiative-planner-and-approval-gate.md` | An initiative thread can produce a slice plan and pause for human approval before implementation. |
| 3. Slice Runner Branch Control | Shipped | `slices/03-slice-runner-branch-control.md` | A slice thread can confirm the working branch and run one slice through explicit lifecycle states. |
| 4. OpenCode Implementer Boundary | Shipped | `slices/04-opencode-implementer-boundary.md` | OpenCode can implement one bounded slice and return a schema-validated summary. |
| 5. Verification And Reviewer Threads | Shipped | `slices/05-verification-and-reviewer-threads.md` | Test/typecheck verification and read-only review run as child threads with structured results. |
| 6. Repair Loop And Human Stop Gates | Shipped | `slices/06-repair-loop-and-human-stop-gates.md` | Failed slices can enter bounded repair attempts or pause for human decision without drift. |
| 7. PR Draft And Initiative Handoff | Shipped | `slices/07-pr-draft-and-initiative-handoff.md` | Completed initiatives produce a reviewable PR draft, test summary, and handoff artifact. |
| 8. Parent Slice Loop Composition | Shipped | `slices/08-parent-slice-loop-composition.md` | One approved slice runs through implement, verify, review, bounded repair, and completion with state-driven replay. |
| 9. Initiative-Level Sequencing | Shipped | `slices/09-initiative-level-sequencing.md` | Approved plans execute slices serially and stop on failure before producing a PR draft. |
| 10. Workspace Lifecycle Ownership | Shipped | `slices/10-workspace-lifecycle-ownership.md` | Initiatives explicitly allocate, reuse, preserve, and clean up workspaces through `WorkspaceRef`. |
| 11. Real OpenCode Runner Adapter | Shipped | `slices/11-real-opencode-runner-adapter.md` | OpenCode implementation and repair runners execute in selected workspaces behind existing boundaries. |
| 12. Initiative Spec And Plan Contracts | Shipped | `slices/12-initiative-spec-and-plan-contracts.md` | Stable PRD/SOW input and initiative-plan contracts define what automation stores, proposes, approves, and executes. |
| 13. PRD To Slices Compiler | Shipped | `slices/13-prd-to-slices-compiler.md` | A compiler turns a pasted PRD/SOW into schema-valid proposed slices without executing them. |
| 14. Slice Plan Approval And Operator CLI | Shipped | `slices/14-slice-plan-approval-and-operator-cli.md` | Operator commands list initiatives and gates, inspect proposed plans, and durably approve or reject them. |
| 15. Resumable Initiative Runner Command | Shipped | `slices/15-resumable-initiative-runner-command.md` | One command creates/resumes PRD-backed initiatives, waits for approval, then runs approved slices sequentially. |
| 16. PR Draft Handoff Automation | Shipped | `slices/16-pr-draft-handoff-automation.md` | Completed initiatives produce PR-ready handoff artifacts and optional gated draft PR creation. |
| 17. Local Workflow Dashboard | Shipped | `slices/17-local-workflow-dashboard.md` | A localhost operator dashboard shows initiatives, slice threads, gates, progress, and events using `DESIGN.md`. |
| 18. Source Checkpoint Contracts | Proposed | `slices/18-source-checkpoint-contracts.md` | Durable schemas and events describe source-code checkpoints without mutating Git. |
| 19. Per-Slice Git Commit Checkpoints | Proposed | `slices/19-per-slice-git-commit-checkpoints.md` | Passing slices create Git commits and store their SHAs as source checkpoints. |
| 20. Source Checkpoint Inspection | Proposed | `slices/20-source-checkpoint-inspection.md` | Operator CLI and dashboard expose per-slice checkpoint metadata and diff commands. |
| 21. Guarded Source Checkpoint Restore | Proposed | `slices/21-guarded-source-checkpoint-restore.md` | Maintainers can restore an initiative worktree to a checkpoint through guarded, auditable commands. |
| 22. Finalization Git Side Effects | Proposed | `slices/22-finalization-git-side-effects.md` | Explicit finalization modes can merge or open PRs only after final approval. |
| 23. Auth Gateway Epic PRD | Proposed | `slices/23-auth-gateway-epic-prd.md` | A multi-slice auth PRD lets Maintainer execute remaining auth slices as one epic after checkpointing. |

## Auth Execution Readiness Path

The orchestrator foundation needed before auth work is shipped. Slices `51` and `52` have been dogfooded individually. Do not run the remaining auth slices as one unattended epic until source checkpoints are shipped, because each accepted slice needs an inspectable Git commit boundary before the next slice starts.

## Auth Slice 51 Dry Run

Use `npm run auth:dry-run` to start or inspect the idempotent single-slice dry run. The script migrates the configured Postgres database without resetting it, starts Weave runtime daemons locally, proposes only `51-auth-gateway-thread-start`, and stops at the mandatory slice-plan approval gate by default.

To approve that gate and let OpenCode run the slice, use `npm run auth:dry-run -- --approve-plan`.

Defaults:

- `baseBranch`: current checkout branch
- `workingBranch`: `auth-gateway-slice-51-dry-run`, or `auth-gateway-slice-51-dry-run-workspace` when the current branch already has the dry-run name
- `workspaceRoot`: `/tmp/weave-development-workspaces`
- `workspaceMode`: initiative-scoped git worktree
- `cleanupOnSuccess`: false, so the workspace is preserved for inspection
- OpenCode command: `opencode run --format json --dir <workspace> <prompt>`
- `github`: disabled; the PR agent creates a local draft summary and stops at `pr-review-approval`
- required reviewers: `security-reviewer`, `replay-safety-reviewer`, `compatibility-reviewer`, `docs-reviewer`

Useful overrides:

- `npm run auth:dry-run -- --base-branch weave-development-orchestrator --working-branch auth-gateway-slice-51-dry-run`
- `npm run auth:dry-run -- --workspace-root /tmp/weave-auth-workspaces`
- `WEAVE_DRY_RUN_OPENCODE_COMMAND=opencode npm run auth:dry-run -- --approve-plan`

The script prints the root thread id, child thread tree, pending gate ids, workspace root, and root timeline. Inspect any preserved workspace with `git -C <workspace-path> status` and `git -C <workspace-path> diff` before proceeding to slices `52` through `56`.

During long-running tools, the script also prints selected live events such as `tool.started`, `tool.progress`, `tool.failed`, child-thread terminal events, gates, and development workflow events. OpenCode CLI runs emit start, heartbeat, stderr, and completion progress through durable `tool.progress` events.

If OpenCode auto-rejects a permission request or exceeds the configured output bound, the runner returns a structured blocked result instead of `tool.failed`, and the slice runner stops at the `repair-stop` human gate for operator action.

The dry run wires `PostgresObservabilitySink`, so runner/tool spans and logs are persisted in `weave.observability_span` and `weave.observability_log` for runs started after this wiring was added.

## PRD/SOW Compiler Path

The first automation path is contract-first and compile-only. A maintainer can pass an `initiativeSpec` with a PRD or statement of work into `createWeaveMaintainerAgent({ planCompiler })`. If explicit `slices` are not supplied, the maintainer uses the injected compiler to produce a schema-valid proposed `InitiativePlan`.

Current behavior:

- `InitiativeSpec` is checkpointed as `initiative-spec`.
- Proposed plans are checkpointed as `proposed-initiative-plan` and mirrored through the legacy `slice-plan` checkpoint for current runner compatibility.
- Compact planning audit events are emitted for spec receipt, plan proposal, plan approval, and plan rejection.
- The deterministic markdown compiler recognizes `## Slice ...` sections and extracts acceptance criteria from markdown bullets.
- Compilation stops at the normal `slice-plan-approval` gate and does not allocate workspaces, start OpenCode, run verification, or create PRs.

Generated plan approvals can be inspected and resolved with the operator CLI.

## Operator CLI

The operator CLI removes the need to inspect raw events for the common dogfood loop. It reads durable state from Postgres and uses the existing `ThreadService.resolveGate` path for approvals.

Commands:

- `npm run gates:list`
- `npm run gates:show -- <gate-id>`
- `npm run gates:approve -- <gate-id> --note "approved"`
- `npm run gates:reject -- <gate-id> --note "reason"`
- `npm run initiatives:list`
- `npm run initiative:status -- <thread-id>`

Typical approval flow:

1. Run `npm run gates:list`.
2. Inspect the plan with `npm run gates:show -- <gate-id>`.
3. Approve or reject the gate with a note.
4. Check progress with `npm run initiative:status -- <thread-id>`.

## Resumable Initiative Run Command

Use `npm run initiative:run -- --from <prd-or-sow.md>` to create or resume a PRD-backed initiative.

Example:

```txt
npm run initiative:run -- --from docs/prds/local-workflow-dashboard.md
```

Behavior:

- Loads the markdown file as an `InitiativeSpec`.
- Uses the deterministic markdown compiler to propose slices when explicit slices are not provided.
- Starts an idempotent `weave.maintainer` root thread.
- Stops at the `slice-plan-approval` gate before implementation.
- After the gate is approved, rerunning the same command resumes the thread and executes approved slices sequentially.
- Stops again on repair, review, PR handoff, or other human gates.
- Prints the root thread id, branch, pending gates, initiative status, and next operator command.

Useful options:

- `--base-branch <branch>`
- `--working-branch <branch>`
- `--workspace-root <path>`
- `--idempotency-key <key>`
- `--timeout-ms <ms>`
- `--opencode-command <command>`
- `--opencode-args "run --format json"`

The command is local/Postgres-backed. It does not push, merge, or create a remote PR.

## PR Handoff

Completed initiatives produce a `pr-handoff` checkpoint before any remote PR side effect. The handoff includes shipped slices, changed files, validation commands, reviewer results, known limitations, follow-ups, suggested PR title/body, and remote PR state.

Remote PR creation or update is behind the final `pr-review-approval` gate:

- Before approval, `dev.github.pr.upsert` is not called.
- If the final gate is denied, the workflow returns without remote side effects.
- If approved and GitHub mode is enabled, the PR agent calls the configured GitHub runner and records `pr-url` plus `pr-remote-handoff`.
- If GitHub mode is disabled, the local handoff remains the terminal review artifact.

## Local Dashboard

Run the local workflow dashboard with:

```txt
npm run dashboard
```

Defaults:

- Host: `0.0.0.0`
- Port: `3010`
- Local URL: `http://127.0.0.1:3010`
- Tailscale/device URL: `http://<tailscale-or-device-ip>:3010`

Environment overrides:

- `WEAVE_DASHBOARD_HOST`
- `WEAVE_DASHBOARD_PORT`
- `PORT`

The dashboard reads durable Postgres state and mirrors the operator CLI vocabulary. It shows initiatives, child slice threads, pending gates, approve/reject actions, live tool progress, recent events, and PR handoff artifacts.

Security posture:

- The dashboard binds to all interfaces by default for local/Tailscale access.
- It has no auth in this slice.
- Use it only on trusted local/Tailscale networks until the auth slices are resumed.

## Completion Rule

When a development-orchestrator slice ships, update:

- the shipped slice document
- this overview if the product workflow changed
- core architecture docs if reusable Weave primitives changed
- agent adapter docs if OpenCode behavior changed
- event taxonomy docs if development events became public or reusable
