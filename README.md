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
- `src/postgres-engine.ts`: Postgres event log, projection, lease, and gate persistence
- `src/thread-service.ts`: session start and gate resolution service
- `src/mock-agent.ts`: deterministic mock agent adapter
- `src/mock-tool-worker.ts`: async mock tool worker with progress events
- `src/runner.ts`: one-step thread runner
- `src/daemons.ts`: runner and tool worker daemons backed by explicit inbox claims
- `src/scripts/poc.ts`: end-to-end verification script
- `src/api-server.ts`: minimal HTTP API for thread sessions, events, projections, and gate resolution
- `src/scripts/system-poc.ts`: API-driven verification with background daemons
- `src/sre-agent.ts`: deterministic SRE investigation agent for the north-star demo
- `src/sre-tool-worker.ts`: mock SRE observability and remediation tools
- `src/scripts/sre-demo.ts`: API-driven SRE demo using the thread service and daemons

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
