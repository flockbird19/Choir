import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="h-full min-h-screen flex flex-col items-center justify-center bg-canvas p-8">
      <div className="max-w-md w-full flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center mb-6 shadow-sm">
          <FileQuestion size={28} className="text-graphite/60" aria-hidden="true" />
        </div>

        <h1 className="font-serif text-4xl text-ink mb-3">Page not found</h1>
        <p className="text-graphite text-base mb-8 leading-relaxed">
          We couldn&rsquo;t find the page you were looking for. It might have been moved or deleted.
        </p>

        <Link
          href="/"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-all shadow-sm shadow-accent/25"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Return to Workspace
        </Link>
      </div>
    </main>
  );
}
