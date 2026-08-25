import { Logo } from "@/components/Logo";

export default function MainLoading() {
  return (
    <div className="flex h-screen w-full bg-canvas overflow-hidden">
      
      {/* ── Ghost Primary Sidebar ── */}
      <div className="w-16 h-full bg-surface border-r border-border flex flex-col items-center py-4 gap-6 shrink-0 z-20">
        <div className="w-10 h-10 rounded-xl bg-accent/20 animate-pulse flex items-center justify-center">
          <Logo className="w-6 h-6 text-accent/50" />
        </div>
        <div className="flex flex-col gap-4 w-full px-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="w-10 h-10 rounded-xl bg-graphite/10 animate-pulse" />
          ))}
        </div>
      </div>

      {/* ── Ghost Secondary Sidebar ── */}
      <div className="w-64 h-full bg-surface border-r border-border flex flex-col shrink-0 z-10 hidden md:flex">
        <div className="px-4 py-5 border-b border-border">
          <div className="w-24 h-5 bg-graphite/10 rounded-md animate-pulse" />
        </div>
        <div className="flex-1 p-4 space-y-6">
          <div>
            <div className="w-12 h-3 bg-graphite/10 rounded-md animate-pulse mb-3" />
            <div className="w-full h-10 bg-graphite/10 rounded-lg animate-pulse" />
          </div>
          <div>
            <div className="w-16 h-3 bg-graphite/10 rounded-md animate-pulse mb-3" />
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="w-full h-10 bg-graphite/10 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Ghost Main Content Area ── */}
      <div className="flex-1 flex flex-col h-full relative">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-graphite/10 animate-pulse" />
            <div className="space-y-2">
              <div className="w-32 h-4 bg-graphite/10 rounded-md animate-pulse" />
              <div className="w-48 h-3 bg-graphite/10 rounded-md animate-pulse" />
            </div>
          </div>
          <div className="w-20 h-8 bg-graphite/10 rounded-lg animate-pulse" />
        </div>

        <div className="flex-1 p-6 space-y-6 overflow-hidden flex flex-col justify-end">
           {[1, 2, 3].map(i => (
             <div key={i} className={`flex gap-3 max-w-[80%] ${i % 2 === 0 ? 'ml-auto flex-row-reverse' : ''}`}>
               <div className="w-8 h-8 rounded-full bg-graphite/10 animate-pulse shrink-0" />
               <div className={`h-16 w-64 bg-graphite/10 rounded-2xl animate-pulse ${i % 2 === 0 ? 'rounded-tr-sm' : 'rounded-tl-sm'}`} />
             </div>
           ))}
        </div>

        <div className="p-4 border-t border-border">
          <div className="w-full max-w-3xl mx-auto h-12 rounded-2xl bg-graphite/10 animate-pulse" />
        </div>
      </div>

    </div>
  );
}
