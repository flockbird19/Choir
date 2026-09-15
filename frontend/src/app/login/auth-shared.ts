import type { AuthError } from "@supabase/supabase-js";

export type AuthView = "signin" | "signup" | "forgot";

export type AuthField = "name" | "email" | "password" | "confirmPassword";

export type FieldErrors = Partial<Record<AuthField, string>>;

export interface AuthFormState {
  status: "idle" | "error" | "check-email" | "reset-sent" | "resent";
  message?: string;
  code?: string;
  email?: string;
  fieldErrors?: FieldErrors;
}

export const initialAuthState: AuthFormState = { status: "idle" };

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function readSecret(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function validateEmail(email: string): string | undefined {
  if (!email) return "Enter your email address.";
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address, like you@example.com.";
  return undefined;
}

export function validateNewPassword(password: string, confirmPassword: string): FieldErrors {
  const errors: FieldErrors = {};
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (confirmPassword !== password) {
    errors.confirmPassword = "Passwords don't match.";
  }
  return errors;
}

export function describeAuthError(error: AuthError): AuthFormState {
  const code = error.code;
  switch (code) {
    case "invalid_credentials":
      return { status: "error", code, message: "That email and password don't match. Check both and try again." };
    case "email_not_confirmed":
      return { status: "error", code, message: "Confirm your email before signing in. We can send the link again." };
    case "user_already_exists":
      return { status: "error", code, message: "An account with this email already exists. Sign in instead." };
    case "weak_password":
      return {
        status: "error",
        code,
        message: "Choose a stronger password.",
        fieldErrors: { password: error.message || "This password is too easy to guess." },
      };
    case "same_password":
      return {
        status: "error",
        code,
        message: "Choose a new password.",
        fieldErrors: { password: "This is your current password. Pick a different one." },
      };
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return { status: "error", code, message: "Too many attempts. Wait a minute, then try again." };
    case "email_address_invalid":
      return {
        status: "error",
        code,
        message: "Check your email address.",
        fieldErrors: { email: "Enter a valid email address, like you@example.com." },
      };
    case "email_address_not_authorized":
      return { status: "error", code, message: "We can't send email to this address yet. Try continuing with Google." };
    case "signup_disabled":
      return { status: "error", code, message: "New sign-ups are paused right now." };
    default:
      return { status: "error", code, message: error.message || "Something went wrong. Please try again." };
  }
}
