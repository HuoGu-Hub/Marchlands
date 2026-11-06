import "./style.css";
import { App } from "./app";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app");

// 开发场景只存在于 dev server：生产包只保留正式游戏入口。
const params = new URLSearchParams(window.location.search);
const scene = import.meta.env.DEV ? params.get("scene") : null;
const previewMap = params.get("map");

if (scene === "map-preview" && previewMap) {
  void import("./game/map-preview").then((module) => module.runMapPreview(host, previewMap));
} else if (scene === "unit-portrait") {
  const skin = params.get("skin");
  if (skin) void import("./game/unit-portrait").then((module) => module.runUnitPortrait(host, skin));
} else if (scene === "height") {
  void import("./game/height-test").then((module) => module.runHeightTest(host));
} else if (scene === "lab") {
  void import("./game/asset-lab").then((module) => module.runAssetLab(host));
} else if (scene === "pieces") {
  void import("./game/piece-viewer").then((module) => module.runPieceViewer(host));
} else if (scene === "buildings") {
  void import("./game/building-gallery").then((module) => module.runBuildingGallery(host));
} else if (scene === "towns") {
  void import("./game/town-showcase").then((module) => module.runTownShowcase(host));
} else if (scene === "switch") {
  void import("./game/switch-demo").then((module) => module.runSwitchDemo(host));
} else if (scene === "roads") {
  void import("./game/road-showcase").then((module) => module.runRoadShowcase(host));
} else if (scene === "units") {
  void import("./game/unit-gallery").then((module) => module.runUnitGallery(host));
} else if (scene === "fx") {
  void import("./game/fx-preview").then((module) => module.runFxPreview(host));
} else if (scene === "cavalry") {
  void import("./game/cavalry-preview").then((module) => module.runCavalryPreview(host));
} else if (scene === "glb") {
  void import("./game/glb-viewer").then((module) => module.runGlbViewer(host));
} else if (scene === "convert") {
  void import("./game/convert-scene").then((module) => module.runModelConvert(host));
} else if (scene === "frontier-battle") {
  new App(host, { autoStart: true }).start();
} else {
  new App(host).start();
}
