import { resolve } from "node:path";
import { loadContent, readJsonFile } from "@marchlands/content/node";
import { validateContent } from "@marchlands/content";
import { DEFAULT_RULESET } from "@marchlands/sim";

const mapArg = process.argv[2];
const { map, rules } = mapArg
  ? validateContent(readJsonFile(resolve(mapArg)), DEFAULT_RULESET)
  : loadContent();

const neutral = map.cities.filter((city) => city.owner === 0).length;
const towns = map.cities.filter((city) => city.kind === "barbarian").length;
const granaries = map.cities.filter((city) => city.kind === "granary").length;
const outposts = map.cities.filter((city) => city.kind === "outpost").length;
console.log(
  `OK ${map.slug}: sites=${map.cities.length} towns=${towns} granaries=${granaries} outposts=${outposts} edges=${map.edges.length} neutral=${neutral} players=${map.players.length} maxTicks=${rules.maxTicks}`,
);
