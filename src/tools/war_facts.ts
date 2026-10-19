import { readFileSync } from "node:fs";
import { ask, prompt } from "../llm.ts";
import { embed, cosine } from "../embed.ts";

const DATASET = new URL("../../dataset/", import.meta.url);

// How many domains the router may pick. More means a wider slice and
// fewer misses; fewer means a sharper slice and a higher chance that the
// right chunk is not in it at all.
const TOP_DOMAINS = 3;

// How many chunks are fed to the model.
const TOP_K = 5;

type Chunk = { id: string; question: string; answer: string; doc: string; url: string; vector: number[] };

// The corpus grows here. Four more conflicts join Russia and Ukraine:
// Gaza from October 2023, the Russo-Georgian war of 2008, Nagorno-Karabakh
// and Israel with Hezbollah, Iran and the Houthis. 196 documents become
// 346, and the questions and chunks were regenerated for all of them:
// 1730 questions, 1716 chunks. Cosine over all of them is still instant.
// What changes is that the corpus now has neighbourhoods a question can
// land in by mistake.
//
// The index, version four: the chunks, plus a map from a domain to the
// chunks that belong to it. Thirteen domains: five actors
// (ukraine, russia, usa, israel, georgia) and eight topics (civilians,
// terrorism, hostages, diplomacy, weapons, military, politics, economy).
// A chunk usually has two or three.
//
// Labelled once by demos/rag/domains.ts: a big model reads ten chunks at
// a time with the domain definitions and names the domains for each.
// Every label is checked against the list before it is kept.
const chunks: Chunk[] = JSON.parse(readFileSync(new URL("chunks.json", DATASET), "utf8"));
const domains: Record<string, string[]> = JSON.parse(readFileSync(new URL("domains.json", DATASET), "utf8"));
const byId = new Map(chunks.map((c) => [c.id, c]));

export const schema = {
  type: "function",
  function: {
    name: "war_facts",
    description:
      "This is a corpus of common war knowledge. You are necessitated to use this tool for any war/casualties/related question. Do not answer from memory.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

// Retrieval, version five: route, then search.
//
// Step one asks the model which domains the question belongs to. Thirteen
// names fit in one small call, and format: "json" means the reply always
// parses. The names it returns are filtered against the map, so a domain
// the model invents cannot select anything. That is the deterministic
// wrapper around a semantic step.
//
// Step two is the cosine search from before, run only inside the chosen
// slice. Over 1716 chunks the search itself is under a millisecond, so
// this buys no speed here. What it buys is scope: the search never sees
// chunks from the wrong conflict, and at a million chunks the slice is
// what makes the search possible at all. The cost is a model call per
// turn and a hard failure mode: wrong domains, zero recall.
export const handler = async ({ query }: { query: string }) => {
  const reply = await ask(
    [{ role: "user", content: prompt("pick_domains")
        .replace("{count}", String(TOP_DOMAINS))
        .replace("{domains}", Object.keys(domains).join(", "))
        .replace("{question}", query) }],
    { format: "json" },
  );

  let picked: string[] = [];
  try {
    picked = (JSON.parse(reply.content).domains ?? []).filter((d: string) => d in domains).slice(0, TOP_DOMAINS);
  } catch {}

  // The slice: the union of the chosen domains' chunks.
  const ids = new Set(picked.flatMap((d) => domains[d]));
  const slice = [...ids].map((id) => byId.get(id)!);
  console.log(`  ~~ domains: ${picked.join(", ") || "(none)"} -> ${slice.length}/${chunks.length} chunks`);
  if (slice.length === 0) return `no domain matched: ${query}`;

  const [v] = await embed([`search_query: ${query}`]);

  const ranked = slice
    .map((c) => ({ ...c, score: cosine(v, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  for (const r of ranked) {
    console.log(`  ~~ ${r.score.toFixed(3)} ${r.question}  [${r.doc}]`);
  }

  return ranked
    .map((r) => `${r.answer}\n(source: ${r.doc}, ${r.url})`)
    .join("\n\n");
};
