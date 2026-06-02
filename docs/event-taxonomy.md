# Event Taxonomy

## Purpose

This document defines the first typed event taxonomy for the PoC.

The PoC only needs a small event set, but the naming and payload structure should be strong enough to carry forward.

## Naming Rules

- use clear dotted names
- keep event names intention-revealing
- use `requested`, `started`, `progress`, `completed`, and `failed` for lifecycle stages
- use one event per durable fact

## Event Envelope

Every event uses a shared envelope plus a typed payload.

```ts
import { z } from "zod"

const Actor = z.object({
  type: z.enum(["user", "agent", "worker", "human", "system"]),
  id: z.string().min(1),
})

const EventEnvelopeBase = z.object({
  eventId: z.string().uuid(),
  threadId: z.string().min(1),
  seq: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime(),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).optional(),
  scopeKey: z.string().min(1).optional(),
  stepKey: z.string().min(1).optional(),
  actor: Actor,
})
```

`scopeKey` and `stepKey` identify durable effects for replay. For `ctx.tool`, the default scope is `agent:<agentName>` and the agent author supplies the stable step key.

## Event Set

The PoC uses this event set.

- `session.started`
- `prompt.received`
- `agent.step.started`
- `agent.step.completed`
- `agent.failed`
- `tool.requested`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `gate.created`
- `gate.resolved`
- `child_thread.spawned`
- `child_thread.completed`
- `child_thread.failed`
- `runner.resumed`
- `agent.response.produced`

## Typed Payload Schemas

### Session started

```ts
const SessionStartedPayload = z.object({
  source: z.enum(["api", "test", "system"]),
})
```

### Prompt received

```ts
const PromptReceivedPayload = z.object({
  prompt: z.string().min(1),
})
```

### Agent step started

```ts
const AgentStepStartedPayload = z.object({
  stepId: z.string().uuid(),
  reason: z.enum(["prompt", "tool-completed", "gate-resolved", "manual-resume"]),
})
```

### Agent step completed

```ts
const AgentStepCompletedPayload = z.object({
  stepId: z.string().uuid(),
  outcome: z.enum(["requested-tool", "created-gate", "produced-response", "no-op"]),
})
```

### Tool requested

```ts
const ToolRequestedPayload = z.object({
  toolCallId: z.string().uuid(),
  toolName: z.string().min(1),
  args: z.unknown(),
  scopeKey: z.string().min(1).optional(),
  stepKey: z.string().min(1).optional(),
})
```

### Agent failed

```ts
const AgentFailedPayload = z.object({
  errorCode: z.string().min(1),
  message: z.string().min(1),
})
```

### Tool started

```ts
const ToolStartedPayload = z.object({
  toolCallId: z.string().uuid(),
  toolName: z.literal("mock.async-progress"),
})
```

### Tool progress

```ts
const ToolProgressPayload = z.object({
  toolCallId: z.string().uuid(),
  percent: z.number().int().min(0).max(100),
  message: z.string().min(1),
})
```

### Tool completed

```ts
const ToolCompletedPayload = z.object({
  toolCallId: z.string().uuid(),
  output: z.unknown(),
  summary: z.string().min(1).optional(),
})
```

`output` is the canonical raw tool result used for replay. `summary` is optional display metadata. Legacy `ToolCompletionOutput` envelopes may still carry `requiresManualApproval`, but that is compatibility-only and not the future approval model.

### Tool failed

```ts
const ToolFailedPayload = z.object({
  toolCallId: z.string().uuid(),
  errorCode: z.string().min(1),
  message: z.string().min(1),
})
```

### Gate created

```ts
const GateCreatedPayload = z.object({
  gateId: z.string().uuid(),
  gateType: z.literal("manual-approval"),
  reason: z.literal("tool-result-requires-approval"),
  relatedToolCallId: z.string().uuid(),
})
```

### Gate resolved

```ts
const GateResolvedPayload = z.object({
  gateId: z.string().uuid(),
  resolution: z.enum(["approved", "denied"]),
  comment: z.string().optional(),
})
```

### Child thread spawned

```ts
const ChildThreadSpawnedPayload = z.object({
  childThreadId: z.string().min(1),
  childAgentName: z.string().min(1),
  scopeKey: z.string().min(1),
  stepKey: z.string().min(1),
  mode: z.enum(["attached", "detached"]),
  inputHash: z.string().min(1).optional(),
  inputSummary: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
```

### Child thread completed

```ts
const ChildThreadCompletedPayload = z.object({
  childThreadId: z.string().min(1),
  childAgentName: z.string().min(1).optional(),
  outputSummary: z.string().min(1).optional(),
})
```

### Child thread failed

```ts
const ChildThreadFailedPayload = z.object({
  childThreadId: z.string().min(1),
  childAgentName: z.string().min(1).optional(),
  errorCode: z.string().min(1),
  message: z.string().min(1),
})
```

### Runner resumed

```ts
const RunnerResumedPayload = z.object({
  reason: z.enum(["new-prompt", "tool-completed", "gate-resolved", "child-spawned", "manual-retry"]),
})
```

### Agent response produced

```ts
const AgentResponseProducedPayload = z.object({
  message: z.string().min(1),
})
```

## Discriminated Union

```ts
const SessionStartedEvent = EventEnvelopeBase.extend({
  type: z.literal("session.started"),
  payload: SessionStartedPayload,
})

const PromptReceivedEvent = EventEnvelopeBase.extend({
  type: z.literal("prompt.received"),
  payload: PromptReceivedPayload,
})

const AgentStepStartedEvent = EventEnvelopeBase.extend({
  type: z.literal("agent.step.started"),
  payload: AgentStepStartedPayload,
})

const AgentStepCompletedEvent = EventEnvelopeBase.extend({
  type: z.literal("agent.step.completed"),
  payload: AgentStepCompletedPayload,
})

const AgentFailedEvent = EventEnvelopeBase.extend({
  type: z.literal("agent.failed"),
  payload: AgentFailedPayload,
})

const ToolRequestedEvent = EventEnvelopeBase.extend({
  type: z.literal("tool.requested"),
  payload: ToolRequestedPayload,
})

const ToolStartedEvent = EventEnvelopeBase.extend({
  type: z.literal("tool.started"),
  payload: ToolStartedPayload,
})

const ToolProgressEvent = EventEnvelopeBase.extend({
  type: z.literal("tool.progress"),
  payload: ToolProgressPayload,
})

const ToolCompletedEvent = EventEnvelopeBase.extend({
  type: z.literal("tool.completed"),
  payload: ToolCompletedPayload,
})

const ToolFailedEvent = EventEnvelopeBase.extend({
  type: z.literal("tool.failed"),
  payload: ToolFailedPayload,
})

const GateCreatedEvent = EventEnvelopeBase.extend({
  type: z.literal("gate.created"),
  payload: GateCreatedPayload,
})

const GateResolvedEvent = EventEnvelopeBase.extend({
  type: z.literal("gate.resolved"),
  payload: GateResolvedPayload,
})

const RunnerResumedEvent = EventEnvelopeBase.extend({
  type: z.literal("runner.resumed"),
  payload: RunnerResumedPayload,
})

const AgentResponseProducedEvent = EventEnvelopeBase.extend({
  type: z.literal("agent.response.produced"),
  payload: AgentResponseProducedPayload,
})

export const ThreadEvent = z.discriminatedUnion("type", [
  SessionStartedEvent,
  PromptReceivedEvent,
  AgentStepStartedEvent,
  AgentStepCompletedEvent,
  AgentFailedEvent,
  ToolRequestedEvent,
  ToolStartedEvent,
  ToolProgressEvent,
  ToolCompletedEvent,
  ToolFailedEvent,
  GateCreatedEvent,
  GateResolvedEvent,
  RunnerResumedEvent,
  AgentResponseProducedEvent,
])
```

## Wake Semantics

Not every durable event needs to wake the runner.

### Runner-waking events

- `prompt.received`
- `tool.completed`
- `gate.resolved`

### History-only events for the PoC

- `session.started`
- `agent.step.started`
- `agent.step.completed`
- `agent.failed`
- `tool.started`
- `tool.progress`
- `tool.failed`
- `gate.created`
- `runner.resumed`
- `agent.response.produced`

This separation keeps the durable history rich while the runner wake logic stays simple. In V1, `tool.failed` and `agent.failed` mark the thread failed immediately; they are terminal rather than runner wakes.

## Deterministic Mock Agent Rules

The PoC mock agent should behave like this:

### Rule 1

If the thread has a prompt but no `tool.requested`, emit a tool request.

### Rule 2

If the thread has a legacy `tool.completed` event whose output has `requiresManualApproval = true` and no open gate exists, create a gate.

### Rule 3

If the thread has a resolved approval gate with resolution `approved`, emit the final response.

### Rule 4

If the approval gate resolves to `denied`, emit a final response that indicates refusal or cancellation.

These rules keep the PoC deterministic and easy to test.
