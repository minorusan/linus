import { readFileSync, writeFileSync } from "node:fs";
import { ask, json, pool, prompt, MODEL, HOST } from "./llm.ts";
import { DATASET } from "./dataset.ts";

export const DOMAINS: Record<string, string> = {
  ukraine: "Ukraine's forces, government, territory or people",
  russia: "Russia's forces, government, territory or people",
  usa: "United States policy, aid, forces or officials",
  israel: "Israel's forces, government, territory or people",
  georgia: "Georgia's forces, government, territory or people",
  civilians: "civilian casualties, displacement, evacuations, humanitarian conditions and aid delivery",
  terrorism: "attacks on civilians by non-state armed groups, and their designation or prosecution",
  hostages: "hostage taking, captivity, releases and exchanges of hostages or prisoners",
  diplomacy: "negotiations, talks, summits, ceasefire agreements, international organisations and recognition",
  weapons: "weapon systems, deliveries, strikes with specific weapons, drones, missiles and arms control",
  military: "battles, operations, troop movements, units, combatant casualties and the timing of fighting",
  politics: "elections, protests, leadership changes, courts and legal rulings, statehood and accession",
  economy: "sanctions, price caps, trade, shipping, energy supply, finance and reconstruction cost",
};
const NAMES = Object.keys(DOMAINS);

const BATCH = 10;
const CONCURRENCY = 1;
const IN = new URL("chunks.json", DATASET);
const OUT = new URL("domains.json", DATASET);

type Chunk = { id: string; question: string; answer: string; doc: string; url: string; vector: number[]; domains?: string[] };

const chunks: Chunk[] = JSON.parse(readFileSync(IN, "utf8"));
const todo = chunks.filter((c) => !c.domains?.length);
const batches: Chunk[][] = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
console.log(`${todo.length}/${chunks.length} chunks to label in ${batches.length} batches of ${BATCH} -> ${NAMES.length} domains via ${MODEL} @ ${HOST}`);

const started = Date.now();
let unlabelled = 0;

await pool(batches, CONCURRENCY, async (batch, i) => {
  const text = prompt("domains")
    .replace("{domains}", NAMES.map((d) => `- ${d}: ${DOMAINS[d]}`).join("\n"))
    .replace("{chunks}", batch.map((c, n) => `${n + 1}. question: ${c.question}\n   answer: ${c.answer}`).join("\n"));

  const labels = new Map<string, string[]>();
  for (let attempt = 1; attempt <= 2 && labels.size < batch.length; attempt++) {
    try {
      const reply = json<{ chunks: { n: number; domains: string[] }[] }>(await ask([{ role: "user", content: text }]));
      for (const r of reply.chunks ?? []) {
        const chunk = batch[Number(r.n) - 1];
        const domains = (r.domains ?? []).filter((d) => NAMES.includes(d));
        if (chunk && domains.length) labels.set(chunk.id, [...new Set(domains)]);
      }
    } catch (err: any) {
      if (attempt === 2) console.log(`  !! batch ${i + 1}: ${err.message}`);
    }
  }

  for (const c of batch) {
    c.domains = labels.get(c.id) ?? [];
    if (c.domains.length === 0) unlabelled++;
  }
  console.log(`  ${String(i + 1).padStart(3)}/${batches.length} ${labels.size}/${batch.length}`);
});

writeFileSync(IN, JSON.stringify(chunks) + "\n");

const map: Record<string, string[]> = Object.fromEntries(NAMES.map((d) => [d, []]));
for (const c of chunks) for (const d of c.domains ?? []) map[d].push(c.id);
writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n");

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`labelled ${todo.length - unlabelled}/${todo.length} chunks in ${seconds}s, ${chunks.filter((c) => !c.domains?.length).length} without a domain overall`);
for (const d of NAMES) console.log(`  ${d.padEnd(10)} ${map[d].length}`);
