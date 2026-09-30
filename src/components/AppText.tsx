import { StyleSheet, Text, type TextProps } from "react-native";
import { colors, fonts } from "../theme";

export type TextVariant =
  | "hero"
  | "display"
  | "title"
  | "heading"
  | "subheading"
  | "body"
  | "bodyStrong"
  | "caption"
  | "label"
  | "micro";

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  /** Fixed-width digits for numbers in columns and live-updating values. */
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
  hero: { fontFamily: fonts.bold, fontSize: 44, lineHeight: 50, color: colors.text, letterSpacing: -1.4 },
  display: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, color: colors.text, letterSpacing: -1 },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, color: colors.text, letterSpacing: -0.7 },
  heading: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 24, color: colors.text, letterSpacing: -0.3 },
  subheading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, color: colors.text, letterSpacing: -0.1 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.text },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.text },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.textMuted },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.textMuted },
  micro: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, color: colors.textMuted },
  tabular: { fontVariant: ["tabular-nums"] },
});
