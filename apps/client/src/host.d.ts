export {};

declare global {
  interface Window {
    /** 关卡预览页完成首帧渲染。 */
    __mlPreviewReady?: boolean;
    marchlandsHost?: {
      setSize(width: number, height: number): Promise<void>;
      setFullscreen(enabled: boolean): Promise<void>;
      saveMapFile(text: string, name: string): Promise<string | null>;
      openMapFile(): Promise<{ name: string; text: string } | null>;
      openAssetPack(): Promise<{ name: string; bytes: Uint8Array } | null>;
      saveAssetPackFile(bytes: Uint8Array, name: string): Promise<string | null>;
      quit(): void;
    };
  }
}