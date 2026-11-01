export {};

declare global {
  interface Window {
    marchlandsHost?: {
      setSize(width: number, height: number): Promise<void>;
      setFullscreen(enabled: boolean): Promise<void>;
      quit(): void;
    };
  }
}
