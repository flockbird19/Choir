import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { buttonClasses } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="h-full min-h-screen flex flex-col items-center justify-center bg-bg p-8">
      <div className="max-w-md w-full flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-card bg-card border border-line flex items-center justify-center mb-6">
          <FileQuestion size={28} className="text-fg-subtle" aria-hidden="true" />
        </div>

        <h1 className="font-display text-4xl text-fg mb-3">Page not found</h1>
        <p className="text-fg-muted text-base mb-8 leading-relaxed">
          We couldn&rsquo;t find the page you were looking for. It might have been moved or deleted.
        </p>

        <Link href="/" className={buttonClasses({ variant: "primary" })}>
          <ArrowLeft size={16} aria-hidden="true" />
          Return to Workspace
        </Link>
      </div>
    </main>
  );
}
