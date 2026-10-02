import { Skeleton } from "@/components/ui/Skeleton";

// Shaped like home/page.tsx: centred greeting and the thread shortcuts.
export default function HomeLoading() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-bg p-8" aria-busy="true">
      <span className="sr-only" role="status">Loading…</span>
      <div className="max-w-md w-full flex flex-col items-center">
        <Skeleton className="size-14 rounded-card mb-6" />
        <Skeleton className="h-9 w-56 mb-3" />
        <Skeleton className="h-4 w-72 mb-10" />
        <div className="w-full space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[74px] w-full rounded-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
