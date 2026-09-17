"""
Live access-rule (RLS) tests (B3).

These sign in real temporary users with the public anon key, the same way a
browser does, and check that the rules in schema.sql stop cross-user and
cross-team access. They talk to the live Supabase project, so they only run
when you opt in:

    RLS_TESTS=1 uv run pytest -q tests/test_rls.py

Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (backend/.env) and
SUPABASE_ANON_KEY (falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY in
frontend/.env.local). All test data uses choir.e2e.rls.<random>@example.com
users and is deleted at the end, even when a test fails.

Tests for Batch 1 columns and tables skip until schema.sql has been run.
"""

import os
import secrets
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from dotenv import dotenv_values, load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or dotenv_values(BACKEND_DIR.parent / "frontend" / ".env.local").get(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", ""
) or ""

if os.getenv("RLS_TESTS") != "1":
    pytest.skip("live RLS tests are opt-in: set RLS_TESTS=1", allow_module_level=True)
if not (URL and SERVICE_KEY and ANON_KEY):
    pytest.skip(
        "RLS tests need SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY", allow_module_level=True
    )

BASE_TABLES = [
    "teams", "team_members", "projects", "threads", "messages",
    "user_api_keys", "team_invitations", "thread_reads", "ai_request_log",
]  # fmt: skip

# Batch 1 schema pieces: name -> (table, column) used to probe whether it exists yet.
FEATURES = {
    "invite_expiry": ("team_invitations", "expires_at,revoked_at"),
    "forks": ("threads", "forked_from_message_id"),
    "published_posts": ("messages", "source_thread_id"),
    "notifications": ("notifications", "id"),
    "shared_keys": ("shared_keys", "id"),
}


class Rest:
    """A PostgREST client acting as one caller (anon, a signed-in user, or the service key)."""

    def __init__(self, http: httpx.Client, apikey: str, token: str | None = None):
        self.http = http
        self.headers = {"apikey": apikey, "Authorization": f"Bearer {token or apikey}"}

    def select(self, table: str, columns: str = "*", **filters: str) -> httpx.Response:
        return self.http.get(f"/rest/v1/{table}", params={"select": columns, **filters}, headers=self.headers)

    def insert(self, table: str, row: dict) -> httpx.Response:
        return self.http.post(
            f"/rest/v1/{table}", json=row, headers={**self.headers, "Prefer": "return=representation"}
        )

    def update(self, table: str, values: dict, **filters: str) -> httpx.Response:
        return self.http.patch(
            f"/rest/v1/{table}",
            params=filters,
            json=values,
            headers={**self.headers, "Prefer": "return=representation"},
        )

    def delete(self, table: str, **filters: str) -> httpx.Response:
        return self.http.delete(
            f"/rest/v1/{table}", params=filters, headers={**self.headers, "Prefer": "return=representation"}
        )


def ok(response: httpx.Response) -> list[dict]:
    assert response.is_success, f"{response.status_code}: {response.text}"
    return response.json()


def assert_denied(response: httpx.Response) -> None:
    """The database refused the request outright (an access rule or a column permission)."""
    assert response.status_code in (401, 403), f"expected a permission error, got {response.status_code}: {response.text}"


def assert_blocked(response: httpx.Response) -> None:
    """Refused outright, or allowed to run but matched no rows the caller may touch."""
    if response.status_code in (401, 403):
        return
    assert response.status_code == 200, f"unexpected {response.status_code}: {response.text}"
    assert response.json() == [], f"caller could reach rows it shouldn't: {response.json()}"


def eq(value: str) -> str:
    return f"eq.{value}"


# ── Test data ────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def world():
    """
    Team 1: A (owner) and B (member), project P1 with a shared thread S1 and
    private threads PA (A's) and PB (B's). Team 2: C alone, project P2 with a
    shared thread S2. Everyone has a saved API key.
    """
    http = httpx.Client(base_url=URL, timeout=30)
    admin = Rest(http, SERVICE_KEY)
    run = secrets.token_hex(4)
    users: list[str] = []
    teams: list[str] = []

    def create_user(label: str) -> SimpleNamespace:
        email = f"choir.e2e.rls.{run}.{label}@example.com"
        password = secrets.token_urlsafe(18)
        response = http.post(
            "/auth/v1/admin/users",
            json={"email": email, "password": password, "email_confirm": True},
            headers=admin.headers,
        )
        assert response.is_success, response.text
        user_id = response.json()["id"]
        users.append(user_id)
        token = http.post(
            "/auth/v1/token",
            params={"grant_type": "password"},
            json={"email": email, "password": password},
            headers={"apikey": ANON_KEY},
        )
        assert token.is_success, token.text
        return SimpleNamespace(id=user_id, api=Rest(http, ANON_KEY, token.json()["access_token"]))

    def insert(table: str, row: dict) -> dict:
        return ok(admin.insert(table, row))[0]

    try:
        features = {
            name for name, (table, columns) in FEATURES.items() if admin.select(table, columns, limit="0").is_success
        }
        a, b, c = create_user("a"), create_user("b"), create_user("c")

        t1 = insert("teams", {"name": f"e2e rls {run} one", "created_by": a.id})["id"]
        teams.append(t1)
        t2 = insert("teams", {"name": f"e2e rls {run} two", "created_by": c.id})["id"]
        teams.append(t2)
        insert("team_members", {"team_id": t1, "user_id": a.id, "role": "owner"})
        insert("team_members", {"team_id": t1, "user_id": b.id, "role": "member"})
        insert("team_members", {"team_id": t2, "user_id": c.id, "role": "owner"})

        p1 = insert("projects", {"team_id": t1, "name": "P1", "created_by": a.id})["id"]
        p2 = insert("projects", {"team_id": t2, "name": "P2", "created_by": c.id})["id"]
        s1 = insert("threads", {"project_id": p1, "type": "shared", "name": "Team Space"})["id"]
        s2 = insert("threads", {"project_id": p2, "type": "shared", "name": "Team Space"})["id"]
        pa = insert("threads", {"project_id": p1, "type": "private", "owner_id": a.id, "name": "A private"})["id"]
        pb = insert("threads", {"project_id": p1, "type": "private", "owner_id": b.id, "name": "B private"})["id"]

        # One message at a time: PostgREST bulk inserts need identical keys.
        def message(thread: str, sender: str | None, content: str) -> str:
            kind = "assistant" if sender is None else "user"
            return insert("messages", {"thread_id": thread, "sender_type": kind, "sender_id": sender, "content": content})[
                "id"
            ]

        m_s1_a = message(s1, a.id, "A in the team space")
        m_s1_ai = message(s1, None, "AI in the team space")
        m_s1_b = message(s1, b.id, "B in the team space")
        m_pa = message(pa, a.id, "A private note")
        m_pb = message(pb, b.id, "B private note")

        def api_key(user: SimpleNamespace) -> str:
            return insert("user_api_keys", {"user_id": user.id, "provider": "anthropic", "encrypted_key": "not-a-key"})[
                "id"
            ]

        key_a, key_b, key_c = api_key(a), api_key(b), api_key(c)
        invite_t1 = insert("team_invitations", {"team_id": t1, "created_by": a.id})
        invite_t1_spare = insert("team_invitations", {"team_id": t1, "created_by": a.id})
        insert("thread_reads", {"thread_id": s1, "user_id": a.id})

        notif_a = notif_b = None
        if "notifications" in features:
            notif_a = insert("notifications", {"user_id": a.id, "team_id": t1, "kind": "e2e"})["id"]
            notif_b = insert("notifications", {"user_id": b.id, "team_id": t1, "kind": "e2e"})["id"]

        yield SimpleNamespace(
            http=http, admin=admin, anon=Rest(http, ANON_KEY), features=features,
            a=a, b=b, c=c, t1=t1, t2=t2, p1=p1, p2=p2, s1=s1, s2=s2, pa=pa, pb=pb,
            m_s1_a=m_s1_a, m_s1_ai=m_s1_ai, m_s1_b=m_s1_b, m_pa=m_pa, m_pb=m_pb,
            key_a=key_a, key_b=key_b, key_c=key_c,
            invite_t1=invite_t1, invite_t1_spare=invite_t1_spare,
            notif_a=notif_a, notif_b=notif_b,
        )  # fmt: skip
    finally:
        # Teams first (cascades to projects, threads, messages, invites, shared keys,
        # notifications), then users (cascades to their keys and read state).
        for team_id in teams:
            admin.delete("teams", id=eq(team_id))
        for user_id in users:
            http.delete(f"/auth/v1/admin/users/{user_id}", headers=admin.headers)
        http.close()


def needs(world, feature: str) -> None:
    if feature not in world.features:
        pytest.skip(f"schema.sql Batch 1 not applied on this database yet (missing {FEATURES[feature]})")


def admin_row(world, table: str, row_id: str) -> dict:
    rows = ok(world.admin.select(table, id=eq(row_id)))
    assert len(rows) == 1
    return rows[0]


# ── Anonymous callers ────────────────────────────────────────────────────────


def test_anon_key_sees_no_rows_in_any_table(world):
    tables = BASE_TABLES + [t for t in ("notifications", "shared_keys") if t in world.features]
    for table in tables:
        assert_blocked(world.anon.select(table, limit="5"))


def test_anon_key_cannot_write(world):
    assert_denied(world.anon.insert("messages", {"thread_id": world.s1, "sender_type": "user", "content": "anon"}))
    assert_denied(world.anon.insert("teams", {"name": "anon team"}))


# ── Outsiders (signed in, not in the team) ──────────────────────────────────


def test_outsider_cannot_read_another_team(world):
    c = world.c.api
    assert_blocked(c.select("teams", id=eq(world.t1)))
    assert_blocked(c.select("team_members", team_id=eq(world.t1)))
    assert_blocked(c.select("projects", id=eq(world.p1)))
    assert_blocked(c.select("threads", id=f"in.({world.s1},{world.pa})"))
    assert_blocked(c.select("messages", thread_id=eq(world.s1)))
    assert_blocked(c.select("team_invitations", team_id=eq(world.t1)))
    assert_blocked(c.select("thread_reads", user_id=eq(world.a.id)))
    # Control: C does see their own team.
    assert len(ok(c.select("teams", id=eq(world.t2)))) == 1


def test_outsider_cannot_join_create_threads_or_post(world):
    c = world.c
    assert_denied(c.api.insert("team_members", {"team_id": world.t1, "user_id": c.id, "role": "member"}))
    assert_denied(c.api.insert("threads", {"project_id": world.p1, "type": "private", "owner_id": c.id}))
    assert_denied(
        c.api.insert("messages", {"thread_id": world.s1, "sender_type": "user", "sender_id": c.id, "content": "hi"})
    )
    assert_denied(c.api.insert("team_invitations", {"team_id": world.t1, "created_by": c.id}))


# ── Members misusing their access ───────────────────────────────────────────


def test_member_reads_team_space(world):
    b = world.b.api
    assert len(ok(b.select("threads", id=eq(world.s1)))) == 1
    assert len(ok(b.select("messages", thread_id=eq(world.s1)))) >= 3


def test_member_cannot_post_as_ai_or_someone_else(world):
    b = world.b
    assert_denied(
        b.api.insert("messages", {"thread_id": world.s1, "sender_type": "assistant", "sender_id": None, "content": "x"})
    )
    assert_denied(
        b.api.insert("messages", {"thread_id": world.s1, "sender_type": "assistant", "sender_id": b.id, "content": "x"})
    )
    assert_denied(
        b.api.insert("messages", {"thread_id": world.s1, "sender_type": "user", "sender_id": world.a.id, "content": "x"})
    )
    # Control: posting as yourself works.
    ok(b.api.insert("messages", {"thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "me"}))


def test_member_cannot_create_shared_threads_or_threads_for_others(world):
    b = world.b
    assert_denied(b.api.insert("threads", {"project_id": world.p1, "type": "shared", "owner_id": b.id}))
    assert_denied(b.api.insert("threads", {"project_id": world.p1, "type": "private", "owner_id": world.a.id}))
    # Control: a private thread of your own works.
    ok(b.api.insert("threads", {"project_id": world.p1, "type": "private", "owner_id": b.id, "name": "extra"}))


def test_member_can_pin_only_in_shared_threads(world):
    b = world.b.api
    # Control: pinning in the Team Space works.
    assert len(ok(b.update("messages", {"is_decision": True}, id=eq(world.m_s1_a)))) == 1
    ok(b.update("messages", {"is_decision": False}, id=eq(world.m_s1_a)))
    # Not in a private thread, even your own.
    assert_blocked(b.update("messages", {"is_decision": True}, id=eq(world.m_pb)))
    assert admin_row(world, "messages", world.m_pb)["is_decision"] is False


def test_member_cannot_edit_message_content_or_sender(world):
    b = world.b
    for message_id in (world.m_s1_a, world.m_s1_ai, world.m_s1_b):
        assert_denied(b.api.update("messages", {"content": "rewritten"}, id=eq(message_id)))
        assert admin_row(world, "messages", message_id)["content"] != "rewritten"
    assert_denied(b.api.update("messages", {"sender_id": b.id}, id=eq(world.m_s1_a)))
    assert_denied(b.api.update("messages", {"thread_id": world.pb}, id=eq(world.m_s1_a)))


def test_member_cannot_delete_messages(world):
    assert_blocked(world.b.api.delete("messages", id=eq(world.m_s1_a)))
    assert admin_row(world, "messages", world.m_s1_a)


# ── Known holes (2026-09-17) ────────────────────────────────────────────────
# These document gaps found by this suite. They are expected to fail until
# schema.sql is fixed; strict=True makes the suite fail once a gap is closed,
# as a reminder to delete the marker.


@pytest.mark.xfail(strict=True, reason="hole: message inserts accept any shared_by / pin fields / created_at")
def test_member_cannot_forge_message_metadata(world):
    b = world.b
    post = {"thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "forged"}
    assert_denied(b.api.insert("messages", {**post, "shared_by": world.a.id}))
    assert_denied(b.api.insert("messages", {**post, "is_decision": True, "pinned_by": world.a.id}))
    assert_denied(b.api.insert("messages", {**post, "created_at": "2020-01-01T00:00:00Z"}))


@pytest.mark.xfail(strict=True, reason="hole: a pin can be credited to another member")
def test_member_cannot_pin_in_someone_elses_name(world):
    b = world.b.api
    response = b.update("messages", {"is_decision": True, "pinned_by": world.a.id}, id=eq(world.m_s1_b))
    try:
        assert_blocked(response)
    finally:
        world.admin.update("messages", {"is_decision": False, "pinned_by": None}, id=eq(world.m_s1_b))


@pytest.mark.xfail(strict=True, reason="hole: invite links can be created in another member's name")
def test_member_cannot_create_invites_as_someone_else(world):
    assert_denied(world.b.api.insert("team_invitations", {"team_id": world.t1, "created_by": world.a.id}))


@pytest.mark.xfail(strict=True, reason="hole: read state can be saved for threads you can't open")
def test_cannot_save_read_state_for_a_thread_you_cannot_open(world):
    assert_denied(world.b.api.insert("thread_reads", {"thread_id": world.pa, "user_id": world.b.id}))


# ── Private threads and keys ────────────────────────────────────────────────


def test_member_cannot_read_or_delete_another_members_private_thread(world):
    b = world.b.api
    assert_blocked(b.select("threads", id=eq(world.pa)))
    assert_blocked(b.select("messages", thread_id=eq(world.pa)))
    assert_blocked(b.select("messages", id=eq(world.m_pa)))
    assert_blocked(b.delete("threads", id=eq(world.pa)))
    assert admin_row(world, "threads", world.pa)
    # Control: the owner sees it.
    assert len(ok(world.a.api.select("messages", thread_id=eq(world.pa)))) == 1


def test_member_cannot_read_or_write_another_members_api_keys(world):
    b = world.b
    assert_blocked(b.api.select("user_api_keys", user_id=eq(world.a.id)))
    assert_blocked(b.api.select("user_api_keys", id=eq(world.key_a)))
    assert_denied(b.api.insert("user_api_keys", {"user_id": world.a.id, "provider": "openai", "encrypted_key": "x"}))
    assert_blocked(b.api.update("user_api_keys", {"encrypted_key": "x"}, id=eq(world.key_a)))
    assert_blocked(b.api.delete("user_api_keys", id=eq(world.key_a)))
    assert admin_row(world, "user_api_keys", world.key_a)["encrypted_key"] == "not-a-key"
    # Control: your own key is visible.
    assert [row["id"] for row in ok(b.api.select("user_api_keys", "id"))] == [world.key_b]


def test_mute_only_works_on_your_own_private_thread(world):
    a, b = world.a.api, world.b.api
    # Control: the owner can mute and unmute.
    assert len(ok(a.update("threads", {"ai_auto_reply": False}, id=eq(world.pa)))) == 1
    ok(a.update("threads", {"ai_auto_reply": True}, id=eq(world.pa)))
    assert_blocked(b.update("threads", {"ai_auto_reply": False}, id=eq(world.pa)))
    assert_blocked(a.update("threads", {"ai_auto_reply": False}, id=eq(world.s1)))
    assert admin_row(world, "threads", world.pa)["ai_auto_reply"] is True
    assert admin_row(world, "threads", world.s1)["ai_auto_reply"] is True
    # Only the mute column can change, even on your own thread.
    assert_denied(a.update("threads", {"type": "shared"}, id=eq(world.pa)))
    assert_denied(a.update("threads", {"project_id": world.p2}, id=eq(world.pa)))


# ── Invite links (L5) ───────────────────────────────────────────────────────


def test_outsider_cannot_read_or_revoke_invites(world):
    needs(world, "invite_expiry")
    invite_id = world.invite_t1["id"]
    assert_blocked(world.c.api.select("team_invitations", id=eq(invite_id)))
    assert_blocked(world.c.api.update("team_invitations", {"revoked_at": "2026-01-01T00:00:00Z"}, id=eq(invite_id)))
    assert admin_row(world, "team_invitations", invite_id)["revoked_at"] is None


def test_member_can_revoke_but_not_change_an_invite(world):
    needs(world, "invite_expiry")
    b = world.b.api
    invite = world.invite_t1
    assert_denied(b.update("team_invitations", {"token": invite["id"]}, id=eq(invite["id"])))
    assert_denied(b.update("team_invitations", {"team_id": world.t2}, id=eq(invite["id"])))
    assert_denied(b.update("team_invitations", {"expires_at": "2099-01-01T00:00:00Z"}, id=eq(invite["id"])))
    row = admin_row(world, "team_invitations", invite["id"])
    assert (row["token"], row["team_id"], row["revoked_at"]) == (invite["token"], world.t1, None)
    # Control: any member can revoke.
    spare = world.invite_t1_spare["id"]
    assert len(ok(b.update("team_invitations", {"revoked_at": "2026-09-17T00:00:00Z"}, id=eq(spare)))) == 1
    assert admin_row(world, "team_invitations", spare)["revoked_at"] is not None


# ── Forks (D2) and published posts (K2) ─────────────────────────────────────


def test_cannot_fork_from_a_message_you_cannot_see(world):
    needs(world, "forks")
    b, c = world.b, world.c
    fork = {"type": "private", "name": "fork"}
    assert_denied(b.api.insert("threads", {**fork, "project_id": world.p1, "owner_id": b.id, "forked_from_message_id": world.m_pa}))
    assert_denied(c.api.insert("threads", {**fork, "project_id": world.p2, "owner_id": c.id, "forked_from_message_id": world.m_s1_a}))
    # Control: forking from a Team Space message you can see works.
    ok(b.api.insert("threads", {**fork, "project_id": world.p1, "owner_id": b.id, "forked_from_message_id": world.m_s1_a}))


def test_published_post_cannot_point_at_someone_elses_private_thread(world):
    needs(world, "published_posts")
    b = world.b
    post = {"thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "findings"}
    assert_denied(b.api.insert("messages", {**post, "source_thread_id": world.pa}))
    assert_denied(b.api.insert("messages", {**post, "source_thread_id": world.s2}))
    # Control: pointing at your own private thread works.
    ok(b.api.insert("messages", {**post, "source_thread_id": world.pb}))


# ── Notifications (F3) ──────────────────────────────────────────────────────


def test_notifications_are_private_and_only_read_state_changes(world):
    needs(world, "notifications")
    a = world.a
    both = f"in.({world.notif_a},{world.notif_b})"
    assert [row["id"] for row in ok(a.api.select("notifications", "id", id=both))] == [world.notif_a]
    # Control: marking your own as read works.
    assert len(ok(a.api.update("notifications", {"read_at": "2026-09-17T00:00:00Z"}, id=eq(world.notif_a)))) == 1
    assert_blocked(a.api.update("notifications", {"read_at": "2026-09-17T00:00:00Z"}, id=eq(world.notif_b)))
    assert admin_row(world, "notifications", world.notif_b)["read_at"] is None
    assert_denied(a.api.update("notifications", {"kind": "changed"}, id=eq(world.notif_a)))
    assert_denied(a.api.update("notifications", {"user_id": world.b.id}, id=eq(world.notif_a)))
    assert_denied(a.api.insert("notifications", {"user_id": a.id, "kind": "self-made"}))
    assert_denied(a.api.insert("notifications", {"user_id": world.b.id, "kind": "spoofed"}))


# ── Shared keys (F4/F5) ─────────────────────────────────────────────────────


def test_shared_keys_rules(world):
    needs(world, "shared_keys")
    a, b, c = world.a, world.b, world.c
    lend = {"project_id": world.p1, "provider": "anthropic", "mode": "fallback"}

    # Can't lend someone else's key, under their name or yours, or a key under the wrong provider.
    assert_denied(b.api.insert("shared_keys", {**lend, "user_id": b.id, "key_id": world.key_a}))
    assert_denied(b.api.insert("shared_keys", {**lend, "user_id": a.id, "key_id": world.key_a}))
    assert_denied(a.api.insert("shared_keys", {**lend, "user_id": a.id, "key_id": world.key_a, "provider": "openai"}))
    # Can't lend to another team's project.
    assert_denied(c.api.insert("shared_keys", {**lend, "user_id": c.id, "key_id": world.key_c}))

    # Control: A lends their own key to their own project.
    row = ok(a.api.insert("shared_keys", {**lend, "user_id": a.id, "key_id": world.key_a}))[0]

    # Teammates see who lends; outsiders don't; nobody else sees the key itself.
    assert [r["id"] for r in ok(b.api.select("shared_keys", "id,user_id", project_id=eq(world.p1)))] == [row["id"]]
    assert_blocked(c.api.select("shared_keys", id=eq(row["id"])))
    assert_blocked(b.api.select("user_api_keys", id=eq(world.key_a)))

    # Others can't change or remove A's row.
    assert_blocked(b.api.update("shared_keys", {"mode": "pool"}, id=eq(row["id"])))
    assert_blocked(b.api.delete("shared_keys", id=eq(row["id"])))
    assert admin_row(world, "shared_keys", row["id"])["mode"] == "fallback"

    # A may change only the mode.
    assert len(ok(a.api.update("shared_keys", {"mode": "pool"}, id=eq(row["id"])))) == 1
    assert_denied(a.api.update("shared_keys", {"key_id": world.key_b}, id=eq(row["id"])))
    assert_denied(a.api.update("shared_keys", {"project_id": world.p2}, id=eq(row["id"])))
    assert_denied(a.api.update("shared_keys", {"user_id": b.id}, id=eq(row["id"])))
    assert_denied(a.api.update("shared_keys", {"provider": "openai"}, id=eq(row["id"])))
