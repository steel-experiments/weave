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
- spawn one OpenCode implementer per slice
- run test, typecheck, and diff-whitespace checks
- spawn at least one read-only reviewer
- stop for human input when checks or review fail
- emit structured development events
- produce a branch summary and PR draft body

Bounded repair loops and multiple specialized reviewers can land as follow-up slices in the same vertical.

## Current Slice Index

| Slice | Status | Document | Primary outcome |
| --- | --- | --- | --- |
| 1. Workflow Contracts And Events | Shipped | `slices/01-workflow-contracts-and-events.md` | Stable inputs, outputs, typed events, checkpoints, and role schemas exist for the orchestrator. |
| 2. Initiative Planner And Approval Gate | Shipped | `slices/02-initiative-planner-and-approval-gate.md` | An initiative thread can produce a slice plan and pause for human approval before implementation. |
| 3. Slice Runner Branch Control | Proposed | `slices/03-slice-runner-branch-control.md` | A slice thread can confirm the working branch and run one slice through explicit lifecycle states. |
| 4. OpenCode Implementer Boundary | Proposed | `slices/04-opencode-implementer-boundary.md` | OpenCode can implement one bounded slice and return a schema-validated summary. |
| 5. Verification And Reviewer Threads | Proposed | `slices/05-verification-and-reviewer-threads.md` | Test/typecheck verification and read-only review run as child threads with structured results. |
| 6. Repair Loop And Human Stop Gates | Proposed | `slices/06-repair-loop-and-human-stop-gates.md` | Failed slices enter bounded repair attempts or pause for human decision without drift. |
| 7. PR Draft And Initiative Handoff | Proposed | `slices/07-pr-draft-and-initiative-handoff.md` | Completed initiatives produce a reviewable PR draft, test summary, and handoff artifact. |

## Completion Rule

When a development-orchestrator slice ships, update:

- the shipped slice document
- this overview if the product workflow changed
- core architecture docs if reusable Weave primitives changed
- agent adapter docs if OpenCode behavior changed
- event taxonomy docs if development events became public or reusable
