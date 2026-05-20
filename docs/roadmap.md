# Roadmap

## Purpose

This roadmap breaks the project into research, planning, and development phases so the work can stay focused while the long-term ambition remains large.

## Phase 0: Foundation

Goal:

Establish shared language, scope, and the core product thesis.

Outputs:

- overview document
- glossary
- architecture outline
- MVP definition
- non-goals and decision boundaries

Exit criteria:

- the team can describe the primitive consistently
- future sessions can build from the same vocabulary

## Phase 1: Primitive Research

Goal:

Pressure test the mailbox idea against adjacent systems and decide what belongs in core.

Research topics:

- event sourcing and replay
- runner lease model
- inbox versus full log semantics
- policy and capability boundaries
- subagent and stream-link semantics
- storage tradeoffs

Outputs:

- architecture decisions
- event model draft
- initial storage assumptions

Exit criteria:

- the core primitive is clear enough to implement narrowly

## Phase 2: Planning the First Build

Goal:

Turn the primitive into a concrete first implementation plan.

Planning topics:

- mailbox schema or storage model
- runner lifecycle
- event taxonomy
- tool contract
- interrupt and gate lifecycle
- first demo flow

Outputs:

- technical implementation plan
- initial API or interface sketches
- demo plan

Exit criteria:

- a small implementation can begin without unresolved conceptual drift

## Phase 3: Mailbox Core MVP

Goal:

Build the smallest useful durable mailbox.

Capabilities:

- mailbox creation
- ordered event append
- replay and inspection
- inbox visibility
- trace metadata
- runner lease model

Exit criteria:

- one mailbox can be created, appended to, replayed, and resumed

## Phase 4: Structured Tool Execution

Goal:

Replace primitive fire-and-poll tool behavior with a richer tool lifecycle.

Capabilities:

- tool definitions
- structured invocation
- progress events
- completion and failure semantics
- async result reporting

Exit criteria:

- at least one tool can run through a full event lifecycle visibly

## Phase 5: Interrupts, Gates, and Supervision

Goal:

Make pausing, escalation, and supervision first-class.

Capabilities:

- gate creation and resolution
- supervisor subscription to mailbox events
- notifications or escalation path
- runner resumption after external input

Exit criteria:

- the system can pause and later continue cleanly using mailbox state alone

## Phase 6: Runtime Adapters

Goal:

Prove runtime portability.

Targets:

- one local or headful runtime
- one hosted or sandbox runtime
- one coding-agent oriented runtime

Exit criteria:

- multiple runtimes can use the same mailbox model without redefining core concepts

## Phase 7: Integrations and Ecosystem

Goal:

Make the project useful to others beyond the first demo.

Targets:

- Slack integration
- webhook adapter
- one project-management integration such as Linear
- stream-to-stream or parent-child agent coordination path

Exit criteria:

- external systems can both trigger and react to mailbox events

## Phase 8: Hardening and Scale

Goal:

Improve deployment, durability, cost, and contributor readiness.

Topics:

- snapshots or compaction strategy
- operational metrics and tracing
- multi-backend strategy
- serverless or low-cost deployment paths
- contributor docs and examples

Exit criteria:

- the project has a credible path to broader adoption

## Ongoing Strategy

At every phase, ask:

- does this belong in the core primitive?
- is this runtime-specific or general?
- are we making the event model clearer or muddier?
- are we proving the control layer, or accidentally building a giant workflow platform too early?
