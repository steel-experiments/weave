# Architecture

## System View

Weave should act as the durable control layer between agents and the outside world.

```txt
agent runtime(s)
  <-> thread control layer
  <-> tools / workers / humans / integrations
```

The thread is where durable history, routing, policy checks, and resumability come together.

## Main Layers

### 1. Agent Layer

Examples:

- OpenCode
- Codex
- Claude Code
- local custom agents
- cloud sandbox agents
- browser-capable agents

Responsibilities:

- consume allowed tools and declared scoped capabilities
- process thread-visible events
- emit decisions or effect requests back into the thread

The agent runtime should not be the durable source of truth.

### 2. Thread Layer

This is the core of the project.

Responsibilities:

- durable append-only event log
- ordered thread-local event streams
- runnable inbox semantics
- artifact and snapshot references for large external data
- trace and correlation metadata
- wake and resume mechanics
- stream-to-stream routing or linking
- gate and interrupt lifecycle

Core idea:

- full event log for history
- narrower runnable inbox for what should wake the agent

### 3. Tool and Worker Layer

Examples:

- shell or sandbox execution
- browser workers
- LLM invocation workers
- email or messaging workers
- webhook handlers
- timers and schedulers

Responsibilities:

- receive explicit work requests
- emit structured lifecycle events
- support progress and long-running execution
- surface bounded retries, terminal failures, and dead-letter diagnostics
- avoid opaque fire-and-forget behavior

Tool workers should keep large raw payloads out of thread events. Events should contain durable facts, summaries, hashes, and artifact references; artifact storage owns raw bodies.

Tool execution, credential provider calls, agent `run` execution, and policy evaluation are wrapped in a small internal Effect-style adapter so runtime code can handle typed success/failure values while keeping public authoring APIs Promise-first.

### 4. Policy and Credential Layer

Responsibilities:

- determine what an agent is allowed to do
- enforce approval or gate requirements
- mediate credential use and enforce declared capability intent at supported request boundaries
- keep raw secret material out of normal agent execution paths where possible

### 5. Integration Layer

Examples:

- Slack
- Linear
- webhooks
- email
- SMS
- browser/session providers
- other threads or agent systems

Responsibilities:

- translate external signals into thread events
- translate thread events into external actions

### 6. Auth Gateway Layer

The auth gateway sits between HTTP ingress and the thread service. It is a composition of two swappable parts:

- **Identity provider**: authenticates a request and produces a normalized `Principal` and `AuthContext`.
- **Access controller**: authorizes a `WeaveAction` (starting with `thread.start` and `agent.run`) for the authenticated context.

The first protected HTTP path is `POST /threads`. When an `AuthGateway` is configured on the API server, `thread.start` requests are authenticated and authorized before any session is created. Denied requests return 401 or 403 without appending events. Accepted requests record a safe auth summary (`principalId`, `provider`, `source`, and optional groups, roles, scopes, tenant, and organization fields) in `session.started.payload.metadata.auth`. No raw access tokens, raw ID tokens, refresh tokens, provider secrets, aliases, display names, or full provider claims are stored by default.

When no auth gateway is configured, the API server preserves the existing unauthenticated local behavior. Provider-specific SDKs (Better Auth, Clerk, Okta, OpenAuth, etc.) live outside core and adapt to the `IdentityProvider` interface via the `AuthProviderAdapter` contract. See `docs/auth-provider-adapters.md` for the adapter boundary specification.

The `Principal` carries normalized identity fields: `id`, `provider`, `aliases`, `groups`, `roles`, `scopes`, `tenantId`, `organizationId`, and `displayName`. The `AuthContext` includes an optional `AccessContext` that mirrors these for authorization rule matching. Emails and usernames are aliases, not preferred immutable identifiers. Core provides a dependency-light `jwtAuth()` adapter (HS256 via Node `crypto`) and reusable adapter contract tests.

## Core Primitives

### Thread

A durable addressable execution boundary for one agent session, task, or logical worker identity.

### Event

An immutable record of something that happened, was requested, or was decided.

### Inbox

The subset of events that should wake, resume, or notify a consumer.

### Runner

An ephemeral process that acquires a thread, replays state, does bounded work, and emits more events.

### Gate

A thread-native object representing work paused on approval, human input, or another external decision.

### Timer

A thread-native durable sleep point. `ctx.sleep` records `timer.scheduled`, the inbox delays runner visibility until `fireAt`, and the runner records `timer.fired` before replaying past the sleep.

### Signal Wait

A thread-native wait for a named external signal. `ctx.waitForSignal` records `signal.waiting`; integrations or APIs call `ThreadService.deliverSignal(...)` to append `signal.received` and wake the runner.

### Capability

A typed declaration of scoped access intent. Capability contracts can be attached to tools as static metadata or requested from tool input with `.request(params)`.

Capability contracts are not credentials. Credentials resolve secret material; capabilities describe authorized access intent and expected scope shape. Capability requests map to existing credential provider requests when a tool needs secret material.

Runtime request policies can inspect capability declarations and capability requests during `ctx.tool` planning. Tool workers do not re-evaluate policies; they use capability requests only to resolve credential material through the configured provider.

### Workspace

A provider-managed development checkout or sandbox where coding agents can inspect, modify, test, diff, and later promote changes without assuming the current process working directory is the unit of isolation.

The core workspace boundary is provider-neutral. The first provider is `git-worktree`; future providers can use Rift-style CoW workspaces, ZFS/btrfs/APFS snapshots, Firecracker snapshots, Docker volumes, or remote sandboxes behind the same `WorkspaceRef` shape.

Workspace lifecycle operations should happen through normal tools such as `workspace.allocate`, `workspace.state`, `workspace.diff`, and `workspace.remove`, with capabilities and policies controlling allocation, inspection, cleanup, promotion, and branch writes. Filesystem snapshots are an efficiency/isolation mechanism, not a security boundary by themselves.

### Policy

A runtime request rule that can allow, deny, or require approval before a supported durable request is recorded. Current enforcement happens at the `ctx.tool` planning boundary and records `policy.evaluated` audit evidence. When the thread was started with safe auth metadata, tool policy requests include `request.auth` with the durable principal id, provider/source, groups, roles, scopes, tenant, and organization values available from `session.started`.

Policies run in `app.policies` order. `allow` records evidence and continues. `deny` and `approval_required` short-circuit later policies. Once recorded, policy decisions replay from the event log rather than re-running current policy code for the same durable request.

If policy evaluation code throws before producing a decision, no `policy.evaluated` evidence is recorded for that policy. Through `ThreadRunner`, the exception is recorded as the existing durable `agent.failed` behavior.

### Stream Link

A controlled way for one thread stream to feed another thread or supervisor path.

## Architectural Constraints

### Durable source of truth

The thread event history is authoritative.

### Ephemeral compute

Runners may stop at any time and later resume.

### Structured side effects

Tool and integration activity should happen through explicit requested and completed events.

### Per-thread coordination

Prefer one active runner lease per thread to keep ordering and state reconstruction simple.

### Trace continuity

Every important event should be correlated back to the initiating session, prompt, or parent workflow.

## Expected Evolution

The initial architecture should be simple and narrow.

Over time it can grow to support:

- child threads and subagents with richer orchestration
- filtered stream routing
- richer policy engines
- pluggable storage backends
- more sophisticated integration adapters

But the core should remain small:

- thread
- event
- inbox
- runner
- worker
- gate
- capability
