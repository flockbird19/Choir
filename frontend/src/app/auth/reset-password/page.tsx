import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { primaryButtonClass } from "@/components/auth/fields";
import { getCurrentUser } from "@/utils/supabase/access";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password — Choir",
};

export default async function ResetPasswordPage() {
  const user = await getCurrentUser();

  return (
    <AuthShell>
      {user ? (
        <ResetPasswordForm email={user.email ?? ""} />
      ) : (
        <div className="animate-rise motion-reduce:animate-none">
          <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Clock size={22} aria-hidden="true" />
          </span>
          <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em]">
            This link has expired
          </h1>
          <p className="mt-2 mb-6 text-[15px] leading-relaxed text-fg-muted">
            Reset links work once and only for a short time. Request a new one and open it on this device.
          </p>
          <Link href="/login?view=forgot" className={primaryButtonClass}>
            Request a new link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
