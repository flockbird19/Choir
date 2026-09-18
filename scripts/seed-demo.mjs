#!/usr/bin/env node
// Builds a believable demo workspace for the pitch video / live demo: a team,
// one project, a Team Space with a realistic conversation, three members with
// profiles, two pinned Decisions, and one private thread. Assistant messages
// are written directly as rows — this never calls a real AI model.
//
// Safe to re-run: it always looks up its own fixed demo accounts by email and
// deletes them (and, via cascade, everything they own) before recreating them.
// It only ever touches those accounts — never the protected live users/teams.
//
// Usage (needs frontend/node_modules, so resolve @supabase/supabase-js from
// there rather than requiring a second install at the repo root):
//   node scripts/seed-demo.mjs

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createClient } = require(path.join(__dirname, "..", "frontend", "node_modules", "@supabase", "supabase-js"));

const envPath = path.join(__dirname, "..", "frontend", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in frontend/.env.local");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEAM_NAME = "Choir Demo";
const DEMO_PASSWORD = "ChoirDemo123!";
const MEMBERS = [
  { email: "demo.asha@choir.example", name: "Asha Rao", status: "online" },
  { email: "demo.devon@choir.example", name: "Devon Lee", status: "online" },
  { email: "demo.priya@choir.example", name: "Priya Nair", status: "away" },
];

// ── 1. Clear any previous run's demo accounts (and, via cascade, their team) ──
async function findUserByEmail(email) {
  // No admin.getUserByEmail in this SDK version; page through listUsers.
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found;
    if (data.users.length < 200) break;
  }
  return null;
}

const existing = [];
for (const m of MEMBERS) {
  const user = await findUserByEmail(m.email);
  if (user) existing.push(user);
}
if (existing.length) {
  const { data: oldTeams } = await admin
    .from("teams")
    .select("id")
    .eq("name", TEAM_NAME)
    .in("created_by", existing.map((u) => u.id));
  for (const t of oldTeams ?? []) {
    await admin.from("teams").delete().eq("id", t.id); // cascades project/thread/message rows
  }
  for (const u of existing) {
    await admin.auth.admin.deleteUser(u.id); // cascades that user's profile row
  }
  console.log(`Removed ${existing.length} demo account(s) from a previous run.`);
}

// ── 2. Create the demo members ────────────────────────────────────────────────
const userIds = {};
for (const m of MEMBERS) {
  const { data, error } = await admin.auth.admin.createUser({
    email: m.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: m.name },
  });
  if (error) throw error;
  userIds[m.email] = data.user.id;
  // The sign-up trigger already created the profile row; just set a status.
  const { error: statusErr } = await admin
    .from("profiles")
    .update({ status: m.status })
    .eq("id", data.user.id);
  if (statusErr) throw statusErr;
}
const ashaId = userIds["demo.asha@choir.example"];
const devonId = userIds["demo.devon@choir.example"];
const priyaId = userIds["demo.priya@choir.example"];

// ── 3. Team, project, Team Space ──────────────────────────────────────────────
const { data: team, error: teamErr } = await admin
  .from("teams")
  .insert({ name: TEAM_NAME, created_by: ashaId })
  .select()
  .single();
if (teamErr) throw teamErr;

const { error: membersErr } = await admin.from("team_members").insert([
  { team_id: team.id, user_id: ashaId, role: "owner" },
  { team_id: team.id, user_id: devonId, role: "member" },
  { team_id: team.id, user_id: priyaId, role: "member" },
]);
if (membersErr) throw membersErr;

const { data: project, error: projErr } = await admin
  .from("projects")
  .insert({ team_id: team.id, name: "EcoRoute", created_by: ashaId })
  .select()
  .single();
if (projErr) throw projErr;

const { data: shared, error: sharedErr } = await admin
  .from("threads")
  .insert({ project_id: project.id, type: "shared", owner_id: ashaId, name: "Team Space" })
  .select()
  .single();
if (sharedErr) throw sharedErr;

// ── 4. A realistic Team Space conversation, with two pinned Decisions ────────
const baseTime = new Date();
baseTime.setHours(baseTime.getHours() - 3);
const minutesLater = (n) => new Date(baseTime.getTime() + n * 60_000).toISOString();

const sharedMessages = [
  { sender_type: "user", sender_id: ashaId, at: 0,
    content: "Morning team — let's lock the EcoRoute demo scope today. I think we cut the offline map cache and focus on the live carpool matching." },
  { sender_type: "user", sender_id: devonId, at: 2,
    content: "Agreed, offline cache is a rabbit hole. Matching + the ETA estimate is the actual wow moment for judges." },
  { sender_type: "assistant", sender_id: null, at: 3, model_provider: "anthropic", model_name: "claude-haiku-4-5",
    content: "Summarizing so far: scope is carpool matching + ETA estimate for the demo; offline map caching is out. Want me to draft the judging-round pitch outline around that?" },
  { sender_type: "user", sender_id: priyaId, at: 6,
    content: "Yes please. Also — I got the matching algorithm returning results in ~400ms on the sample dataset, which is good enough for a live demo." },
  { sender_type: "user", sender_id: ashaId, at: 9, is_decision: true, pinned_by: ashaId,
    content: "Decision: EcoRoute demo scope is carpool matching + ETA estimate only. Offline map cache is cut for now." },
  { sender_type: "user", sender_id: devonId, at: 12,
    content: "On it — I'll wire the ETA card into the results list this afternoon." },
  { sender_type: "assistant", sender_id: null, at: 13, model_provider: "anthropic", model_name: "claude-haiku-4-5",
    content: "Pitch outline drafted: 1) the commute-sharing problem, 2) live match + ETA demo, 3) the carbon-saved counter, 4) ask. Want it posted as a Decision so it's easy to find later?" },
  { sender_type: "user", sender_id: priyaId, at: 16,
    content: "Let's also add a stretch goal: a 'carbon saved this week' counter on the results screen, purely for the demo's closing beat." },
  { sender_type: "user", sender_id: ashaId, at: 18, is_decision: true, pinned_by: ashaId,
    content: "Decision: add a 'carbon saved this week' counter as the closing beat of the demo, stretch goal if time allows." },
  { sender_type: "user", sender_id: devonId, at: 21,
    content: "Sounds good. I'll ping here once the ETA card is live so Priya can wire the matching result into it." },
];

for (const m of sharedMessages) {
  const row = {
    thread_id: shared.id,
    sender_type: m.sender_type,
    sender_id: m.sender_id,
    content: m.content,
    created_at: minutesLater(m.at),
  };
  if (m.model_provider) { row.model_provider = m.model_provider; row.model_name = m.model_name; }
  if (m.is_decision) { row.is_decision = true; row.pinned_by = m.pinned_by; row.pinned_at = minutesLater(m.at); }
  const { error } = await admin.from("messages").insert(row);
  if (error) throw error;
}

// ── 5. One private thread (Asha exploring something on her own) ─────────────
const { data: priv, error: privErr } = await admin
  .from("threads")
  .insert({ project_id: project.id, type: "private", owner_id: ashaId, name: "Judging Q&A prep" })
  .select()
  .single();
if (privErr) throw privErr;

const privateMessages = [
  { sender_type: "user", sender_id: ashaId, at: 25,
    content: "What are judges likely to ask about a carpool-matching demo that only has sample data, not real users?" },
  { sender_type: "assistant", sender_id: null, at: 26, model_provider: "anthropic", model_name: "claude-haiku-4-5",
    content: "Likely questions: how matching handles conflicting time windows, what happens with zero nearby matches, and how you'd bootstrap the first users in a city. Want draft answers for each?" },
  { sender_type: "user", sender_id: ashaId, at: 27,
    content: "Yes — keep them short, one or two sentences each, so I can say them without notes." },
];
for (const m of privateMessages) {
  const row = {
    thread_id: priv.id,
    sender_type: m.sender_type,
    sender_id: m.sender_id,
    content: m.content,
    created_at: minutesLater(m.at),
  };
  if (m.model_provider) { row.model_provider = m.model_provider; row.model_name = m.model_name; }
  const { error } = await admin.from("messages").insert(row);
  if (error) throw error;
}

console.log("Demo workspace ready.");
console.log(`Team: ${TEAM_NAME} (${team.id})`);
console.log("Sign in as any of:");
for (const m of MEMBERS) console.log(`  ${m.email}  /  ${DEMO_PASSWORD}`);
