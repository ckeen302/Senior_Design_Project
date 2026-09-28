import { StyleSheet, Text, type TextProps } from "react-native";
import { colors, fonts } from "../theme";

export type TextVariant = "display" | "title" | "heading" | "body" | "bodyStrong" | "caption" | "label";

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  /** Fixed-width digits so prices and values do not jitter when they update. */
  tabular?: boolean;
}

export function AppText({ variant = "body", color, tabular, style, ...rest }: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[styles[variant], color ? { color } : null, tabular ? styles.tabular : null, style]}
    />
  );
}

const styles = StyleSheet.create({
  display: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, color: colors.text, letterSpacing: -0.5 },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colors.text, letterSpacing: -0.3 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.text },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.text },
  caption: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.textMuted },
  label: {
    fontFamily: fonts.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  tabular: { fontVariant: ["tabular-nums"] },
});
