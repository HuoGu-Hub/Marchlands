import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MapDef, Ruleset } from "@marchlands/sim";
import { validateContent } from "./validate";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadContent(
  mapFile = "maps/forest01.json",
  rulesFile = "rules/1.json",
): { map: MapDef; rules: Ruleset } {
  return validateContent(readJsonFile(join(packageRoot, mapFile)), readJsonFile(join(packageRoot, rulesFile)));
}
