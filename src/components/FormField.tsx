import { forwardRef, type ReactNode, useState } from "react";
import { StyleSheet, TextInput, type TextInputProps, View } from "react-native";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

export interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  accessory?: ReactNode;
}

/** Filled input: quiet until focused (mint ring) or invalid (orange-red ring). */
export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, error, hint, accessory, style, onFocus, onBlur, ...inputProps },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.container}>
      <AppText variant="label">{label}</AppText>
      <View style={[styles.inputRow, focused && styles.focused, error ? styles.invalid : null]}>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          accessibilityLabel={label}
          style={[styles.input, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...inputProps}
        />
        {accessory}
      </View>
      {error ? (
        <AppText variant="caption" color={colors.sell} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption">{hint}</AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: "transparent",
    paddingRight: spacing.sm,
  },
  focused: { borderColor: colors.primary },
  invalid: { borderColor: colors.sell },
  input: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
    // Web: the row draws its own focus ring.
    outlineWidth: 0,
  },
});
