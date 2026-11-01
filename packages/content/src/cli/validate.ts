import { loadContent } from "../node";

const { map, rules } = loadContent();
const neutral = map.cities.filter((city) => city.owner === 0).length;
console.log(
  `OK ${map.slug}: cities=${map.cities.length} edges=${map.edges.length} neutral=${neutral} players=${map.players.length} ruleset=${rules.ruleset} maxTicks=${rules.maxTicks}`,
);
