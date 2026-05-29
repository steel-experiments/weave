# ECC Features For Thread

## Purpose

This document looks specifically at ECC features that overlap with Weave goals:

- security and governance
- skills
- instincts and continuous learning
- memory and persistence

It is narrower than `ecc-analysis.md`.

The main question here is not just "what does ECC do?"

The main question is:

```txt
Which ECC feature patterns belong in a thread-adjacent layer,
and which belong in the thread core?
```

This analysis is based on DeepWiki material for `affaan-m/ECC` and cross-checks against the repo docs and code already reviewed locally.

## Short Answer

ECC handles these concerns mostly at the harness and operator layer.

That means:

- it is strong on runtime guardrails, packaging, and operator ergonomics
- it is weaker as a model for durable thread-native state transitions

So the right move is:

- copy its boundary ideas
- avoid copying its source-of-truth model

## 1. Security And Governance

## How ECC works

ECC's security model is centered on preflight controls, hook enforcement, config protection, and operator readiness.

The main mechanisms are:

- hook-based policy checks before tools run
- hook-based governance capture for sensitive operations
- config protection for important settings files
- secrets-handling rules that push credentials into env vars or secret managers
- MCP health checks before MCP-backed actions
- GateGuard-style "fact-forcing" that blocks the first risky action until the agent gathers evidence
- release and publication approval gates tracked through readiness artifacts

In practical terms, ECC treats security as a set of control points around the harness:

- before command execution
- before editing sensitive files
- before using MCP integrations
- before publishing or releasing

Examples from ECC:

- `pre:config-protection` blocks config weakening
- `pre:mcp-health-check` blocks unhealthy MCP calls
- `pre:governance-capture` and `post:governance-capture` emit governance signals
- GateGuard forces the agent to justify edits, writes, and destructive bash actions

## What is good about it

ECC is strong on:

- enforcing least-agency behavior at action boundaries
- separating config safety from normal code changes
- treating secrets and MCPs as first-class risk surfaces
- making risky behavior visible to operators

That is exactly the right instinct for thread systems too.

## Where it differs from Weave

ECC does not model governance as a durable thread-native object.

It mostly uses:

- hook decisions
- emitted governance events
- operator-facing readiness signals
- documented release gates

That is different from the thread direction, where we want:

- `gate.created`
- `gate.resolved`
- replayable gate lifecycle
- durable policy decision records
- capability issuance tied to explicit events

In other words:

```txt
ECC security is boundary enforcement.
Thread security should be boundary enforcement plus durable gate state.
```

## What to adapt

- policy evaluation at every side-effect boundary
- explicit treatment of MCPs, secrets, config edits, and destructive commands as high-risk actions
- health checks before dispatching work to external integrations or workers
- fact-forcing flows that require evidence before action
- operator-ready summaries of pending risky actions

## What not to adapt directly

- hooks as the authoritative security record
- markdown approval artifacts as the only representation of approval state
- governance alerts without first-class durable gate objects

## Thread implication

Weave should turn ECC-style enforcement into event-native state:

- request enters thread
- policy is evaluated
- if more evidence is needed, append a gate event
- if approval is needed, create a first-class gate object
- when resolved, re-enter runnable inbox and continue

## 2. Skills

## How ECC works

ECC skills are packaged knowledge modules.

They are not durable state machines.
They are structured reusable guidance packs that the harness can auto-activate or expose through commands and agents.

The basic shape is:

- one directory per skill under `skills/`
- one `SKILL.md` file as the canonical definition
- optional examples and references
- metadata used for identification and activation

ECC's model distinguishes three things:

- skills: knowledge and workflow guidance
- agents: specialized task executors
- commands: entrypoint UX for users

Skills are intended to be:

- portable across harnesses
- installable selectively
- auto-activated by relevance
- used by agents and commands rather than replacing them

## What is good about it

ECC has a clean distinction between:

- knowledge assets
- execution assets
- UX entrypoints

That is useful for Weave because it reduces a common design failure:

- mixing prompts, state, execution control, and user interface into one abstraction

## Where it differs from Weave

ECC skills are largely static knowledge packs.

Weave is about durable control flow and side-effect mediation.

So ECC skills are not a model for thread execution itself.
They are closer to:

- runtime-side policy packs
- planner guidance
- domain-specific prompt assets
- worker behavior templates

## What to adapt

- a clear distinction between knowledge modules and execution state
- portable skill packaging that can attach to different runtimes
- selective installation and discovery of capability packs
- the separation of commands from the deeper reusable logic they trigger

## What not to adapt directly

- treating static skill bundles as the durable unit of execution
- allowing skill activation to stand in for explicit thread events and state transitions

## Thread implication

For Weave, skills should likely sit above or beside the thread core:

- threads hold durable event history and state
- runtimes may load skills to decide what to do
- skills influence planning and behavior
- the thread remains the system of record

This is already aligned with the project's current positioning as a control plane rather than a monolithic runtime.

## 3. Instincts And Continuous Learning

## How ECC works

ECC's `continuous-learning-v2` system turns repeated observed behavior into "instincts".

The flow is roughly:

1. hooks capture tool observations
2. observations are stored in project-scoped logs
3. a background observer analyzes those logs
4. recurring patterns become instincts
5. high-confidence instincts can be evolved into skills, commands, or agents

Important properties:

- instincts are small and atomic
- instincts carry confidence and evidence
- instincts can be project-scoped or global
- evolution into larger artifacts is a later step

This is a better learning architecture than the older ECC v1 pattern because it separates:

- raw observation
- learned behavioral candidates
- promoted reusable artifacts

## What is good about it

ECC gets two important things right here:

- learning is incremental and evidence-backed
- promotion into durable reusable assets is explicit rather than automatic magic

That maps well to how thread-native learning should work.

## Where it differs from Weave

ECC's instinct system is fundamentally filesystem and observer based.

It is learned memory layered around a harness.
It is not integrated into a thread event stream as first-class replayable control state.

That means:

- it is good for meta-learning
- it is not the right model for primary execution durability

## What to adapt

- distinguish raw observations from promoted lessons
- keep evidence linked to learned behavioral artifacts
- allow project-scoped learning before global promotion
- treat learned patterns as optional reusable overlays, not as implicit mutations of core execution history

## What not to adapt directly

- filesystem logs as the main substrate for long-term control-plane learning
- background learning flows that are disconnected from the authoritative execution history

## Thread implication

Weave should probably model learning as a derived system off thread events.

One clean design would be:

- thread history remains authoritative
- a learning pipeline consumes thread events and worker outcomes
- it emits candidate instincts or playbooks into a separate learning store or thread family
- promotion into reusable skills or policies is explicit

That gives us ECC's good parts without splitting learning away from the main event source.

## 4. Memory And Persistence

## How ECC works

ECC has more than one kind of memory.

It is useful to split it into four layers.

### 1. Working session memory

ECC uses session-start, pre-compact, and session-end hooks to preserve useful local session state.

Examples:

- loading previous context at session start
- saving state before compaction
- writing session summaries at stop or session end

This is basically continuity memory for a harness session.

### 2. Learned memory

This is the instinct system described above.

It captures repeated patterns across sessions and promotes them into reusable behaviors.

### 3. Operator state

ECC also keeps structured local state for sessions, tool activity, installs, governance events, work items, and status views.

This is the part that starts to look like a local control plane.

### 4. ECC 2.0 session persistence

The `ecc2` work adds a more explicit SQLite-backed state store for session lifecycle and operator views.

This is more structured than the older hook-plus-filesystem model, but still centered on operator session management rather than thread-native replay.

## What is good about it

ECC's biggest strength here is that it does not treat all memory as one thing.

It implicitly separates:

- short-term working continuity
- long-term learned patterns
- operational session state
- install and governance state

That separation is exactly what Weave needs too.

## Where it differs from Weave

ECC's persistence is mostly:

- hook-driven
- local-state oriented
- session oriented
- partially snapshot based

Weave wants:

- append-only thread history
- explicit event replay
- durable inbox and gate semantics
- per-thread coordination leases

So ECC's memory model is closer to a runtime shell than to the thread core.

## What to adapt

- explicit separation of memory classes
- session-start context hydration as an adapter concern
- pre-compact persistence hooks for harnesses that have context limits
- local operator state stores and dashboards as projections

## What not to adapt directly

- injected session context as the primary persistence mechanism
- snapshots and summaries as the authoritative execution record

## Thread implication

Weave should likely distinguish at least these memory classes:

- thread working state: rebuilt from thread events
- runtime continuity memory: adapter-managed session context for a specific harness
- learned behavior memory: derived instincts or playbooks promoted from many threads
- operator state: projections for dashboards, queues, and readiness

That would be a cleaner and more explicit version of the separations ECC already hints at.

## Synthesis

## Best ECC ideas for thread-adjacent features

- boundary-centric security checks
- portable knowledge packs separated from execution state
- evidence-backed incremental learning
- explicit distinction between short-term memory, learned memory, and operator state

## Best thread-specific upgrade over ECC

The thread version of these features should be stricter and more durable:

- security becomes replayable policy and gate state
- skills stay external to the source of truth
- instincts are derived from thread history instead of separate ad hoc logs
- memory is divided cleanly between thread state, runtime continuity, learning, and projections

## Concrete Recommendations

## 1. Add a gate model, not just governance events

If we borrow ECC's governance ideas, we should formalize them as thread objects and events.

## 2. Keep skills outside the thread core

Thread state should never be confused with prompt packs, skill packs, or command UX.

## 3. Build learning off the thread event stream

Use thread history as the evidence source for future instinct-like learning.

## 4. Define memory classes explicitly in the docs

The project should document separate layers for:

- thread state
- runtime continuity state
- learned memory
- operator projections

## Bottom Line

ECC already contains several patterns we want, but mostly in harness-native form.

The strongest adaptation path is:

- preserve ECC's boundary and operator ideas
- re-express them with thread-native durability and replay

In short:

```txt
ECC shows how these features feel in a runtime shell.
Weave should make the important ones durable.
```
