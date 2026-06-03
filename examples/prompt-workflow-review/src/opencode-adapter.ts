import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { agent, capability, stableJsonHash, tool, type AnyToolContract } from "weave";
import { z } from "zod";

export const repoReadCapability = capability({
  name: "repo.read",
  description: "Read repository files and documentation for claim verification.",
  scopes: z.object({ repository: z.string().min(1) }),
});

export const repoWriteCapability = capability({
  name: "repo.write",
  description: "Write repository files. Not available to the read-only workflow adapter.",
  scopes: z.object({ repository: z.string().min(1) }),
});

export const networkAccessCapability = capability({
  name: "network.access",
  description: "Access external network resources. Policy-gated and disabled by default.",
  scopes: z.object({ host: z.string().min(1) }),
});

export const shellAccessCapability = capability({
  name: "shell.exec",
  description: "Execute shell commands. Policy-gated and disabled by default.",
  scopes: z.object({ commandClass: z.string().min(1) }),
});

const adapterFile = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(adapterFile), "../../..");
const defaultDeniedGlobs = [
  ".git/**",
  "node_modules/**",
  "**/node_modules/**",
  "dist/**",
  "**/dist/**",
  "**/.env*",
] as const;
const defaultRepoToolLimits = {
  maxFileSizeBytes: 200_000,
  maxSearchFiles: 300,
  maxListFiles: 200,
};

export const RepoListFilesInputSchema = z.object({
  directory: z.string().min(1).optional(),
  maxResults: z.number().int().positive().max(500).optional(),
});

export const RepoListFilesOutputSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
});

export const RepoReadFileInputSchema = z.object({
  path: z.string().min(1),
});

export const RepoReadFileOutputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export const RepoReadRangeInputSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
});

export const RepoReadRangeOutputSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});

export const RepoSearchTextInputSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(100).optional(),
});

export const RepoSearchTextOutputSchema = z.object({
  matches: z.array(
    z.object({
      path: z.string().min(1),
      line: z.number().int().positive(),
      text: z.string().min(1),
    }),
  ),
});

export type RepoListFilesOutput = z.infer<typeof RepoListFilesOutputSchema>;
export type RepoReadFileOutput = z.infer<typeof RepoReadFileOutputSchema>;
export type RepoReadRangeOutput = z.infer<typeof RepoReadRangeOutputSchema>;
export type RepoSearchTextOutput = z.infer<typeof RepoSearchTextOutputSchema>;

export type RepositoryToolOptions = {
  root: string;
  deniedGlobs?: readonly string[];
  maxFileSizeBytes?: number;
  maxSearchFiles?: number;
  maxListFiles?: number;
};

export type OpenCodeAgentLimits = {
  maxToolCalls: number;
  timeoutMs: number;
  maxBytesRead: number;
  maxOutputBytes: number;
  maxFileSizeBytes?: number;
};

export type OpenCodeToolClient = {
  listFiles(input: z.infer<typeof RepoListFilesInputSchema>): Promise<RepoListFilesOutput>;
  readFile(input: z.infer<typeof RepoReadFileInputSchema>): Promise<RepoReadFileOutput>;
  readRange(input: z.infer<typeof RepoReadRangeInputSchema>): Promise<RepoReadRangeOutput>;
  searchText(input: z.infer<typeof RepoSearchTextInputSchema>): Promise<RepoSearchTextOutput>;
};

export type OpenCodeSession<Input> = {
  input: Input;
  taskPrompt: string;
  tools: OpenCodeToolClient;
  limits: OpenCodeAgentLimits;
  signal: AbortSignal;
};

export type OpenCodeSessionRunner<Input> = {
  run(session: OpenCodeSession<Input>): Promise<unknown> | unknown;
};

export type OpenCodeAgentOptions<Input, Output> = {
  name: string;
  description?: string;
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  taskPrompt(input: Input): string;
  limits: OpenCodeAgentLimits;
  runner: OpenCodeSessionRunner<Input>;
};

export type OpenCodeCliRunnerOptions<Input> = {
  binary?: string;
  model?: string;
  agent?: string;
  cwd?: string;
  timeoutMs?: number;
  buildPrompt(session: OpenCodeSession<Input>): Promise<string> | string;
};

export function defaultOpenCodeRepoRoot(): string {
  return defaultRepositoryRoot;
}

export function defaultOpenCodeDeniedGlobs(): readonly string[] {
  return defaultDeniedGlobs;
}

export const repoListFilesTool = tool({
  name: "repo.listFiles",
  description: "List files under the bounded repository root.",
  input: RepoListFilesInputSchema,
  output: RepoListFilesOutputSchema,
  capabilities: [repoReadCapability],
  summarize(output) {
    return `${output.files.length} files`;
  },
  run(ctx) {
    return listRepositoryFiles({
      root: defaultRepositoryRoot,
      deniedGlobs: defaultDeniedGlobs,
      maxListFiles: ctx.input.maxResults ?? defaultRepoToolLimits.maxListFiles,
      directory: ctx.input.directory,
    });
  },
});

export const repoReadFileTool = tool({
  name: "repo.readFile",
  description: "Read one file under the bounded repository root.",
  input: RepoReadFileInputSchema,
  output: RepoReadFileOutputSchema,
  capabilities: [repoReadCapability],
  summarize(output) {
    return `read ${output.path}`;
  },
  run(ctx) {
    return readRepositoryFile({
      root: defaultRepositoryRoot,
      deniedGlobs: defaultDeniedGlobs,
      maxFileSizeBytes: defaultRepoToolLimits.maxFileSizeBytes,
      path: ctx.input.path,
    });
  },
});

export const repoReadRangeTool = tool({
  name: "repo.readRange",
  description: "Read a line range from one file under the bounded repository root.",
  input: RepoReadRangeInputSchema,
  output: RepoReadRangeOutputSchema,
  capabilities: [repoReadCapability],
  summarize(output) {
    return `read ${output.path}:${output.startLine}-${output.endLine}`;
  },
  run(ctx) {
    return readRepositoryRange({
      root: defaultRepositoryRoot,
      deniedGlobs: defaultDeniedGlobs,
      maxFileSizeBytes: defaultRepoToolLimits.maxFileSizeBytes,
      path: ctx.input.path,
      startLine: ctx.input.startLine,
      endLine: ctx.input.endLine,
    });
  },
});

export const repoSearchTextTool = tool({
  name: "repo.searchText",
  description: "Search text under the bounded repository root.",
  input: RepoSearchTextInputSchema,
  output: RepoSearchTextOutputSchema,
  capabilities: [repoReadCapability],
  summarize(output) {
    return `${output.matches.length} matches`;
  },
  run(ctx) {
    return searchRepositoryText({
      root: defaultRepositoryRoot,
      deniedGlobs: defaultDeniedGlobs,
      maxFileSizeBytes: defaultRepoToolLimits.maxFileSizeBytes,
      maxSearchFiles: defaultRepoToolLimits.maxSearchFiles,
      query: ctx.input.query,
      maxResults: ctx.input.maxResults,
    });
  },
});

export function createOpenCodeAgent<Input, Output>(options: OpenCodeAgentOptions<Input, Output>) {
  const mediatedTools = [repoListFilesTool, repoReadFileTool, repoReadRangeTool, repoSearchTextTool] as const satisfies readonly AnyToolContract[];
  return agent({
    name: options.name,
    description: options.description,
    input: options.input,
    output: options.output,
    tools: mediatedTools,
    async run(ctx, input) {
      const taskPrompt = await ctx.checkpoint("opencode-task-spec", () => options.taskPrompt(input));
      await ctx.checkpoint("opencode-adapter-limits", () => options.limits);
      const limits = { ...options.limits };
      const startedAt = Date.now();
      let toolCalls = 0;
      let totalBytesRead = 0;

      const beforeTool = (toolName: string, toolInput: unknown) => {
        toolCalls += 1;
        if (toolCalls > limits.maxToolCalls) {
          throw new Error(`OpenCode adapter exceeded maxToolCalls=${limits.maxToolCalls}`);
        }
        if (Date.now() - startedAt > limits.timeoutMs) {
          throw new Error(`OpenCode adapter exceeded timeoutMs=${limits.timeoutMs}`);
        }
        return `opencode:${String(toolCalls).padStart(3, "0")}:${toolName}:${stableJsonHash(toolInput).slice(0, 8)}`;
      };
      const afterTool = (bytesRead: number) => {
        totalBytesRead += bytesRead;
        if (totalBytesRead > limits.maxBytesRead) {
          throw new Error(`OpenCode adapter exceeded maxBytesRead=${limits.maxBytesRead}`);
        }
      };
      const tools: OpenCodeToolClient = {
        listFiles: async (toolInput) => {
          const output = await ctx.tool(beforeTool(repoListFilesTool.name, toolInput), repoListFilesTool, toolInput);
          afterTool(output.files.reduce((total, file) => total + file.path.length, 0));
          return output;
        },
        readFile: async (toolInput) => {
          const output = await ctx.tool(beforeTool(repoReadFileTool.name, toolInput), repoReadFileTool, toolInput);
          afterTool(output.sizeBytes);
          return output;
        },
        readRange: async (toolInput) => {
          const output = await ctx.tool(beforeTool(repoReadRangeTool.name, toolInput), repoReadRangeTool, toolInput);
          afterTool(output.sizeBytes);
          return output;
        },
        searchText: async (toolInput) => {
          const output = await ctx.tool(beforeTool(repoSearchTextTool.name, toolInput), repoSearchTextTool, toolInput);
          afterTool(output.matches.reduce((total, match) => total + match.path.length + match.text.length, 0));
          return output;
        },
      };

      const rawOutput = await options.runner.run({ input, taskPrompt, tools, limits, signal: ctx.signal });
      return parseOpenCodeStructuredOutput(rawOutput, options.output, limits.maxOutputBytes);
    },
  });
}

export function createOpenCodeCliRunner<Input>(options: OpenCodeCliRunnerOptions<Input>): OpenCodeSessionRunner<Input> {
  return {
    async run(session) {
      const prompt = await options.buildPrompt(session);
      const args = [
        "run",
        "--format",
        "json",
        "--agent",
        options.agent ?? "summary",
        "--dir",
        options.cwd ?? defaultRepositoryRoot,
      ];
      if (options.model) {
        args.push("--model", options.model);
      }
      args.push(prompt);
      const stdout = await runOpenCodeCli(options.binary ?? "opencode", args, {
        cwd: options.cwd ?? defaultRepositoryRoot,
        timeoutMs: options.timeoutMs ?? session.limits.timeoutMs,
        maxBufferBytes: Math.max(5_000_000, session.limits.maxOutputBytes * 100),
        signal: session.signal,
      });
      return extractOpenCodeJsonText(stdout);
    },
  };
}

export function parseOpenCodeStructuredOutput<Output>(rawOutput: unknown, schema: z.ZodType<Output>, maxOutputBytes: number): Output {
  const rawText = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
  if (Buffer.byteLength(rawText, "utf8") > maxOutputBytes) {
    throw new Error(`OpenCode adapter exceeded maxOutputBytes=${maxOutputBytes}`);
  }
  const value = typeof rawOutput === "string" ? JSON.parse(rawOutput) : rawOutput;
  return schema.parse(value);
}

export function extractOpenCodeJsonText(stdout: string): string {
  const textParts: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object" || Reflect.get(event, "type") !== "text") {
      continue;
    }
    const part = Reflect.get(event, "part");
    if (part && typeof part === "object" && typeof Reflect.get(part, "text") === "string") {
      textParts.push(Reflect.get(part, "text"));
    }
  }
  const text = textParts.join("").trim();
  if (!text) {
    throw new Error("OpenCode CLI did not produce JSON text output.");
  }
  return stripJsonCodeFence(text);
}

export async function listRepositoryFiles(
  options: RepositoryToolOptions & { directory?: string; maxListFiles?: number },
): Promise<RepoListFilesOutput> {
  const root = resolve(options.root);
  const deniedGlobs = options.deniedGlobs ?? defaultDeniedGlobs;
  const maxListFiles = options.maxListFiles ?? defaultRepoToolLimits.maxListFiles;
  const { resolvedPath } = resolveRepositoryPath(root, options.directory ?? ".", deniedGlobs);
  const files: RepoListFilesOutput["files"] = [];
  await collectRepositoryFiles(root, resolvedPath, deniedGlobs, maxListFiles, files);
  return { files: files.sort((left, right) => left.path.localeCompare(right.path)).slice(0, maxListFiles) };
}

export async function readRepositoryFile(
  options: RepositoryToolOptions & { path: string; maxFileSizeBytes?: number },
): Promise<RepoReadFileOutput> {
  const root = resolve(options.root);
  const deniedGlobs = options.deniedGlobs ?? defaultDeniedGlobs;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? defaultRepoToolLimits.maxFileSizeBytes;
  const { repoPath, resolvedPath } = resolveRepositoryPath(root, options.path, deniedGlobs);
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new Error(`Repository path is not a file: ${repoPath}`);
  }
  if (fileStat.size > maxFileSizeBytes) {
    throw new Error(`Repository file ${repoPath} exceeds maxFileSizeBytes=${maxFileSizeBytes}`);
  }
  const content = await readFile(resolvedPath, "utf8");
  return { path: repoPath, content, sizeBytes: Buffer.byteLength(content, "utf8") };
}

export async function readRepositoryRange(
  options: RepositoryToolOptions & { path: string; startLine: number; endLine?: number; maxFileSizeBytes?: number },
): Promise<RepoReadRangeOutput> {
  const file = await readRepositoryFile(options);
  const lines = file.content.split(/\r?\n/);
  const startLine = options.startLine;
  const endLine = Math.min(options.endLine ?? startLine, lines.length);
  if (endLine < startLine) {
    throw new Error(`Repository read range endLine must be >= startLine for ${file.path}`);
  }
  const content = lines.slice(startLine - 1, endLine).join("\n");
  return { path: file.path, startLine, endLine, content, sizeBytes: Buffer.byteLength(content, "utf8") };
}

export async function searchRepositoryText(
  options: RepositoryToolOptions & { query: string; maxResults?: number; maxSearchFiles?: number; maxFileSizeBytes?: number },
): Promise<RepoSearchTextOutput> {
  const files = await listRepositoryFiles({
    root: options.root,
    deniedGlobs: options.deniedGlobs,
    directory: ".",
    maxListFiles: options.maxSearchFiles ?? defaultRepoToolLimits.maxSearchFiles,
  });
  const terms = searchTerms(options.query);
  const maxResults = options.maxResults ?? 20;
  const matches: Array<RepoSearchTextOutput["matches"][number] & { score: number }> = [];
  for (const file of files.files) {
    let content: string;
    try {
      content = (await readRepositoryFile({
        root: options.root,
        deniedGlobs: options.deniedGlobs,
        maxFileSizeBytes: options.maxFileSizeBytes,
        path: file.path,
      })).content;
    } catch {
      continue;
    }
    if (content.includes("\0")) {
      continue;
    }
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const normalized = line.toLowerCase();
      const score = terms.filter((term) => normalized.includes(term)).length;
      if (score > 0) {
        matches.push({ path: file.path, line: index + 1, text: line, score });
      }
    });
  }
  return {
    matches: matches
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
      .slice(0, maxResults)
      .map(({ score: _score, ...match }) => match),
  };
}

export function workflowCapabilityDecision(capabilityNames: readonly string[]): "allow" | "deny" | undefined {
  if (capabilityNames.some((name) => name !== repoReadCapability.name)) {
    return "deny";
  }
  return capabilityNames.includes(repoReadCapability.name) ? "allow" : undefined;
}

export function hasMutableHarnessCapability(capabilityName: string): boolean {
  return capabilityName === repoWriteCapability.name || capabilityName === networkAccessCapability.name || capabilityName === shellAccessCapability.name;
}

function resolveRepositoryPath(root: string, requestedPath: string, deniedGlobs: readonly string[]): { repoPath: string; resolvedPath: string } {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new Error("Repository path is required.");
  }
  if (isAbsolute(trimmed)) {
    throw new Error(`Repository absolute paths are denied: ${trimmed}`);
  }
  const resolvedPath = resolve(root, trimmed);
  const relativePath = relative(root, resolvedPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Repository path escapes root: ${trimmed}`);
  }
  const repoPath = relativePath ? relativePath.split(sep).join("/") : ".";
  if (matchesDeniedGlob(repoPath, deniedGlobs)) {
    throw new Error(`Repository path denied by glob: ${repoPath}`);
  }
  return { repoPath, resolvedPath };
}

async function collectRepositoryFiles(
  root: string,
  directory: string,
  deniedGlobs: readonly string[],
  maxListFiles: number,
  files: RepoListFilesOutput["files"],
): Promise<void> {
  if (files.length >= maxListFiles) {
    return;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= maxListFiles) {
      return;
    }
    const resolvedEntry = resolve(directory, entry.name);
    const repoPath = relative(root, resolvedEntry).split(sep).join("/");
    if (matchesDeniedGlob(entry.isDirectory() ? `${repoPath}/` : repoPath, deniedGlobs)) {
      continue;
    }
    const entryStat = await lstat(resolvedEntry);
    if (entryStat.isSymbolicLink()) {
      continue;
    }
    if (entryStat.isDirectory()) {
      await collectRepositoryFiles(root, resolvedEntry, deniedGlobs, maxListFiles, files);
      continue;
    }
    if (entryStat.isFile()) {
      files.push({ path: repoPath, sizeBytes: entryStat.size });
    }
  }
}

function matchesDeniedGlob(repoPath: string, deniedGlobs: readonly string[]): boolean {
  const normalized = repoPath.replace(/^\.\//, "");
  return deniedGlobs.some((glob) => {
    if (glob === normalized) {
      return true;
    }
    if (glob.endsWith("/**")) {
      const prefix = glob.slice(0, -3).replace(/^\*\*\//, "");
      return normalized === prefix || normalized.startsWith(`${prefix}/`) || normalized.includes(`/${prefix}/`);
    }
    if (glob.startsWith("**/") && glob.endsWith("*")) {
      const prefix = glob.slice(3, -1);
      return normalized.split("/").some((part) => part.startsWith(prefix));
    }
    return false;
  });
}

function searchTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 5);
  return terms.length > 0 ? terms : [query.toLowerCase()];
}

function stripJsonCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? text;
}

function runOpenCodeCli(
  binary: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; maxBufferBytes: number; signal: AbortSignal },
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binary, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`OpenCode CLI timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
    const abort = () => {
      child.kill("SIGTERM");
      reject(new Error("OpenCode CLI aborted."));
    };
    const reject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      rejectPromise(error);
    };
    const resolve = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      resolvePromise(value);
    };
    options.signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > options.maxBufferBytes) {
        child.kill("SIGTERM");
        reject(new Error(`OpenCode CLI exceeded event stream buffer=${options.maxBufferBytes}.`));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`OpenCode CLI failed. code=${code ?? "null"} signal=${signal ?? "null"}${stderr.trim() ? ` stderr=${stderr.trim().slice(0, 1_000)}` : ""}`));
    });
  });
}
