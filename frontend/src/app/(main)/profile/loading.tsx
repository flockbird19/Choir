import { Skeleton } from "@/components/ui/Skeleton";

// Shaped like profile/page.tsx: header, then the avatar, name and status card.
export default function ProfileLoading() {
  return (
    <main className="h-full overflow-y-auto bg-bg" aria-busy="true">
      <span className="sr-only" role="status">Loading profile…</span>
      <div className="max-w-lg mx-auto px-6 py-10">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <Skeleton className="size-10 rounded-card" />
            <Skeleton className="h-8 w-28" />
          </div>
          <Skeleton className="h-3.5 w-56 ml-[52px]" />
        </div>
        <div className="flex items-center gap-4 mb-8">
          <Skeleton className="size-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-11 w-full rounded-control" />
          <Skeleton className="h-28 w-full rounded-card" />
        </div>
      </div>
    </main>
  );
}
