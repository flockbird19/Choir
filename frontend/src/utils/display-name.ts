import type { User } from "@supabase/supabase-js";

export function getDisplayName(user: Pick<User, "email" | "user_metadata"> | null | undefined): string {
  const metadata = user?.user_metadata;
  const savedName =
    (typeof metadata?.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata?.name === "string" && metadata.name.trim());
  return savedName || user?.email?.split("@")[0] || "User";
}

// K2: a published post only names the private thread's owner (who is always the poster),
// never the thread's name or contents.
export function publishedLabel(isOwn: boolean, ownerName: string): string {
  return isOwn ? "Published from your private thread" : `Published from ${ownerName}'s private thread`;
}

export function getInitials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
