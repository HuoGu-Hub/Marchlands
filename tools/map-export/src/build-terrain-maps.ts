import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TERRAIN_MAP_RECIPES, buildTerrainMap } from "./terrain-maps";

const here = dirname(fileURLToPath(import.meta.url));
for (const recipe of TERRAIN_MAP_RECIPES) {
  const out = resolve(here, "../../../packages/content/maps/" + recipe.slug + ".json");
  mkdirSync(dirname(out), { recursive: true });
  const map = buildTerrainMap(recipe);
  writeFileSync(out, JSON.stringify(map, null, 2) + "\n", "utf8");
  console.log("wrote " + out + " sites=" + map.cities.length + " edges=" + map.edges.length);
}
