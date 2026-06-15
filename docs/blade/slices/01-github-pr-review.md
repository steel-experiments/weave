# Blade Slice 1: GitHub PR Review

## Status

- Vertical: Blade
- Status: Shipped
- Last updated: 2026-06-15
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
GitHub `pull_request.review_requested` event where Blade is requested as reviewer
  -> GitHub adapter verifies signature, repo, actor, and idempotency
  -> Blade creates or resumes one Weave thread
  -> Blade coordinator records normalized work item metadata
  -> code-reviewer agent inspects PR metadata and diff
  -> findings and evidence become artifacts
  -> gate is created before publishing when policy requires it
  -> GitHub review summary or inline comments are posted
  -> published URLs are recorded in the thread
```

## Architecture Impact

### Weave Core

No Weave core changes shipped for this slice.

The shipped implementation reuses:

- thread creation with metadata and idempotency
- inbox wakeups
- typed tools
- artifacts
- credential provider
- gate lifecycle
- structured findings

Only add new Weave primitives if the PR review path cannot be modeled cleanly with existing events and artifact records.

### Blade App

Shipped in `examples/blade`.

Defined:

- `createBladeApiServer` and `createBladeGithubWebhookRoute` for signed GitHub webhook intake
- `normalizeGitHubReviewRequestedWebhook` for typed payload validation, reviewer matching, repository policy, and stable work item metadata
- `blade.github-pr-review` run-first agent for the PR review workflow
- `github.inspectPullRequest` tool
- `blade.synthesizePullRequestReview` tool for deterministic schema validation and review artifacts
- `github.publishReview` tool
- structured review artifact and finding data

Deferred from this slice:

- PR comment mention intake
- runtime workspace preparation
- command execution and targeted checks
- real GitHub network calls in default tests

### Events

The shipped flow uses existing generic events:

- `session.started`
- `prompt.received`
- `tool.requested`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `gate.created`
- `gate.resolved`
- `agent.finding.produced`
- `agent.response.produced`
- `agent.output.completed`

Candidate Blade-specific events should remain deferred until query needs are proven:

- `blade.work_item.created`
- `blade.review.completed`
- `blade.notification.posted`

### Artifacts

Expected artifacts:

- PR metadata snapshot
- raw diff artifact
- diff summary
- structured review summary
- structured findings
- published review URL in `github.publishReview` tool output and final agent output

Large diffs, logs, and command outputs should be stored as artifacts with hashes and references, not embedded directly in thread events.

### Gates And Policy

Shipped gate policy:

- require a `pr-review-approval` gate before every `github.publishReview` call
- never publish `APPROVE` in slice 1
- denied gates produce a final non-published agent response and do not request `github.publishReview`
- approved gates allow one idempotent `github.publishReview` tool call

### Credentials

The default implementation uses a fake/test GitHub client and does not resolve credentials.

When real GitHub network calls are added, credentials must be resolved through the credential layer.

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

Tests verify schema validation, repository allowlist behavior, redaction by omission, real tool lifecycle events, and stable artifact references.

### `blade.synthesizePullRequestReview`

Purpose:

- produce schema-validated findings, inline comment drafts, review body, and review artifacts from compact PR inspection output

Inputs:

- `github.inspectPullRequest` output

Outputs:

- review id
- outcome
- publish event: `COMMENT` or `REQUEST_CHANGES`
- review body
- inline comments
- structured findings
- findings artifact reference
- review summary artifact reference
- publish policy proposal

Tests verify every finding has evidence and artifact references.

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
- GitHub API response artifact reference if useful in a future real-client version

Tests should verify duplicate publish attempts are idempotent and do not create duplicate comments.

## Test Plan

### Unit Tests

- GitHub payload validation rejects invalid signatures, malformed payloads, and invalid repositories.
- Unsupported GitHub events or non-Blade reviewer requests are ignored without creating a thread.
- Work item normalization produces stable metadata and idempotency keys.
- Review finding validation rejects missing evidence, invalid severity, and malformed inline comments.
- Gate policy requires approval before every `github.publishReview` call in slice 1.

### Integration Tests

- A valid GitHub PR review request creates exactly one thread with durable work item metadata.
- Duplicate webhook delivery returns or reuses the existing thread without duplicate runnable work.
- The real runner and tool worker process `github.inspectPullRequest` through requested, started, progress, completed, and finding events.
- A denied publish gate prevents `github.publishReview` from running.
- An approved publish gate runs `github.publishReview` and records the published URL.

### Artifact Tests

- Large diff content is stored as an artifact reference, not directly inside event payloads.
- PR metadata, raw diff, diff summary, findings, and review summary artifacts include media type, byte length, hash, and source URL.
- Review findings link back to source file, line, diff hunk, command output, or PR metadata evidence.

### Failure Tests

- Invalid GitHub payload returns 400 or 401 and creates no thread.
- GitHub API failure becomes `tool.failed` with actionable error metadata.
- Runtime preparation failure becomes `tool.failed`, not a runner crash.
- Publish failure is visible as a tool failure and can be retried without duplicate comments.

Shipped note: runtime preparation did not ship in slice 1.

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

- [x] A GitHub `review_requested` event can create or resume exactly one durable thread.
- [x] The thread records normalized work item metadata without storing secrets.
- [x] PR inspection runs through typed tool lifecycle events.
- [x] Findings are structured, evidence-backed, and inspectable as artifacts and compact events.
- [x] Publishing is gated according to policy.
- [x] Duplicate webhooks and retries do not duplicate reviews or comments.
- [x] Tests exercise the real Weave service, runner, worker, tool, and gate boundaries where practical.
- [x] `blade/overview.md`, `blade/domain-model.md`, and relevant Weave architecture docs are updated when shipped.

## Progress

- [x] Decide the first GitHub trigger: review request.
- [x] Define GitHub intake payload schemas and idempotency keys.
- [x] Define `github.inspectPullRequest` contract and tests.
- [x] Define review finding schema and artifact shape.
- [x] Wire Blade review agent through `weave` app definition.
- [x] Add gate policy for review publishing.
- [x] Define `github.publishReview` contract and tests.
- [x] Add end-to-end integration test for request through publish gate.
- [x] Update vertical and architecture docs with actual shipped behavior.

## Completion Notes

Implemented as `examples/blade`.

Shipped behavior:

- signed GitHub `pull_request.review_requested` webhook intake at `/webhooks/github/blade`
- allowlisted repository policy and Blade reviewer matching
- stable work item idempotency key based on repository, PR number, and requested reviewer
- one durable Weave thread per work item using `ThreadService.startSession`
- `blade.github-pr-review` agent with normalized typed input
- `github.inspectPullRequest` typed tool using a fake/test GitHub client by default
- raw PR metadata and raw diff stored as artifacts, with compact references in events
- `blade.synthesizePullRequestReview` typed tool for structured findings and review artifacts
- `pr-review-approval` gate before publishing
- `github.publishReview` typed tool with idempotency key support and fake/test publishing boundary
- final agent output includes findings, artifacts, gate id, and published review URL when approved

Test evidence:

- `npm --workspace weave-blade run test`
- `npm --workspace weave-blade run typecheck`

No core architecture docs changed because no core primitive changed.

## Docs To Update On Completion

- [x] `docs/blade/slices/01-github-pr-review.md`
- [x] `docs/blade/slices/README.md`
- [x] `docs/blade/overview.md`
- [x] `docs/blade/domain-model.md`
- [x] `docs/architecture.md` if core primitives change: not needed
- [x] `docs/event-taxonomy.md` if event types change: not needed
- [x] `docs/declarative-api.md` if app authoring changes: not needed
- [x] `docs/glossary.md` if shared vocabulary changes: not needed
