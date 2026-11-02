export type AssetKind = "terrain" | "prop" | "building" | "unit";

export const ASSET_KINDS: readonly AssetKind[] = ["terrain", "prop", "building", "unit"];

export interface AssetEntry {
  /** 全局唯一资产 ID，格式为 命名空间:路径，例如 builtin:prop.tree_oak。 */
  id: string;
  kind: AssetKind;
  label: string;
  /** 资产包内的 GLB 路径；内置资产可以省略。 */
  file?: string;
  /** 加载时的默认缩放。 */
  scale?: number;
  /** 加载时的默认朝向，单位为度。 */
  rotation?: number;
  /** 占地直径，单位为米。 */
  footprint?: number;
  /** 资产高度，单位为米。 */
  height?: number;
  /** 是否支持队伍色材质，材质名以 team 开头。 */
  teamColor?: boolean;
  tags?: string[];
  /** 资产包内的缩略图路径。 */
  thumbnail?: string;
}

export interface AssetManifest {
  format: "mlpack";
  version: 1;
  /** 资产包命名空间，例如 com.example.frontier。 */
  id: string;
  name: string;
  author?: string;
  description?: string;
  assets: AssetEntry[];
}

export interface AssetPack {
  manifest: AssetManifest;
  files: Map<string, Uint8Array>;
}

export interface AssetPackLimits {
  maxBytes: number;
  maxFiles: number;
  maxManifestBytes: number;
  maxAssetBytes: number;
}

export const DEFAULT_PACK_LIMITS: AssetPackLimits = {
  maxBytes: 64 * 1024 * 1024,
  maxFiles: 512,
  maxManifestBytes: 16 * 1024 * 1024,
  maxAssetBytes: 32 * 1024 * 1024,
};

export class AssetPackError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("；"));
    this.name = "AssetPackError";
    this.issues = issues;
  }
}
