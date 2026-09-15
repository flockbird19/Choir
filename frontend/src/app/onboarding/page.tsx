import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { getCurrentUser } from "@/utils/supabase/access";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = {
  title: "Create your workspace — Choir",
  description: "Name your team, get an invite link and start working with your team and AI.",
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/onboarding");

  return (
    <AuthShell>
      <OnboardingForm />
    </AuthShell>
  );
}
