import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ask, json, pool, prompt, MODEL, HOST } from "./llm.ts";
import { docs, DATASET } from "./dataset.ts";
import { embed, EMBED_MODEL } from "./embed.ts";

const CONCURRENCY = 4;
const IN = new URL("questions.json", DATASET);
const OUT = new URL("chunks.json", DATASET);

type Question = { question: string; doc: string };
type Chunk = { id: string; question: string; answer: string; doc: string; url: string; vector: number[] };

const normalise = (s: string) => s.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

const questions: Question[] = JSON.parse(readFileSync(IN, "utf8"));
const byDoc = new Map<string, string[]>();
for (const q of questions) (byDoc.get(q.doc) ?? byDoc.set(q.doc, []).get(q.doc)!).push(q.question);

const all = docs().filter((d) => byDoc.has(d.id));
console.log(`${questions.length} questions over ${all.length} docs -> verbatim answers via ${MODEL} @ ${HOST}`);

const started = Date.now();
let dropped = 0;

const perDoc = await pool(all, CONCURRENCY, async (doc, i) => {
  const asked = byDoc.get(doc.id)!;
  const text = prompt("answer")
    .replace("{title}", doc.title)
    .replace("{body}", doc.body)
    .replace("{questions}", asked.map((q, n) => `${n + 1}. ${q}`).join("\n"));

  const body = normalise(doc.body);
  let best: Chunk[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const reply = await ask([{ role: "user", content: text }]);
      const answers = json<{ answers: string[] }>(reply).answers ?? [];
      const chunks: Chunk[] = [];
      asked.forEach((question, n) => {
        const answer = normalise(String(answers[n] ?? ""));
        if (answer && body.includes(answer)) {
          chunks.push({ id: randomUUID(), question, answer, doc: doc.id, url: doc.url, vector: [] });
        }
      });
      if (chunks.length > best.length) best = chunks;
      if (best.length === asked.length) break;
    } catch (err: any) {
      if (attempt === 2) console.log(`  !! ${doc.id}: ${err.message}`);
    }
  }

  dropped += asked.length - best.length;
  console.log(`  ${String(i + 1).padStart(3)}/${all.length} ${doc.id} ${best.length}/${asked.length}`);
  return best;
});

const chunks = perDoc.flat();

console.log(`embedding ${chunks.length} chunks with ${EMBED_MODEL}`);
const vectors = await embed(chunks.map((c) => `search_document: ${c.question}`));
chunks.forEach((c, i) => (c.vector = vectors[i]));

writeFileSync(OUT, JSON.stringify(chunks) + "\n");

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`wrote ${chunks.length} chunks, dropped ${dropped} questions without a verbatim answer, in ${seconds}s`);
