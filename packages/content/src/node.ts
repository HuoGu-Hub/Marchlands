import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RULESET } from "@marchlands/sim";
import type { MapDef, Ruleset } from "@marchlands/sim";
import { validateContent } from "./validate";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadContent(
  mapFile = "maps/forest01.json",
  rulesFile?: string,
): { map: MapDef; rules: Ruleset } {
  const rules = rulesFile ? readJsonFile(join(packageRoot, rulesFile)) : DEFAULT_RULESET;
  return validateContent(readJsonFile(join(packageRoot, mapFile)), rules);
}
