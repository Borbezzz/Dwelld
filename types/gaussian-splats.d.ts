declare module "@mkkellogg/gaussian-splats-3d" {
  export const RenderMode: { Always: number; OnChange: number };
  export const SceneFormat: { Ply: number; Splat: number; KSplat: number };
  export class Viewer {
    controls?: {autoRotate:boolean;autoRotateSpeed:number};
    camera: import("three").Camera;
    renderer: import("three").WebGLRenderer;
    constructor(options: Record<string, unknown>);
    addSplatScene(url: string, options?: Record<string, unknown>): Promise<unknown>;
    start(): void;
    forceRenderNextFrame(): void;
    dispose(): Promise<void>;
  }
}
