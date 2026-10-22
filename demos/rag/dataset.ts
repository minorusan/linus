import { readdirSync, readFileSync } from "node:fs";

export const DATASET = new URL("../../dataset/", import.meta.url);

export type Doc = { id: string; title: string; body: string; url: string };

export function docs(): Doc[] {
  const dir = new URL("docs/", DATASET);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
}
