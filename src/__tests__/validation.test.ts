import { friendlyAuthError, validateEmail, validatePassword, validateRegistration } from "../lib/validation";

describe("email validation", () => {
  it("requires a well-formed address", () => {
    expect(validateEmail("")).toBe("Email is required.");
    expect(validateEmail("nope")).toBe("Enter a valid email address.");
    expect(validateEmail("a@b")).toBe("Enter a valid email address.");
    expect(validateEmail("  student@university.edu ")).toBeNull();
  });
});

describe("password validation", () => {
  it("only requires presence when signing in", () => {
    expect(validatePassword("")).toBe("Password is required.");
    expect(validatePassword("x")).toBeNull();
  });

  it("enforces strength for new passwords", () => {
    expect(validatePassword("short1", { isNew: true })).toMatch(/at least 8/);
    expect(validatePassword("allletters", { isNew: true })).toMatch(/letter and one number/);
    expect(validatePassword("12345678", { isNew: true })).toMatch(/letter and one number/);
    expect(validatePassword("pulse2026", { isNew: true })).toBeNull();
  });
});

describe("registration", () => {
  it("collects every field error", () => {
    expect(validateRegistration({ email: "bad", password: "short", confirmPassword: "" })).toEqual({
      email: "Enter a valid email address.",
      password: "Use at least 8 characters.",
      confirmPassword: "Please confirm your password.",
    });
  });

  it("detects mismatched confirmation", () => {
    expect(
      validateRegistration({ email: "a@b.co", password: "pulse2026", confirmPassword: "pulse2027" }).confirmPassword,
    ).toBe("Passwords do not match.");
  });

  it("passes valid input", () => {
    expect(validateRegistration({ email: "a@b.co", password: "pulse2026", confirmPassword: "pulse2026" })).toEqual({});
  });
});

it("maps Supabase auth errors to friendly copy", () => {
  expect(friendlyAuthError("Invalid login credentials")).toBe("Incorrect email or password.");
  expect(friendlyAuthError("Email not confirmed")).toMatch(/confirm your email/);
  expect(friendlyAuthError("User already registered")).toMatch(/already exists/);
  expect(friendlyAuthError("TypeError: Network request failed")).toMatch(/Can't reach the server/);
});
