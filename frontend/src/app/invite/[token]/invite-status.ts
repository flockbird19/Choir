export const EXPIRED_INVITE_MESSAGE = "This invite link has expired. Ask your teammate for a new one.";

type InviteDates = { expires_at?: string | null; revoked_at?: string | null };

/** An invite link stops working once it is revoked or past its expiry date (L5). */
export function isInviteUsable(invite: InviteDates, now = Date.now()): boolean {
  if (invite.revoked_at) return false;
  // No expires_at only happens before schema.sql adds the column; treat those links as live.
  return !invite.expires_at || new Date(invite.expires_at).getTime() > now;
}
