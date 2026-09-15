import type { User } from "@supabase/supabase-js";

export function getDisplayName(user: Pick<User, "email" | "user_metadata"> | null | undefined): string {
  const metadata = user?.user_metadata;
  const savedName =
    (typeof metadata?.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata?.name === "string" && metadata.name.trim());
  return savedName || user?.email?.split("@")[0] || "User";
}
