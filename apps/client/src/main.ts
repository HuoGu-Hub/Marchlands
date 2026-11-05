import "./style.css";
import { App } from "./app";
import { runAssetLab } from "./game/asset-lab";
import { runBuildingGallery } from "./game/building-gallery";
import { runHeightTest } from "./game/height-test";
import { runPieceViewer } from "./game/piece-viewer";
import { runRoadShowcase } from "./game/road-showcase";
import { runSwitchDemo } from "./game/switch-demo";
import { runUnitGallery } from "./game/unit-gallery";
import { runTownShowcase } from "./game/town-showcase";
import { runSpriteShowcase } from "./game/sprite-showcase";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app");

const params = new URLSearchParams(window.location.search);
const scene = params.get("scene");
const previewMap = params.get("map");
if (scene === "map-preview" && previewMap) {
  void import("./game/map-preview").then((module) => module.runMapPreview(host, previewMap));
} else if (scene === "unit-portrait") {
  const skin = params.get("skin");
  if (skin) void import("./game/unit-portrait").then((module) => module.runUnitPortrait(host, skin));
} else if (scene === "height") {
  runHeightTest(host);
} else if (scene === "lab") {
  runAssetLab(host);
} else if (scene === "pieces") {
  runPieceViewer(host);
} else if (scene === "buildings") {
  runBuildingGallery(host);
} else if (scene === "towns") {
  runTownShowcase(host);
} else if (scene === "switch") {
  runSwitchDemo(host);
} else if (scene === "roads") {
  runRoadShowcase(host);
} else if (scene === "units") {
  runUnitGallery(host);
} else if (scene === "frontier-battle") {
  // 直接进真实对局；?map= 可换地图
  new App(host, { autoStart: true }).start();
} else if (scene === "sprite") {
  runSpriteShowcase(host);
} else if (scene === "convert") {
  void import("./game/convert-scene").then((module) => module.runModelConvert(host));
} else {
  new App(host).start();
}