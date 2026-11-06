import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toGridMap } from "./grid-map";
import { withMageSites } from "./mage-sites";

/** frontier01 没有生成器，就地补法师塔；重复执行不会叠加。 */
const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, "../../../packages/content/maps/frontier01.json");
const map = JSON.parse(readFileSync(file, "utf8"));
const next = map.navigation === "grid" ? map : toGridMap(withMageSites(map), { stables: 2 });
writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
console.log("wrote " + file);
