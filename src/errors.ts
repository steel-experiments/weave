export class WeaveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WeaveError";
  }
}

export class ToolFailedError extends WeaveError {
  constructor(message: string, details?: unknown) {
    super("TOOL_FAILED", message, details);
    this.name = "ToolFailedError";
  }
}

export class ReplayMismatchError extends WeaveError {
  constructor(message: string, details?: unknown) {
    super("REPLAY_MISMATCH", message, details);
    this.name = "ReplayMismatchError";
  }
}

export class ParallelDurableEffectError extends WeaveError {
  constructor(message: string, details?: unknown) {
    super("PARALLEL_DURABLE_EFFECT", message, details);
    this.name = "ParallelDurableEffectError";
  }
}

export class ChildThreadFailedError extends WeaveError {
  constructor(message: string, details?: unknown) {
    super("CHILD_THREAD_FAILED", message, details);
    this.name = "ChildThreadFailedError";
  }
}

export function isWeaveError(error: unknown, code?: string): error is WeaveError {
  return error instanceof WeaveError && (code === undefined || error.code === code);
}
