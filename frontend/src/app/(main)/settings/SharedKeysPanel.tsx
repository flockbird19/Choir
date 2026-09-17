"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Users } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { PROVIDER_NAMES, providerName } from "@/utils/providers";
import { getSharedKeysSetup, type LendingProject } from "./sharedKeysActions";

type Mode = "fallback" | "pool";
type Choice = Mode | "off";

/** A row of `shared_keys`: who lends which provider's key to a project. Never the key itself. */
interface SharedKeyRow {
  id: string;
  user_id: string;
  provider: string;
  mode: Mode;
}

const CHOICES: { value: Choice; label: string }[] = [
  { value: "off", label: "Not lent" },
  { value: "fallback", label: "Fallback" },
  { value: "pool", label: "Pool" },
];

const MODE_LABELS: Record<Mode, string> = { fallback: "Fallback", pool: "Pool" };

/** Who lends keys to a project, or null if the query failed. */
async function fetchRows(projectId: string): Promise<SharedKeyRow[] | null> {
  const { data, error } = await createClient()
    .from("shared_keys")
    .select("id, user_id, provider, mode")
    .eq("project_id", projectId)
    .order("created_at");
  return error ? null : ((data as SharedKeyRow[]) ?? []);
}

function LendChoice({
  provider,
  value,
  disabled,
  onChange,
}: {
  provider: string;
  value: Choice;
  disabled: boolean;
  onChange: (next: Choice) => void;
}) {
  const name = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span id={`${name}-label`} className="text-sm font-semibold text-ink">
        {providerName(provider)} key
      </span>
      <div role="radiogroup" aria-labelledby={`${name}-label`} className="flex gap-1.5">
        {CHOICES.map((choice) => (
          <label key={choice.value} className="relative">
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              disabled={disabled}
              onChange={() => onChange(choice.value)}
              className="peer sr-only"
            />
            <span
              className={
                "flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-xs font-medium transition-colors sm:min-h-8 " +
                "border-border text-graphite hover:text-ink hover:border-graphite/40 " +
                "peer-checked:border-ink peer-checked:bg-ink peer-checked:text-canvas " +
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent " +
                "peer-disabled:cursor-wait peer-disabled:opacity-60"
              }
            >
              {choice.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Settings → Shared keys (F4 + F5). Lend a saved key to one project's Team Space as a
 * fallback (used only when the key in use hits its rate limit) or into the pool
 * (Team Space replies take turns). Writes go straight to Supabase; RLS only lets
 * people lend their own saved key to a project in their team.
 */
export function SharedKeysPanel({ savedProviders }: { savedProviders: string[] }) {
  const selectId = useId();
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof getSharedKeysSetup>>>(null);
  const [setupLoaded, setSetupLoaded] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [rows, setRows] = useState<SharedKeyRow[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSharedKeysSetup()
      .then((result) => {
        if (cancelled) return;
        setSetup(result);
        setProjectId((current) => current || result?.projects[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your projects. Refresh the page to try again.");
      })
      .finally(() => {
        if (!cancelled) setSetupLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showRows = useCallback((result: SharedKeyRow[] | null) => {
    if (!result) setError("Couldn't load who lends keys to this project. Refresh the page to try again.");
    setRows(result ?? []);
  }, []);

  // Reload when the project changes, or when a saved key is added or removed (removing a
  // saved key also removes its lending rows).
  const providersKey = savedProviders.slice().sort().join(",");
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchRows(projectId).then((result) => {
      if (!cancelled) showRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, providersKey, showRows]);

  const userId = setup?.userId;
  const mine = (rows ?? []).filter((row) => row.user_id === userId);
  const others = (rows ?? []).filter((row) => row.user_id !== userId);
  const lendable = Object.keys(PROVIDER_NAMES).filter((provider) => savedProviders.includes(provider));

  const change = async (provider: string, next: Choice) => {
    if (!userId || !projectId) return;
    setPending(provider);
    setError(null);
    const supabase = createClient();
    const current = mine.find((row) => row.provider === provider);
    let failed = false;

    if (next === "off") {
      if (current) failed = !!(await supabase.from("shared_keys").delete().eq("id", current.id)).error;
    } else if (current) {
      failed = !!(await supabase.from("shared_keys").update({ mode: next }).eq("id", current.id)).error;
    } else {
      const { data: key } = await supabase
        .from("user_api_keys")
        .select("id")
        .eq("user_id", userId)
        .eq("provider", provider)
        .maybeSingle();
      failed =
        !key ||
        !!(
          await supabase
            .from("shared_keys")
            .insert({ project_id: projectId, user_id: userId, key_id: key.id, provider, mode: next })
        ).error;
    }

    showRows(await fetchRows(projectId));
    if (failed) setError(`Couldn't update your ${providerName(provider)} key. Try again.`);
    setPending(null);
  };

  const project = setup?.projects.find((p) => p.id === projectId);
  const projectLabel = (p: LendingProject) => (p.teamName && p.teamName !== p.name ? `${p.teamName} / ${p.name}` : p.name);

  return (
    <section aria-labelledby={`${selectId}-heading`} className="mt-10">
      <h2 id={`${selectId}-heading`} className="text-xs font-bold uppercase tracking-widest text-graphite mb-3 px-1">
        Shared keys
      </h2>

      <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-5">
        <div className="flex flex-col gap-2 text-sm text-graphite leading-relaxed">
          <p>
            Lend one of your saved keys to a project so Team Space keeps working for everyone. Teammates see that
            you lend a key, never the key itself.
          </p>
          <ul className="flex flex-col gap-1">
            <li>
              <span className="font-medium text-ink">Fallback:</span> used only when the key in use hits its rate
              limit.
            </li>
            <li>
              <span className="font-medium text-ink">Pool:</span> Team Space replies take turns across every pooled
              key.
            </li>
          </ul>
        </div>

        {!setupLoaded ? (
          <p className="text-sm text-graphite">Loading your projects…</p>
        ) : !setup || setup.projects.length === 0 ? (
          <p className="text-sm text-graphite">Join or create a workspace to lend a key to its Team Space.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={selectId} className="text-xs font-medium text-graphite">
                Project
              </label>
              <select
                id={selectId}
                value={projectId}
                onChange={(e) => {
                  setRows(null);
                  setError(null);
                  setProjectId(e.target.value);
                }}
                className="min-h-11 sm:min-h-10 w-full px-3 text-sm bg-canvas border border-border rounded-xl text-ink outline-none focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/30"
              >
                {setup.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {projectLabel(p)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-ink">Your keys</h3>
              {lendable.length === 0 ? (
                <p className="text-sm text-graphite">Save a key above to lend it.</p>
              ) : rows === null ? (
                <p className="text-sm text-graphite">Loading…</p>
              ) : (
                lendable.map((provider) => (
                  <LendChoice
                    key={provider}
                    provider={provider}
                    value={mine.find((row) => row.provider === provider)?.mode ?? "off"}
                    disabled={pending !== null}
                    onChange={(next) => void change(provider, next)}
                  />
                ))
              )}
              {error && (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Users size={15} strokeWidth={1.75} aria-hidden="true" className="text-graphite" />
                Teammates lending to {project?.name ?? "this project"}
              </h3>
              {rows === null ? (
                <p className="text-sm text-graphite">Loading…</p>
              ) : others.length === 0 ? (
                <p className="text-sm text-graphite">Nobody else lends a key to this project yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {others.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink">
                        {setup.names[row.user_id] ?? "Former member"}{" "}
                        <span className="text-graphite">· {providerName(row.provider)}</span>
                      </span>
                      <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs text-graphite">
                        {MODE_LABELS[row.mode] ?? row.mode}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
