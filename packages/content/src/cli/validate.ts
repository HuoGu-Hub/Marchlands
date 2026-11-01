import { loadContent } from "../node";

const { map, rules } = loadContent();
const neutral = map.cities.filter((city) => city.owner === 0).length;
const towns = map.cities.filter((city) => city.kind === "town").length;
const granaries = map.cities.filter((city) => city.kind === "granary").length;
const outposts = map.cities.filter((city) => city.kind === "outpost").length;
console.log(
  `OK ${map.slug}: sites=${map.cities.length} towns=${towns} granaries=${granaries} outposts=${outposts} edges=${map.edges.length} neutral=${neutral} players=${map.players.length} ruleset=${rules.ruleset} maxTicks=${rules.maxTicks}`,
);
