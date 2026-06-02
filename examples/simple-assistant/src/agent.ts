import { agent, event } from "weave";
import { z } from "zod";
import { zenChatCompletionTool } from "./tools.js";

const ASSISTANT_INSTRUCTIONS = `You are Assistant, an internal assistant. You receive task requests via chat.
Complete the task autonomously and return a concise summary of what you did, or the answer the user requested.

Behavior:
- Work autonomously. Never ask clarifying questions. Make your best judgment and proceed.
- After completing the task, respond with a clear, concise summary of the outcome.
- If something fails, explain what went wrong and what you tried.`;

export const assistantInput = z.object({
  prompt: z.string().min(1),
});

export const assistantAgent = agent({
  name: "assistant",
  description: "Simple model-backed assistant using OpenCode Zen and Kimi K2.6.",
  input: assistantInput,
  tools: [zenChatCompletionTool],
  async run(ctx, input) {
    const completion = await ctx.tool("zen-chat-completion", zenChatCompletionTool, {
      model: "kimi-k2.6",
      messages: [
        { role: "system" as const, content: ASSISTANT_INSTRUCTIONS },
        { role: "user" as const, content: input.prompt },
      ],
      temperature: 0.2,
    });

    await ctx.emit(
      "final-response",
      event("agent.response.produced", {
        message: completion.message,
      }),
    );

    return completion;
  },
});
