export interface OpenedMap {
  name: string;
  text: string;
}

function normalizeName(name: string): string {
  const trimmed = name.trim() || "map";
  return /\.mlmap\.json$/i.test(trimmed) ? trimmed : `${trimmed}.mlmap.json`;
}

function download(name: string, text: string): string {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = normalizeName(name);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return anchor.download;
}

export async function saveMapText(text: string, name: string): Promise<string | null> {
  if (window.marchlandsHost?.saveMapFile) {
    return window.marchlandsHost.saveMapFile(text, normalizeName(name));
  }
  return download(name, text);
}

export async function openMapText(): Promise<OpenedMap | null> {
  if (window.marchlandsHost?.openMapFile) {
    return window.marchlandsHost.openMapFile();
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.mlmap.json,application/json";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? "") });
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      },
      { once: true },
    );
    input.click();
  });
}
export interface OpenedAssetPack {
  name: string;
  bytes: Uint8Array;
}

export async function openAssetPackFile(): Promise<OpenedAssetPack | null> {
  if (window.marchlandsHost?.openAssetPack) {
    return window.marchlandsHost.openAssetPack();
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mlpack,.zip,application/zip";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (result instanceof ArrayBuffer) resolve({ name: file.name, bytes: new Uint8Array(result) });
          else resolve(null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file);
      },
      { once: true },
    );
    input.click();
  });
}
function normalizePackName(name: string): string {
  const trimmed = name.trim() || "assets";
  return /\.mlpack$/i.test(trimmed) ? trimmed : `${trimmed}.mlpack`;
}

export async function saveAssetPackFile(bytes: Uint8Array, name: string): Promise<string | null> {
  const fileName = normalizePackName(name);
  if (window.marchlandsHost?.saveAssetPackFile) {
    return window.marchlandsHost.saveAssetPackFile(bytes, fileName);
  }
  const blob = new Blob([bytes.slice().buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return anchor.download;
}
