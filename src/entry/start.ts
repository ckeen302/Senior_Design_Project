import { registerRootComponent } from "expo";

// Native entry. The web entry (start.web.ts) loads Skia's CanvasKit first;
// keeping that import out of this file keeps canvaskit-wasm (which needs
// Node's "fs") out of the iOS and Android bundles.
export function start() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  registerRootComponent(require("../../App").default);
}
