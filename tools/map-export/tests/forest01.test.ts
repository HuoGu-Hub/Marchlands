import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildForest01 } from "../src/forest01";

describe("forest01 generator", () => {
  it("matches the committed map json", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, "../../../packages/content/maps/forest01.json");
    const committed = JSON.parse(readFileSync(file, "utf8"));
    expect(buildForest01()).toEqual(committed);
  });
});
