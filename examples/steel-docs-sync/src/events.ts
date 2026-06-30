import { z } from "zod";

export const FINDING_PRODUCED = "agent.finding.produced";

export const FindingProducedSchema = z.object({
  findingId: z.string().uuid(),
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  evidence: z.array(z.object({ source: z.string().min(1), summary: z.string().min(1) })),
});
