export const OLLAMA = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

const BATCH = 50;
const DECIMALS = 4;

export async function embed(input: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < input.length; i += BATCH) {
    const res = await fetch(`${OLLAMA}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: input.slice(i, i + BATCH), keep_alive: -1 }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    for (const v of body.embeddings) out.push(v.map((x: number) => +x.toFixed(DECIMALS)));
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
