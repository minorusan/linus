import { readFileSync } from "node:fs";

export const OLLAMA = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
export const MODEL = process.env.AGENT_MODEL ?? "granite4:tiny-h";

export type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, any> } }[];
  tool_name?: string;
};

export const prompt = (name: string) =>
  readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8").trim();

export async function ask(
  messages: Msg[],
  extra: Record<string, any> = {},
): Promise<Msg> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      keep_alive: -1,
      options: { num_ctx: 8192, temperature: 0.2 },
      ...extra,
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.message;
}
