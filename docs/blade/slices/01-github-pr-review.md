# Blade Slice 1: GitHub PR Review

## Status

- Vertical: Blade
- Status: Planned
- Last updated: 2026-05-29
- Owner: Blade coordinator and code-reviewer workflow

## Goal

Build the first production-shaped Blade capability: request Blade on a GitHub PR, inspect the PR through a durable Weave thread, produce structured findings with evidence, and publish a review only through an explicit policy path.

## Non-goals

- Do not implement background code changes in this slice.
- Do not add broad Slack, Discord, Linear, Sentry, or scheduled automation support.
- Do not build the full session UI before the thread and artifacts prove useful.
- Do not allow Blade to approve PRs automatically.
- Do not make customer-facing or public-repo publishing automatic unless an allowlist and gate policy are explicit.

## User Outcome

As an engineer, I can request Blade as a reviewer on a GitHub PR and inspect a durable review thread that shows the prompt, context collection, tools, findings, evidence, gates, and published review result.

## Target Flow

```txt
GitHub PR event or @blade review
  -> GitHub adapter verifies signature, repo, actor, and idempotency
  -> Blade creates or resumes one Weave thread
  -> Blade coordinator records normalized work item metadata
  -> code-reviewer agent inspects PR metadata and diff
  -> runtime prepares a read-only workspace when needed
  -> targeted checks run when cheap and relevant
  -> findings and evidence become artifacts
  -> gate is created before publishing when policy requires it
  -> GitHub review summary or inline comments are posted
  -> published URLs are recorded in the thread
```

## Architecture Impact

### Weave Core

Expected core changes should be minimal.

The slice should reuse:

- thread creation with metadata and idempotency
- inbox wakeups
- typed tools
- artifacts
- credential provider
- gate lifecycle
- structured findings

Only add new Weave primitives if the PR review path cannot be modeled cleanly with existing events and artifact records.

### Blade App

Add or define:

- `blade.intake.github` for PR webhook and mention intake
- `blade.review` for PR review planning and finding synthesis
- `github.inspectPullRequest` tool
- `runtime.prepareWorkspace` tool or read-only local equivalent
- `runtime.runCommand` tool for bounded checks
- `github.publishReview` tool
- structured review artifact and finding data

### Events

Start with existing generic events:

- `session.started`
- `prompt.received`
- `agent.step.started`
- `agent.step.completed`
- `tool.requested`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `gate.created`
- `gate.resolved`
- `agent.finding.produced`
- `agent.response.produced`

Candidate Blade-specific events should remain deferred until query needs are proven:

- `blade.work_item.created`
- `blade.review.completed`
- `blade.notification.posted`

### Artifacts

Expected artifacts:

- PR metadata snapshot
- diff summary
- structured review summary
- structured findings
- command output summaries
- test report when checks run
- published review URL

Large diffs, logs, and command outputs should be stored as artifacts with hashes and references, not embedded directly in thread events.

### Gates And Policy

Initial gate policy:

- require a gate before `APPROVE`
- require a gate before `REQUEST_CHANGES`
- require a gate before publishing to public repositories
- require a gate when inline findings include uncertain or low-confidence claims
- allow internal comment-only summaries to be auto-published only after a repository allowlist is explicit

### Credentials

GitHub credentials must be resolved through the credential layer.

Thread events may record credential metadata, grant id, actor, repository scope, and action, but never raw tokens.

## Tool Contracts

### `github.inspectPullRequest`

Purpose:

- fetch PR metadata, diff, comments, review threads, check statuses, and related commits

Inputs:

- owner
- repository
- pull request number
- optional path filters
- optional commit range

Outputs:

- PR title and body summary
- base and head refs
- changed files
- diff artifact reference
- check statuses
- comment context
- GitHub resource URLs

Tests should verify schema validation, repository allowlist behavior, redaction, and stable artifact references.

### `runtime.prepareWorkspace`

Purpose:

- prepare a read-only workspace for review and targeted checks

Inputs:

- repository
- base ref
- head ref
- setup mode
- runtime provider
- requested secrets

Outputs:

- workspace id
- root path
- checkout metadata
- setup logs artifact reference

Tests should use a local or fake runtime provider that exercises the real tool boundary without hitting cloud sandboxes.

### `runtime.runCommand`

Purpose:

- run bounded commands such as tests, typecheck, lint, or targeted scripts

Inputs:

- workspace id
- command
- args
- working directory
- timeout
- output limit
- redaction policy

Outputs:

- exit code
- duration
- stdout artifact reference
- stderr artifact reference
- redaction summary

Tests should verify timeout, output limit, failure exit code, and redaction paths.

### `github.publishReview`

Purpose:

- publish Blade's review result to GitHub after policy allows it

Inputs:

- owner
- repository
- pull request number
- review body
- event: `COMMENT`, `APPROVE`, or `REQUEST_CHANGES`
- optional inline comments
- idempotency key

Outputs:

- review URL
- published comment ids
- GitHub API response artifact reference if useful

Tests should verify duplicate publish attempts are idempotent and do not create duplicate comments.

## Test Plan

### Unit Tests

- GitHub payload validation rejects invalid signatures, unsupported events, invalid repositories, and stale timestamps.
- Work item normalization produces stable metadata and idempotency keys.
- Review finding validation rejects missing evidence, invalid severity, and malformed inline comments.
- Gate policy produces the expected gate requirement for approve, request-changes, public repo, and low-confidence cases.

### Integration Tests

- A valid GitHub PR review request creates exactly one thread with durable work item metadata.
- Duplicate webhook delivery returns or reuses the existing thread without duplicate runnable work.
- The real runner and tool worker process `github.inspectPullRequest` through requested, started, completed, and finding events.
- A denied publish gate prevents `github.publishReview` from running.
- An approved publish gate runs `github.publishReview` and records the published URL.

### Artifact Tests

- Large diff content is stored as an artifact reference, not directly inside event payloads.
- Command output artifacts include media type, byte length, hash, and redaction metadata.
- Review findings link back to source file, line, diff hunk, command output, or PR metadata evidence.

### Failure Tests

- Invalid GitHub payload returns 400 or 401 and creates no thread.
- GitHub API failure becomes `tool.failed` with actionable error metadata.
- Runtime preparation failure becomes `tool.failed`, not a runner crash.
- Publish failure is visible as a tool failure and can be retried without duplicate comments.

### Mocking Boundary

Mock GitHub network calls and sandbox providers at their boundary.

Do not mock:

- work item normalization
- `ThreadService`
- event append and projection updates
- runner planning path under test
- tool worker lifecycle
- gate policy logic

At least one test should fail if the actual review planner or publish tool is not invoked.

## Acceptance Criteria

- [ ] A GitHub PR event or `@blade review` can create or resume exactly one durable thread.
- [ ] The thread records normalized work item metadata without storing secrets.
- [ ] PR inspection runs through typed tool lifecycle events.
- [ ] Findings are structured, evidence-backed, and inspectable as artifacts or events.
- [ ] Publishing is gated according to policy.
- [ ] Duplicate webhooks and retries do not duplicate reviews or comments.
- [ ] Tests exercise the real Weave service, runner, worker, tool, and gate boundaries where practical.
- [ ] `blade/overview.md`, `blade/domain-model.md`, and relevant Weave architecture docs are updated when shipped.

## Progress

- [ ] Decide the first GitHub trigger: review request, PR comment mention, or both.
- [ ] Define `blade.intake.github` payload schemas and idempotency keys.
- [ ] Define `github.inspectPullRequest` contract and tests.
- [ ] Define review finding schema and artifact shape.
- [ ] Wire Blade review agent through `defineWeaveApp`.
- [ ] Add gate policy for review publishing.
- [ ] Define `github.publishReview` contract and tests.
- [ ] Add end-to-end integration test for request through publish gate.
- [ ] Update vertical and architecture docs with actual shipped behavior.

## Completion Notes

Not started.

## Docs To Update On Completion

- [ ] `docs/blade/slices/01-github-pr-review.md`
- [ ] `docs/blade/slices/README.md`
- [ ] `docs/blade/overview.md`
- [ ] `docs/blade/domain-model.md`
- [ ] `docs/architecture.md` if core primitives change
- [ ] `docs/event-taxonomy.md` if event types change
- [ ] `docs/declarative-api.md` if app authoring changes
- [ ] `docs/glossary.md` if shared vocabulary changes
