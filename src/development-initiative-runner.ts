import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DevelopmentInitiativeInputSchema, InitiativeSpecSchema } from "./development-orchestrator.js";

const NonEmptyStringSchema = z.string().min(1);

export const InitiativeRunOptionsSchema = z.object({
  from: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema.optional(),
  workingBranch: NonEmptyStringSchema.optional(),
  workspaceRoot: NonEmptyStringSchema.optional(),
  idempotencyKey: NonEmptyStringSchema.optional(),
  timeoutMs: z.number().int().positive().default(900_000),
  openCodeCommand: NonEmptyStringSchema.optional(),
  openCodeArgs: z.array(NonEmptyStringSchema).optional(),
});
export type InitiativeRunOptions = z.infer<typeof InitiativeRunOptionsSchema>;

export function parseInitiativeRunOptions(args: readonly string[]): InitiativeRunOptions {
  const parsed: Record<string, unknown> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--from") {
      parsed.from = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--base-branch") {
      parsed.baseBranch = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--working-branch") {
      parsed.workingBranch = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--workspace-root") {
      parsed.workspaceRoot = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--idempotency-key") {
      parsed.idempotencyKey = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--opencode-command") {
      parsed.openCodeCommand = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--opencode-args") {
      parsed.openCodeArgs = requiredValue(args, index, arg).split(" ").filter(Boolean);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg ?? ""}`);
  }
  return InitiativeRunOptionsSchema.parse(parsed);
}

export async function buildInitiativeRunInput(input: {
  options: InitiativeRunOptions;
  repoRoot: string;
  baseBranch: string;
}): Promise<{ initiativeInput: z.infer<typeof DevelopmentInitiativeInputSchema>; idempotencyKey: string; prdPath: string }> {
  const prdPath = path.resolve(input.repoRoot, input.options.from);
  const markdown = await readFile(prdPath, "utf8");
  const spec = InitiativeSpecSchema.parse({
    title: titleFromMarkdown(markdown) ?? titleFromPath(prdPath),
    statementOfWork: markdown,
    source: "prd",
    contextFiles: uniqueStrings([path.relative(input.repoRoot, prdPath), "docs/development-orchestrator/README.md"]),
  });
  const workingBranch = input.options.workingBranch ?? `initiative-${slugify(spec.title)}`;
  const workspaceRoot = input.options.workspaceRoot ?? path.join("/tmp", "weave-development-workspaces");
  const idempotencyKey = input.options.idempotencyKey ?? `initiative-run:v1:${hashString(path.relative(input.repoRoot, prdPath))}:${input.baseBranch}:${workingBranch}`;

  return {
    prdPath,
    idempotencyKey,
    initiativeInput: DevelopmentInitiativeInputSchema.parse({
      initiative: spec.title,
      repo: "weave",
      baseBranch: input.baseBranch,
      workingBranch,
      contextFiles: spec.contextFiles,
      initiativeSpec: spec,
      workspacePolicy: {
        mode: "initiative",
        provider: "git-worktree",
        sourceRepoPath: input.repoRoot,
        workspaceRoot,
        preserveOnFailure: true,
        preserveOnHumanGate: true,
        cleanupOnSuccess: false,
        requireCleanOnCleanup: true,
        forceCleanup: false,
      },
    }),
  };
}

export function titleFromMarkdown(markdown: string): string | undefined {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^#\s+(.+)$/.exec(line.trim())?.[1]?.trim())
    .find((title): title is string => Boolean(title));
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "initiative";
}

function titleFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ");
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}
