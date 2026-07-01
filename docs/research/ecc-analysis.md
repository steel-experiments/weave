# ECC Analysis

## Purpose

This document analyzes the ECC project in the context of Weave.

ECC is not a thread engine or durable agent control plane in the same sense as this project.
It is still highly relevant because it solves several adjacent problems well:

- cross-harness packaging
- runtime-side adapters
- hook-driven observability and guardrails
- operator-facing session and status surfaces
- install lifecycle management

The right framing is:

```txt
ECC is a runtime and operator system.
Weave is a durable control plane.
```

That makes ECC more useful as a source of integration and product-surface ideas than as a direct architectural template for the thread core.

## What ECC Provides

## 1. Cross-harness distribution

ECC is designed to ship one large reusable layer across many agent harnesses, including Claude Code, Codex, OpenCode, Cursor, Gemini, Zed, and others.

It provides:

- harness-specific config surfaces such as `.claude-plugin/`, `.codex/`, `.cursor/`, and `.opencode/`
- shared content catalogs for agents, skills, commands, hooks, and rules
- one packaging and install story that can target different harness roots

This is one of the strongest parts of the repo because it treats harnesses as adapter targets rather than completely separate products.

Relevant ECC files:

- `README.md`
- `package.json`
- `manifests/install-modules.json`
- `docs/SELECTIVE-INSTALL-ARCHITECTURE.md`

## 2. Manifest-driven install planning

ECC has moved beyond a simple copy script toward a more explicit install model.

It already has:

- install modules with target compatibility and dependency metadata
- install profiles like `core`, `developer`, `security`, and `research`
- request normalization for legacy and manifest-driven install modes
- install-state recording for later `doctor`, `repair`, and `uninstall` flows

This is important because it gives ECC a durable contract for what was requested, resolved, and installed.

That same idea maps well to Weave, not for user-facing skills, but for:

- runtime adapters
- integration adapters
- worker packs
- policy plugins
- thread-side optional capabilities

Relevant ECC files:

- `manifests/install-modules.json`
- `scripts/lib/install/request.js`
- `scripts/lib/install/apply.js`
- `docs/SELECTIVE-INSTALL-ARCHITECTURE.md`

## 3. Hook-driven runtime guardrails and telemetry

ECC uses hooks as a major runtime boundary.

Those hooks do several jobs:

- block or warn on risky commands
- enforce quality checks around edits and commits
- track session activity
- capture governance-style events
- track cost and context usage
- persist session summaries and learning signals

This is not the same thing as thread-native event sourcing, but it is a strong example of how to instrument existing harnesses without rewriting them.

For Weave, this matters because the first path to adoption may be:

- existing harness keeps running as-is
- hooks or wrappers emit structured thread ingress events
- thread becomes the durable control boundary around the harness

Relevant ECC files:

- `hooks/hooks.json`
- `hooks/README.md`
- `scripts/hooks/*`

## 4. Session adapter normalization

ECC has a useful concept that is very close to what this project needs on the runtime side: a canonical session adapter contract.

Its session adapter work defines:

- a canonical session snapshot schema
- adapter IDs per harness or runtime style
- normalization of different session sources into one shape
- a registry that resolves the correct adapter for a target

This is a strong pattern because it separates:

- harness-specific session details
- operator-facing session views

from the core app logic that consumes them.

That is directly relevant to Weave adapter design.

Relevant ECC files:

- `docs/SESSION-ADAPTER-CONTRACT.md`
- `docs/ECC-2.0-SESSION-ADAPTER-DISCOVERY.md`

## 5. Local state store and operator status surface

ECC has both a JavaScript and Rust-side state-store story.

It keeps structured local records for things like:

- sessions
- tool activity
- skill runs
- install state
- governance events
- work items

It also exposes operator-oriented status views that summarize current health and attention areas.

This is not an append-only thread log, but it is a good example of practical derived projections and operator dashboards built on top of structured state.

Relevant ECC files:

- `scripts/lib/state-store/schema.js`
- `scripts/status.js`
- `ecc2/src/session/store.rs`

## 6. Security and governance posture

ECC takes security seriously at the harness layer.

It includes:

- explicit secrets-handling guidance
- MCP configuration filtering
- install-time and runtime safety checks
- AgentShield as a separate security scanner
- governance capture and approval-like operator signals

This reinforces an important lesson for Weave:

- security should be enforced at boundaries where tools, configs, secrets, and external integrations are touched

That aligns with the thread thesis around effect mediation and capability-scoped access.

Relevant ECC files:

- `SECURITY.md`
- `scripts/lib/install/apply.js`
- `scripts/hooks/*`

## 7. ECC 2.0 operator shell direction

The `ecc2/` work shows ECC moving toward a local control-plane shape with:

- a Rust daemon
- a SQLite-backed state store
- multi-session lifecycle tracking
- dashboards and status commands
- worktree-aware session scaffolding

This is the part of ECC that comes closest to Weave territory.

But it is still primarily an operator shell for managing agent sessions, not a thread-native event model with explicit requested/completed effect semantics, gates, leases, and replayable per-thread history.

Relevant ECC files:

- `ecc2/README.md`
- `ecc2/src/session/store.rs`

## Where ECC Fits Relative To Weave

Using this repo's vocabulary from `../positioning.md`, `../architecture.md`, and `../engines-and-integrations.md`:

- ECC is mostly an execution-side and integration-side system
- Weave is the durable boundary above those systems

More specifically:

- ECC overlaps with execution engines and integration adapters
- ECC partially overlaps with operator-facing control surfaces
- ECC does not replace the thread event log, runnable inbox, gate model, or capability model proposed here

So the clean mental model is:

```txt
ECC-like systems can sit in front of, beside, or behind Weave.
They should not define the thread core itself.
```

## What We Could Adapt

## 1. A canonical adapter contract for runtimes and session sources

This is the clearest direct reuse candidate.

Weave already needs runtime adapters for systems like OpenCode, Codex, Claude Code, and browser-capable runners.

ECC's adapter work suggests we should define a contract with two separate concerns:

- runtime snapshot contract
- runtime event ingestion contract

For Weave, this should become thread-specific rather than session-dashboard-specific.

Suggested adaptation:

- `RuntimeAdapter` exposes thread-relevant state such as active session IDs, harness metadata, current turn status, and accessible tool surface
- `IngressAdapter` translates harness events into thread events like `prompt.received`, `tool.requested`, `tool.completed`, `gate.created`, and `agent.reply.produced`
- adapters remain harness-specific, but the thread sees one stable event envelope

This would fit naturally with `agent-adapters.md` and `engine-contracts.md`.

## 2. Install-state and lifecycle management for thread adapters

ECC's install-state work is useful beyond configuration packs.

Weave will likely need a way to install and manage:

- runtime adapters
- worker adapters
- ingress channel adapters
- policy providers
- local operator tooling

We should adapt ECC's ideas of:

- normalized install requests
- target adapters
- recorded install state
- lifecycle commands like inspect, repair, and uninstall

This matters if Weave becomes a real control-plane product rather than just a library.

## 3. Read-only operator projections and health views

ECC's status surfaces are good examples of how to make structured state operationally useful.

Weave should adapt the projection idea, but built from thread events instead of ad hoc session records.

Useful projections would include:

- thread readiness
- pending gates
- active leases
- effect backlog by worker type
- last policy decision
- recent failures by thread or correlation ID

This aligns with the existing docs on derived indexes and runnable inboxes.

## 4. Harness-side hook and wrapper instrumentation

ECC shows that hooks are a practical way to instrument existing agent harnesses.

For Weave, we should adapt this as a migration path, not as the core architecture.

Examples:

- a Claude or OpenCode hook emits thread ingress events on prompt receipt, tool lifecycle changes, and session stop
- an edit or bash wrapper captures file or command metadata as trace events
- a harness plugin converts approval-required situations into thread `gate.created` events

This is especially useful before a runtime has a first-class thread SDK.

## 5. Schema discipline around adapter payloads and state

ECC is disciplined about explicit schemas and canonical shapes for state.

We should adapt that habit for:

- adapter payloads
- policy decision records
- gate resolution payloads
- worker completion payloads
- projections used by operator UIs

This complements the Zod-style event taxonomy already proposed in `event-taxonomy.md`.

## 6. Multi-session operator UX ideas

ECC 2.0 is useful product inspiration for how operators may want to interact with many active agent sessions.

For Weave, that could become:

- a thread dashboard
- attention queues for blocked or failed threads
- grouped views by user request, customer case, or incident
- a session board for child threads and subagents

The important distinction is that our UI should be projection-driven from thread history, not the source of truth itself.

## 7. Security boundary treatment for configs and secrets

ECC's safety checks reinforce that real systems need guardrails at install time and runtime.

We should adapt that principle for:

- secret redaction before event append
- capability references instead of raw credentials in agent-visible payloads
- install-time validation for adapters and integrations
- health checks for external workers or MCP-style integrations before work dispatch

This maps directly to `weave-primitive-research.md` and its capability-based secret model.

## What We Should Not Adapt Directly

## 1. Hook-heavy implicit behavior as the thread core

ECC uses many hooks because it operates inside existing harnesses.

That is reasonable for a harness system, but it is not a good source-of-truth model.

Weave should keep hooks and wrappers as adapter techniques only.
The durable truth should remain the thread event log.

## 2. SQLite-first control plane as the primary distributed design

ECC 2.0 uses SQLite for local state.

That is a fine operator-shell choice, but it does not change the conclusion in `weave-primitive-research.md`:

- Postgres should still be the default first production engine for thread durability, leases, and transactional append behavior

SQLite can still be useful for:

- local developer mode
- embedded single-node deployments
- desktop operator tooling

but not as the main distributed thread architecture target.

## 3. Content-pack sprawl as part of the thread primitive

ECC intentionally ships a very broad surface of skills, agents, commands, and rules.

Weave should avoid inheriting that shape into the core product.

The thread primitive should stay narrow:

- thread
- event log
- runnable inbox
- runner lease
- gates
- capabilities
- workers
- adapters

Large domain packs should stay outside the core.

## 4. Session snapshots as a replacement for event history

ECC's canonical snapshots are useful, but they are not durable replay history.

Weave should use snapshots only as derived views or rebuild shortcuts.
The append-only thread event stream must remain authoritative.

## 5. Governance capture without a first-class gate model

ECC has governance-style captures and operator readiness signals.

For Weave, we should be stricter and use first-class gate objects and replayable gate lifecycle events instead of loose alerts or notes.

## Concrete Adaptation Plan

## Phase 1: Adapter contracts

Add a thread-oriented adapter design doc that borrows ECC's normalization discipline.

Define:

- `RuntimeAdapter`
- `IngressAdapter`
- canonical harness metadata
- minimal thread ingress event mapping rules

This should extend `agent-adapters.md`.

## Phase 2: Harness instrumentation path

Design one thin integration path for existing harnesses.

Examples:

- OpenCode plugin emits thread events
- Claude-style hook runner emits thread ingress events
- worker wrappers emit requested/completed events for long-running tools

This gives a practical adoption route before a full thread-native runtime exists.

## Phase 3: Projection and operator surfaces

Use ECC's status ideas as inspiration for thread dashboards backed by projections:

- pending gates
- active runners
- blocked threads
- recent effect failures
- policy denials

This should build on `runnable-inbox.md`, not bypass it.

## Phase 4: Installation and lifecycle model

If Weave grows into a product with adapters and workers, adopt ECC-style install-state concepts for:

- adapter installation
- connector setup
- repair and drift detection
- safe uninstall of managed outputs

## Bottom Line

ECC is valuable, but mostly for the layers around the thread.

The most reusable ideas are:

- harness adapter normalization
- install-state and lifecycle management
- hook and wrapper instrumentation for existing runtimes
- operator-facing status and session surfaces
- schema discipline for state and projections

The parts we should avoid copying into the core are:

- hook-heavy implicit control flow
- snapshot-oriented thinking as a substitute for durable event history
- SQLite-first assumptions for distributed durability
- broad config-pack sprawl inside the primitive

So the strongest synthesis is:

```txt
Use ECC ideas to make Weave adoptable.
Do not use ECC as the source model for thread durability.
```

That keeps the project aligned with its current thesis:

- the thread is the durable source of truth
- runtimes and harnesses are replaceable adapters
- operator surfaces are projections over thread history
- policy, approvals, and capabilities remain explicit first-class thread concerns
