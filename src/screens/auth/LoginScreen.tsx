import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useRef, useState } from "react";
import { StyleSheet, type TextInput, View } from "react-native";
import { AppText } from "../../components/AppText";
import { Button } from "../../components/Button";
import { FormField } from "../../components/FormField";
import { validateEmail, validatePassword } from "../../lib/validation";
import type { AuthStackParamList } from "../../navigation/types";
import { useAuthStore } from "../../store/authStore";
import { colors, spacing } from "../../theme";
import { AuthLayout } from "./AuthLayout";
import { PasswordToggle } from "./PasswordToggle";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const signIn = useAuthStore((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function onSubmit() {
    const nextErrors = {
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password) ?? undefined,
    };
    setErrors(nextErrors);
    setFormError(null);
    if (nextErrors.email || nextErrors.password) return;

    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);
    if (error) setFormError(error);
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Follow the money insiders move — straight from SEC Form 4 filings.">
      <View style={styles.form}>
        <FormField
          label="Email"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
          }}
          onBlur={() => email && setErrors((e) => ({ ...e, email: validateEmail(email) ?? undefined }))}
          error={errors.email}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="login-email"
        />
        <FormField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
          }}
          error={errors.password}
          placeholder="Your password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          accessory={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
          testID="login-password"
        />
        {formError ? (
          <AppText variant="caption" color={colors.sell} accessibilityLiveRegion="assertive" testID="login-error">
            {formError}
          </AppText>
        ) : null}
        <Button title="Sign in" onPress={onSubmit} loading={submitting} testID="login-submit" />
      </View>
      <View style={styles.footer}>
        <AppText variant="body" color={colors.textMuted}>
          New to InsiderPulse?
        </AppText>
        <Button title="Create an account" variant="ghost" onPress={() => navigation.navigate("Register")} />
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  footer: { alignItems: "center", gap: spacing.xs },
});
