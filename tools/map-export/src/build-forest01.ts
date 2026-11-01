import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildForest01 } from "./forest01";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../packages/content/maps/forest01.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(buildForest01(), null, 2)}\n`, "utf8");
console.log(`wrote ${out}`);
