const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isDev = process.argv.includes("--dev");
if (process.argv.includes("--smoke")) app.disableHardwareAcceleration();
const isSmoke = process.argv.includes("--smoke");

let win = null;

function smokeOutputPath() {
  const arg = process.argv.find((entry) => entry.startsWith("--smoke-out="));
  if (arg) return arg.slice("--smoke-out=".length);
  return path.join(process.cwd(), "smoke.json");
}

let smokeDone = false;

function finishSmoke(result) {
  if (smokeDone) return;
  smokeDone = true;
  result.ok = Boolean(result.ok);
  try {
    fs.writeFileSync(smokeOutputPath(), JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
  }
  app.exit(result.ok ? 0 : 2);
}

async function runSmoke() {
  setTimeout(() => finishSmoke({ ok: false, error: "smoke timeout" }), 15000);
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    finishSmoke({ ok: false, error: `load failed ${code} ${description} ${url}` });
  });
  win.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      try {
        const menu = await win.webContents.executeJavaScript(
          `({
            title: document.title,
            menu: !!document.querySelector("#page-menu.active"),
            canvas: !!document.querySelector("#game-canvas"),
            width: innerWidth,
            height: innerHeight,
            overflow: document.documentElement.scrollWidth - innerWidth
          })`,
        );
        await win.webContents.executeJavaScript(
          `(() => {
            document.querySelector("#btn-start")?.click();
            document.querySelector("#btn-brief-start")?.click();
            return true;
          })()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2200));
        const game = await win.webContents.executeJavaScript(
          `({
            game: !!document.querySelector("#page-game.active"),
            timer: document.querySelector("#hud-timer")?.textContent ?? "",
            cities: document.querySelector("#hud-cities")?.textContent ?? "",
            canvasWidth: document.querySelector("#game-canvas")?.width ?? 0
          })`,
        );
        finishSmoke({
          ...menu,
          ...game,
          ok:
            menu.menu &&
            menu.canvas &&
            menu.overflow <= 0 &&
            game.game &&
            game.canvasWidth > 0,
        });
      } catch (error) {
        finishSmoke({ ok: false, error: String(error) });
      }
    }, 2600);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 576,
    backgroundColor: "#0d120f",
    show: !isSmoke,
    autoHideMenuBar: true,
    title: "Marchlands",
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (isSmoke) {
    win.setPosition(-3000, -3000);
    win.showInactive();
  }

  win.webContents.on("did-start-loading", () => console.log("[smoke] did-start-loading"));
  win.webContents.on("did-finish-load", () => console.log("[smoke] did-finish-load"));
  win.webContents.on("did-fail-load", (_event, code, description, url) =>
    console.log("[smoke] did-fail-load", code, description, url),
  );
  win.webContents.on("render-process-gone", (_event, details) =>
    console.log("[smoke] render-process-gone", JSON.stringify(details)),
  );

  if (isDev) {
    win
      .loadURL("http://127.0.0.1:5188/")
      .then(() => console.log("[smoke] load resolved"))
      .catch((error) => console.log("[smoke] load rejected", String(error)));
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  if (isSmoke) runSmoke();
}

ipcMain.handle("window:set-size", (_event, width, height) => {
  if (!win || win.isMaximized() || win.isFullScreen()) return;
  win.setContentSize(Math.round(width), Math.round(height));
});

ipcMain.handle("window:set-fullscreen", (_event, enabled) => {
  if (!win) return;
  win.setFullScreen(Boolean(enabled));
});

ipcMain.on("app:quit", () => {
  app.quit();
});

ipcMain.handle("map:save", async (_event, text, suggestedName) => {
  if (!win || typeof text !== "string" || text.length > 4_000_000) return null;
  const safeName = typeof suggestedName === "string" ? suggestedName.replace(/[\\/:*?"<>|]/g, "-") : "map.mlmap.json";
  const result = await dialog.showSaveDialog(win, {
    title: "保存地图",
    defaultPath: safeName,
    filters: [{ name: "Marchlands 地图", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, text, "utf8");
  return result.filePath;
});

ipcMain.handle("map:open", async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    title: "载入地图",
    properties: ["openFile"],
    filters: [{ name: "Marchlands 地图", extensions: ["json"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 4_000_000) return null;
  return { name: path.basename(filePath), text: fs.readFileSync(filePath, "utf8") };
});

ipcMain.handle("pack:open", async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    title: "导入资产包",
    properties: ["openFile"],
    filters: [{ name: "Marchlands 资产包", extensions: ["mlpack", "zip"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return null;
  return { name: path.basename(filePath), bytes: new Uint8Array(fs.readFileSync(filePath)) };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}