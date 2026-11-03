import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContent, readJsonFile } from "@marchlands/content/node";
import { validateContent } from "@marchlands/content";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const mapArg = process.argv[2];
const { map, rules } = mapArg
  ? validateContent(readJsonFile(resolve(mapArg)), readJsonFile(resolve(root, "packages/content/rules/1.json")))
  : loadContent();

const neutral = map.cities.filter((city) => city.owner === 0).length;
const towns = map.cities.filter((city) => city.kind === "barracks").length;
const granaries = map.cities.filter((city) => city.kind === "granary").length;
const outposts = map.cities.filter((city) => city.kind === "outpost").length;
console.log(
  `OK ${map.slug}: sites=${map.cities.length} towns=${towns} granaries=${granaries} outposts=${outposts} edges=${map.edges.length} neutral=${neutral} players=${map.players.length} maxTicks=${rules.maxTicks}`,
);
