import { registerRootComponent } from "expo";
import { Platform } from "react-native";

// The app is loaded with require() so that, on web, Skia's CanvasKit (used by
// the Victory Native charts and the sentiment gauge) is ready before any
// component module is evaluated.
if (Platform.OS === "web") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LoadSkiaWeb } = require("@shopify/react-native-skia/lib/module/web");
  LoadSkiaWeb({ locateFile: (file: string) => `/${file}` })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    .then(() => registerRootComponent(require("./App").default))
    .catch((error: unknown) => console.error("Failed to load Skia for web", error));
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  registerRootComponent(require("./App").default);
}
