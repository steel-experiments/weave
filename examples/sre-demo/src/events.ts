import { z } from "zod";

export const FINDING_PRODUCED = "agent.finding.produced";
export const REMEDIATION_PROPOSED = "agent.remediation.proposed";
export const INCIDENT_REPORT_PRODUCED = "agent.incident_report.produced";

export const FindingProducedSchema = z.object({
  findingId: z.string().uuid(),
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  evidence: z.array(z.object({ source: z.string().min(1), summary: z.string().min(1) })),
});

export const RemediationProposedSchema = z.object({
  remediationId: z.string().uuid(),
  actionToolName: z.string().min(1),
  summary: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  requiresApproval: z.boolean(),
});

export const IncidentReportProducedSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  actions: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)),
});
