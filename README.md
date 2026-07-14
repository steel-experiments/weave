# Weave

Weave is a TypeScript control plane for durable agent execution. It gives agent systems a persistent thread of record where prompts, tool requests, progress, approvals, credentials, timers, signals, child threads, policy decisions, and final outcomes are stored as events.

Hosts can adopt Weave at either of two levels:

- Use the kernel as an event log, inbox, lease, lineage, gate, and read-model substrate while keeping an existing agent runtime and worker loop.
- Use the optional replay runtime to author agents and tools with durable `ctx.*` operations.

The project is currently a working proof of concept, not a published npm package. The runtime, Postgres engine, HTTP server, auth gateway, tests, and examples are implemented in this repository and are being prepared for an open-source release.

## What Weave Provides

- Durable event-sourced threads for agent sessions.
- Replay-based `agent.run(ctx, input)` authoring with stable durable effect keys.
- Typed tools that run outside the agent process and report progress, completion, failure, summaries, credentials, artifacts, and gates.
- Human approval gates, durable sleeps, external signal waits, checkpoints, and child threads.
- Runtime request policies that can allow, deny, or require approval before supported durable requests are recorded.
- A Postgres-backed engine, inbox-based runner/tool daemons, and an HTTP API for local service mode.
- A read-only `ThreadQueryService` boundary for hosts that need thread heads, ancestry, health summaries, inbox diagnostics, and cursor-paginated event pages without depending on storage tables.
- Auth gateway primitives for protecting API ingress with pluggable identity providers and access rules.
- A hardened `weave/opencode` adapter for bounded OpenCode CLI execution with explicit permission profiles, schema-validated output, sanitized env, and actual workspace diff enforcement.

Weave does not persist JavaScript continuations. When a durable operation is pending, the runner exits. A later event wakes the thread, and Weave replays `agent.run` from the beginning, returning recorded results for completed durable effects.

## Current Status

- Runtime status: usable local proof of concept.
- Storage status: Postgres-backed implementation using a dedicated `weave` schema.
- Consumption model: kernel-first hosts use `weave`, `weave/core`, and a storage adapter such as `weave/postgres`; hosts that want Weave's replay authoring model use `weave/runtime`.
- Production-shaped consumer: [Blade](https://github.com/steel-dev/blade) embeds the kernel beneath its existing Steel agent harness and owns its worker and connector loops.
- Compatibility: older planner-style agents and legacy tool output envelopes are still supported as migration paths.
- Packaging status: a `tsc` build emits JavaScript and declaration files to `dist/`, `exports` point at the built files, `files` narrows the publish manifest, and the package is MIT-licensed. Remaining before `npm publish`: flip `private: true`, finalize the public repository URL and package name, and complete `docs/release-readiness.md`.
- Release status: see `docs/release-readiness.md` for remaining open-source blockers.

## Requirements

- Node.js 22 or newer is recommended for the current TypeScript-first workflow.
- npm.
- Postgres for kernel embedding, runtime demos, and service mode.

By default, local commands use:

```txt
postgres://dev:password@localhost:5432/dev
```

Set `DATABASE_URL` to use a different database.

## Install

```sh
npm install
```

## Verify

```sh
npm run typecheck
npm test
```

## Build

Local development resolves the `weave` subpaths to TypeScript source (via `tsconfig` path mapping), so no build is needed to run tests or examples. To produce the publishable artifact, compile to `dist/` with `tsc`:

```sh
npm run build
```

The package `exports` point at the built `dist/` files; the build also runs automatically before `npm pack`/`npm publish` via `prepack`.

Run migrations without resetting existing data:

```sh
npm run db:migrate
```

## Kernel-First Embedding

Use this shape when the host already has an agent harness or worker loop. `ThreadService` authors validated lifecycle events, `ThreadQueryService` exposes operational read models, and `PostgresThreadEngine` supplies persistence, inboxes, leases, projections, gates, and lineage.

```ts
import {
  PostgresThreadEngine,
  ThreadQueryService,
  ThreadService,
  createPool,
  migrate,
} from "weave/postgres";

const pool = createPool();
await migrate(pool);

const engine = new PostgresThreadEngine(pool, {
  inboxRoutes(event) {
    return event.type === "agent.reply.produced"
      ? [{ consumer: "my-egress" }]
      : [];
  },
});
const threads = new ThreadService(engine);
const queries = new ThreadQueryService(engine);

const { threadId } = await threads.startSession({
  prompt: "Investigate the failed deployment",
  source: "api",
  agentName: "ops-agent",
  actor: { type: "user", id: "user-123" },
  idempotencyKey: "slack:event-456",
  metadata: { channel: "deployments" },
});

const head = await queries.getThreadHead(threadId);
```

The engine's built-in inbox routes wake the standard `runner` and `tool-worker` consumers for relevant kernel events. `inboxRoutes` adds host-specific consumers without replacing those defaults. A custom host can claim inbox work, acquire a thread lease, run its own bounded turn, and append typed events through `ThreadService.appendEvent`.

## How Blade Uses Weave

[Blade](https://github.com/steel-dev/blade) is the clearest example of kernel-first embedding. It does not import `weave/runtime` or use replay-authored `agent.run` functions. Instead, it:

- Vendors Weave at `packages/weave` as a Git submodule and builds it as an npm workspace package in CI and deployment.
- Imports event contracts and deterministic ID helpers from `weave`, and the Postgres engine, migrations, `ThreadService`, and `ThreadQueryService` from `weave/postgres`.
- Converts Slack, Discord, alert, and other connector envelopes into idempotent root sessions or additional `prompt.received` events.
- Claims the built-in `runner` inbox, acquires a per-thread lease, invokes its existing Steel turn harness, and appends replies, progress, tool facts, terminal events, and approval gates to the thread.
- Routes `agent.reply.produced` and Blade-specific `domain.event` records to a custom `egress` inbox consumer, which delivers results through the originating connector.
- Uses child-session lineage for delegated work, gates for operator approval, and query-service read models for audit timelines, health checks, stuck-thread detection, inbox remediation, and UI observability.

The important boundary is that Weave owns durable coordination and history while Blade owns agent execution, connector behavior, and product policy. See Blade's [`apps/api/src/weave`](https://github.com/steel-dev/blade/tree/main/apps/api/src/weave) integration for the current implementation.

## Minimal Authoring Example

For hosts that want Weave to provide the replay model as well, authoring primitives (`agent`, `tool`, `weave`, `event`, `capability`, `policy`) live in `weave/runtime`.

```ts
import { agent, tool, weave } from "weave/runtime";
import { z } from "zod";

const echo = tool({
  name: "example.echo",
  description: "Echo text through a durable tool boundary.",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ text: z.string().min(1) }),
  summarize(output) {
    return output.text;
  },
  run(ctx) {
    return { text: ctx.input.text };
  },
});

const assistant = agent({
  name: "example.assistant",
  input: z.object({ text: z.string().min(1) }),
  tools: [echo],
  async run(ctx, input) {
    return ctx.tool("echo-input", echo, input);
  },
});

export const app = weave({
  name: "example-app",
  agents: [assistant],
});
```

Every durable operation needs a stable key such as `"echo-input"`. Do not generate durable keys from random values, wall-clock time, or other nondeterministic data.

## Runtime Binding Example

Authoring an app does not start storage, runners, workers, or HTTP services. Bind runtime infrastructure explicitly:

```ts
import { ThreadService, createWeaveRuntime } from "weave/runtime";
import { PostgresThreadEngine, createPool, migrate } from "weave/postgres";
import { app } from "./app.js";

const pool = createPool();
await migrate(pool);

const engine = new PostgresThreadEngine(pool);
const service = new ThreadService(engine);
const runtime = createWeaveRuntime({
  app,
  agentName: "example.assistant",
  engine,
  service,
});

runtime.runnerDaemon.start();
runtime.toolDaemon.start();
```

## Package Boundaries

Weave is split into a **kernel** and a **runtime**. The kernel is the durable thread/record/coordination core: events, the engine contract, projections, leases, the inbox, gates, lineage, the mutating `ThreadService`, and the read-only `ThreadQueryService`. It carries no agent-authoring or replay machinery, so a host can build directly on the log. The runtime is the replay/agent layer on top: `agent`/`tool`/`weave` authoring, the durable `ctx.*` API, runners, daemons, and tool workers.

A `kernel → runtime` import is forbidden and enforced statically by `npm run lint:boundaries` (dependency-cruiser). Only the runtime-facing entry barrels may re-export the runtime.

Local workspace subpaths:

- `weave`: **minimal kernel surface** — durable thread, event, projection, timeline, query-service, and coordination contracts plus shared errors and observability types. It intentionally excludes storage, `ThreadService`, agent authoring, and replay code.
- `weave/core`: **kernel service surface** — everything from `weave` plus `ThreadService` for starting sessions, appending typed events, managing child sessions, resolving gates, and delivering signals.
- `weave/runtime`: **runtime** — authoring primitives (`agent`, `tool`, `weave`, `event`, `capability`, `policy`, `integration`), the durable `ctx.*` context, runners, daemons, tool workers, workspace providers, and `ThreadService`. Re-exports the kernel, so it is a strict superset.
- `weave/postgres`: Postgres engine, pool, migrations, artifact store, `ThreadService`, `ThreadQueryService`, testing helpers, and observability store. Kernel-only, with no runtime dependency.
- `weave/server`: HTTP API server helpers (runtime).
- `weave/testing`: deterministic mock agent and tool worker (runtime).
- `weave/auth`: auth gateway, access rules, JWT helper, and identity adapter contract tests. Kernel-only.
- `weave/opencode`: hardened OpenCode CLI adapter, permission profiles, capability mapping, bounded execution, env sanitization, JSON output validation, and actual Git diff enforcement (runtime).

These boundaries are the intended public shape. The package builds to `dist/` (`npm run build`), `exports` point at the built files, and `files` narrows the publish manifest to `dist`, `README.md`, and `LICENSE`. Remaining npm-publication steps are tracked in `docs/release-readiness.md`.

## Local PoC Commands

Run the low-level end-to-end PoC:

```sh
npm run poc
```

Run the API-driven system PoC:

```sh
npm run system:poc
```

Run the local workflow dashboard:

```sh
npm run dashboard
```

The dashboard is provided by `examples/weave-maintainer`, which dogfoods Weave as a framework instead of living in core. It binds to `0.0.0.0:3010` by default and reads the configured `DATABASE_URL`.

Inspect Weave Maintainer source checkpoints:

```sh
npm run checkpoints:list -- <initiative-thread-id>
npm run checkpoints:show -- <checkpoint-id-or-sha>
npm run checkpoints:diff -- <checkpoint-id-or-sha>
npm run checkpoints:restore -- <checkpoint-id-or-sha> --confirm [--force]
```

## Service Mode

Run the API server:

```sh
npm run server
```

In separate terminals, run the background loops:

```sh
npm run daemon:runner
npm run daemon:tool
```

The API exposes thread creation, event reads, projections, summaries, streams, diagnostics, gate resolution, and signal delivery.

## Examples

- `examples/sre-demo`: deterministic gate-heavy runtime semantics demo. It uses mocked Axiom, Grafana, Sentry, deploy metadata, approval gates, credentials, observability, and remediation flow. Run with `npm run sre:demo`.
- `examples/steel-docs-sync`: deterministic docs audit workflow using run-first authoring, local fixtures, artifact storage, `ctx.tool`, and emitted domain facts. Run with `npm run steel:demo` or `npm run steel:webhook-demo`.
- `examples/simple-assistant`: model-backed assistant that routes a Kimi K2.6 call through OpenCode Zen behind a tool boundary. It requires `OPENCODE_API_KEY`. Run with `npm run assistant:demo -- "your prompt"` or `npm run assistant:server`.
- `examples/prompt-workflow-review`: prompt-driven workflow review example using durable child agents and a conservative repo-read harness. Its deterministic test runs through `npm test`; the OpenCode integration test is optional and environment-dependent.
- `examples/weave-maintainer`: dogfooded maintenance app for dashboard, gates, initiatives, and source checkpoints.

Deterministic examples double as regression assets. The model-backed assistant is optional and demonstrates the tool boundary for external model calls; Weave itself does not require a model provider.

## Destructive Demo Warning

These commands call `migrate(pool, { reset: true })` and reset only the dedicated `weave` schema in the configured database:

- `npm run poc`
- `npm run system:poc`
- `npm run sre:demo`
- `npm run steel:demo`
- `npm run steel:webhook-demo`
- `npm run assistant:demo -- "your prompt"`

Do not run reset-based demos concurrently against the same database. Use a throwaway local database for demos.

## Model-Backed Assistant Setup

Create `examples/simple-assistant/.env` from `examples/simple-assistant/.env.example` or export the variable in your shell:

```sh
OPENCODE_API_KEY=your-api-key npm run assistant:demo -- "Explain what Weave does in one sentence"
```

Run the same assistant as a local API:

```sh
npm run assistant:server
```

The server starts on port `3000` by default. If that port is busy and `PORT` is not set, it tries the next available port and prints the URL. Set `PORT=3100` to choose a specific port.

Call the convenience route:

```sh
curl -X POST http://127.0.0.1:3000/assistant \
  -H 'content-type: application/json' \
  -d '{"prompt":"Write me a poem about steel weaves"}'
```

The server also exposes the raw Weave thread API at `/threads`, `/threads/<threadId>/events`, and `/threads/<threadId>/stream`.

## Implementation Map

Kernel (`src/`, exported from `weave`, `weave/core`, `weave/postgres`, and `weave/auth`):

- `src/events.ts`: closed kernel event union, payload contracts, and the open `domain.event` extension point.
- `src/contracts.ts`: `ThreadEngine` and `ThreadLeaseStore` interfaces, append/read options (including `expectedTailSeq` fencing), and inbox contracts.
- `src/postgres-engine.ts`: Postgres event log, projection, leases, lineage, gates, signals, timers, and inbox persistence.
- `src/thread-service.ts`: session start, typed event append, child sessions, gate resolution, signal delivery, child listing, and child cancellation.
- `src/thread-query-service.ts`: storage-independent thread, event, lineage, inbox, and health read models.
- `src/timeline.ts`, `src/summary.ts`: read-model projection and summary helpers.
- `src/auth-gateway.ts`: HTTP ingress auth gateway composition.

Runtime (`src/runtime/`, exported from `weave/runtime`, `weave/server`, `weave/testing`, `weave/opencode`):

- `src/runtime/agent-contract.ts`: run-first agent authoring contracts and durable context API.
- `src/runtime/tool-contract.ts`: typed tool contracts, output summaries, credentials, capabilities, and gates.
- `src/runtime/app-contract.ts`: `weave` app registry.
- `src/runtime/agent-runner.ts`: replay adapter for `agent.run`, durable effects, gates, checkpoints, timers, signals, and child threads.
- `src/runtime/runner.ts`: one-step thread runner with durable agent failure events.
- `src/runtime/tool-worker.ts`: contract tool worker with credentials, artifacts, progress, retries, policy evidence, and output summaries.
- `src/runtime/daemons.ts`: runner and tool worker daemons backed by explicit inbox claims.
- `src/runtime/api-server.ts`: HTTP API for thread sessions, events, projections, summaries, streams, diagnostics, gates, and signals.
- `src/runtime/policy-contract.ts`: request policy rules and approval policy helpers.
- `src/runtime/workspace-provider.ts`: provider-neutral workspace abstraction and git worktree provider.
- `src/runtime/opencode-adapter.ts`: reusable hardened OpenCode CLI adapter exported through `weave/opencode`.

## Docs

- `docs/what-is-weave.md`: product narrative and vision.
- `docs/declarative-api.md`: current authoring API and replay semantics.
- `docs/architecture.md`: system boundaries and primitives.
- `docs/glossary.md`: core vocabulary.
- `docs/migration/api-refactor.md`: migration guide from planner-first and legacy tool-output patterns.
- `docs/release-readiness.md`: open-source release checklist and known blockers.
- `docs/README.md`: full documentation index, including internal planning docs and north-star material.
