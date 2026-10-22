import { writeFileSync } from "node:fs";
import { ask, json, pool, prompt, MODEL, HOST } from "./llm.ts";
import { docs, DATASET } from "./dataset.ts";
import { embed, EMBED_MODEL } from "./embed.ts";

const QUESTIONS = 5;
const CONCURRENCY = 4;
const OUT = new URL("questions.json", DATASET);

type Entry = { question: string; doc: string; vector: number[] };

const all = docs();
console.log(`${all.length} docs -> ${QUESTIONS} questions each via ${MODEL} @ ${HOST}`);

const started = Date.now();
const failed: string[] = [];

const perDoc = await pool(all, CONCURRENCY, async (doc, i) => {
  const text = prompt("doc2query")
    .replace("{count}", String(QUESTIONS))
    .replace("{title}", doc.title)
    .replace("{body}", doc.body);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const reply = await ask([{ role: "user", content: text }]);
      const questions = json<{ questions: string[] }>(reply).questions
        .filter((q) => typeof q === "string" && q.trim().endsWith("?"))
        .slice(0, QUESTIONS);
      if (questions.length === 0) throw new Error("no questions");
      console.log(`  ${String(i + 1).padStart(3)}/${all.length} ${doc.id} (${questions.length})`);
      return questions.map((question) => ({ question: question.trim(), doc: doc.id, vector: [] as number[] }));
    } catch (err: any) {
      if (attempt === 2) {
        console.log(`  !! ${doc.id}: ${err.message}`);
        failed.push(doc.id);
      }
    }
  }
  return [] as Entry[];
});

const entries = perDoc.flat();

console.log(`embedding ${entries.length} questions with ${EMBED_MODEL}`);
const vectors = await embed(entries.map((e) => `search_document: ${e.question}`));
entries.forEach((e, i) => (e.vector = vectors[i]));

writeFileSync(OUT, JSON.stringify(entries) + "\n");

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`wrote ${entries.length} questions for ${all.length - failed.length} docs in ${seconds}s`);
if (failed.length) console.log(`failed: ${failed.join(", ")}`);
