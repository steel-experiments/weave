import type { z } from "zod";
import type { ThreadStatus } from "./events.js";

export type ThreadRef<Output = unknown> = {
  threadId: string;
  agentName: string;
  parentThreadId?: string;
  rootThreadId?: string;
  parentScopeKey?: string;
  parentStepKey?: string;
  status?: ThreadStatus;
  outputSchema?: z.ZodType<Output>;
  output?: Output;
};
