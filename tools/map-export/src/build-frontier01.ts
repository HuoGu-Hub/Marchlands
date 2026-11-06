import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reroadMap, toGridMap } from "./grid-map";
import { withMageSites } from "./mage-sites";

/** frontier01 没有生成器，就地补法师塔；重复执行不会叠加。 */
const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, "../../../packages/content/maps/frontier01.json");
const map = JSON.parse(readFileSync(file, "utf8"));
// 已经转过网格但没写地形参数的，退回据点图重转一次。
const source =
  map.navigation === "grid" && !map.terrain
    ? { ...map, navigation: undefined, grid: undefined, mapHash: undefined, schema: 1, cities: map.cities.filter((city: { kind: string }) => city.kind !== "cavalry") }
    : map;
const next = source.navigation === "grid"
  ? reroadMap(source)
  : toGridMap(withMageSites(source), { stables: 2, terrain: { seed: 20261123, amplitude: 1 } });
writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
console.log("wrote " + file);
