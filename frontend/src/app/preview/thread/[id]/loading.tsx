import { Skeleton } from "@/components/ui/Skeleton";

export default function PreviewThreadLoading() {
  return (
    <div data-ds className="flex h-full w-full bg-bg" aria-busy="true" aria-label="Loading thread">
      <div className="hidden w-sidebar shrink-0 flex-col gap-4 border-r border-line bg-sunken p-3 md:flex">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-8 w-full" />
        <div className="flex flex-col gap-2 pt-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-4 h-3 w-28" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-5/6" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-header items-center gap-3 border-b border-line px-4">
          <Skeleton className="size-8" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="mx-auto flex w-full max-w-measure flex-1 flex-col justify-end gap-6 px-6 pb-6">
          <div className="flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-14 w-3/4 rounded-bubble" />
            </div>
          </div>
          <Skeleton className="h-10 w-1/2 self-end rounded-bubble" />
          <div className="flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </div>
        <div className="px-6 pb-5">
          <Skeleton className="mx-auto h-24 w-full max-w-measure rounded-sheet" />
        </div>
      </div>
    </div>
  );
}
