import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The corpus: one JSON file per document, { id, title, body, url }.
// Nothing else exists yet. No index, no map, no vectors.
const DOCS = fileURLToPath(new URL("../../dataset/docs/", import.meta.url));

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

// Retrieval, version one: grep.
//
// The whole query is one literal string (-F), case-insensitive (-i), and
// every file that contains it is returned whole (-l lists the files).
// There is no ranking and no cap, so the result is either nothing or
// everything that happens to contain those exact characters.
//
// Three things go wrong, in order of how often you will see them:
//   - a full sentence matches nothing, and the model answers anyway;
//   - a short word matches a lot ("dam" is inside "damage"), and the
//     documents overflow the context window, cutting off the question;
//   - a common word ("Russia") matches almost the whole corpus.
export const handler = ({ query }: { query: string }) => {
  let files: string[];
  try {
    files = execFileSync("grep", ["-rliF", query, DOCS], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    // grep exits non-zero when nothing matches. The model sees this text
    // as the tool result, so it is a prompt too.
    return `no documents match: ${query}`;
  }

  return files
    .map((f) => JSON.parse(readFileSync(f, "utf8")))
    .map((d) => `# ${d.title}\n${d.url}\n${d.body}`)
    .join("\n\n");
};
