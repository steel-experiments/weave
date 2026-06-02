import { ThreadService, createWeaveRuntime } from "weave/runtime";
import { PostgresThreadEngine, createPool, migrate } from "weave/postgres";
import type { ThreadEvent } from "weave";
import { simpleAssistantApp } from "./app.js";

const prompt = process.argv.slice(2).join(" ") || "Summarize what a minimal Weave assistant does in one sentence.";

if (!process.env.OPENCODE_API_KEY) {
  throw new Error("Set OPENCODE_API_KEY in your shell or examples/simple-assistant/.env before running the demo.");
}

const pool = createPool();

try {
  await migrate(pool, { reset: true });

  const engine = new PostgresThreadEngine(pool);
  const service = new ThreadService(engine);
  const runtime = createWeaveRuntime({
    app: simpleAssistantApp,
    agentName: "assistant",
    engine,
    service,
    intervalMs: 25,
    toolWorkerId: "simple-assistant-tool-worker",
  });
  const { runnerDaemon, toolDaemon } = runtime;

  runnerDaemon.start();
  toolDaemon.start();

  try {
    const session = await service.startSession({ prompt, agentName: "assistant" });
    const projection = await waitForCompletion(engine, session.threadId);
    const events = await engine.read(session.threadId);
    const finalResponse = events.find((threadEvent) => threadEvent.type === "agent.response.produced");

    if (projection.status !== "completed" || !finalResponse) {
      throw new Error(`Assistant did not complete. Final status: ${projection.status}. ${describeFailure(events)}`);
    }

    console.log(finalResponse.payload.message);
  } finally {
    await runnerDaemon.stop();
    await toolDaemon.stop();
  }
} finally {
  await pool.end();
}

async function waitForCompletion(engine: PostgresThreadEngine, threadId: string) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const projection = await engine.getProjection(threadId);
    if (projection?.status === "completed" || projection?.status === "failed") {
      return projection;
    }
    await sleep(50);
  }

  throw new Error(`Timed out waiting for assistant thread ${threadId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFailure(events: ThreadEvent[]): string {
  let failure: ThreadEvent | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "tool.failed" || event?.type === "agent.failed" || event?.type === "credential.failed") {
      failure = event;
      break;
    }
  }

  if (!failure) {
    return "No failure event was recorded.";
  }

  switch (failure.type) {
    case "tool.failed":
      return `Tool failed (${failure.payload.errorCode}): ${failure.payload.message}`;
    case "agent.failed":
      return `Agent failed (${failure.payload.errorCode}): ${failure.payload.message}`;
    case "credential.failed":
      return `Credential failed (${failure.payload.errorCode}): ${failure.payload.message}`;
  }

  return "No supported failure event was recorded.";
}
