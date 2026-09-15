"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, KeyRound } from "lucide-react";
import { initialAuthState, MIN_PASSWORD_LENGTH } from "@/app/login/auth-shared";
import { FormAlert, PasswordField, SubmitButton } from "@/components/auth/fields";
import { updatePassword } from "./actions";

export function ResetPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updatePassword, initialAuthState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "error") return;
    if (state.fieldErrors?.password) document.getElementById("reset-password")?.focus();
    else if (state.fieldErrors?.confirmPassword) document.getElementById("reset-confirmPassword")?.focus();
    else alertRef.current?.focus();
  }, [state]);

  const longEnough = password.length >= MIN_PASSWORD_LENGTH;
  const mismatch = confirmTouched && confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <div className="animate-rise motion-reduce:animate-none">
      <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <KeyRound size={22} aria-hidden="true" />
      </span>
      <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em]">Set a new password</h1>
      <p className="mt-2 mb-6 text-[15px] leading-relaxed text-fg-muted">
        Choose a new password for <span className="font-medium text-fg [overflow-wrap:anywhere]">{email}</span>.
      </p>

      <form action={action} noValidate className="flex flex-col gap-4">
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        {state.status === "error" && state.message && <FormAlert ref={alertRef}>{state.message}</FormAlert>}
        <PasswordField
          id="reset-password"
          name="password"
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={state.fieldErrors?.password}
          hint={
            <span className={`inline-flex items-center gap-1.5 ${longEnough ? "text-success" : ""}`}>
              <Check size={13} aria-hidden="true" className={longEnough ? "opacity-100" : "opacity-40"} />
              At least {MIN_PASSWORD_LENGTH} characters
            </span>
          }
          required
        />
        <PasswordField
          id="reset-confirmPassword"
          name="confirmPassword"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          onBlur={() => setConfirmTouched(true)}
          error={mismatch ? "Passwords don't match." : state.fieldErrors?.confirmPassword}
          required
        />
        <div className="pt-1">
          <SubmitButton pending={pending} label="Update password" pendingLabel="Updating…" />
        </div>
      </form>
    </div>
  );
}
