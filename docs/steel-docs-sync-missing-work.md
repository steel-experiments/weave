# Steel Docs Sync Missing Work

## Purpose

This document lists the Agent Mailbox work needed to support the Steel docs sync example cleanly.

The example can be hacked together today inside a standalone script, but several seams are missing from the core if we want the demo to prove the mailbox primitive rather than bypass it.

## Guiding Constraint

Each slice should preserve the core invariant that mailbox events are the durable source of truth.

External systems may trigger work and read results, but they should not become hidden state machines outside the mailbox.

## Slice 1: App-aware Runtime Wiring

### Problem

The default server and daemon scripts use the generic mock agent and mock tool worker.

The SRE demo manually wires its own app-specific agent, tools, credentials, observability, runner daemon, and tool daemon inside `examples/sre-demo/src/index.ts`.

That works for one demo, but a webhook-triggered Steel docs example needs a reusable way to boot a mailbox app with custom ingress and custom tools.

### Current Relevant Code

- `src/scripts/server.ts` creates the generic API server.
- `src/scripts/runner-daemon.ts` creates a `MailboxRunner` with default `DeterministicMockAgent`.
- `src/scripts/tool-daemon.ts` creates a `MockAsyncToolWorker`.
- `examples/sre-demo/src/index.ts` shows the custom wiring pattern.
- `src/app-contract.ts` defines `defineMailboxApp` and `getAgent`.

### Required Work

- add a runtime helper that accepts a `MailboxAppDefinition` and active agent name
- construct `MailboxRunner` with the chosen agent planner
- construct `ContractToolWorker` with the chosen agent tools
- pass app credential provider and observability sink into workers
- allow example servers to add custom HTTP routes before falling back to the core API

### Candidate API

```ts
type MailboxRuntimeOptions = {
  app: MailboxAppDefinition;
  agentName: string;
  engine: PostgresMailboxEngine;
  service: MailboxService;
  intervalMs?: number;
};

function createMailboxRuntime(options: MailboxRuntimeOptions): {
  runner: MailboxRunner;
  toolWorker: ContractToolWorker;
  runnerDaemon: RunnerDaemon;
  toolDaemon: ToolWorkerDaemon;
};
```

### Acceptance Criteria

- `examples/sre-demo` can either keep its existing wiring or migrate to the helper without behavior changes.
- `examples/steel-docs-sync` can boot its app without duplicating daemon setup.
- Core scripts remain simple for the generic PoC.

## Slice 2: Webhook Ingress

### Problem

The API only supports manually creating a mailbox with `POST /mailboxes` and `{ prompt }`.

There is no authenticated webhook endpoint for GitHub Actions, and `createApiServer` has no route extension point.

### Current Relevant Code

- `src/api-server.ts` handles `/health`, `/mailboxes`, events, observability, and gate resolution.
- `src/mailbox-service.ts` only exposes `startSession(prompt)` and `resolveGate(...)`.
- `docs/architecture.md` names webhooks as integration-layer responsibilities but there is no implementation.

### Required Work

- define a generic route extension or example-owned HTTP server wrapper
- add `POST /webhooks/github/steel-docs-sync` in the example server
- verify `x-agent-mailbox-signature` or equivalent HMAC header
- reject stale timestamps to reduce replay risk
- validate payload shape with Zod
- enforce repository allowlist of `steel-dev/docs`
- enforce URL host allowlist for docs and OpenAPI inputs
- create a mailbox session from the webhook payload

### Candidate Payload Schema

```ts
const SteelDocsSyncWebhookPayload = z.object({
  repository: z.literal("steel-dev/docs"),
  ref: z.string().min(1),
  sha: z.string().min(7),
  runId: z.string().min(1),
  runAttempt: z.number().int().positive(),
  eventName: z.string().min(1),
  mode: z.enum(["production-drift", "pull-request", "manual"]),
  docsBaseUrl: z.string().url(),
  llmsTxtUrl: z.string().url(),
  llmsFullTxtUrl: z.string().url().optional(),
  apiReferenceUrl: z.string().url().optional(),
  openApiSpecUrl: z.string().url().optional(),
});
```

### Acceptance Criteria

- invalid signatures return 401 or 403.
- invalid repository or URL hosts return 400.
- valid webhook requests create a mailbox and return status/events URLs.
- webhook-created mailboxes wake the runner through existing inbox routing.

## Slice 3: Session Metadata and Idempotency

### Problem

`MailboxService.startSession(prompt)` records only `session.started` with a hardcoded source and `prompt.received` with a hardcoded actor.

The Steel docs sync example needs to persist GitHub run metadata, source URLs, audit mode, and idempotency information.

### Current Relevant Code

- `src/mailbox-service.ts` hardcodes `source: "test"` and actor `demo-user`.
- `src/events.ts` has `SessionStartedPayloadSchema` with only `source`.
- `src/events.ts` has `PromptReceivedPayloadSchema` with only `prompt`.
- `src/postgres-engine.ts` supports `idempotencyKey` on events and append options, but session creation does not expose it.

### Required Work

- replace `startSession(prompt: string)` with an options object or add a new method
- support `source: "api" | "test" | "system" | "github-action"` or keep source generic enough for integrations
- include actor ID and actor type in session creation
- include metadata in `session.started` or a new event type
- expose idempotency keys for webhook-triggered runs
- decide whether duplicate webhook deliveries return the existing mailbox or create a no-op event

### Candidate API

```ts
type StartSessionInput = {
  prompt: string;
  source: "api" | "test" | "system" | "github-action";
  actor?: Actor;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
};

startSession(input: string | StartSessionInput): Promise<{
  mailboxId: string;
  correlationId: string;
}>;
```

### Acceptance Criteria

- existing PoC scripts still work or are migrated with minimal changes.
- webhook metadata is durable in the event stream.
- duplicate GitHub Action deliveries are safe.
- no secret values are stored in metadata.

## Slice 4: Artifact and Snapshot Handling

### Problem

Docs pages, `llms-full.txt`, and OpenAPI specs can be too large for mailbox events.

The event log should record durable facts and compact evidence, not raw source dumps.

The example also needs cross-run comparison for production drift and historical baselines.

### Current Relevant Code

- `tool.completed` output allows `data: unknown`.
- there is no blob, artifact, or snapshot table.
- there is no cross-mailbox state keyed by external resource.

### Required Work

- add an artifact storage interface or keep first slice outside core with filesystem/object storage references
- store content hash, byte length, media type, and source URL in mailbox events
- keep raw large content outside event payloads
- add optional snapshot records keyed by source identity
- support baseline lookup for the last successful audit of `steel-dev/docs`

### Candidate Artifact Record

```ts
type MailboxArtifact = {
  artifactId: string;
  mailboxId: string;
  kind: "source" | "report" | "diff";
  mediaType: string;
  sha256: string;
  byteLength: number;
  uri: string;
  createdAt: string;
};
```

### Acceptance Criteria

- tool events contain references and hashes, not full large payloads.
- an audit can compare current source fingerprints to a previous successful run.
- artifacts are inspectable by mailbox ID.
- artifact failure does not corrupt mailbox append semantics.

## Slice 5: Structured Audit Results

### Problem

The existing projection only exposes mailbox status, tail sequence, lease owner, and pending gates.

CI needs an easy way to know whether the run passed, warned, or failed without parsing every event deeply.

The current `agent.finding.produced` event is useful but not specific enough for docs drift as a long-term product shape.

### Current Relevant Code

- `src/events.ts` has `agent.finding.produced` with severity, summary, and evidence.
- `src/events.ts` has `agent.response.produced` with a message.
- `src/postgres-engine.ts` marks `agent.response.produced` as completed.
- `src/api-server.ts` returns raw events and a simple projection.

### Required Work

- use `agent.finding.produced` for the MVP
- define a docs-audit finding shape inside tool output data
- consider adding `agent.audit_report.produced` or a generic `agent.report.produced` later
- add a read model or summary endpoint for finding counts by severity
- expose final outcome as `passed`, `warning`, or `failed`

### Candidate Summary Response

```json
{
  "mailboxId": "...",
  "status": "completed",
  "outcome": "warning",
  "findings": {
    "critical": 0,
    "warning": 3,
    "info": 5
  },
  "finalMessage": "Steel docs sync audit completed with 3 warnings."
}
```

### Acceptance Criteria

- GitHub Actions can decide pass or fail from a stable API or stable event shape.
- humans can still inspect full event history for evidence.
- no docs-specific event is added until the generic finding path proves insufficient.

## Slice 6: Model-backed Review Boundary

### Problem

The current `AgentPlanner.plan` interface is synchronous.

A real expert review likely needs an LLM call, but the agent planner cannot await a model call today.

Putting LLM calls directly inside the runner would also blur the tool boundary.

### Current Relevant Code

- `src/runner.ts` defines `AgentPlanner.plan(mailboxId, events): AgentPlan | null`.
- `ContractToolWorker` already supports async tool execution.
- tools can emit progress, spans, credential events, and failures.

### Required Work

- implement model-backed review as a tool in the first version
- keep planner deterministic and event-driven
- pass compact source summaries and excerpts to the model tool
- validate model output with Zod before appending completion
- consider async planners only after one model-backed tool proves the need

### Acceptance Criteria

- model failures appear as `tool.failed`, not runner crashes.
- model output is schema-validated before becoming agent findings.
- replay does not require hidden in-memory model state.

## Slice 7: External Result Publishing

### Problem

The initial GitHub Action can poll events and fail itself, but richer product behavior needs mailbox-mediated publishing back to GitHub.

Publishing should not happen as a hidden side effect in the GitHub Action if the mailbox is meant to be the trace surface.

### Current Relevant Code

- `ContractToolWorker` can resolve credentials and run arbitrary typed tools.
- `CredentialProvider` can represent scoped tokens and delegated identity.
- there is no GitHub integration tool yet.

### Required Work

- add a `github.publishAuditResult` tool in the example
- request a scoped GitHub token through the credential provider
- create or update a check run for the commit SHA
- optionally post PR comments for pull request mode
- optionally create issues for scheduled drift
- record published URLs in tool output data

### Acceptance Criteria

- publishing can be disabled by audit mode.
- all publish attempts have tool lifecycle events.
- credentials are never stored in mailbox events.
- GitHub URLs are included in the final response when publishing succeeds.

## Slice 8: Worker Reliability and Diagnostics

### Problem

The current worker model is enough for deterministic demos but thin for network-heavy docs audits.

Fetches can timeout, upstream providers can fail, and long-running audits may need retry visibility.

### Current Relevant Code

- `ToolWorkerDaemon` claims `tool-worker` inbox rows and loops until terminal tool event.
- `mailbox_inbox` tracks attempts but has no dead-letter policy.
- `tool.failed` marks the mailbox failed immediately.

### Required Work

- define retry limits for transient tool failures
- expose inbox attempts in diagnostics
- add dead-letter or terminal failure policy for exhausted work
- distinguish audit findings from execution failure
- add fetch timeouts and content-size limits to docs tools

### Acceptance Criteria

- transient network failures are visible and bounded.
- permanent audit findings do not look like worker infrastructure failures.
- operators can inspect why a webhook-triggered mailbox stopped.

## Smallest Path That Works Today

The fastest credible version does not need every slice.

Build in this order:

1. app-aware example wiring by copying the SRE demo pattern
2. deterministic `examples/steel-docs-sync` with one audit tool
3. example-owned webhook server with HMAC verification
4. session metadata support in `MailboxService`
5. GitHub Action polling in `steel-dev/docs`
6. real source collection and OpenAPI lookup
7. structured summary endpoint or stable event parsing

Artifact storage, model-backed review, GitHub check publishing, and retry/dead-letter behavior can follow once the tracer bullet proves useful.
