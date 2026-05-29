import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { AddressInfo } from "node:net";
import { OtlpHttpObservabilitySink, newSpanId, newTraceId } from "../index.js";

const configuredEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const receiver = configuredEndpoint ? null : await startMockOtlpReceiver();
const endpoint = configuredEndpoint ?? receiver?.endpoint;

assert(endpoint);

const sink = new OtlpHttpObservabilitySink({
  endpoint,
  serviceName: "weave-otlp-smoke",
  resourceAttributes: {
    "deployment.environment": "smoke",
  },
});

const traceId = newTraceId();
const spanId = newSpanId();
const now = new Date().toISOString();
const threadId = randomUUID();
const toolCallId = randomUUID();

try {
  await sink.emitSpan({
    traceId,
    spanId,
    threadId,
    toolCallId,
    toolName: "smoke.tool",
    name: "tool.execute smoke.tool",
    kind: "tool",
    status: "ok",
    startedAt: now,
    endedAt: new Date().toISOString(),
    durationMs: 1,
    attributes: {
      "smoke.test": true,
    },
  });

  await sink.emitLog({
    traceId,
    spanId,
    threadId,
    toolCallId,
    toolName: "smoke.tool",
    timestamp: new Date().toISOString(),
    level: "info",
    message: "OTLP smoke log",
    attributes: {
      "smoke.test": true,
    },
  });

  if (receiver) {
    assert.equal(receiver.requests.traces.length, 1);
    assert.equal(receiver.requests.logs.length, 1);
    assert.deepEqual(receiver.requests.other, []);
  }

  console.log("OTLP smoke test passed");
  console.log(`endpoint=${endpoint}`);
  console.log(`mode=${configuredEndpoint ? "collector" : "mock-receiver"}`);
} finally {
  await receiver?.close();
}

async function startMockOtlpReceiver(): Promise<{
  endpoint: string;
  requests: { traces: unknown[]; logs: unknown[]; other: string[] };
  close(): Promise<void>;
}> {
  const requests = { traces: [] as unknown[], logs: [] as unknown[], other: [] as string[] };
  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    if (request.url === "/v1/traces") {
      requests.traces.push(body);
      response.writeHead(200).end();
      return;
    }
    if (request.url === "/v1/logs") {
      requests.logs.push(body);
      response.writeHead(200).end();
      return;
    }
    requests.other.push(request.url ?? "unknown");
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(isAddressInfo(address));

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return typeof address === "object" && address !== null && "port" in address;
}
