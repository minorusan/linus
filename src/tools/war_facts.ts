import { readFileSync } from "node:fs";
import { embed, cosine } from "../embed.ts";

const DATASET = new URL("../../dataset/", import.meta.url);

// How many chunks are fed to the model. All of them, no vote.
const TOP_K = 5;

// The index, version three: chunks.
//
// A chunk is a question (the key), the sentence from the document that
// answers it, copied verbatim (the value), and the document id and link
// (the citation). Built once by demos/rag/chunk.ts: a big model is given
// a document and its questions and asked to copy the answering passage
// character for character. The script keeps a chunk only if the passage
// really occurs in the body, so an invented answer cannot get in.
// 977 chunks from 980 questions; 3 had no verbatim answer.
//
// The question is what gets embedded. The prompt is a question too, so
// both sides of the cosine have the same shape, which is why the scores
// are higher here than question-against-description would be.
type Chunk = { id: string; question: string; answer: string; doc: string; url: string; vector: number[] };

const chunks: Chunk[] = JSON.parse(
  readFileSync(new URL("chunks.json", DATASET), "utf8"),
);

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

// Retrieval, version four: same embedding and cosine as before, but what
// comes back is five quoted sentences with their sources, about 1 KB,
// instead of a 1.5 KB document chosen by vote or 64 KB of grep matches.
// Facts from three documents can arrive together, and every line the
// model is given can be traced to a sentence and a URL.
export const handler = async ({ query }: { query: string }) => {
  const [v] = await embed([`search_query: ${query}`]);

  const ranked = chunks
    .map((c) => ({ ...c, score: cosine(v, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  for (const r of ranked) {
    console.log(`  ~~ ${r.score.toFixed(3)} ${r.question}  [${r.doc}]`);
  }

  // The citation travels with the text. Retrieval fixes what the model
  // sees, not what it does with it, so the source has to be in the prompt
  // for anyone to check the answer.
  return ranked
    .map((r) => `${r.answer}\n(source: ${r.doc}, ${r.url})`)
    .join("\n\n");
};
