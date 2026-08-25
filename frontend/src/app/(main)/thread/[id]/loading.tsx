export default function ThreadLoading() {
  return (
    <div className="flex-1 flex flex-col w-full h-full relative overflow-hidden bg-canvas">
      {/* Header Skeleton */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-canvas z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-graphite/10 animate-pulse" />
          <div className="space-y-1.5">
            <div className="w-40 h-4 bg-graphite/10 rounded-md animate-pulse" />
            <div className="w-56 h-2.5 bg-graphite/10 rounded-md animate-pulse" />
          </div>
        </div>
        <div className="flex gap-2">
           <div className="w-20 h-8 bg-graphite/10 rounded-lg animate-pulse" />
           <div className="w-24 h-8 bg-graphite/10 rounded-lg animate-pulse hidden sm:block" />
        </div>
      </div>

      {/* Messages Skeleton */}
      <div className="flex-1 p-6 space-y-8 overflow-hidden flex flex-col justify-end pb-8">
        
        {/* AI Message Skeleton */}
        <div className="flex gap-4 max-w-3xl w-full mx-auto">
          <div className="w-8 h-8 rounded-full bg-graphite/10 animate-pulse shrink-0" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="w-24 h-3 bg-graphite/10 rounded-md animate-pulse" />
            <div className="w-full h-24 bg-graphite/10 rounded-xl animate-pulse" />
          </div>
        </div>

        {/* User Message Skeleton */}
        <div className="flex gap-4 max-w-3xl w-full mx-auto flex-row-reverse">
          <div className="w-8 h-8 rounded-full bg-graphite/10 animate-pulse shrink-0" />
          <div className="flex-1 space-y-3 pt-1 flex flex-col items-end">
            <div className="w-16 h-3 bg-graphite/10 rounded-md animate-pulse" />
            <div className="w-2/3 h-16 bg-graphite/10 rounded-xl animate-pulse" />
          </div>
        </div>

        {/* AI Message Skeleton */}
        <div className="flex gap-4 max-w-3xl w-full mx-auto">
          <div className="w-8 h-8 rounded-full bg-graphite/10 animate-pulse shrink-0" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="w-24 h-3 bg-graphite/10 rounded-md animate-pulse" />
            <div className="w-5/6 h-32 bg-graphite/10 rounded-xl animate-pulse" />
          </div>
        </div>

      </div>

      {/* Input Skeleton */}
      <div className="p-4 border-t border-border bg-canvas/80 backdrop-blur-md sticky bottom-0">
        <div className="w-full max-w-3xl mx-auto h-12 rounded-2xl bg-graphite/10 animate-pulse" />
      </div>
    </div>
  );
}
