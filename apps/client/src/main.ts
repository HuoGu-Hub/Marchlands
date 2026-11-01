import "./style.css";
import { App } from "./app";
import { runHeightTest } from "./game/height-test";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app");

if (new URLSearchParams(window.location.search).get("scene") === "height") {
  runHeightTest(host);
} else {
  new App(host).start();
}
