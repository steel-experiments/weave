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
  outcome: z.enum(["requested-tool", "created-gate", "produced-response", "no-op"]),
});

export const ToolRequestedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  toolName: z.literal("mock.async-progress"),
  args: z.object({
    jobLabel: z.string().min(1),
  }),
});

export const ToolStartedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  toolName: z.literal("mock.async-progress"),
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
  }),
});

export const ToolFailedPayloadSchema = z.object({
  toolCallId: z.string().uuid(),
  errorCode: z.string().min(1),
  message: z.string().min(1),
});

export const GateCreatedPayloadSchema = z.object({
  gateId: z.string().uuid(),
  gateType: z.literal("manual-approval"),
  reason: z.literal("tool-result-requires-approval"),
  relatedToolCallId: z.string().uuid(),
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
  GateCreatedEventSchema,
  GateResolvedEventSchema,
  RunnerResumedEventSchema,
  AgentResponseProducedEventSchema,
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
