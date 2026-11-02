import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCrossroads01 } from "../src/crossroads01";

describe("crossroads01 generator", () => {
  it("matches the committed map json", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, "../../../packages/content/maps/crossroads01.json");
    const committed = JSON.parse(readFileSync(file, "utf8"));
    expect(buildCrossroads01()).toEqual(committed);
  });
});
