"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { safeRedirectPath } from "@/utils/safe-redirect";
import {
  describeAuthError,
  readSecret,
  readText,
  validateEmail,
  validateNewPassword,
  type AuthFormState,
  type FieldErrors,
} from "./auth-shared";

async function siteOrigin(): Promise<string> {
  const requestHeaders = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL || requestHeaders.get("origin") || "http://localhost:3000";
}

function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readText(formData, "email");
  const password = readSecret(formData, "password");
  const next = safeRedirectPath(readText(formData, "next"));

  const fieldErrors: FieldErrors = {
    email: validateEmail(email),
    password: password ? undefined : "Enter your password.",
  };
  if (hasErrors(fieldErrors)) {
    return { status: "error", email, fieldErrors, message: "Check the highlighted fields." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ...describeAuthError(error), email };

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = readText(formData, "name");
  const email = readText(formData, "email");
  const password = readSecret(formData, "password");
  const confirmPassword = readSecret(formData, "confirmPassword");
  const next = safeRedirectPath(readText(formData, "next"));

  const fieldErrors: FieldErrors = {
    name: name ? undefined : "Enter your name so teammates know who you are.",
    email: validateEmail(email),
    ...validateNewPassword(password, confirmPassword),
  };
  if (hasErrors(fieldErrors)) {
    return { status: "error", email, fieldErrors, message: "Check the highlighted fields." };
  }

  const supabase = await createClient();
  // Without this, a browser still holding another account's session lands in that account after sign-up.
  await supabase.auth.signOut({ scope: "local" });

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { ...describeAuthError(error), email };

  if (!data.session) {
    return { status: "check-email", email };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function resendConfirmation(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readText(formData, "email");
  const next = safeRedirectPath(readText(formData, "next"));
  const emailError = validateEmail(email);
  if (emailError) return { status: "error", email, message: emailError };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) return { ...describeAuthError(error), email };

  return { status: "resent", email };
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readText(formData, "email");
  const emailError = validateEmail(email);
  if (emailError) {
    return { status: "error", email, fieldErrors: { email: emailError }, message: "Check your email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/auth/reset-password`,
  });
  // Only rate limits are surfaced, so this form never reveals whether an account exists.
  if (error && (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")) {
    return { ...describeAuthError(error), email };
  }

  return { status: "reset-sent", email };
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeRedirectPath(readText(formData, "next"));
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth");
  }
  redirect(data.url);
}

export async function signOutFromLogin() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  revalidatePath("/", "layout");
  redirect("/login");
}
