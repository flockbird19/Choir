import { Skeleton } from "@/components/ui/Skeleton";

// Shaped like TeamPageClient: icon + name header, then the Members list and other sections.
export default function TeamLoading() {
  return (
    <main className="relative h-full overflow-y-auto bg-bg" aria-busy="true">
      <span className="sr-only" role="status">Loading team…</span>
      <div className="mx-auto flex max-w-[720px] flex-col gap-10 px-4 py-10 sm:px-8">
        <div className="flex items-start gap-5">
          <Skeleton className="size-[72px] rounded-[20px]" />
          <div className="flex-1 space-y-2.5 pt-1">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <div className="divide-y divide-line rounded-card border border-line bg-card">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-32 w-full rounded-card" />
        </div>
      </div>
    </main>
  );
}
