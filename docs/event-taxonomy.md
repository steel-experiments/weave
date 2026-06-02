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

## Typed Event Factories

App code should prefer defining reusable event factories with `event({ type, payload })`:

```ts
const responseProduced = event({
  type: "agent.response.produced",
  payload: z.object({
    message: z.string().min(1),
  }),
  description: "Final response shown to the user.",
});
```

The factory validates payloads before producing an event input for `ctx.emit`:

```ts
await ctx.emit("final-response", responseProduced({ message }));
```

Replay identity is still `threadId + scopeKey + stepKey`. Re-emitting the same key, type, and canonical payload is a no-op. Reusing a key with a different event type or different canonical payload raises `ReplayMismatchError`.

The lower-level raw form remains supported for compatibility:

```ts
await ctx.emit("final-response", {
  type: "agent.response.produced",
  payload: { message },
});
```

## Event Set

The PoC uses this event set.

- `session.started`
- `prompt.received`
- `agent.step.started`
- `agent.step.completed`
- `agent.failed`
- `agent.finding.produced`
- `agent.incident_report.produced`
- `agent.output.completed`
- `agent.remediation.proposed`
- `tool.requested`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `tool.failed`
- `policy.evaluated`
- `credential.requested`
- `credential.resolved`
- `credential.failed`
- `gate.created`
- `gate.resolved`
- `checkpoint.completed`
- `child_thread.spawned`
- `child_thread.completed`
- `child_thread.failed`
- `runner.resumed`
- `agent.response.produced`

## Typed Payload Schemas

### Session started

```ts
const SessionStartedPayload = z.object({
  source: z.enum(["api", "test", "system", "github-action"]),
  agentName: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
  outcome: z.enum([
    "requested-tool",
    "created-gate",
    "produced-finding",
    "proposed-remediation",
    "produced-response",
    "no-op",
  ]),
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
  toolName: z.string().min(1),
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
const ToolCompletedPayload = z.union([
  z.object({
    toolCallId: z.string().uuid(),
    output: z.unknown(),
    summary: z.string().min(1).optional(),
  }),
  z.object({
    toolCallId: z.string().uuid(),
    summary: z.string().min(1),
    requiresManualApproval: z.boolean(),
    data: z.unknown().optional(),
  }),
])
```

`output` is the canonical raw tool result used for replay. `summary` is optional display metadata. Legacy `ToolCompletionOutput` envelopes may still carry `requiresManualApproval`, but that is compatibility-only and not the future approval model. Older top-level `summary`/`requiresManualApproval`/`data` payloads are normalized into the current `output` shape when events are decoded.

### Tool failed

```ts
const ToolFailedPayload = z.object({
  toolCallId: z.string().uuid(),
  errorCode: z.string().min(1),
  message: z.string().min(1),
})
```

### Policy evaluated

```ts
const PolicyEvaluatedPayload = z.object({
  policyEvaluationId: z.string().uuid(),
  requestType: z.literal("tool"),
  outcome: z.enum(["allowed", "denied", "approval_required"]),
  scopeKey: z.string().min(1),
  stepKey: z.string().min(1),
  policyStepKey: z.string().min(1),
  toolCallId: z.string().uuid(),
  toolName: z.string().min(1),
  inputHash: z.string().min(1),
  capabilityNames: z.array(z.string().min(1)),
  policyName: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  gateId: z.string().uuid().optional(),
})
```

`policy.evaluated` is durable audit evidence for runtime request policy decisions. It is emitted before `tool.requested` for allowed tool requests, before `gate.created` for approval-required requests, and before `agent.failed` for denied requests.

### Credential requested

```ts
const CredentialKind = z.enum(["secret", "delegated-identity", "scoped-token", "browser-session"])

const CredentialRequestedPayload = z.object({
  toolCallId: z.string().uuid(),
  credentialName: z.string().min(1),
  kind: CredentialKind,
  provider: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).optional(),
  scope: z.record(z.string(), z.string()).optional(),
})
```

### Credential resolved

```ts
const CredentialResolvedPayload = z.object({
  toolCallId: z.string().uuid(),
  credentialName: z.string().min(1),
  kind: CredentialKind,
  source: z.string().min(1),
  subject: z.string().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
})
```

### Credential failed

```ts
const CredentialFailedPayload = z.object({
  toolCallId: z.string().uuid(),
  credentialName: z.string().min(1),
  kind: CredentialKind,
  errorCode: z.string().min(1),
  message: z.string().min(1),
})
```

### Gate created

```ts
const GateCreatedPayload = z.object({
  gateId: z.string().uuid(),
  gateType: z.literal("manual-approval"),
  reason: z.enum(["tool-result-requires-approval", "risky-remediation"]),
  relatedToolCallId: z.string().uuid().optional(),
  proposedAction: z.string().optional(),
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
  output: z.unknown().optional(),
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
  reason: z.enum([
    "new-prompt",
    "tool-completed",
    "gate-resolved",
    "child-spawned",
    "child-completed",
    "child-failed",
    "manual-retry",
  ]),
})
```

### Agent response produced

```ts
const AgentResponseProducedPayload = z.object({
  message: z.string().min(1),
})
```

### Agent output completed

```ts
const AgentOutputCompletedPayload = z.object({
  output: z.unknown(),
  summary: z.string().min(1).optional(),
})
```

`output` is the canonical raw return value from `agent.run`. `summary` is optional display metadata and usually matches the response message.

### Agent finding produced

```ts
const AgentFindingProducedPayload = z.object({
  findingId: z.string().uuid(),
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  evidence: z.array(
    z.object({
      source: z.string().min(1),
      summary: z.string().min(1),
    }),
  ),
})
```

### Agent remediation proposed

```ts
const AgentRemediationProposedPayload = z.object({
  remediationId: z.string().uuid(),
  actionToolName: z.string().min(1),
  summary: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  requiresApproval: z.boolean(),
})
```

### Agent incident report produced

```ts
const AgentIncidentReportProducedPayload = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  actions: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)),
})
```

### Checkpoint completed

```ts
const CheckpointCompletedPayload = z.object({
  scopeKey: z.string().min(1),
  stepKey: z.string().min(1),
  value: z.unknown(),
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

const CredentialRequestedEvent = EventEnvelopeBase.extend({
  type: z.literal("credential.requested"),
  payload: CredentialRequestedPayload,
})

const CredentialResolvedEvent = EventEnvelopeBase.extend({
  type: z.literal("credential.resolved"),
  payload: CredentialResolvedPayload,
})

const CredentialFailedEvent = EventEnvelopeBase.extend({
  type: z.literal("credential.failed"),
  payload: CredentialFailedPayload,
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

const AgentOutputCompletedEvent = EventEnvelopeBase.extend({
  type: z.literal("agent.output.completed"),
  payload: AgentOutputCompletedPayload,
})

const AgentFindingProducedEvent = EventEnvelopeBase.extend({
  type: z.literal("agent.finding.produced"),
  payload: AgentFindingProducedPayload,
})

const AgentRemediationProposedEvent = EventEnvelopeBase.extend({
  type: z.literal("agent.remediation.proposed"),
  payload: AgentRemediationProposedPayload,
})

const AgentIncidentReportProducedEvent = EventEnvelopeBase.extend({
  type: z.literal("agent.incident_report.produced"),
  payload: AgentIncidentReportProducedPayload,
})

const CheckpointCompletedEvent = EventEnvelopeBase.extend({
  type: z.literal("checkpoint.completed"),
  payload: CheckpointCompletedPayload,
})

const ChildThreadSpawnedEvent = EventEnvelopeBase.extend({
  type: z.literal("child_thread.spawned"),
  payload: ChildThreadSpawnedPayload,
})

const ChildThreadCompletedEvent = EventEnvelopeBase.extend({
  type: z.literal("child_thread.completed"),
  payload: ChildThreadCompletedPayload,
})

const ChildThreadFailedEvent = EventEnvelopeBase.extend({
  type: z.literal("child_thread.failed"),
  payload: ChildThreadFailedPayload,
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
  CredentialRequestedEvent,
  CredentialResolvedEvent,
  CredentialFailedEvent,
  GateCreatedEvent,
  GateResolvedEvent,
  RunnerResumedEvent,
  AgentResponseProducedEvent,
  AgentOutputCompletedEvent,
  AgentFindingProducedEvent,
  AgentRemediationProposedEvent,
  AgentIncidentReportProducedEvent,
  CheckpointCompletedEvent,
  ChildThreadSpawnedEvent,
  ChildThreadCompletedEvent,
  ChildThreadFailedEvent,
])
```

## Wake Semantics

Not every durable event needs to wake the runner.

### Runner-waking events

- `prompt.received`
- `tool.completed`
- `gate.resolved`
- `child_thread.spawned`
- `child_thread.completed`
- `child_thread.failed`

### History-only events for the PoC

- `session.started`
- `agent.step.started`
- `agent.step.completed`
- `agent.failed`
- `tool.started`
- `tool.progress`
- `tool.failed`
- `credential.requested`
- `credential.resolved`
- `credential.failed`
- `gate.created`
- `runner.resumed`
- `agent.response.produced`
- `agent.output.completed`
- `agent.finding.produced`
- `agent.remediation.proposed`
- `agent.incident_report.produced`
- `checkpoint.completed`

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
