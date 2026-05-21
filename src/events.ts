import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const ActorSchema = z.object({
  type: z.enum(["user", "agent", "worker", "human", "system"]),
  id: z.string().min(1),
});
export type Actor = z.infer<typeof ActorSchema>;

export const EventEnvelopeBaseSchema = z.object({
  eventId: z.string().uuid(),
  mailboxId: z.string().min(1),
  seq: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime(),
  correlationId: z.string().uuid().optional(),
  causationId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).optional(),
  actor: ActorSchema,
});

export const SessionStartedPayloadSchema = z.object({
  source: z.enum(["api", "test", "system"]),
});

export const PromptReceivedPayloadSchema = z.object({
  prompt: z.string().min(1),
});

export const AgentStepStartedPayloadSchema = z.object({
  stepId: z.string().uuid(),
  reason: z.enum(["prompt", "tool-completed", "gate-resolved", "manual-resume"]),
});

export const AgentStepCompletedPayloadSchema = z.object({
  stepId: z.string().uuid(),
  outcome: z.enum([
    "requested-tool",
    "created-gate",
    "produced-finding",
    "proposed-remediation",
    "produced-response",
    "no-op",
  ]),
});

export const EnvironmentSchema = z.enum(["staging", "production"]);

export const ToolNameSchema = z.string().min(1);

export const ToolRequestedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  toolName: ToolNameSchema,
  args: z.unknown(),
});

export const ToolStartedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  toolName: ToolNameSchema,
});

export const ToolProgressPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  percent: z.number().int().min(0).max(100),
  message: z.string().min(1),
});

export const ToolCompletedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  output: z.object({
    summary: z.string().min(1),
    requiresManualApproval: z.boolean(),
    data: z.unknown().optional(),
  }),
});

export const ToolFailedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  errorCode: z.string().min(1),
  message: z.string().min(1),
});

export const CredentialKindSchema = z.enum(["secret", "delegated-identity", "scoped-token", "browser-session"]);

export const CredentialRequestedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  credentialName: z.string().min(1),
  kind: CredentialKindSchema,
  provider: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).optional(),
  scope: z.record(z.string(), z.string()).optional(),
});

export const CredentialResolvedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  credentialName: z.string().min(1),
  kind: CredentialKindSchema,
  source: z.string().min(1),
  subject: z.string().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const CredentialFailedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  credentialName: z.string().min(1),
  kind: CredentialKindSchema,
  errorCode: z.string().min(1),
  message: z.string().min(1),
});

export const GateCreatedPayloadSchema = z.object({
  gateId: z.string().uuid(),
  gateType: z.literal("manual-approval"),
  reason: z.enum(["tool-result-requires-approval", "risky-remediation"]),
  relatedToolCallId: z.string().uuid().optional(),
  proposedAction: z.string().optional(),
});

export const GateResolvedPayloadSchema = z.object({
  gateId: z.string().uuid(),
  resolution: z.enum(["approved", "denied"]),
  comment: z.string().optional(),
});

export const RunnerResumedPayloadSchema = z.object({
  reason: z.enum(["new-prompt", "tool-completed", "gate-resolved", "manual-retry"]),
});

export const AgentResponseProducedPayloadSchema = z.object({
  message: z.string().min(1),
});

export const AgentFindingProducedPayloadSchema = z.object({
  findingId: z.string().uuid(),
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  evidence: z.array(
    z.object({
      source: z.string().min(1),
      summary: z.string().min(1),
    }),
  ),
});

export const AgentRemediationProposedPayloadSchema = z.object({
  remediationId: z.string().uuid(),
  actionToolName: ToolNameSchema,
  summary: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  requiresApproval: z.boolean(),
});

export const AgentIncidentReportProducedPayloadSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  actions: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)),
});

const SessionStartedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("session.started"),
  payload: SessionStartedPayloadSchema,
});

const PromptReceivedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("prompt.received"),
  payload: PromptReceivedPayloadSchema,
});

const AgentStepStartedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("agent.step.started"),
  payload: AgentStepStartedPayloadSchema,
});

const AgentStepCompletedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("agent.step.completed"),
  payload: AgentStepCompletedPayloadSchema,
});

const ToolRequestedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("tool.requested"),
  payload: ToolRequestedPayloadSchema,
});

const ToolStartedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("tool.started"),
  payload: ToolStartedPayloadSchema,
});

const ToolProgressEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("tool.progress"),
  payload: ToolProgressPayloadSchema,
});

const ToolCompletedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("tool.completed"),
  payload: ToolCompletedPayloadSchema,
});

const ToolFailedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("tool.failed"),
  payload: ToolFailedPayloadSchema,
});

const CredentialRequestedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("credential.requested"),
  payload: CredentialRequestedPayloadSchema,
});

const CredentialResolvedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("credential.resolved"),
  payload: CredentialResolvedPayloadSchema,
});

const CredentialFailedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("credential.failed"),
  payload: CredentialFailedPayloadSchema,
});

const GateCreatedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("gate.created"),
  payload: GateCreatedPayloadSchema,
});

const GateResolvedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("gate.resolved"),
  payload: GateResolvedPayloadSchema,
});

const RunnerResumedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("runner.resumed"),
  payload: RunnerResumedPayloadSchema,
});

const AgentResponseProducedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("agent.response.produced"),
  payload: AgentResponseProducedPayloadSchema,
});

const AgentFindingProducedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("agent.finding.produced"),
  payload: AgentFindingProducedPayloadSchema,
});

const AgentRemediationProposedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("agent.remediation.proposed"),
  payload: AgentRemediationProposedPayloadSchema,
});

const AgentIncidentReportProducedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal("agent.incident_report.produced"),
  payload: AgentIncidentReportProducedPayloadSchema,
});

export const MailboxEventSchema = z.discriminatedUnion("type", [
  SessionStartedEventSchema,
  PromptReceivedEventSchema,
  AgentStepStartedEventSchema,
  AgentStepCompletedEventSchema,
  ToolRequestedEventSchema,
  ToolStartedEventSchema,
  ToolProgressEventSchema,
  ToolCompletedEventSchema,
  ToolFailedEventSchema,
  CredentialRequestedEventSchema,
  CredentialResolvedEventSchema,
  CredentialFailedEventSchema,
  GateCreatedEventSchema,
  GateResolvedEventSchema,
  RunnerResumedEventSchema,
  AgentResponseProducedEventSchema,
  AgentFindingProducedEventSchema,
  AgentRemediationProposedEventSchema,
  AgentIncidentReportProducedEventSchema,
]);

export type MailboxEvent = z.infer<typeof MailboxEventSchema>;
export type MailboxEventType = MailboxEvent["type"];

export const MailboxStatusSchema = z.enum([
  "idle",
  "running",
  "waiting",
  "blocked",
  "completed",
  "failed",
]);
export type MailboxStatus = z.infer<typeof MailboxStatusSchema>;

export const MailboxProjectionSchema = z.object({
  mailboxId: z.string().min(1),
  status: MailboxStatusSchema,
  tailSeq: z.number().int().nonnegative(),
  activeLeaseOwnerId: z.string().min(1).nullable(),
  pendingGateIds: z.array(z.string().uuid()),
  updatedAt: z.string().datetime(),
});
export type MailboxProjection = z.infer<typeof MailboxProjectionSchema>;

export function deterministicUuid(...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\0")).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newEventId(): string {
  return randomUUID();
}

export function eventKey(mailboxId: string, type: string, semanticKey: string): string {
  return deterministicUuid("event", mailboxId, type, semanticKey);
}
