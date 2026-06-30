import { tool } from "weave/runtime";
import { z } from "zod";

const ZenMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

const ZenChatCompletionInputSchema = z.object({
  model: z.string().min(1),
  messages: z.array(ZenMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

const ZenChatCompletionOutputSchema = z.object({
  model: z.string(),
  message: z.string().min(1),
  usage: z.unknown().optional(),
});

const ZenChatCompletionResponseSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z.object({
          message: z
            .object({
              content: z.string().nullable().optional(),
            })
            .passthrough(),
        }),
      )
      .min(1),
    usage: z.unknown().optional(),
  })
  .passthrough();

export type ZenChatCompletionInput = z.infer<typeof ZenChatCompletionInputSchema>;
export type ZenChatCompletionOutput = z.infer<typeof ZenChatCompletionOutputSchema>;

export const zenChatCompletionTool = tool({
  name: "opencode.zen.chatCompletion",
  description: "Call the OpenCode Zen OpenAI-compatible chat completions gateway.",
  input: ZenChatCompletionInputSchema,
  output: ZenChatCompletionOutputSchema,
  credentials: () => ({
    name: "opencode.zen.api_key",
    kind: "secret",
    provider: "env",
    reason: "Call the OpenCode Zen API gateway.",
  }),
  summarize(output) {
    return output.message.length > 140 ? `${output.message.slice(0, 137)}...` : output.message;
  },
  async run(ctx) {
    const input = ctx.input;
    const apiKey = ctx.credentials.value("opencode.zen.api_key");
    const response = await fetch("https://opencode.ai/zen/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature,
        max_tokens: input.maxTokens,
      }),
    });

    const body = await readJsonBody(response);
    if (!response.ok) {
      throw new Error(`OpenCode Zen request failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
    }

    const parsed = ZenChatCompletionResponseSchema.parse(body);
    const message = parsed.choices[0]?.message.content?.trim();
    if (!message) {
      throw new Error("OpenCode Zen response did not include assistant message content.");
    }

    return {
      model: parsed.model ?? input.model,
      message,
      usage: parsed.usage,
    };
  },
});

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
