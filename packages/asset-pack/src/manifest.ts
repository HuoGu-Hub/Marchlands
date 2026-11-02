import {
  ASSET_KINDS,
  AssetPackError,
  type AssetEntry,
  type AssetKind,
  type AssetManifest,
} from "./types";

const PACK_ID = /^[a-z][a-z0-9_.-]{1,47}$/;
const ASSET_ID = /^[a-z][a-z0-9_.-]{1,31}:[a-z0-9][a-z0-9_.\/-]{0,95}$/;
const FILE_PATH = /^[a-z0-9][a-z0-9_.\/-]*\.glb$/i;
const IMAGE_PATH = /^[a-z0-9][a-z0-9_.\/-]*\.(png|jpe?g|webp)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, label: string, issues: string[], max: number, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) issues.push(`${label} 不能为空`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${label} 必须是非空字符串`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > max) issues.push(`${label} 超过 ${max} 个字符`);
  return trimmed;
}

function finite(value: unknown, label: string, issues: string[], min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${label} 必须是有限数字`);
    return undefined;
  }
  if (value < min || value > max) issues.push(`${label} 必须在 ${min} 到 ${max} 之间`);
  return value;
}

function safePath(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (value.includes("\\")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function parseEntry(value: unknown, index: number, issues: string[]): AssetEntry | null {
  const label = `assets[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${label} 必须是对象`);
    return null;
  }
  const id = text(value.id, `${label}.id`, issues, 160);
  if (id && !ASSET_ID.test(id)) issues.push(`${label}.id 格式应为 命名空间:路径`);
  const kind = value.kind;
  if (typeof kind !== "string" || !ASSET_KINDS.includes(kind as AssetKind)) {
    issues.push(`${label}.kind 必须是 ${ASSET_KINDS.join("、")} 之一`);
  }
  const entryLabel = text(value.label, `${label}.label`, issues, 48);
  const file = value.file === undefined ? undefined : text(value.file, `${label}.file`, issues, 200, false);
  if (file) {
    if (!FILE_PATH.test(file) || !safePath(file)) issues.push(`${label}.file 必须是包内的 .glb 路径`);
  }
  const thumbnail = value.thumbnail === undefined
    ? undefined
    : text(value.thumbnail, `${label}.thumbnail`, issues, 200, false);
  if (thumbnail && (!IMAGE_PATH.test(thumbnail) || !safePath(thumbnail))) {
    issues.push(`${label}.thumbnail 必须是包内的图片路径`);
  }
  const tagsValue = value.tags;
  let tags: string[] | undefined;
  if (tagsValue !== undefined) {
    if (!Array.isArray(tagsValue) || tagsValue.length > 12) {
      issues.push(`${label}.tags 最多 12 项`);
    } else {
      tags = tagsValue
        .map((tag, tagIndex) => text(tag, `${label}.tags[${tagIndex}]`, issues, 32, false))
        .filter((tag): tag is string => tag !== undefined);
    }
  }
  const teamColor = value.teamColor;
  if (teamColor !== undefined && typeof teamColor !== "boolean") {
    issues.push(`${label}.teamColor 必须是布尔值`);
  }
  if (id && entryLabel && typeof kind === "string" && ASSET_KINDS.includes(kind as AssetKind)) {
    return {
      id,
      kind: kind as AssetKind,
      label: entryLabel,
      ...(file ? { file } : {}),
      ...(thumbnail ? { thumbnail } : {}),
      ...(finite(value.scale, `${label}.scale`, issues, 0.01, 100) !== undefined
        ? { scale: value.scale as number }
        : {}),
      ...(finite(value.rotation, `${label}.rotation`, issues, -3600, 3600) !== undefined
        ? { rotation: value.rotation as number }
        : {}),
      ...(finite(value.footprint, `${label}.footprint`, issues, 0, 200) !== undefined
        ? { footprint: value.footprint as number }
        : {}),
      ...(finite(value.height, `${label}.height`, issues, 0, 200) !== undefined
        ? { height: value.height as number }
        : {}),
      ...(typeof teamColor === "boolean" ? { teamColor } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    };
  }
  return null;
}

export function parseAssetManifest(input: unknown): AssetManifest {
  const issues: string[] = [];
  if (!isRecord(input)) throw new AssetPackError(["pack.json 必须是对象"]);
  if (input.format !== "mlpack") issues.push("format 必须是 mlpack");
  if (input.version !== 1) issues.push("version 必须是 1");
  const id = text(input.id, "id", issues, 48);
  if (id && !PACK_ID.test(id)) issues.push("id 格式应为小写命名空间，例如 com.example.frontier");
  const name = text(input.name, "name", issues, 64);
  const author = text(input.author, "author", issues, 64, false);
  const description = text(input.description, "description", issues, 400, false);
  const assetsValue = input.assets;
  if (!Array.isArray(assetsValue)) {
    issues.push("assets 必须是数组");
  } else if (assetsValue.length === 0) {
    issues.push("assets 至少需要一个资产");
  } else if (assetsValue.length > 256) {
    issues.push("assets 最多 256 个资产");
  }
  const assets: AssetEntry[] = [];
  const ids = new Set<string>();
  if (Array.isArray(assetsValue)) {
    assetsValue.forEach((entry, index) => {
      const parsed = parseEntry(entry, index, issues);
      if (!parsed) return;
      if (ids.has(parsed.id)) issues.push(`资产 ID 重复：${parsed.id}`);
      ids.add(parsed.id);
      assets.push(parsed);
    });
  }
  if (issues.length > 0) throw new AssetPackError(issues);
  return {
    format: "mlpack",
    version: 1,
    id: id as string,
    name: name as string,
    ...(author ? { author } : {}),
    ...(description ? { description } : {}),
    assets,
  };
}

export function assertGlb(bytes: Uint8Array, file: string): void {
  if (bytes.byteLength < 12) throw new AssetPackError([`${file} 不是有效的 GLB`]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new AssetPackError([`${file} 缺少 glTF 标识`]);
  if (view.getUint32(4, true) !== 2) throw new AssetPackError([`${file} 只支持 glTF 2.0`]);
  const length = view.getUint32(8, true);
  if (length > bytes.byteLength || length < 12) throw new AssetPackError([`${file} 的 GLB 长度不正确`]);
}
