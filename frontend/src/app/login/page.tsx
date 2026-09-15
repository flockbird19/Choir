import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/utils/supabase/access";
import { safeRedirectPath } from "@/utils/safe-redirect";
import type { AuthView } from "./auth-shared";

export const metadata: Metadata = {
  title: "Sign in — Choir",
  description: "Sign in to Choir, where your team and AI share context.",
};

const NOTICES: Record<string, string> = {
  link: "That link is invalid or has expired. Request a new one below.",
  oauth: "Google sign-in didn't finish. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const view: AuthView = params.view === "signup" || params.view === "forgot" ? params.view : "signin";
  const next = safeRedirectPath(params.next);
  const notice = (params.error && NOTICES[params.error]) || null;
  const user = await getCurrentUser();

  return (
    <AuthShell>
      <AuthForm initialView={view} next={next} notice={notice} signedInEmail={user?.email ?? null} />
    </AuthShell>
  );
}
