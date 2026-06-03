import { z } from "zod";
import { WorkflowPlanSchema, type WorkflowInput, type WorkflowPlan } from "./schemas.js";

export type WorkflowCompiler = {
  readonly source: "deterministic" | "model-backed";
  compile(input: WorkflowInput): Promise<unknown> | unknown;
};

export type WorkflowPlanValidationOptions = {
  registeredAgents: ReadonlySet<string>;
  safeCapabilities: ReadonlySet<string>;
  unsafeCapabilityMode?: "allow-for-gate" | "reject";
};

const executablePlanKeys = new Set(["code", "script", "javascript", "generatedJavaScript", "executable"]);

export async function compileWorkflowPlanWithCompiler(
  input: WorkflowInput,
  compiler: WorkflowCompiler,
  options: WorkflowPlanValidationOptions,
): Promise<WorkflowPlan> {
  const rawPlan = await compiler.compile(input);
  return normalizeWorkflowPlan(rawPlan, options);
}

export function createMockModelWorkflowCompiler(rawPlan: unknown): WorkflowCompiler {
  return {
    source: "model-backed",
    compile() {
      return rawPlan;
    },
  };
}

export function normalizeWorkflowPlan(rawPlan: unknown, options: WorkflowPlanValidationOptions): WorkflowPlan {
  rejectExecutablePlanData(rawPlan);
  const plan = WorkflowPlanSchema.parse(rawPlan);
  validateRegisteredAgents(plan, options.registeredAgents);
  validateCapabilities(plan, options.safeCapabilities, options.unsafeCapabilityMode ?? "allow-for-gate");
  return plan;
}

function validateRegisteredAgents(plan: WorkflowPlan, registeredAgents: ReadonlySet<string>): void {
  const unknownAgents = plan.steps.flatMap((step) => {
    if (step.kind !== "spawn") {
      return [];
    }
    return [step.agentName, step.verifyWith].filter((agentName): agentName is string => {
      return typeof agentName === "string" && !registeredAgents.has(agentName);
    });
  });

  if (unknownAgents.length > 0) {
    throw new Error(`WorkflowPlan references unregistered agents: ${[...new Set(unknownAgents)].join(", ")}`);
  }
}

function validateCapabilities(
  plan: WorkflowPlan,
  safeCapabilities: ReadonlySet<string>,
  unsafeCapabilityMode: "allow-for-gate" | "reject",
): void {
  if (unsafeCapabilityMode !== "reject") {
    return;
  }

  const unsafeCapabilities = plan.requiredCapabilities
    .map((capability) => capability.name)
    .filter((capabilityName) => !safeCapabilities.has(capabilityName));
  if (unsafeCapabilities.length > 0) {
    throw new Error(`WorkflowPlan requires unsafe capabilities: ${[...new Set(unsafeCapabilities)].join(", ")}`);
  }
}

function rejectExecutablePlanData(value: unknown, path: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectExecutablePlanData(item, [...path, String(index)]));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (executablePlanKeys.has(key)) {
      throw new Error(`WorkflowPlan contains executable field: ${[...path, key].join(".")}`);
    }
    rejectExecutablePlanData(nested, [...path, key]);
  }
}

export function parseUnknownWorkflowPlan(value: unknown): WorkflowPlan {
  return WorkflowPlanSchema.parse(value);
}

export function workflowPlanValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
