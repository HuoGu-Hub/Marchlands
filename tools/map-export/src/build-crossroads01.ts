import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCrossroads01 } from "./crossroads01";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../packages/content/maps/crossroads01.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(buildCrossroads01(), null, 2)}\n`, "utf8");
console.log(`wrote ${out}`);
