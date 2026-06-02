# Steel Docs Sync Example

## Purpose

This document plans a product-shaped Weave example for auditing the Steel documentation ecosystem.

The focused app overview now lives in `docs-sync/README.md`, and per-slice progress tracking lives in `docs-sync/slices/`.

The example target is not this repository. It is the external Steel docs project:

- repository: `https://github.com/steel-dev/docs`
- live site: `https://docs.steel.dev`
- LLM index: `https://docs.steel.dev/llms.txt`
- API reference redirect: `https://docs.steel.dev/api-reference` to `https://steel.apidocumentation.com/api-reference`

The example should prove that Weave can coordinate an automated docs consistency agent triggered from GitHub Actions through a webhook, while preserving durable events, tool mediation, replayability, and auditable findings.

## Product Claim

A docs team should be able to schedule or trigger an expert agent that checks whether `llms.txt`, source docs, live docs, and the canonical OpenAPI schema agree with each other.

Weave should make that run:

- triggerable by an external system
- inspectable after completion
- resumable if workers restart
- safe around credentials and external publishing
- structured enough for CI to pass, warn, or fail

## Target User Story

As a Steel docs maintainer, I want GitHub Actions to trigger a docs sync audit after docs or API changes, so that drift between OpenAPI, docs pages, and `llms.txt` is caught before users and coding agents consume stale instructions.

## Current Steel Docs Signals

These facts were observed from the public `steel-dev/docs` repository and live site during planning.

- `scripts/generate-llms-txt.ts` generates root and section-level `llms.txt` files.
- `.github/workflows/ci.yml` already runs `bun run generate-llms`.
- `package.json` has `generate-openapi`, `generate-llms`, and `generate` scripts.
- `scripts/fetch-openapi-specs.mts` contains OpenAPI fetch/generation helpers, but the main fetch calls appear commented out.
- `next.config.mjs` redirects `/api-reference` to `https://steel.apidocumentation.com/api-reference`.
- `https://docs.steel.dev/llms.txt` is available.
- `https://docs.steel.dev/openapi.json` and `https://docs.steel.dev/openapi.yaml` returned 404 during planning.

The canonical OpenAPI source is therefore an explicit open decision for implementation.

## Non-goals

This example should not become a generalized workflow engine.

It should avoid:

- crawling arbitrary domains
- storing full docs bodies in thread events
- mutating the Steel docs repo in the first slice
- publishing comments before the thread run format is stable
- building a full dashboard before the event stream proves useful

## Desired End-to-end Flow

```txt
GitHub Action in steel-dev/docs
  -> signs webhook payload
  -> POST /webhooks/github/steel-docs-sync
  -> Weave creates a docs audit thread
  -> runner wakes docs sync agent
  -> agent requests source collection tool
  -> tool fetches repo/live docs/llms/OpenAPI inputs
  -> agent requests audit/review tool or emits deterministic findings
  -> agent produces structured findings and final response
  -> GitHub Action polls thread status and events
  -> GitHub Action passes, warns, or fails
```

## Weave App Shape

Create a new example app under `examples/steel-docs-sync`.

The app should use the current authoring and runtime primitives:

- `weave` for app composition
- `agent` for the Steel docs sync agent
- `tool` for fetch, compare, review, and publishing side effects
- `createWeaveRuntime` for app-aware runner and tool worker wiring
- `weave/runtime`, `weave/postgres`, and `weave/server` package subpaths for runtime, storage, and HTTP concerns
- `ThreadService.startSession` metadata and idempotency for webhook-triggered sessions

The first implementation can be deterministic. A later implementation can add an LLM review tool.

## Agent Role

The agent is an expert reviewer for Steel documentation consistency.

It should know how to reason about:

- API endpoint coverage
- SDK examples and constructor names
- CLI commands and install instructions
- auth headers and environment variables
- links from `llms.txt` to docs pages
- page descriptions in `llms.txt` versus page frontmatter
- generated docs versus live deployed docs
- OpenAPI operations that lack docs coverage
- docs pages that describe stale or removed endpoints

The agent should not directly fetch network resources or post to GitHub. Those actions should happen through thread-backed tools.

## Initial Tool Contracts

### `steelDocs.collectSources`

Collects the inputs required for the audit.

Inputs:

- repository owner and name
- ref and SHA
- docs base URL
- `llms.txt` URL
- optional `llms-full.txt` URL
- canonical OpenAPI URL or repo path
- audit mode

Outputs:

- source summary
- content hashes
- page index count
- OpenAPI operation count
- small excerpts for suspicious records
- artifact references for large payloads once artifact storage exists

This tool should enforce allowlists for repository and hostnames.

### `steelDocs.auditLlmsIndex`

Checks whether `llms.txt` represents the docs source and live site correctly.

Checks:

- missing pages
- stale page titles
- stale page descriptions
- links in `llms.txt` that return non-2xx status
- docs pages present in source but excluded unexpectedly
- generated `llms.txt` differs from deployed `llms.txt`

Outputs:

- findings grouped by severity
- affected pages
- suggested fix path

### `steelDocs.auditOpenApiCoverage`

Checks whether the canonical OpenAPI schema is reflected in docs and `llms.txt`.

Checks:

- undocumented operations
- documented endpoints not present in OpenAPI
- auth scheme mismatch
- base URL mismatch
- request or response shape mismatch where examples are parseable
- renamed SDK methods that still appear in docs or `llms.txt`

Outputs:

- findings grouped by endpoint and severity
- OpenAPI operation fingerprints
- docs page references

### `steelDocs.reviewWithModel`

Optional later tool for model-backed expert review.

Inputs should be compact summaries and excerpts, not full raw docs.

Outputs should be schema-validated findings.

This tool is the right place for LLM calls while `agent.run` remains replay-based and deterministic over thread events.

### `github.publishAuditResult`

Optional later tool for GitHub output.

Capabilities:

- create or update a check run
- post a PR comment
- create an issue for scheduled drift
- upload a markdown audit artifact

This should require explicit credentials from a `CredentialProvider` and should be introduced after the thread audit output is stable.

## Finding Model

The MVP can reuse `agent.finding.produced` with a compact evidence list.

The example should standardize finding data inside the summary and evidence fields until a dedicated docs-audit event is justified.

Suggested finding fields in tool output data:

- `id`
- `severity`: `info`, `warning`, or `critical`
- `category`: `llms-index`, `openapi-coverage`, `live-drift`, `link-health`, or `example-staleness`
- `summary`
- `source`
- `affectedUrl`
- `affectedFile`
- `operationId`
- `method`
- `path`
- `evidence`
- `suggestedFix`

Severity guidance:

- `critical`: CI should fail because users or agents would receive wrong API instructions.
- `warning`: CI may pass with warning because content is incomplete or stale but not dangerous.
- `info`: informational drift, coverage gap, or improvement.

## Webhook Payload

GitHub Actions should call a hosted Weave endpoint with a signed payload.

```json
{
  "repository": "steel-dev/docs",
  "ref": "refs/heads/main",
  "sha": "<commit-sha>",
  "runId": "<github-run-id>",
  "runAttempt": 1,
  "eventName": "schedule",
  "mode": "production-drift",
  "docsBaseUrl": "https://docs.steel.dev",
  "llmsTxtUrl": "https://docs.steel.dev/llms.txt",
  "llmsFullTxtUrl": "https://docs.steel.dev/llms-full.txt",
  "apiReferenceUrl": "https://steel.apidocumentation.com/api-reference",
  "openApiSpecUrl": "<canonical-openapi-source-tbd>"
}
```

Required response:

```json
{
  "threadId": "<thread-id>",
  "correlationId": "<correlation-id>",
  "statusUrl": "/threads/<thread-id>",
  "eventsUrl": "/threads/<thread-id>/events"
}
```

## GitHub Action Behavior

The GitHub Action in `steel-dev/docs` should run on:

- `workflow_dispatch`
- `schedule`
- `push` to `main` for docs-generation paths
- `pull_request` once PR comment behavior is ready

The action should:

- build the webhook JSON payload
- sign it with an HMAC secret
- POST it to the Weave webhook URL
- poll thread projection until `completed`, `failed`, or timeout
- fetch thread events
- summarize findings into the GitHub job summary
- fail if any critical finding exists

For the first slice, the action can be manually dispatched only.

## Tracer-bullet Slices

### Slice 1: Local deterministic audit demo

Goal:

Prove the agent shape without real webhook ingress.

Scope:

- create `examples/steel-docs-sync`
- define one agent and one `steelDocs.auditSources` tool
- run from a script like `npm run steel-docs:demo`
- use fixed sample inputs for `steel-dev/docs`
- produce final `agent.response.produced`

Acceptance criteria:

- the demo creates one thread
- the runner requests the audit tool
- the tool completes with deterministic findings
- the agent emits findings and a final response
- the event timeline is inspectable

### Slice 2: Real source collection

Goal:

Replace fixtures with real Steel docs inputs.

Scope:

- fetch live `https://docs.steel.dev/llms.txt`
- fetch live `https://docs.steel.dev/llms-full.txt` if available
- fetch selected `/llms.mdx/<page-path>` pages
- fetch source repo files through GitHub raw URLs or a checked-out workspace
- load canonical OpenAPI from the agreed source

Acceptance criteria:

- network fetches are allowlisted and bounded
- tool output contains hashes and summaries, not large raw bodies
- failures become `tool.failed` with actionable errors

### Slice 3: Webhook-triggered thread creation

Goal:

Let GitHub Actions start a Steel docs audit thread.

Scope:

- add a signed webhook route
- validate repository and host allowlists
- include GitHub run metadata in the thread start event or prompt metadata
- return polling URLs

Acceptance criteria:

- unsigned requests are rejected
- duplicate run attempts are idempotent or harmless
- a valid request creates exactly one runnable thread

### Slice 4: GitHub Action polling and CI result

Goal:

Make the external repo consume thread results.

Scope:

- add a workflow to `steel-dev/docs`
- call the webhook
- poll thread status
- fetch event history
- write a job summary
- fail on critical findings

Acceptance criteria:

- manual dispatch can complete an audit
- findings appear in GitHub Actions output
- critical findings fail the job

### Slice 5: Model-backed expert review

Goal:

Introduce non-deterministic expert judgment behind a typed tool boundary.

Scope:

- add `steelDocs.reviewWithModel`
- pass compact source summaries and excerpts
- require schema-validated output
- record model provider metadata without storing secrets

Acceptance criteria:

- model output is parsed and validated
- invalid output becomes a failed tool event
- final findings remain structured enough for CI

### Slice 6: GitHub publishing

Goal:

Publish results back to the Steel docs repo.

Scope:

- add `github.publishAuditResult`
- create or update a check run
- optionally post a PR comment
- optionally create an issue for scheduled drift

Acceptance criteria:

- GitHub credentials are resolved through the credential layer
- publishing emits tool lifecycle events
- the agent can run in report-only mode without publishing

## Open Decisions

- What is the canonical OpenAPI source for Steel?
- Should the audit compare generated files from the PR branch, deployed production, or both?
- Should scheduled audits create issues, check runs, or only fail a workflow?
- Should `llms.txt` drift be treated as critical on main but warning on pull requests?
- Where should large source artifacts live before the thread has first-class artifact storage?

## Success Criteria

This example is successful when:

- a GitHub Action in `steel-dev/docs` can trigger a thread through a webhook
- the thread event stream explains each audit step
- the audit checks live `llms.txt`, docs pages, and the canonical OpenAPI source
- findings are structured enough for CI and humans
- no raw secrets or large source bodies are stored in thread events
- the example makes integration ingress and result publishing concrete without turning Weave into a workflow DSL
