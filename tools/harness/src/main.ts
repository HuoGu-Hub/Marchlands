import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadContent, readJsonFile } from "@marchlands/content/node";
import { validateContent } from "@marchlands/content";
import type { Ruleset } from "@marchlands/sim";
import { replayMatch, runMatch } from "./match";
import type { Replay } from "./match";

function readArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const matches = Number(readArg("matches", "100"));
const seedStart = Number(readArg("seed", "1"));
const outDir = resolve(readArg("out", "out"));
const mapArg = readArg("map", "");
const rulesArg = readArg("rules", "");

const loaded = mapArg
  ? validateContent(readJsonFile(resolve(mapArg)), readJsonFile(resolve(rulesArg || "packages/content/rules/1.json")))
  : loadContent();
const map = loaded.map;
const rules: Ruleset = loaded.rules;
const mapHash = createHash("sha256").update(JSON.stringify(map)).digest("hex");

mkdirSync(outDir, { recursive: true });

let winsOne = 0;
let winsTwo = 0;
let draws = 0;
let totalTicks = 0;
let totalRejected = 0;
let firstReplay: Replay | null = null;

for (let index = 0; index < matches; index += 1) {
  const seed = seedStart + index;
  const { state, replay } = runMatch(map, rules, seed);
  if (state.winner === 1) winsOne += 1;
  else if (state.winner === 2) winsTwo += 1;
  else draws += 1;
  totalTicks += state.tick;
  totalRejected += replay.result.rejected;
  if (!firstReplay) firstReplay = replay;
  console.log(
    `#${String(index + 1).padStart(3, "0")} seed=${seed} winner=${state.winner} reason=${state.finishReason} tick=${state.tick} hash=${replay.result.finalHash}`,
  );
}

if (firstReplay) {
  const replayPath = resolve(outDir, `forest01-${firstReplay.seed}.json`);
  writeFileSync(replayPath, `${JSON.stringify({ ...firstReplay, mapHash }, null, 2)}\n`, "utf8");
  const replayed = replayMatch(map, rules, firstReplay);
  console.log(`replay ${replayPath} hash=${createHash("sha256").update(JSON.stringify(replayed)).digest("hex").slice(0, 12)}`);
}

console.log(
  `summary matches=${matches} wins1=${winsOne} wins2=${winsTwo} draws=${draws} avgTick=${Math.round(totalTicks / matches)} rejected=${totalRejected} mapHash=${mapHash.slice(0, 12)}`,
);
