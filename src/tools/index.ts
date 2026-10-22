import * as read_file from "./read_file.ts";
import * as write_file from "./write_file.ts";
import * as bash from "./bash.ts";
import * as weather from "./weather.ts";
import * as web_search from "./web_search.ts";
import * as war_facts from "./war_facts.ts";

import { noops } from "./noops.ts";
const all = [
  read_file,
  write_file,
  bash,
  weather,
  web_search,
  war_facts,
  ...noops,
];

export const tools = all.map((t) => t.schema);

export const handlers: Record<string, (args: any) => string | Promise<string>> =
  Object.fromEntries(all.map((t) => [t.schema.function.name, t.handler]));
