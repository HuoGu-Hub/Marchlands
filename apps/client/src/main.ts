import "./style.css";
import { App } from "./app";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app");
new App(host).start();
