import { createPool } from "../db.js";
import {
  formatGateDetail,
  formatGateList,
  formatInitiativeList,
  formatInitiativeStatus,
  getGate,
  getInitiativeStatus,
  latestPlanForGate,
  listInitiatives,
  listPendingGates,
  resolveOperatorGate,
} from "../development-operator.js";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";
import { ThreadService } from "../thread-service.js";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  usage(1);
}

const pool = createPool();

try {
  await migrate(pool);
  await run(command, args);
} finally {
  await pool.end();
}

async function run(command: string, args: string[]): Promise<void> {
  switch (command) {
    case "gates:list": {
      console.log(formatGateList(await listPendingGates(pool)));
      return;
    }
    case "gates:show": {
      const gateId = requiredArg(args, 0, "gate id");
      const gate = await getGate(pool, gateId);
      if (!gate) {
        throw new Error(`Gate not found: ${gateId}`);
      }
      console.log(formatGateDetail(gate, await latestPlanForGate(pool, gate)));
      return;
    }
    case "gates:approve":
    case "gates:reject": {
      const gateId = requiredArg(args, 0, "gate id");
      const note = optionValue(args, "--note");
      const engine = new PostgresThreadEngine(pool);
      const service = new ThreadService(engine);
      const resolved = await resolveOperatorGate({
        pool,
        service,
        gateId,
        resolution: command === "gates:approve" ? "approved" : "denied",
        note,
      });
      console.log(`Gate ${resolved.gateId} ${resolved.resolution ?? "resolved"}.`);
      console.log(`Next: npm run initiative:status -- ${resolved.threadId}`);
      return;
    }
    case "initiatives:list": {
      const limit = Number.parseInt(optionValue(args, "--limit") ?? "20", 10);
      console.log(formatInitiativeList(await listInitiatives(pool, limit)));
      return;
    }
    case "initiative:status": {
      const threadId = requiredArg(args, 0, "thread id");
      const status = await getInitiativeStatus(pool, threadId);
      if (!status) {
        throw new Error(`Initiative not found: ${threadId}`);
      }
      console.log(formatInitiativeStatus(status));
      return;
    }
    default:
      usage(1);
  }
}

function requiredArg(args: readonly string[], index: number, label: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function usage(exitCode: number): never {
  console.error([
    "Usage:",
    "  npm run gates:list",
    "  npm run gates:show -- <gate-id>",
    "  npm run gates:approve -- <gate-id> --note \"approved\"",
    "  npm run gates:reject -- <gate-id> --note \"reason\"",
    "  npm run initiatives:list",
    "  npm run initiative:status -- <thread-id>",
  ].join("\n"));
  process.exit(exitCode);
}
