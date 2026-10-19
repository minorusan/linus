import { readFileSync } from "node:fs";

export const HOST = process.env.CHUNK_HOST ?? "http://192.168.0.229:11434";
export const MODEL = process.env.CHUNK_MODEL ?? "gemma4:26b";

export type Msg = { role: "system" | "user" | "assistant"; content: string };

export const prompt = (name: string) =>
  readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8").trim();

export async function ask(messages: Msg[]): Promise<string> {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      keep_alive: -1,
      format: "json",
      options: { num_ctx: 8192, temperature: 0.2 },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.message.content;
}

export function json<T>(text: string): T {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(stripped);
}

export async function pool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
