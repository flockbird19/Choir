"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, MailCheck } from "lucide-react";
import {
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signInWithGoogle,
  signOutFromLogin,
  signUp,
} from "@/app/login/actions";
import {
  initialAuthState,
  MIN_PASSWORD_LENGTH,
  type AuthField,
  type AuthFormState,
  type AuthView,
} from "@/app/login/auth-shared";
import {
  FormAlert,
  PasswordField,
  primaryButtonClass,
  secondaryButtonClass,
  Spinner,
  SubmitButton,
  TextField,
  textLinkClass,
} from "./fields";

const riseClass = "animate-rise motion-reduce:animate-none";

const COPY: Record<AuthView, { title: string; subtitle: string }> = {
  signin: { title: "Welcome back", subtitle: "Sign in to pick up where your team left off." },
  signup: { title: "Create your account", subtitle: "Start a workspace and bring your team in within minutes." },
  forgot: { title: "Reset your password", subtitle: "Enter your email and we'll send you a link to set a new one." },
};

const SIGNIN_FIELDS: AuthField[] = ["email", "password"];
const SIGNUP_FIELDS: AuthField[] = ["name", "email", "password", "confirmPassword"];
const FORGOT_FIELDS: AuthField[] = ["email"];

function useFocusFirstError(state: AuthFormState, prefix: string, order: AuthField[]) {
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status !== "error") return;
    const firstInvalid = order.find((field) => state.fieldErrors?.[field]);
    if (firstInvalid) {
      document.getElementById(`${prefix}-${firstInvalid}`)?.focus();
    } else {
      alertRef.current?.focus();
    }
  }, [state, prefix, order]);
  return alertRef;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853" />
      <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  );
}

function GoogleSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={secondaryButtonClass}>
      {pending ? <Spinner /> : <GoogleIcon />}
      {pending ? "Connecting to Google…" : "Continue with Google"}
    </button>
  );
}

function GoogleButton({ next }: { next: string }) {
  return (
    <form action={signInWithGoogle}>
      <input type="hidden" name="next" value={next} />
      <GoogleSubmit />
    </form>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-[13px] text-fg-subtle">
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      or continue with email
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}

function ModeTabs({ view, onChange }: { view: AuthView; onChange: (view: AuthView) => void }) {
  const tabs: { id: AuthView; label: string }[] = [
    { id: "signin", label: "Sign in" },
    { id: "signup", label: "Create account" },
  ];
  const activeIndex = view === "signup" ? 1 : 0;

  return (
    <div
      role="tablist"
      aria-label="Sign in or create an account"
      className="relative mb-6 grid grid-cols-2 rounded-xl border border-line bg-card p-1 shadow-soft"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const nextView: AuthView = view === "signin" ? "signup" : "signin";
        onChange(nextView);
        document.getElementById(`auth-tab-${nextView}`)?.focus();
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-primary-soft transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      {tabs.map((tab) => {
        const selected = view === tab.id;
        return (
          <button
            key={tab.id}
            id={`auth-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="auth-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`relative h-10 cursor-pointer rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              selected ? "text-primary" : "text-fg-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] text-fg">{title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{subtitle}</p>
    </div>
  );
}

function ResendForm({ email, next, label = "Send the link again" }: { email: string; next: string; label?: string }) {
  const [state, action, pending] = useActionState(resendConfirmation, initialAuthState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      {state.status === "resent" && <FormAlert tone="success">Sent. Check your inbox (and spam folder).</FormAlert>}
      {state.status === "error" && <FormAlert>{state.message}</FormAlert>}
      <SubmitButton pending={pending} label={label} pendingLabel="Sending…" variant="secondary" />
    </form>
  );
}

function SignInForm({
  email,
  onEmailChange,
  next,
  onForgot,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  next: string;
  onForgot: () => void;
}) {
  const [state, action, pending] = useActionState(signIn, initialAuthState);
  const alertRef = useFocusFirstError(state, "signin", SIGNIN_FIELDS);

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {state.status === "error" && state.message && (
        <FormAlert
          ref={alertRef}
          action={
            state.code === "email_not_confirmed" ? <ResendForm email={email} next={next} /> : undefined
          }
        >
          {state.message}
        </FormAlert>
      )}
      <TextField
        id="signin-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        error={state.fieldErrors?.email}
        required
      />
      <PasswordField
        id="signin-password"
        name="password"
        label="Password"
        autoComplete="current-password"
        error={state.fieldErrors?.password}
        labelAside={
          <button type="button" onClick={onForgot} className={textLinkClass}>
            Forgot password?
          </button>
        }
        required
      />
      <div className="pt-1">
        <SubmitButton pending={pending} label="Sign in" pendingLabel="Signing in…" />
      </div>
    </form>
  );
}

function CheckInbox({
  email,
  next,
  onBack,
  backLabel,
  resend,
  children,
}: {
  email: string;
  next: string;
  onBack: () => void;
  backLabel: string;
  resend: boolean;
  children: ReactNode;
}) {
  return (
    <div className={riseClass}>
      <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <MailCheck size={22} aria-hidden="true" />
      </span>
      <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em]">Check your inbox</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-muted" role="status">
        {children} <span className="font-medium text-fg [overflow-wrap:anywhere]">{email}</span>.
      </p>
      <p className="mt-2 text-sm text-fg-subtle">It can take a minute to arrive. Open the link on this device.</p>
      <div className="mt-6 flex flex-col gap-2.5">
        {resend && <ResendForm email={email} next={next} label="Resend email" />}
        <button type="button" onClick={onBack} className={`${textLinkClass} self-center py-2`}>
          {backLabel}
        </button>
      </div>
    </div>
  );
}

function SignUpForm({
  email,
  onEmailChange,
  next,
  onSwitchToSignIn,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  next: string;
  onSwitchToSignIn: () => void;
}) {
  const [state, action, pending] = useActionState(signUp, initialAuthState);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [dismissedInbox, setDismissedInbox] = useState<AuthFormState | null>(null);
  const alertRef = useFocusFirstError(state, "signup", SIGNUP_FIELDS);

  if (state.status === "check-email" && dismissedInbox !== state) {
    return (
      <CheckInbox
        email={state.email ?? email}
        next={next}
        resend
        onBack={() => setDismissedInbox(state)}
        backLabel="Use a different email"
      >
        We sent a confirmation link to
      </CheckInbox>
    );
  }

  const longEnough = password.length >= MIN_PASSWORD_LENGTH;
  const mismatch = confirmTouched && confirmPassword.length > 0 && confirmPassword !== password;
  const confirmError = mismatch ? "Passwords don't match." : state.fieldErrors?.confirmPassword;

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {state.status === "error" && state.message && (
        <FormAlert
          ref={alertRef}
          action={
            state.code === "user_already_exists" ? (
              <button type="button" onClick={onSwitchToSignIn} className={`${textLinkClass} self-start`}>
                Go to sign in
              </button>
            ) : undefined
          }
        >
          {state.message}
        </FormAlert>
      )}
      <TextField
        id="signup-name"
        name="name"
        label="Your name"
        autoComplete="name"
        placeholder="Priya Sharma"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={state.fieldErrors?.name}
        required
      />
      <TextField
        id="signup-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        error={state.fieldErrors?.email}
        required
      />
      <PasswordField
        id="signup-password"
        name="password"
        label="Password"
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
        id="signup-confirmPassword"
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        onBlur={() => setConfirmTouched(true)}
        error={confirmError}
        required
      />
      <div className="pt-1">
        <SubmitButton pending={pending} label="Create account" pendingLabel="Creating your account…" />
      </div>
    </form>
  );
}

function ForgotForm({
  email,
  onEmailChange,
  onBack,
  next,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  onBack: () => void;
  next: string;
}) {
  const [state, action, pending] = useActionState(requestPasswordReset, initialAuthState);
  const alertRef = useFocusFirstError(state, "forgot", FORGOT_FIELDS);

  if (state.status === "reset-sent") {
    return (
      <CheckInbox email={state.email ?? email} next={next} resend={false} onBack={onBack} backLabel="Back to sign in">
        If an account exists, we sent a password reset link to
      </CheckInbox>
    );
  }

  return (
    <div className={riseClass}>
      <button type="button" onClick={onBack} className={`${textLinkClass} mb-6 inline-flex items-center gap-1.5`}>
        <ArrowLeft size={15} aria-hidden="true" />
        Back to sign in
      </button>
      <Heading {...COPY.forgot} />
      <form action={action} noValidate className="flex flex-col gap-4">
        {state.status === "error" && state.message && <FormAlert ref={alertRef}>{state.message}</FormAlert>}
        <TextField
          id="forgot-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          error={state.fieldErrors?.email}
          required
        />
        <div className="pt-1">
          <SubmitButton pending={pending} label="Send reset link" pendingLabel="Sending…" />
        </div>
      </form>
    </div>
  );
}

function SignedInCard({ email, next }: { email: string; next: string }) {
  return (
    <div className={riseClass}>
      <Heading title="You're already signed in" subtitle="Continue to your workspace, or sign out to use a different account." />
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 shadow-soft">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold uppercase text-primary"
        >
          {email.charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] text-fg-subtle">Signed in as</p>
          <p className="truncate text-[15px] font-medium text-fg" title={email}>
            {email}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Link href={next} className={primaryButtonClass}>
          Continue to Choir
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <form action={signOutFromLogin}>
          <SignOutSubmit />
        </form>
      </div>
    </div>
  );
}

function SignOutSubmit() {
  const { pending } = useFormStatus();
  return <SubmitButton pending={pending} label="Sign out" pendingLabel="Signing out…" variant="secondary" />;
}

export function AuthForm({
  initialView,
  next,
  notice,
  signedInEmail,
}: {
  initialView: AuthView;
  next: string;
  notice: string | null;
  signedInEmail: string | null;
}) {
  const [view, setView] = useState<AuthView>(initialView);
  const [email, setEmail] = useState("");

  if (signedInEmail) {
    return <SignedInCard email={signedInEmail} next={next} />;
  }

  function changeView(nextView: AuthView) {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    url.searchParams.delete("error");
    window.history.replaceState(null, "", url);
  }

  if (view === "forgot") {
    return (
      <ForgotForm email={email} onEmailChange={setEmail} onBack={() => changeView("signin")} next={next} />
    );
  }

  return (
    <div className={riseClass}>
      <Heading {...COPY[view]} />
      {notice && (
        <div className="mb-5">
          <FormAlert>{notice}</FormAlert>
        </div>
      )}
      <ModeTabs view={view} onChange={changeView} />
      <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${view}`}>
        <GoogleButton next={next} />
        <Divider />
        {view === "signin" ? (
          <SignInForm email={email} onEmailChange={setEmail} next={next} onForgot={() => changeView("forgot")} />
        ) : (
          <SignUpForm email={email} onEmailChange={setEmail} next={next} onSwitchToSignIn={() => changeView("signin")} />
        )}
      </div>
    </div>
  );
}
