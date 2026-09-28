/** Form validation for the authentication screens. */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return "Email is required.";
  if (!EMAIL_PATTERN.test(value)) return "Enter a valid email address.";
  return null;
}

export function validatePassword(password: string, { isNew = false } = {}): string | null {
  if (!password) return "Password is required.";
  if (!isNew) return null;
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Include at least one letter and one number.";
  return null;
}

export interface RegistrationErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export function validateRegistration(input: {
  email: string;
  password: string;
  confirmPassword: string;
}): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const email = validateEmail(input.email);
  if (email) errors.email = email;
  const password = validatePassword(input.password, { isNew: true });
  if (password) errors.password = password;
  if (!input.confirmPassword) errors.confirmPassword = "Please confirm your password.";
  else if (input.confirmPassword !== input.password) errors.confirmPassword = "Passwords do not match.";
  return errors;
}

/** Maps Supabase Auth errors to friendly copy. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Incorrect email or password.";
  if (m.includes("email not confirmed")) return "Please confirm your email address, then sign in.";
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "An account with this email already exists. Try signing in.";
  }
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a minute and try again.";
  if (m.includes("network") || m.includes("fetch")) return "Can't reach the server. Check your connection and try again.";
  if (m.includes("password")) return message;
  return message || "Something went wrong. Please try again.";
}
