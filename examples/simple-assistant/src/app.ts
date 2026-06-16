import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StaticCredentialProvider, weave } from "weave/runtime";
import { assistantAgent } from "./agent.js";

loadExampleEnv();

const opencodeApiKey = process.env.OPENCODE_API_KEY?.trim();
if (opencodeApiKey !== undefined) {
  process.env.OPENCODE_API_KEY = opencodeApiKey;
}

export const simpleAssistantApp = weave({
  name: "simple-assistant",
  agents: [assistantAgent],
  credentialProvider: new StaticCredentialProvider(
    opencodeApiKey ? { "opencode.zen.api_key": opencodeApiKey } : {},
    "env:OPENCODE_API_KEY",
  ),
});

function loadExampleEnv(): void {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  let contents: string;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = stripQuotes(trimmed.slice(equalsIndex + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
