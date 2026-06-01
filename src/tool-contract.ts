import type { z } from "zod";
import type { ThreadArtifactStore } from "./artifacts.js";
import type { CredentialRequest, ResolvedCredentials } from "./credentials.js";
import type { ThreadEvent } from "./events.js";
import type { ToolObserver } from "./observability.js";

export type ToolCompletionOutput = {
  summary: string;
  requiresManualApproval: boolean;
  data?: unknown;
};

export type ToolProgressUpdate = {
  percent: number;
  message: string;
};

export type ManualToolGate = {
  type: "manual-approval";
  reason: "tool-result-requires-approval" | "risky-remediation";
  message?: string;
  proposedAction?: string;
};

export class RetryableToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableToolError";
  }
}

export type ToolRunContext<Input> = {
  threadId: string;
  toolCallId: string;
  toolName: string;
  input: Input;
  credentials: ResolvedCredentials;
  artifactStore: ThreadArtifactStore;
  observe: ToolObserver;
  request: Extract<ThreadEvent, { type: "tool.requested" }>;
  progress(update: ToolProgressUpdate): Promise<void>;
};

export type ToolContract<
  Name extends string = string,
  Input = unknown,
  Output extends ToolCompletionOutput = ToolCompletionOutput,
> = {
  name: Name;
  description: string;
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  gate?: (context: { input: Input }) => ManualToolGate | undefined;
  credentials?: (context: { input: Input }) => CredentialRequest | readonly CredentialRequest[] | undefined;
  run(context: ToolRunContext<Input>): Promise<Output> | Output;
};

export type AnyToolContract = ToolContract<string, any, ToolCompletionOutput>;

export function defineTool<
  const Name extends string,
  Input,
  Output extends ToolCompletionOutput,
>(contract: ToolContract<Name, Input, Output>): ToolContract<Name, Input, Output> {
  return contract;
}

export const tool = defineTool;

export class ToolRegistry {
  private readonly tools: Map<string, AnyToolContract>;

  constructor(tools: readonly AnyToolContract[]) {
    this.tools = new Map();
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Duplicate tool contract registered: ${tool.name}`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string): AnyToolContract | undefined {
    return this.tools.get(name);
  }

  list(): AnyToolContract[] {
    return [...this.tools.values()];
  }
}

export function createToolRegistry(tools: readonly AnyToolContract[]): ToolRegistry {
  return new ToolRegistry(tools);
}
