import { resolve } from "node:path";
import { loadContent, readJsonFile } from "@marchlands/content/node";
import { validateContent } from "@marchlands/content";

const mapArg = process.argv[2];
const { map, rules } = mapArg
  ? validateContent(readJsonFile(resolve(mapArg)), readJsonFile(resolve("packages/content/rules/1.json")))
  : loadContent();

const neutral = map.cities.filter((city) => city.owner === 0).length;
console.log(
  `OK ${map.slug}: cities=${map.cities.length} edges=${map.edges.length} neutral=${neutral} players=${map.players.length} maxTicks=${rules.maxTicks}`,
);
