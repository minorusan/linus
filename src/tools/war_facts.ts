import { readFileSync } from "node:fs";

const DATASET = new URL("../../dataset/", import.meta.url);

// How many single-character edits a prompt word may be away from a tag
// and still count as a hit. 0 is exact match. 1 catches typos and plural
// endings. 2 is already noise: "dam" is two edits from "duma", "gas",
// "war" and "law".
const MAX_DISTANCE = 1;

// How many documents are fed to the model.
const TOP_K = 5;

type Doc = { id: string; title: string; body: string; url: string };

// The index, version one: a hand-made map from a single-word tag to the
// documents it applies to. Built once, outside the agent. 540 tags for
// 196 documents, 3 to 8 tags per document.
const tags: Record<string, string[]> = JSON.parse(
  readFileSync(new URL("tags.json", DATASET), "utf8"),
);

const doc = (id: string): Doc =>
  JSON.parse(readFileSync(new URL(`docs/${id}.json`, DATASET), "utf8"));

// Levenshtein distance: the smallest number of single-character inserts,
// deletes or replacements that turns a into b.
//
//   did -> aid        1  (replace d with a)
//   how -> hrw        1  (replace o with r)
//   dam -> duma       2  (replace a with u, insert a)
//   breach -> dam     6  (no threshold reaches a synonym)
//
// d[i][j] is the distance between the first i characters of a and the
// first j characters of b. Each cell comes from its three neighbours:
// delete one from a (up), insert one into a (left), or replace or keep
// the current character (diagonal). The answer is the bottom-right cell.
//
// It compares characters, not meaning. Short words are the problem: a
// three-letter word is within distance 1 of every three-letter tag that
// shares two characters with it. Long words have no neighbours.
function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length][b.length];
}

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

// Retrieval, version two: every word of the prompt against every tag.
//
// A document scores one point per distinct prompt word that reached one
// of its tags. Ranking by points is what saves distance 1: "kakhovka"
// and "dam" both reach the dam documents (2 points), while "did" reaching
// "aid" gives sixteen aid documents 1 point each, so they come last.
//
// Deterministic, instant, testable. Blind to synonyms, paraphrase and any
// language the tags are not written in.
export const handler = ({ query }: { query: string }) => {
  const words = query.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);

  const points = new Map<string, number>();
  for (const word of words) {
    for (const tag of Object.keys(tags)) {
      if (levenshtein(word, tag) > MAX_DISTANCE) continue;
      console.log(`  ~~ ${word} -> ${tag} (${tags[tag].length} docs)`);
      for (const id of tags[tag]) points.set(id, (points.get(id) ?? 0) + 1);
    }
  }

  const picked = [...points].sort((a, b) => b[1] - a[1]).slice(0, TOP_K);
  if (picked.length === 0) return `no tags match: ${words.join(" ")}`;

  for (const [id, n] of picked) console.log(`  ~~ ${n} ${id}`);

  // Still whole documents, same as grep. Only the selection changed.
  return picked
    .map(([id]) => doc(id))
    .map((d) => `# ${d.title}\n${d.url}\n${d.body}`)
    .join("\n\n");
};
