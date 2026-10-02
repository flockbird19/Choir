import { Logo } from "@/components/Logo";
import { Skeleton } from "@/components/ui/Skeleton";

// The whole app shell while (main)/layout.tsx loads the workspace (only there: login and the
// other public pages show no skeleton).
export function ShellSkeleton() {
  return (
    <div className="flex h-screen w-full bg-bg overflow-hidden">

      {/* Ghost rail — matches PrimarySidebar's actual 64px width */}
      <div className="w-16 h-full bg-sunken border-r border-line flex flex-col items-center py-4 gap-3 shrink-0 z-20">
        <div className="grid size-10 place-items-center rounded-[14px]">
          <Logo className="size-6 text-fg-subtle" />
        </div>
        <div className="h-px w-6 bg-line" />
        <div className="flex flex-col gap-2 w-full items-center">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="size-11 rounded-[12px]" />
          ))}
        </div>
      </div>

      {/* Ghost channel column — matches SecondarySidebar's actual 264px width */}
      <div className="w-[264px] h-full bg-bg border-r border-line flex flex-col shrink-0 z-10 hidden md:flex">
        <div className="flex h-14 items-center border-b border-line px-4">
          <Skeleton className="w-28 h-4" />
        </div>
        <div className="flex-1 p-4 space-y-6">
          <div>
            <Skeleton className="w-16 h-3 mb-3" />
            <Skeleton className="w-full h-9 rounded-control" />
          </div>
          <div>
            <Skeleton className="w-20 h-3 mb-3" />
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="w-full h-9 rounded-control" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ghost main content area */}
      <div className="flex-1 flex flex-col h-full relative">
        <div className="px-5 py-3.5 border-b border-line flex items-center justify-between sticky top-0">
          <div className="flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-control" />
            <div className="space-y-1.5">
              <Skeleton className="w-32 h-4" />
              <Skeleton className="w-48 h-3" />
            </div>
          </div>
          <Skeleton className="w-9 h-9 rounded-control" />
        </div>

        <div className="flex-1 p-6 space-y-6 overflow-hidden flex flex-col justify-end">
          {[1, 2, 3].map(i => (
            <div key={i} className={`flex gap-3 max-w-[80%] ${i % 2 === 0 ? 'ml-auto flex-row-reverse' : ''}`}>
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <Skeleton className={`h-16 w-64 rounded-bubble ${i % 2 === 0 ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]'}`} />
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-line">
          <Skeleton className="w-full max-w-3xl mx-auto h-11 rounded-pill" />
        </div>
      </div>

    </div>
  );
}
