import "./style.css";
import { App } from "./app";
import { runAssetLab } from "./game/asset-lab";
import { runBuildingGallery } from "./game/building-gallery";
import { runHeightTest } from "./game/height-test";
import { runPieceViewer } from "./game/piece-viewer";
import { runTownShowcase } from "./game/town-showcase";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app");

const scene = new URLSearchParams(window.location.search).get("scene");
if (scene === "height") {
  runHeightTest(host);
} else if (scene === "lab") {
  runAssetLab(host);
} else if (scene === "pieces") {
  runPieceViewer(host);
} else if (scene === "buildings") {
  runBuildingGallery(host);
} else if (scene === "towns") {
  runTownShowcase(host);
} else {
  new App(host).start();
}
