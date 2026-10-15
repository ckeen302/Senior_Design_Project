import { registerRootComponent } from "expo";
import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

// Web entry: Skia's CanvasKit (used by the Victory Native charts and the
// sentiment gauge) must be ready before any component module is evaluated.
export function start() {
  LoadSkiaWeb({ locateFile: (file: string) => `/${file}` })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    .then(() => registerRootComponent(require("../../App").default))
    .catch((error: unknown) => console.error("Failed to load Skia for web", error));
}
