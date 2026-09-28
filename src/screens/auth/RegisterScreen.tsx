import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useRef, useState } from "react";
import { StyleSheet, type TextInput, View } from "react-native";
import { AppText } from "../../components/AppText";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormField } from "../../components/FormField";
import { MIN_PASSWORD_LENGTH, type RegistrationErrors, validateRegistration } from "../../lib/validation";
import type { AuthStackParamList } from "../../navigation/types";
import { useAuthStore } from "../../store/authStore";
import { colors, spacing } from "../../theme";
import { AuthLayout } from "./AuthLayout";
import { PasswordToggle } from "./PasswordToggle";

type Props = NativeStackScreenProps<AuthStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const signUp = useAuthStore((s) => s.signUp);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  async function onSubmit() {
    const nextErrors = validateRegistration({ email, password, confirmPassword });
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const { error, needsEmailConfirmation } = await signUp(email, password);
    setSubmitting(false);
    if (error) setFormError(error);
    else if (needsEmailConfirmation) setConfirmationSentTo(email.trim().toLowerCase());
    // Otherwise the new session switches the app to the signed-in stack.
  }

  if (confirmationSentTo) {
    return (
      <AuthLayout title="Check your inbox" subtitle="One more step before you can sign in.">
        <Card style={styles.confirm}>
          <Ionicons name="mail-unread-outline" size={32} color={colors.buy} />
          <AppText variant="body">
            We sent a confirmation link to <AppText variant="bodyStrong">{confirmationSentTo}</AppText>. Open it on
            this device, then come back and sign in.
          </AppText>
        </Card>
        <Button title="Back to sign in" onPress={() => navigation.navigate("Login")} />
      </AuthLayout>
    );
  }

  const clear = (field: keyof RegistrationErrors) => errors[field] && setErrors((e) => ({ ...e, [field]: undefined }));

  return (
    <AuthLayout title="Create your account" subtitle="Get whale alerts and track the insiders behind your stocks.">
      <View style={styles.form}>
        <FormField
          label="Email"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            clear("email");
          }}
          error={errors.email}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          testID="register-email"
        />
        <FormField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            clear("password");
          }}
          error={errors.password}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters with a letter and a number.`}
          placeholder="Create a password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
          accessory={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
          testID="register-password"
        />
        <FormField
          ref={confirmRef}
          label="Confirm password"
          value={confirmPassword}
          onChangeText={(v) => {
            setConfirmPassword(v);
            clear("confirmPassword");
          }}
          error={errors.confirmPassword}
          placeholder="Repeat your password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          testID="register-confirm"
        />
        {formError ? (
          <AppText variant="caption" color={colors.sell} accessibilityLiveRegion="assertive" testID="register-error">
            {formError}
          </AppText>
        ) : null}
        <Button title="Create account" onPress={onSubmit} loading={submitting} testID="register-submit" />
      </View>
      <View style={styles.footer}>
        <AppText variant="body" color={colors.textMuted}>
          Already have an account?
        </AppText>
        <Button title="Sign in" variant="ghost" onPress={() => navigation.navigate("Login")} />
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  footer: { alignItems: "center", gap: spacing.xs },
  confirm: { gap: spacing.md, alignItems: "flex-start" },
});
