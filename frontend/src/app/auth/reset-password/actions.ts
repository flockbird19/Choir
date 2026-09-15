"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import {
  describeAuthError,
  readSecret,
  validateNewPassword,
  type AuthFormState,
} from "@/app/login/auth-shared";

export async function updatePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = readSecret(formData, "password");
  const confirmPassword = readSecret(formData, "confirmPassword");

  const fieldErrors = validateNewPassword(password, confirmPassword);
  if (Object.values(fieldErrors).some(Boolean)) {
    return { status: "error", fieldErrors, message: "Check the highlighted fields." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", message: "Your reset link has expired. Request a new one from the sign-in page." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return describeAuthError(error);

  revalidatePath("/", "layout");
  redirect("/");
}
