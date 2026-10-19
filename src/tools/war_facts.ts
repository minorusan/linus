import { readFileSync } from "node:fs";
import { embed, cosine } from "../embed.ts";

const DATASET = new URL("../../dataset/", import.meta.url);

// How many questions survive the ranking. The documents behind them then
// vote, and one document is fed to the model.
const TOP_K = 5;

// The index, version two: questions a document can answer, each with the
// id of its document and a 768-number vector of its meaning.
//
// Built once, offline, by demos/rag/doc2query.ts: a big model reads each
// document and writes five questions it answers, each naming its event,
// place or person so it stands on its own. Then every question is
// embedded with nomic-embed-text and the vector is stored next to it.
// 196 documents, 980 questions, about 6 MB of JSON.
//
// Nothing here is per turn. The expensive model ran when nobody was
// waiting. At query time the only model call is one embedding.
type Question = { question: string; doc: string; vector: number[] };
type Doc = { id: string; title: string; body: string; url: string };

const questions: Question[] = JSON.parse(
  readFileSync(new URL("questions.json", DATASET), "utf8"),
);

const doc = (id: string): Doc =>
  JSON.parse(readFileSync(new URL(`docs/${id}.json`, DATASET), "utf8"));

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

// Retrieval, version three: compare meaning, not characters.
//
// The prompt becomes a vector with the same model that embedded the
// questions. Cosine between two vectors is the angle between them: 1 is
// the same direction, 0 is nothing in common. nomic's scores sit between
// 0.4 (unrelated) and 0.85 (near paraphrase), so top-K is a sort, never a
// threshold.
//
// "search_query:" and "search_document:" are prefixes nomic was trained
// with. They tell it which side of the comparison a text is on.
export const handler = async ({ query }: { query: string }) => {
  const [v] = await embed([`search_query: ${query}`]);

  const ranked = questions
    .map((q) => ({ ...q, score: cosine(v, q.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  for (const r of ranked) {
    console.log(`  ~~ ${r.score.toFixed(3)} ${r.question}  [${r.doc}]`);
  }

  // Top-K questions, not top-K documents. Several hits usually point at
  // the same document, and a question about a neighbouring event can tie
  // for first place. Counting votes per document is deterministic and
  // settles the tie. It can also lose: one strong hit against two weak
  // hits from another document. The next version removes the vote.
  // Count how many of the five questions belong to each document.
  const votes = new Map<string, number>();
  for (const r of ranked) {
    const current = votes.get(r.doc) ?? 0;
    votes.set(r.doc, current + 1);
  }

  // The document with the most votes wins. On a tie the one that appeared
  // first in the ranking keeps the lead, because only a strictly higher
  // count replaces it.
  let winner = ranked[0].doc;
  let count = 0;
  for (const [id, n] of votes) {
    if (n > count) {
      winner = id;
      count = n;
    }
  }
  console.log(`  ~~ ${count}/${TOP_K} votes -> ${winner}`);

  // Still a whole document. The model gets 300 words to answer a question
  // one sentence answers.
  const d = doc(winner);
  return `# ${d.title}\n${d.url}\n${d.body}`;
};
