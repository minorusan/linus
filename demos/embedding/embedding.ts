// An embedding turns a piece of text into a list of numbers, so that texts
// with similar meaning end up with similar numbers. The list is called a
// vector. nomic-embed-text produces 768 numbers for any text, in any
// language, and the numbers mean nothing on their own: only the comparison
// between two vectors means something.
//
// Run: node embedding.ts   (needs local Ollama with nomic-embed-text)

const OLLAMA = "http://127.0.0.1:11434";
const MODEL = "nomic-embed-text";

// One call to the embedding model: a list of texts in, one vector per text
// out. The prefix tells nomic which side of a comparison the text is on:
// "search_document" for stored text, "search_query" for a question about it.
async function embed(texts: string[], prefix: string): Promise<number[][]> {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      input: texts.map((t) => `${prefix}: ${t}`),
    }),
  });
  return (await res.json()).embeddings;
}

// Step 1. The corpus: sentences we know in advance. In a real system these
// are documents, tool descriptions, questions, anything stored. They are
// embedded once and the vectors are kept.
const CORPUS = [
  "Read a file from disk and return its contents.",
  "Get the current weather for a city.",
  "How was the Kakhovka dam destroyed?",
];

const corpusVectors = await embed(CORPUS, "search_document");

console.log(`"${CORPUS[0]}"`);
console.log(`-> ${corpusVectors[0].length} numbers, the first eight:`);
console.log(
  "  ",
  corpusVectors[0]
    .slice(0, 8)
    .map((x) => x.toFixed(3))
    .join("  "),
  "...\n",
);

// Step 2. Two sentences standing in for what a user types. Neither shares a
// word with the corpus sentence it is about, which is the point. In a real
// system this happens on every prompt.
const PROMPTS = [
  "what happened to the hydroelectric station in Kherson?",
  "book me a flight to Lisbon",
];

const promptVectors = await embed(PROMPTS, "search_query");

// Step 3. Cosine similarity: the angle between two vectors, ignoring their
// length. 1 means the same direction, 0 means nothing in common. It is the
// dot product divided by the product of the lengths.
function cosine(a: number[], b: number[]): number {
  let dot = 0,
    lenA = 0,
    lenB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    lenA += a[i] * a[i];
    lenB += b[i] * b[i];
  }
  return dot / (Math.sqrt(lenA) * Math.sqrt(lenB));
}

// Below this cosine the best corpus sentence is not a match at all.
// nomic puts unrelated sentences around 0.3 to 0.45, so 0.5 separates them.
const MATCH = 0.5;

// Each prompt vector against every corpus vector. The highest cosine is the
// match, if it clears the bar. No word in common was needed.
for (const [p, prompt] of PROMPTS.entries()) {
  console.log(`prompt: "${prompt}"`);

  let best = { index: -1, score: -1 };
  for (const [c, sentence] of CORPUS.entries()) {
    const score = cosine(promptVectors[p], corpusVectors[c]);
    console.log(`  ${score.toFixed(3)}  ${sentence}`);
    if (score > best.score) best = { index: c, score };
  }

  if (best.score >= MATCH) {
    let result = CORPUS[best.index];
    console.log(`  matched: "${result}"\n`);
  } else {
    console.log(
      `  no match (best ${best.score.toFixed(3)} is below ${MATCH})\n`,
    );
  }
}
