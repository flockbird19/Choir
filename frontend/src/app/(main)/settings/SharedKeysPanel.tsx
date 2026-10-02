"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Users, ChevronDown } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { PROVIDER_NAMES, providerName } from "@/utils/providers";
import { getSharedKeysSetup, type LendingProject } from "./sharedKeysActions";
import { Menu, MenuRadioItem } from "@/components/ui";
import { Skeleton } from "@/components/ui/Skeleton";

// Placeholder rows while the lending setup loads (DESIGN.md 6: skeletons, not "Loading…" text).
const LoadingRows = ({ label }: { label: string }) => (
  <div role="status" aria-label={label} className="space-y-2">
    <Skeleton className="h-11 w-full rounded-control" />
    <Skeleton className="h-11 w-full rounded-control" />
  </div>
);

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
      <span id={`${name}-label`} className="text-sm font-semibold text-fg">
        {providerName(provider)} key
      </span>
      <div role="radiogroup" aria-labelledby={`${name}-label`} className="flex flex-wrap gap-1.5">
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
                "flex min-h-11 cursor-pointer items-center whitespace-nowrap rounded-pill border px-3.5 text-xs font-medium transition-colors sm:min-h-8 " +
                "border-line-strong text-fg-muted hover:text-fg hover:border-fg-subtle " +
                "peer-checked:border-fg peer-checked:bg-fg peer-checked:text-bg " +
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-team " +
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
      <h2 id={`${selectId}-heading`} className="text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-fg-subtle mb-3 px-1">
        Shared keys
      </h2>

      <div className="bg-card border border-line rounded-card p-5 flex flex-col gap-5">
        <div className="flex flex-col gap-2 text-sm text-fg-muted leading-relaxed">
          <p>
            Lend one of your saved keys to a project so Team Space keeps working for everyone. Teammates see that
            you lend a key, never the key itself.
          </p>
          <ul className="flex flex-col gap-1">
            <li>
              <span className="font-medium text-fg">Fallback:</span> used only when the key in use hits its rate
              limit.
            </li>
            <li>
              <span className="font-medium text-fg">Pool:</span> Team Space replies take turns across every pooled
              key.
            </li>
          </ul>
        </div>

        {!setupLoaded ? (
          <LoadingRows label="Loading your projects" />
        ) : !setup || setup.projects.length === 0 ? (
          <p className="text-sm text-fg-muted">Join or create a workspace to lend a key to its Team Space.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span id={selectId} className="text-xs font-medium text-fg-muted">
                Project
              </span>
              <Menu
                label="Project"
                wrapperClassName="w-full"
                trigger={(props) => (
                  <button
                    {...props}
                    type="button"
                    aria-labelledby={`${selectId} ${props.id}`}
                    disabled={pending !== null}
                    className="focus-ring-in-container flex w-full items-center justify-between gap-2 px-3.5 h-11 sm:h-10 text-sm bg-card border border-field-line rounded-control text-fg outline-none focus:border-team focus:ring-2 focus:ring-team/25 disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="truncate">{project ? projectLabel(project) : "Select a project"}</span>
                    <ChevronDown size={16} className="text-fg-muted shrink-0" aria-hidden="true" />
                  </button>
                )}
              >
                {setup.projects.map((p) => (
                  <MenuRadioItem
                    key={p.id}
                    checked={p.id === projectId}
                    onSelect={() => {
                      if (p.id === projectId) return;
                      setRows(null);
                      setError(null);
                      setProjectId(p.id);
                    }}
                  >
                    {projectLabel(p)}
                  </MenuRadioItem>
                ))}
              </Menu>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-fg">Your keys</h3>
              {lendable.length === 0 ? (
                <p className="text-sm text-fg-muted">Save a key above to lend it.</p>
              ) : rows === null ? (
                <LoadingRows label="Loading" />
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

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Users size={15} strokeWidth={1.75} aria-hidden="true" className="text-fg-muted" />
                Teammates lending to {project?.name ?? "this project"}
              </h3>
              {rows === null ? (
                <LoadingRows label="Loading" />
              ) : others.length === 0 ? (
                <p className="text-sm text-fg-muted">Nobody else lends a key to this project yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {others.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-fg">
                        {setup.names[row.user_id] ?? "Former member"}{" "}
                        <span className="text-fg-muted">· {providerName(row.provider)}</span>
                      </span>
                      <span className="shrink-0 rounded-pill border border-line px-2.5 py-0.5 text-xs text-fg-muted">
                        {CHOICES.find((c) => c.value === row.mode)?.label ?? row.mode}
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
