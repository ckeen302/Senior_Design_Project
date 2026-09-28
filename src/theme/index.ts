import { DarkTheme, type Theme } from "@react-navigation/native";

export const colors = {
  background: "#0A0E13",
  surface: "#121821",
  surfaceRaised: "#18212C",
  border: "#232E3B",
  text: "#E8EDF2",
  textMuted: "#8A97A6",
  textFaint: "#5B6776",
  primary: "#4F8BFF",
  primaryMuted: "rgba(79,139,255,0.16)",
  brand: "#2DD4BF",
  buy: "#22C55E",
  buyMuted: "rgba(34,197,94,0.15)",
  sell: "#EF4444",
  sellMuted: "rgba(239,68,68,0.15)",
  neutral: "#94A3B8",
  neutralMuted: "rgba(148,163,184,0.15)",
  warning: "#F59E0B",
  warningMuted: "rgba(245,158,11,0.15)",
  overlay: "rgba(5,8,12,0.72)",
} as const;

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
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
