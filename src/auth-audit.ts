import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuthContext, AuthorizationDecision, Principal, WeaveAction } from "./auth-gateway.js";
import type { ThreadEngine } from "./contracts.js";
import { deterministicUuid, nowIso, type Actor, type ThreadEvent } from "./events.js";

export type AuthDecisionAuditInput = {
  threadId: string;
  context: AuthContext;
  action: WeaveAction;
  decision: AuthorizationDecision;
  actor?: Actor;
  correlationId?: string;
  resource?: string;
};

export function hashProviderSubject(provider: string, subject: string): string {
  return createHash("sha256").update(`${provider}\0${subject}`).digest("hex").slice(0, 16);
}

export function principalKindFromActor(actor: Actor | undefined): string {
  return actor?.type ?? "user";
}

export function resourceFromAction(action: WeaveAction): string | undefined {
  switch (action.type) {
    case "thread.start":
      return action.agentName ? `agent:${action.agentName}` : undefined;
    case "agent.run":
      return `agent:${action.agentName}`;
    case "thread.read":
      return action.threadId ? `thread:${action.threadId}` : undefined;
    case "thread.signal":
      return action.threadId ? `thread:${action.threadId}` : undefined;
    case "gate.resolve":
      return action.threadId ? `thread:${action.threadId}` : undefined;
    case "thread.cancel":
      return action.threadId ? `thread:${action.threadId}` : undefined;
    case "artifact.read":
      return action.threadId ? `thread:${action.threadId}` : undefined;
    case "integration.trigger":
      return `integration:${action.integrationName}`;
    default:
      return undefined;
  }
}

function firstSubjectHash(principal: Principal): string | undefined {
  const alias = principal.aliases[0];
  if (!alias) {
    return undefined;
  }
  return hashProviderSubject(alias.provider, alias.subject);
}

export const AUTH_DECISION_RECORDED = "auth.decision.recorded";

export const AuthDecisionRecordedDataSchema = z.object({
  principalId: z.string().min(1),
  principalKind: z.string().min(1),
  provider: z.string().min(1),
  action: z.string().min(1),
  resource: z.string().min(1).optional(),
  decision: z.enum(["allowed", "denied"]),
  reason: z.string().min(1).optional(),
  subjectHash: z.string().min(1).optional(),
});
export type AuthDecisionRecordedData = z.infer<typeof AuthDecisionRecordedDataSchema>;

export function buildAuthDecisionEvent(input: AuthDecisionAuditInput): Extract<ThreadEvent, { type: "domain.event" }> {
  const actionType = input.action.type;
  const resource = input.resource ?? resourceFromAction(input.action);
  const subjectHash = firstSubjectHash(input.context.principal);

  return {
    eventId: deterministicUuid("auth-decision", input.threadId, input.context.principal.id, actionType, resource ?? ""),
    threadId: input.threadId,
    type: "domain.event",
    occurredAt: nowIso(),
    correlationId: input.correlationId,
    actor: input.actor ?? { type: "system", id: "auth-gateway" },
    payload: {
      kind: AUTH_DECISION_RECORDED,
      data: {
        principalId: input.context.principal.id,
        principalKind: principalKindFromActor(input.actor),
        provider: input.context.principal.provider,
        action: actionType,
        ...(resource ? { resource } : {}),
        decision: input.decision.allowed ? "allowed" : "denied",
        ...(input.decision.reason ? { reason: input.decision.reason } : {}),
        ...(subjectHash ? { subjectHash } : {}),
      },
    },
  };
}

export async function recordAuthDecision(
  engine: ThreadEngine,
  input: AuthDecisionAuditInput,
): Promise<void> {
  const event = buildAuthDecisionEvent(input);
  await engine.append([event]);
}
