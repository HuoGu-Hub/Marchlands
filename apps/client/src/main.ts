import "./style.css";
import { App } from "./app";
import { runAssetLab } from "./game/asset-lab";
import { runHeightTest } from "./game/height-test";
import { runPieceViewer } from "./game/piece-viewer";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app");

const scene = new URLSearchParams(window.location.search).get("scene");
if (scene === "height") {
  runHeightTest(host);
} else if (scene === "lab") {
  runAssetLab(host);
} else if (scene === "pieces") {
  runPieceViewer(host);
} else {
  new App(host).start();
}
