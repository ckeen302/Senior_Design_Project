import { DarkTheme, type Theme } from "@react-navigation/native";

/**
 * True-black, Robinhood-inspired palette. Up/down use Robinhood's original
 * mint and orange-red, which stay distinguishable for red-green colour-blind
 * readers (ΔE 12.7 deutan); direction is also always carried by a sign,
 * arrow or word, never by colour alone.
 */
export const colors = {
  background: "#000000",
  surface: "#0E0E10",
  surfaceRaised: "#1A1A1D",
  border: "#1F1F23",
  text: "#FFFFFF",
  textMuted: "#8E8E93",
  textFaint: "#5C5C62",
  primary: "#21CE99",
  primaryMuted: "rgba(33,206,153,0.14)",
  /** Text / icons drawn on top of a primary, buy or sell fill. */
  onPrimary: "#000000",
  brand: "#21CE99",
  buy: "#21CE99",
  buyMuted: "rgba(33,206,153,0.14)",
  sell: "#F45531",
  sellMuted: "rgba(244,85,49,0.14)",
  neutral: "#8E8E93",
  neutralMuted: "rgba(142,142,147,0.16)",
  /** Solid fill for neutral value pills. */
  neutralFill: "#2C2C2E",
  warning: "#FFB020",
  warningMuted: "rgba(255,176,32,0.14)",
  overlay: "rgba(0,0,0,0.72)",
} as const;

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Horizontal padding of every screen. */
export const gutter = 20;

export const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.sell,
  },
  fonts: {
    regular: { fontFamily: fonts.regular, fontWeight: "400" },
    medium: { fontFamily: fonts.medium, fontWeight: "500" },
    bold: { fontFamily: fonts.semibold, fontWeight: "600" },
    heavy: { fontFamily: fonts.bold, fontWeight: "700" },
  },
};
