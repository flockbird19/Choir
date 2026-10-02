import { Skeleton } from "@/components/ui/Skeleton";

// Shaped like settings/page.tsx: header, API keys, Connect your AI.
export default function SettingsLoading() {
  return (
    <main className="h-full overflow-y-auto bg-bg" aria-busy="true">
      <span className="sr-only" role="status">Loading settings…</span>
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <Skeleton className="size-10 rounded-card" />
            <Skeleton className="h-8 w-36" />
          </div>
          <Skeleton className="h-3.5 w-full mb-2" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <Skeleton className="h-3 w-20 mb-3" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-card" />
          ))}
        </div>
        <Skeleton className="h-3 w-32 mt-10 mb-3" />
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    </main>
  );
}
