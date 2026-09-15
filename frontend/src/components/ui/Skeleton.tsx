import { cn } from "./cn";

/** Placeholder block while content loads. Pulses opacity only; still under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-selected motion-reduce:animate-none", className)}
    />
  );
}
