import {
  ThreadSummarySchema,
  type ThreadEvent,
  type ThreadExecutionStatus,
  type ThreadProjection,
  type ThreadSummary,
  type ThreadSummaryOutcome,
} from "./events.js";

export function buildThreadSummary(projection: ThreadProjection, events: ThreadEvent[]): ThreadSummary {
  const findings = {
    critical: 0,
    warning: 0,
    info: 0,
  };

  let finalMessage: string | null = null;
  let executionErrorCode: string | null = null;
  let executionMessage: string | null = null;

  for (const event of events) {
    if (event.type === "agent.finding.produced") {
      findings[event.payload.severity] += 1;
      continue;
    }

    if (event.type === "agent.response.produced") {
      finalMessage = event.payload.message;
      continue;
    }

    if (event.type === "tool.failed") {
      executionErrorCode = event.payload.errorCode;
      executionMessage = event.payload.message;
    }
  }

  const outcome = deriveOutcome(projection.status, findings);
  const executionStatus = deriveExecutionStatus(projection.status);

  return ThreadSummarySchema.parse({
    threadId: projection.threadId,
    status: projection.status,
    outcome,
    execution: {
      status: executionStatus,
      errorCode: executionStatus === "failed" ? executionErrorCode : null,
      message: executionStatus === "failed" ? executionMessage : finalMessage,
    },
    findings,
    finalMessage,
    tailSeq: projection.tailSeq,
    pendingGateIds: projection.pendingGateIds,
    updatedAt: projection.updatedAt,
  });
}

function deriveOutcome(
  status: ThreadProjection["status"],
  findings: ThreadSummary["findings"],
): ThreadSummaryOutcome | null {
  if (status !== "completed") {
    return null;
  }

  if (findings.critical > 0) {
    return "failed";
  }

  if (findings.warning > 0) {
    return "warning";
  }

  return "passed";
}

function deriveExecutionStatus(status: ThreadProjection["status"]): ThreadExecutionStatus {
  if (status === "failed") {
    return "failed";
  }

  if (status === "completed") {
    return "succeeded";
  }

  return "pending";
}
