# Weave

This repository is building Weave: Steel's open, durable, event-driven control layer for agents.

The product name is Weave. It may be spoken as Steel Weave in Steel contexts, but use Weave in repository docs and code.

The core idea is simple:

- agent runtimes are ephemeral
- the thread is the source of truth
- every meaningful action should cross a durable event boundary

## Current Status

This repo is no longer only planning docs.

It contains:

- the core design documents in `docs/`
- a Postgres-backed PoC
- a deterministic mock agent and mock tool worker
- daemonized runner and tool-worker loops with explicit inbox claims
- a mocked SRE north-star demo
- per-slice planning docs for docs sync and future verticals
- typed authoring primitives like `defineTool`, `defineAgent`, and `defineWeaveApp`

The docs are still the working source of truth for direction and scope.

## Current North Star

Weave's north star is to be a clean, durable, runtime-agnostic control plane (kernel) that other systems build on. It is being prepared as an open-source product.

Blade is the primary consumer that proves Weave under real organizational workflows, but Blade is a separate product: it lives in the Blade app (`apps/blade` in the Steel monorepo), and its product overview, domain model, and slices live there, not in this repository. The Steel docs sync app is a second, focused Weave app and recurring audit workflow.

Use this split when making decisions:

- Weave owns threads, events, inboxes, runners, workers, typed tools, credentials, gates, artifacts, and resumability.
- Blade owns product workflows, specialist roles, prompts, integration UX, runtime choices, and Steel-specific operating taste — in its own app, on top of Weave.
- Docs sync owns docs/API drift audits, source collection, findings, CI outcomes, and optional GitHub publishing.

## Who Is Who

- *you*: the agent working directly on this repository
- *we*/*us*: the humans building Weave
- *users*: developers and operators who will use Weave or build on top of it
- *agents*: the external runtimes that Weave coordinates; these are not the same as *you*

## What We Are Building

Weave is meant to be:

- a durable event boundary for agent sessions
- a control layer between runtimes and side effects
- a structured tool mediation layer
- a policy and approval boundary
- a trace surface for decisions, tool calls, and outcomes
- a neutral substrate that multiple runtimes can adapt to

Weave is not primarily:

- a single agent runtime
- a foundation model product
- a giant workflow DSL
- a UI-heavy orchestration platform
- a reason to hard-wire the system to one cloud or one agent host

## Core Invariants

When making changes, protect these invariants first:

- the thread event history is authoritative
- runners may stop and resume at any time
- tools should be mediated by explicit events, not hidden side effects
- human approval and interruption are first-class paths, not exceptions
- one thread should strongly prefer one active runner lease at a time
- replay from durable state should be sufficient for correctness
- credentials should be scoped to workers and capabilities, not handed to the agent runtime by default
- observability is a parallel signal plane, not a replacement for thread events

## Project Biases

Default to these choices unless there is a concrete reason not to:

- keep the primitive small and legible
- prefer obvious control boundaries over clever abstractions
- wrap existing runtimes before rewriting them
- force side effects through thread-backed tools
- model long-running work with lifecycle events like `requested`, `started`, `progress`, `completed`, and `failed`
- use deterministic mocks to prove semantics before introducing real integrations
- keep engine boundaries explicit so Postgres is not the permanent assumption

## Slice Methodology

Plan meaningful feature work as vertical slices.

A slice is one independently reviewable markdown document that tracks:

- the user-visible outcome
- non-goals
- architecture impact
- tool, event, artifact, credential, and gate changes
- implementation steps
- acceptance criteria
- test plan
- progress
- completion notes

Use `docs/slices/template.md` for new slices.

Current slice areas:

- `docs/docs-sync/slices/`: Steel docs sync app slices
- Blade product slices live in the Blade app (`apps/blade/docs/slices/`), not in this repository
- future verticals should follow the same pattern

A slice is not complete when code merges. It is complete only when:

- the behavior exists in code
- meaningful tests pass
- the slice doc records actual behavior and test evidence
- the owning vertical doc is updated
- changed Weave primitives are reflected in core architecture docs
- new terms are reflected in `docs/glossary.md`, or the Blade app's domain model for Blade-specific terms
- follow-up work is captured as new slices or explicit open questions

Test plans must prove the real module or vertical works. Mock external networks, model providers, GitHub, Slack, Sentry, Axiom, and sandbox providers at their boundaries, but do not mock the planner, service, engine, projection, worker, or tool module that the slice exists to build.

## Current Implementation Landmarks

Read these files before making significant architectural changes:

- `docs/overview.md`: thesis, principles, and north-star framing
- `docs/docs-operating-model.md`: slice methodology, completion rules, and testing expectations
- `docs/glossary.md`: canonical terminology
- `docs/architecture.md`: system boundaries and primitives
- `docs/interface.md`: engine and thread interfaces
- Blade product docs (overview, domain model, slices) live in the Blade app (`apps/blade/docs/`), not in this repository
- `docs/poc-scope.md`: fixed PoC decisions and non-goals
- `docs/declarative-api.md`: current authoring API and why `defineThread` does not exist yet
- `docs/research/README.md`: grouped comparison and research index
- `README.md`: local setup, commands, and current implementation summary

Code landmarks. The tree is split into a kernel (`src/`, the durable thread/record/coordination core) and a runtime (`src/runtime/`, the replay/agent layer). A `kernel → runtime` import is forbidden and enforced by `npm run lint:boundaries`.

Kernel (`src/`):

- `src/events.ts`: closed kernel event union and payload contracts, plus the open `domain.event` extension point
- `src/contracts.ts`: `ThreadEngine`/`ThreadLeaseStore` interfaces and append/read options (`expectedTailSeq` fencing)
- `src/postgres-engine.ts`: durable event log, projections, inbox, leases, and gates
- `src/thread-service.ts`: session, gate, and read operations
- `src/observability.ts`, `src/postgres-observability.ts`, `src/otlp-observability.ts`: observability sinks

Runtime (`src/runtime/`):

- `src/runtime/runner.ts`: bounded thread step execution
- `src/runtime/daemons.ts`: inbox-claim-driven background processing
- `src/runtime/tool-contract.ts`: `defineTool` and tool lifecycle contract
- `src/runtime/agent-contract.ts`: `defineAgent`
- `src/runtime/app-contract.ts`: `defineWeaveApp`
- `src/runtime/credentials.ts`: scoped credential resolution model
- `src/runtime/api-server.ts`: minimal HTTP surface for the PoC and demo flows

## How To Make Good Changes Here

If you are adding or changing behavior, use this decision order:

1. Preserve thread semantics.
2. Check whether the work belongs to an existing slice or needs a new slice doc.
3. Keep the event model clearer, not broader.
4. Prefer a small explicit seam over a generic framework.
5. Keep hidden runtime state out of correctness-critical paths.
6. Update docs when the change affects terminology, invariants, intended scope, or architecture.

Good changes usually look like this:

- a slice doc updated with actual progress and test evidence
- a new event type with a clear durable fact
- a narrower runner or worker responsibility
- a typed tool contract instead of ad hoc execution
- a capability or gate added at the thread boundary
- a demo improvement that proves the primitive more clearly

Risky changes usually look like this:

- implementing broad feature work without a slice doc
- marking a slice done without tests or architecture updates
- tests that only validate mocks and never exercise the module being built
- bypassing the event log because it feels faster
- storing correctness-critical state only in memory
- letting tools perform opaque work without lifecycle events
- adding generalized orchestration before the PoC claim is proven
- coupling the core model too tightly to one runtime, provider, or integration

## PoC Guardrails

For the first implementation, keep the scope disciplined:

- one thread equals one agent session
- Postgres is the current engine, but not the final architectural truth
- one runner lease per thread is the default coordination model
- the first demos should stay deterministic where possible
- gates, credentials, and tool progress matter more than flashy UI

If you are unsure whether something belongs in core, ask:

- does this strengthen the thread primitive?
- is this runtime-agnostic?
- does this make replay and resumption more trustworthy?
- are we proving the control layer, or drifting into workflow sprawl?

## Adapter Strategy

The recommended integration path for outside agents is:

- adapter layer
- thread-backed tools
- bounded turns
- replay and reinvocation

Do not start by deeply rewriting external runtimes.

The biggest integration risk is usually not model quality. It is hidden state and hidden side effects.

## Authoring Model

The current authoring surface is TypeScript composition, not config discovery.

- `defineTool`: declare typed side-effect contracts, progress, credentials, and optional gate metadata
- `defineAgent`: compose a planner with the tools it may request
- `defineWeaveApp`: compose one or more named agents plus credential and observability providers

There is intentionally no `defineThread()` yet. A thread is runtime session state until a real authoring need proves otherwise.

## Commands

Local Postgres defaults to:

```txt
postgres://dev:password@localhost:5432/dev
```

Useful commands:

```sh
npm run typecheck
npm run poc
npm run system:poc
npm run sre:demo
npm run server
npm run daemon:runner
npm run daemon:tool
```

Do not run `npm run poc` and `npm run system:poc` at the same time because both reset the dedicated `weave` schema.

## Reading Order

If you are new to the repo, start here:

1. `docs/README.md`
2. `docs/overview.md`
3. `docs/docs-operating-model.md`
4. `docs/glossary.md`
5. `docs/architecture.md`
6. `docs/interface.md`
7. `docs/poc-scope.md`
8. `docs/declarative-api.md`
9. `README.md`

## Bottom Line

The project is trying to prove one claim:

> a thread can durably coordinate agent reasoning, async tool work, human approval, credentials, and resumable execution through a single event boundary

Bias your work toward making that claim more obvious, more durable, and easier for other runtimes to adopt.
