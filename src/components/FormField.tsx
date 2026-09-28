import { forwardRef, type ReactNode } from "react";
import { StyleSheet, TextInput, type TextInputProps, View } from "react-native";
import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

export interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  accessory?: ReactNode;
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, error, hint, accessory, style, ...inputProps },
  ref,
) {
  return (
    <View style={styles.container}>
      <AppText variant="label" style={styles.label}>
        {label}
      </AppText>
      <View style={[styles.inputRow, error ? styles.inputError : null]}>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          accessibilityLabel={label}
          style={[styles.input, style]}
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
  container: { gap: 6 },
  label: { marginLeft: 2 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: spacing.sm,
  },
  inputError: { borderColor: colors.sell },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15.5,
  },
});
