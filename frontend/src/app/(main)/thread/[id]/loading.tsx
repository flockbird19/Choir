import { Skeleton } from "@/components/ui/Skeleton";

export default function ThreadLoading() {
  return (
    <div className="flex-1 flex flex-col w-full h-full relative overflow-hidden bg-bg">
      {/* Header skeleton — matches ThreadView's actual icon+title+action layout */}
      <div className="px-5 py-3.5 border-b border-line flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Skeleton className="w-9 h-9 rounded-control shrink-0" />
          <div className="space-y-1.5">
            <Skeleton className="w-40 h-4" />
            <Skeleton className="w-56 h-2.5" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="w-9 h-9 rounded-control" />
          <Skeleton className="w-28 h-9 rounded-pill hidden sm:block" />
        </div>
      </div>

      {/* Messages skeleton */}
      <div className="flex-1 p-6 space-y-8 overflow-hidden flex flex-col justify-end pb-8">
        <div className="flex gap-4 max-w-3xl w-full mx-auto">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-3 pt-1">
            <Skeleton className="w-24 h-3" />
            <Skeleton className="w-full h-24 rounded-bubble" />
          </div>
        </div>

        <div className="flex gap-4 max-w-3xl w-full mx-auto flex-row-reverse">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-3 pt-1 flex flex-col items-end">
            <Skeleton className="w-16 h-3" />
            <Skeleton className="w-2/3 h-16 rounded-bubble" />
          </div>
        </div>

        <div className="flex gap-4 max-w-3xl w-full mx-auto">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-3 pt-1">
            <Skeleton className="w-24 h-3" />
            <Skeleton className="w-5/6 h-32 rounded-bubble" />
          </div>
        </div>
      </div>

      {/* Composer skeleton */}
      <div className="p-4 border-t border-line bg-card/80 backdrop-blur-md sticky bottom-0">
        <Skeleton className="w-full max-w-3xl mx-auto h-11 rounded-pill" />
      </div>
    </div>
  );
}
