# Weave PoC

This repository contains the planning docs and a first Postgres-backed proof of concept for Weave, Steel's durable control plane for agent execution.

## Local Database

The PoC expects Postgres at:

```txt
postgres://dev:password@localhost:5432/dev
```

Override with `DATABASE_URL` if needed.

## Commands

Install dependencies:

```sh
npm install
```

Run typecheck:

```sh
npm run typecheck
```

Run the end-to-end PoC:

```sh
npm run poc
```

Run the API-driven system PoC:

```sh
npm run system:poc
```

Run the mock SRE north-star demo:

```sh
npm run sre:demo
```

Run the simple model-backed assistant demo with Kimi K2.6 through OpenCode Zen:

```sh
npm run assistant:demo -- "Explain what Weave does in one sentence"
```

Set `OPENCODE_API_KEY` in your shell or in `examples/simple-assistant/.env` first.

Run the same assistant as a local API:

```sh
npm run assistant:server
```

The server starts on port `3000` by default. If that port is busy and `PORT` is not set, it tries the next available port and prints the URL. Set `PORT=3100` to choose a specific port.

Then call the convenience route:

```sh
curl -X POST http://127.0.0.1:3000/assistant \
  -H 'content-type: application/json' \
  -d '{"prompt":"Write me a poem about steel weaves"}'
```

The server also exposes the raw Weave thread API at `/threads`, `/threads/<threadId>/events`, and `/threads/<threadId>/stream`.

The PoC script resets only the dedicated `weave` schema, then verifies:

- thread creation
- prompt ingestion
- runner lease and deterministic mock agent step
- async mock tool progress and completion
- manual approval gate creation and resolution
- runner resume after gate resolution
- final agent response

Do not run `npm run poc` and `npm run system:poc` at the same time because both reset the dedicated PoC schema.

## Current Implementation

- `src/events.ts`: Zod event schemas and typed event union
- `src/agent-contract.ts`: run-first agent authoring contracts and durable context API
- `src/agent-runner.ts`: replay adapter for `agent.run`, durable effects, gates, checkpoints, and child threads
- `src/postgres-engine.ts`: Postgres event log, projection, lease, lineage, gate, and inbox persistence
- `src/thread-service.ts`: session start, child session, gate resolution, child listing, and child cancellation service
- `src/runner.ts`: one-step thread runner with durable agent failure events
- `src/tool-worker.ts`: contract tool worker with credentials, artifacts, progress, retries, and output summaries
- `src/daemons.ts`: runner and tool worker daemons backed by explicit inbox claims
- `src/api-server.ts`: HTTP API for thread sessions, events, projections, summaries, streams, diagnostics, and gates
- `examples/sre-demo`: deterministic SRE demo using gates and domain-shaped outputs
- `examples/steel-docs-sync`: docs-sync demo using run-first authoring patterns
- `examples/simple-assistant`: model-backed assistant demo using tool-routed model calls

The service milestone uses an explicit `weave.thread_inbox` table. Event appends route wake events into per-consumer inbox rows, and daemons claim those rows before processing work.

The SRE demo is fully mocked and deterministic. It exercises Axiom, Grafana, Sentry, deploy metadata, and gated infrastructure remediation without requiring real external credentials.

## Local Service Mode

Run the API:

```sh
npm run server
```

In separate terminals, run the background loops:

```sh
npm run daemon:runner
npm run daemon:tool
```

## Docs

Start with `docs/README.md` for project direction and planning docs.
