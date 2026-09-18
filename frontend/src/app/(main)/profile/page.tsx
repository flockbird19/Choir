import { getCurrentUser } from "@/utils/supabase/access";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { User as UserIcon } from "lucide-react";
import { ProfileClient } from "./ProfileClient";
import type { StatusId } from "./actions";
import { getDisplayName, getInitials } from "@/utils/display-name";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile — Choir",
  description: "Manage your Choir account and profile preferences.",
};

const STATUS_IDS: StatusId[] = ["online", "away", "dnd", "offline"];

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, status")
    .eq("id", user.id)
    .single();

  // profiles is the source of truth (E4); fall back if the row is somehow missing.
  const displayName = profile?.display_name || getDisplayName(user);
  const email = user.email || "";
  const initials = getInitials(displayName);
  const initialStatus: StatusId = STATUS_IDS.includes(profile?.status as StatusId)
    ? (profile!.status as StatusId)
    : "online";

  return (
    <main className="h-full overflow-y-auto bg-canvas">
      <div className="max-w-lg mx-auto px-6 py-10">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <UserIcon size={18} className="text-accent" />
            </div>
            <h1 className="font-serif text-3xl text-ink">Profile</h1>
          </div>
          <p className="text-graphite text-sm ml-[52px]">Manage your account and preferences.</p>
        </div>

        <ProfileClient
          initialName={displayName}
          email={email}
          initials={initials}
          initialStatus={initialStatus}
        />
      </div>
    </main>
  );
}
