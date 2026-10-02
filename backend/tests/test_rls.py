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

import base64
import hashlib
import os
import secrets
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from dotenv import dotenv_values, load_dotenv

from backend.db import verify_thread_access

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
    "reply": ("messages", "reply_to_message_id"),
    "withdraw": ("messages", "withdrawn_at,publish_edited"),
    "context": ("project_memory", "project_id"),
    "attachments": ("messages", "attachments"),
    "team_page": ("teams", "icon_kind,description"),
    "tasks": ("tasks", "id,status,claimed_by"),
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

    def rpc(self, function: str, args: dict) -> httpx.Response:
        return self.http.post(f"/rest/v1/rpc/{function}", json=args, headers=self.headers)


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
    file_threads: list[str] = []

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
        file_threads.extend([s1, s2, pa, pb])

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
        # Stored files don't cascade with their threads: remove every test thread's folder.
        for thread_id in file_threads:
            if thread_id:
                listed = http.post(
                    "/storage/v1/object/list/attachments",
                    json={"prefix": thread_id, "limit": 1000},
                    headers=admin.headers,
                )
                folders = [f"{thread_id}/{f['name']}" for f in (listed.json() if listed.is_success else [])]
                for folder in folders:
                    inner = http.post(
                        "/storage/v1/object/list/attachments", json={"prefix": folder, "limit": 1000}, headers=admin.headers
                    )
                    paths = [f"{folder}/{f['name']}" for f in (inner.json() if inner.is_success else [])]
                    if paths:
                        http.request("DELETE", "/storage/v1/object/attachments", json={"prefixes": paths}, headers=admin.headers)
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


def admin_row_by(world, table: str, column: str, value: str) -> dict:
    rows = ok(world.admin.select(table, **{column: eq(value)}))
    assert len(rows) == 1
    return rows[0]


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


def test_member_cannot_forge_message_metadata(world):
    b = world.b
    post = {"thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "forged"}
    assert_denied(b.api.insert("messages", {**post, "shared_by": world.a.id}))
    assert_denied(b.api.insert("messages", {**post, "is_decision": True, "pinned_by": world.a.id}))
    assert_denied(b.api.insert("messages", {**post, "created_at": "2020-01-01T00:00:00Z"}))


def test_member_cannot_pin_in_someone_elses_name(world):
    b = world.b.api
    response = b.update("messages", {"is_decision": True, "pinned_by": world.a.id}, id=eq(world.m_s1_b))
    try:
        assert_blocked(response)
    finally:
        world.admin.update("messages", {"is_decision": False, "pinned_by": None}, id=eq(world.m_s1_b))


def test_member_cannot_create_invites_as_someone_else(world):
    assert_denied(world.b.api.insert("team_invitations", {"team_id": world.t1, "created_by": world.a.id}))


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
    # Control (L23): blocking mute on Team Space doesn't block renaming it.
    assert len(ok(b.update("threads", {"name": "Renamed"}, id=eq(world.s1)))) == 1
    ok(b.update("threads", {"name": "Team Space"}, id=eq(world.s1)))
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


def test_published_post_source_ids_cannot_point_outside_what_you_can_see(world):
    # 2026-09-28 (L20): source_message_ids's own check had the identical shadowing bug as the
    # reply check below, silently masked by its coalesce fallback — this is the negative test
    # that would have caught it, added retroactively once the bug was found.
    needs(world, "published_posts")
    b = world.b
    # A message in team 2's shared thread — b (team 1) cannot see it.
    foreign = ok(world.admin.insert("messages", {
        "thread_id": world.s2, "sender_type": "user", "sender_id": world.c.id, "content": "not yours",
    }))[0]["id"]
    post = {"thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "findings"}
    assert_denied(b.api.insert("messages", {**post, "source_message_ids": [foreign]}))
    # Control: pointing at a message you can see (your own private note) works.
    ok(b.api.insert("messages", {**post, "source_message_ids": [world.m_pb]}))


def test_reply_must_point_at_a_message_in_the_same_thread(world):
    # 2026-09-28 (L20, K20): the reply check's own shadowing bug rejected every reply, valid or
    # not, until fixed — this is the negative test that should have existed from the start.
    needs(world, "reply")
    b = world.b
    post = {"thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "replying"}
    # world.m_pa is in a different thread (A's private thread) than s1.
    assert_denied(b.api.insert("messages", {**post, "reply_to_message_id": world.m_pa}))
    # Control: replying to a message actually in this thread works.
    ok(b.api.insert("messages", {**post, "reply_to_message_id": world.m_s1_a}))


# ── Withdrawing a publication (curation) ────────────────────────────────────


def test_only_your_own_publication_can_be_withdrawn(world):
    needs(world, "withdraw")
    a, b = world.a, world.b
    pub = ok(b.api.insert("messages", {
        "thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "oops, my key",
        "shared_by": b.id, "source_thread_id": world.pb, "source_message_ids": [world.m_pb], "publish_edited": True,
    }))[0]["id"]  # fmt: skip
    ok(a.api.update("messages", {"is_decision": True, "pinned_by": a.id, "pinned_at": "2026-09-29T00:00:00Z"}, id=eq(pub)))
    ok(world.admin.insert("thread_summaries", {"thread_id": world.s1, "summary": "mentions oops", "covers_through": "2026-09-29T00:00:00Z"}))

    # Someone else's publication, and your own ordinary message, can't be withdrawn.
    assert_denied(a.api.rpc("withdraw_publication", {"p_message_id": pub}))
    assert_denied(b.api.rpc("withdraw_publication", {"p_message_id": world.m_s1_b}))
    assert admin_row(world, "messages", pub)["content"] == "oops, my key"
    assert admin_row(world, "messages", world.m_s1_b)["content"] == "B in the team space"

    # Control: withdrawing your own publication clears it everywhere it could leak from.
    response = b.api.rpc("withdraw_publication", {"p_message_id": pub})
    assert response.is_success, f"{response.status_code}: {response.text}"
    row = admin_row(world, "messages", pub)
    assert row["content"] == "" and row["withdrawn_at"] is not None
    assert row["is_decision"] is False and row["pinned_by"] is None and row["source_message_ids"] is None
    assert ok(world.admin.select("thread_summaries", thread_id=eq(world.s1))) == []

    # It can't be pinned again, or withdrawn twice.
    assert_blocked(a.api.update("messages", {"is_decision": True, "pinned_by": a.id}, id=eq(pub)))
    assert admin_row(world, "messages", pub)["is_decision"] is False
    assert_denied(b.api.rpc("withdraw_publication", {"p_message_id": pub}))


# ── File attachments (2026-09-30) ───────────────────────────────────────────


def _file(thread_id: str, name: str = "notes.txt", size: int = 5) -> dict:
    return {"path": f"{thread_id}/{secrets.token_hex(8)}/{name}", "name": name, "size": size, "type": "text/plain"}


def _upload(api, path: str, body: bytes = b"hello", content_type: str = "text/plain") -> httpx.Response:
    return api.http.post(
        f"/storage/v1/object/attachments/{path}",
        content=body,
        # Same as the app: without it the storage CDN keeps serving a removed file for an hour.
        headers={**api.headers, "Content-Type": content_type, "cache-control": "no-cache"},
    )


def _stored(api, thread_id: str, name: str = "notes.txt", body: bytes = b"hello", content_type: str = "text/plain") -> dict:
    """Uploads a real file as this caller and returns its attachment entry."""
    file = {**_file(thread_id, name, len(body)), "type": content_type}
    response = _upload(api, file["path"], body, content_type)
    assert response.is_success, f"{response.status_code}: {response.text}"
    return file


def _download(api, path: str) -> httpx.Response:
    return api.http.get(f"/storage/v1/object/authenticated/attachments/{path}", headers=api.headers)


def _sign(api, path: str) -> httpx.Response:
    return api.http.post(f"/storage/v1/object/sign/attachments/{path}", json={"expiresIn": 60}, headers=api.headers)


def _remove(api, path: str) -> httpx.Response:
    return api.http.request("DELETE", "/storage/v1/object/attachments", json={"prefixes": [path]}, headers=api.headers)


def _post(user, thread_id: str, files, **extra) -> httpx.Response:
    row = {"thread_id": thread_id, "sender_type": "user", "sender_id": user.id, "content": "", "attachments": files}
    return user.api.insert("messages", {**row, **extra})


def test_attachment_lists_are_well_formed_and_from_the_messages_own_thread(world):
    needs(world, "attachments")
    a = world.a
    mine = _stored(a.api, world.s1)
    private = _stored(a.api, world.pa)
    # A file from your own private thread can't be pulled into Team Space by pointing at it.
    assert_denied(_post(a, world.s1, [private]))
    # Malformed lists are refused, never an error.
    for bad in (
        [{**mine, "path": f"{world.s1}/../{world.pb}/x"}],
        [{**mine, "path": "not-a-thread/x/y.txt"}],
        [mine] * 11,
        [{**mine, "size": 10485761}],
        [{**mine, "size": "5"}],
        [{**mine, "name": ""}],
        [{**mine, "name": "report‮fdp.exe"}],
        [{**mine, "name": "two\nlines.txt"}],
        [],
        {"path": mine["path"]},
        ["just a string"],
    ):
        assert_denied(_post(a, world.s1, bad))
    # Control: your own stored files, in this thread, described truthfully.
    row = ok(_post(a, world.s1, [mine, _stored(a.api, world.s1, "b.txt")]))[0]
    assert len(row["attachments"]) == 2
    ok(_post(a, world.pa, [private]))


def test_a_message_can_only_list_your_own_real_files(world):
    needs(world, "attachments")
    a, b = world.a, world.b
    theirs = _stored(a.api, world.s1, "draft.txt")
    # Pointing at a teammate's unsent file, or at a file that doesn't exist, is refused.
    assert_denied(_post(b, world.s1, [theirs]))
    assert_denied(_post(b, world.s1, [_file(world.s1)]))
    # The size and type must be the stored file's own: no "invoice, 2 KB" label on something else.
    mine = _stored(b.api, world.s1, "photo.png", b"\x89PNG....", "image/png")
    assert_denied(_post(b, world.s1, [{**mine, "size": 2048}]))
    assert_denied(_post(b, world.s1, [{**mine, "type": "application/pdf"}]))
    # Control: the truth is accepted.
    ok(_post(b, world.s1, [mine]))


def test_files_are_seen_only_once_sent_and_follow_thread_access(world):
    needs(world, "attachments")
    a, b, c = world.a, world.b, world.c
    team_file = _stored(a.api, world.s1)
    private_file = _stored(a.api, world.pa)

    # Waiting in A's composer: only A can read it, not even a teammate.
    assert _download(a.api, team_file["path"]).is_success
    assert not _download(b.api, team_file["path"]).is_success
    assert not _sign(b.api, team_file["path"]).is_success
    # Nor can a teammate list the folder to find unsent files.
    listed = b.api.http.post(
        "/storage/v1/object/list/attachments", json={"prefix": world.s1, "limit": 100}, headers=b.api.headers
    )
    assert listed.is_success and team_file["path"].split("/")[1] not in [f["name"] for f in listed.json()]

    # Control: once sent, teammates read it and get links.
    ok(_post(a, world.s1, [team_file]))
    response = _download(b.api, team_file["path"])
    assert response.is_success and response.content == b"hello"
    assert _sign(b.api, team_file["path"]).is_success

    # A private file stays A's alone, sent or not: no read, no link for anyone else.
    ok(_post(a, world.pa, [private_file]))
    for api in (b.api, c.api, world.anon):
        assert not _download(api, private_file["path"]).is_success
        assert not _sign(api, private_file["path"]).is_success
    # An outsider can't read Team Space files either.
    assert not _download(c.api, team_file["path"]).is_success
    assert not _sign(c.api, team_file["path"]).is_success

    # No uploads into threads you can't open, outside a thread folder, escaping it, or anonymously.
    assert not _upload(b.api, _file(world.pa)["path"]).is_success
    assert not _upload(c.api, _file(world.s1)["path"]).is_success
    assert not _upload(a.api, "not-a-thread/x/y.txt").is_success
    assert not _upload(a.api, f"{world.s1}/x/../../{world.pb}/y.txt").is_success
    assert not _upload(world.anon, _file(world.s1)["path"]).is_success
    # A stored file can't be replaced (even asking for an overwrite) or moved.
    assert not _upload(a.api, team_file["path"], b"changed").is_success
    overwrite = a.api.http.post(
        f"/storage/v1/object/attachments/{team_file['path']}",
        content=b"changed",
        headers={**a.api.headers, "Content-Type": "text/plain", "x-upsert": "true"},
    )
    assert not overwrite.is_success
    moved = a.api.http.post(
        "/storage/v1/object/move",
        json={"bucketId": "attachments", "sourceKey": team_file["path"], "destinationKey": f"{world.s1}/moved/x.txt"},
        headers=a.api.headers,
    )
    assert not moved.is_success
    assert _download(b.api, team_file["path"]).content == b"hello"
    # A teammate can't copy a private file into Team Space (they can't read it).
    copied = b.api.http.post(
        "/storage/v1/object/copy",
        json={"bucketId": "attachments", "sourceKey": private_file["path"], "destinationKey": f"{world.s1}/stolen/x.txt"},
        headers=b.api.headers,
    )
    assert not copied.is_success

    # Only the uploader removes a file. A teammate's or outsider's attempt removes nothing.
    _remove(b.api, team_file["path"])
    _remove(c.api, team_file["path"])
    assert _download(a.api, team_file["path"]).is_success
    removed = _remove(a.api, team_file["path"])
    assert removed.is_success and len(removed.json()) == 1
    # Nobody can get a new link to it (the app only ever shows fresh links). The storage CDN may
    # still hand the bytes to someone who fetched them moments before; that can't be revoked.
    assert not _sign(a.api, team_file["path"]).is_success
    assert not _sign(b.api, team_file["path"]).is_success


def test_stored_files_are_capped_at_10_mb(world):
    needs(world, "attachments")
    a = world.a
    assert not _upload(a.api, _file(world.s1)["path"], b"x" * (10 * 1024 * 1024 + 1)).is_success
    # Control: exactly 10 MB is accepted.
    assert _upload(a.api, _file(world.s1)["path"], b"x" * (10 * 1024 * 1024)).is_success


def test_uploads_are_limited_per_person_per_hour(world):
    needs(world, "attachments")
    c = world.c
    # Control: 60 uploads in an hour are fine.
    for i in range(60):
        response = _upload(c.api, _file(world.s2, f"f{i}.txt")["path"], b"x")
        assert response.is_success, f"upload {i + 1}: {response.status_code} {response.text}"
    # The 61st is refused.
    assert not _upload(c.api, _file(world.s2, "one-too-many.txt")["path"], b"x").is_success


def test_withdrawing_a_publication_clears_its_attachments_and_hides_them(world):
    needs(world, "attachments")
    needs(world, "withdraw")
    a, b = world.a, world.b
    shot = _stored(b.api, world.s1, "shot.png", b"\x89PNG", "image/png")
    pub = ok(_post(b, world.s1, [shot], content="screenshot", shared_by=b.id, source_thread_id=world.pb))[0]["id"]
    assert _sign(a.api, shot["path"]).is_success
    response = b.api.rpc("withdraw_publication", {"p_message_id": pub})
    assert response.is_success, f"{response.status_code}: {response.text}"
    assert admin_row(world, "messages", pub)["attachments"] is None
    # Not in a live message any more: teammates can't get a link, even before it's removed.
    assert not _sign(a.api, shot["path"]).is_success


# ── Context and project memory (component #4) ───────────────────────────────


def test_project_memory_is_team_only_and_edited_in_your_own_name(world):
    needs(world, "context")
    b, c = world.b, world.c
    note = [{"id": "n1", "section": "goal", "text": "A plant monitor", "sources": [], "by": b.id}]
    # Control: a member creates it in their own name, reads it, and edits it.
    ok(b.api.insert("project_memory", {"project_id": world.p1, "items": note, "version": 1, "updated_by": b.id}))
    assert len(ok(b.api.select("project_memory", project_id=eq(world.p1)))) == 1
    assert len(ok(b.api.update("project_memory", {"items": [], "version": 2, "updated_by": b.id}, project_id=eq(world.p1)))) == 1
    # Not in someone else's name, and not the AI's coverage marker.
    assert_denied(b.api.update("project_memory", {"items": note, "updated_by": world.a.id}, project_id=eq(world.p1)))
    assert_denied(b.api.update("project_memory", {"covers_through": "2026-01-01T00:00:00Z"}, project_id=eq(world.p1)))
    # An outsider can't read, edit or create it.
    assert_blocked(c.api.select("project_memory", project_id=eq(world.p1)))
    assert_blocked(c.api.update("project_memory", {"items": note, "updated_by": c.id}, project_id=eq(world.p1)))
    assert_denied(c.api.insert("project_memory", {"project_id": world.p1, "items": note, "updated_by": c.id}))
    assert admin_row_by(world, "project_memory", "project_id", world.p1)["items"] == []


def test_members_cannot_create_or_pin_compact_checkpoints(world):
    needs(world, "context")
    a, b = world.a, world.b
    post = {"thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "fake summary"}
    assert_denied(b.api.insert("messages", {**post, "kind": "checkpoint"}))
    assert_denied(b.api.insert("messages", {**post, "covers_through": "2026-01-01T00:00:00Z"}))
    checkpoint = ok(world.admin.insert("messages", {
        "thread_id": world.s1, "sender_type": "assistant", "kind": "checkpoint", "content": "summary",
        "covers_through": "2026-01-01T00:00:00Z", "covers_count": 3,
    }))[0]["id"]
    assert_blocked(a.api.update("messages", {"is_decision": True, "pinned_by": a.id}, id=eq(checkpoint)))
    assert admin_row(world, "messages", checkpoint)["is_decision"] is False
    # Control: pinning an ordinary message still works.
    assert len(ok(a.api.update("messages", {"is_decision": True, "pinned_by": a.id}, id=eq(world.m_s1_b)))) == 1
    ok(a.api.update("messages", {"is_decision": False, "pinned_by": None, "pinned_at": None}, id=eq(world.m_s1_b)))


def test_withdrawing_also_undoes_covering_checkpoints_and_memory_notes(world):
    needs(world, "context")
    b = world.b
    pub = ok(b.api.insert("messages", {
        "thread_id": world.s1, "sender_type": "user", "sender_id": b.id, "content": "my key sk-oops",
        "shared_by": b.id, "source_thread_id": world.pb,
    }))[0]
    covering = ok(world.admin.insert("messages", {
        "thread_id": world.s1, "sender_type": "assistant", "kind": "checkpoint", "content": "mentions sk-oops",
        "covers_through": pub["created_at"], "covers_count": 4,
    }))[0]["id"]
    earlier = ok(world.admin.insert("messages", {
        "thread_id": world.s1, "sender_type": "assistant", "kind": "checkpoint", "content": "older summary",
        "covers_through": "2020-01-01T00:00:00Z", "covers_count": 1,
    }))[0]["id"]
    world.admin.delete("project_memory", project_id=eq(world.p1))
    ok(world.admin.insert("project_memory", {"project_id": world.p1, "version": 1, "items": [
        {"id": "cites", "section": "facts", "text": "Key is sk-oops", "sources": [pub["id"]], "by": "ai"},
        {"id": "other", "section": "goal", "text": "A plant monitor", "sources": [world.m_s1_a], "by": "ai"},
    ]}))

    response = b.api.rpc("withdraw_publication", {"p_message_id": pub["id"]})
    assert response.is_success, f"{response.status_code}: {response.text}"
    assert admin_row(world, "messages", covering)["withdrawn_at"] is not None
    assert admin_row(world, "messages", earlier)["withdrawn_at"] is None
    items = admin_row_by(world, "project_memory", "project_id", world.p1)["items"]
    assert [i["id"] for i in items] == ["other"]


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


# ── Cross-verification: RLS vs. the backend's own access check (2026-09-28) ───
# verify_thread_access is the *entire* authorization layer for /api/chat, /api/digest
# and /api/export (they run under the service-role key, which bypasses RLS entirely),
# and is documented as matching the RLS rules above — but nothing proved that until
# now. Runs the same thread/user pairs through both paths so a future change to one
# without the other fails here instead of silently diverging.


def rls_allows(user, table: str, row_id: str) -> bool:
    """True if the RLS SELECT policy lets this user see this row."""
    response = user.api.select(table, id=eq(row_id))
    return response.is_success and response.json() != []


@pytest.mark.parametrize("user_key,thread_key,expected", [
    ("a", "s1", True),   # owner, shared thread
    ("b", "s1", True),   # member, shared thread
    ("c", "s1", False),  # outsider, shared thread
    ("a", "pa", True),   # owner, own private thread
    ("b", "pa", False),  # teammate, someone else's private thread
    ("c", "pa", False),  # outsider, private thread
])  # fmt: skip
def test_verify_thread_access_agrees_with_rls(world, user_key, thread_key, expected):
    user = getattr(world, user_key)
    thread_id = getattr(world, thread_key)
    assert verify_thread_access(user.id, thread_id) is expected
    assert rls_allows(user, "threads", thread_id) is expected


# ── Team page (2026-10-01) ──────────────────────────────────────────────────


def fresh_team(world, owner, *members) -> SimpleNamespace:
    """A team made for one test (leaving and removing change membership); the test deletes it."""
    admin = world.admin
    team = ok(admin.insert("teams", {"name": f"e2e team page {secrets.token_hex(3)}", "created_by": owner.id}))[0]["id"]
    ok(admin.insert("team_members", {"team_id": team, "user_id": owner.id, "role": "owner", "joined_at": "2026-01-01T00:00:00Z"}))
    for i, member in enumerate(members, 2):
        ok(admin.insert("team_members", {"team_id": team, "user_id": member.id, "role": "member", "joined_at": f"2026-01-0{i}T00:00:00Z"}))
    project = ok(admin.insert("projects", {"team_id": team, "name": "P", "created_by": owner.id}))[0]["id"]
    shared = ok(admin.insert("threads", {"project_id": project, "type": "shared", "name": "Team Space"}))[0]["id"]
    return SimpleNamespace(id=team, project=project, shared=shared)


def member_role(world, team: str, user) -> str | None:
    rows = ok(world.admin.select("team_members", team_id=eq(team), user_id=eq(user.id)))
    return rows[0]["role"] if rows else None


def test_team_details_and_icon_are_member_only_and_checked(world):
    needs(world, "team_page")
    b, c, t1 = world.b, world.c, world.t1
    # Control: any member (B isn't an owner) sets the description and icon.
    ok(b.api.update("teams", {"description": "Building Choir", "icon_kind": "icon", "icon_name": "rocket", "icon_color": "teal"}, id=eq(t1)))
    assert admin_row(world, "teams", t1)["icon_color"] == "teal"
    # An outsider changes nothing.
    assert_blocked(c.api.update("teams", {"description": "hijacked"}, id=eq(t1)))
    assert admin_row(world, "teams", t1)["description"] == "Building Choir"
    # Values outside the allowed sets, and an image path in another team's folder, are refused.
    for bad in (
        {"icon_color": "purple"},
        {"icon_kind": "emoji"},
        {"icon_name": "<script>"},
        {"icon_kind": "image", "icon_path": f"{world.t2}/x.webp"},
        {"icon_kind": "image", "icon_path": f"{t1}/../x.webp"},
        {"description": "x" * 281},
    ):
        response = b.api.update("teams", bad, id=eq(t1))
        assert response.status_code == 400, f"{bad}: {response.status_code} {response.text}"
    # Control: an image in the team's own folder is accepted.
    ok(b.api.update("teams", {"icon_kind": "image", "icon_path": f"{t1}/abc123.webp"}, id=eq(t1)))
    # The creator can't be changed.
    assert_denied(b.api.update("teams", {"created_by": b.id}, id=eq(t1)))


def test_members_see_their_teammates_memberships_and_outsiders_dont(world):
    needs(world, "team_page")
    # Control: B sees A's membership (and role) in their shared team.
    rows = ok(world.b.api.select("team_members", team_id=eq(world.t1), user_id=eq(world.a.id)))
    assert rows and rows[0]["role"] == "owner"
    assert ok(world.c.api.select("team_members", team_id=eq(world.t1))) == []
    # Nobody adds or changes memberships directly.
    assert_denied(world.c.api.insert("team_members", {"team_id": world.t1, "user_id": world.c.id}))
    assert_blocked(world.b.api.update("team_members", {"role": "owner"}, team_id=eq(world.t1), user_id=eq(world.b.id)))
    assert member_role(world, world.t1, world.b) == "member"


def test_only_owners_delete_a_team(world):
    needs(world, "team_page")
    team = fresh_team(world, world.a, world.b)
    try:
        assert_blocked(world.b.api.delete("teams", id=eq(team.id)))
        assert ok(world.admin.select("teams", id=eq(team.id)))
        # Control: an owner who isn't the creator can delete it.
        ok(world.admin.update("teams", {"created_by": world.c.id}, id=eq(team.id)))
        ok(world.a.api.delete("teams", id=eq(team.id)))
        assert ok(world.admin.select("teams", id=eq(team.id))) == []
    finally:
        world.admin.delete("teams", id=eq(team.id))


def test_leaving_closes_the_team_and_your_private_threads(world):
    needs(world, "team_page")
    a, b = world.a, world.b
    team = fresh_team(world, a, b)
    try:
        private = ok(world.admin.insert("threads", {"project_id": team.project, "type": "private", "owner_id": b.id, "name": "B notes"}))[0]["id"]
        ok(world.admin.insert("shared_keys", {"project_id": team.project, "user_id": b.id, "key_id": world.key_b, "provider": "anthropic", "mode": "pool"}))
        invite = ok(world.admin.insert("team_invitations", {"team_id": team.id, "created_by": b.id}))[0]["id"]
        # Control: before leaving, B opens both threads (RLS and the backend agree).
        assert rls_allows(b, "threads", private) and rls_allows(b, "threads", team.shared)
        assert verify_thread_access(b.id, private) is True
        # An outsider can't "leave" a team they aren't in.
        assert_denied(world.c.api.rpc("leave_team", {"p_team_id": team.id}))

        assert ok(b.api.rpc("leave_team", {"p_team_id": team.id})) == "left"
        assert member_role(world, team.id, b) is None
        assert not rls_allows(b, "threads", private) and not rls_allows(b, "threads", team.shared)
        assert verify_thread_access(b.id, private) is False
        assert ok(world.admin.select("threads", id=eq(private)))  # kept, for when they come back
        assert ok(world.admin.select("shared_keys", project_id=eq(team.project), user_id=eq(b.id))) == []
        assert admin_row(world, "team_invitations", invite)["revoked_at"] is not None
        assert member_role(world, team.id, a) == "owner"
    finally:
        world.admin.delete("teams", id=eq(team.id))


def test_the_last_owner_hands_over_and_the_last_person_deletes_the_team(world):
    needs(world, "team_page")
    a, b, c = world.a, world.b, world.c
    team = fresh_team(world, a, b, c)
    try:
        assert ok(a.api.rpc("leave_team", {"p_team_id": team.id})) == "left_new_owner"
        assert member_role(world, team.id, b) == "owner"  # joined before C
        assert member_role(world, team.id, c) == "member"
        # Control: a non-last owner leaving hands nothing over.
        assert b.api.rpc("make_owner", {"p_team_id": team.id, "p_user_id": c.id}).is_success
        assert ok(b.api.rpc("leave_team", {"p_team_id": team.id})) == "left"
        assert ok(c.api.rpc("leave_team", {"p_team_id": team.id})) == "deleted"
        assert ok(world.admin.select("teams", id=eq(team.id))) == []
    finally:
        world.admin.delete("teams", id=eq(team.id))


def test_only_owners_remove_people_or_make_owners(world):
    needs(world, "team_page")
    a, b, c = world.a, world.b, world.c
    team = fresh_team(world, a, b, c)
    try:
        invite = ok(world.admin.insert("team_invitations", {"team_id": team.id, "created_by": a.id}))[0]["id"]
        assert_denied(b.api.rpc("remove_member", {"p_team_id": team.id, "p_user_id": c.id, "p_revoke_invites": False}))
        assert_denied(b.api.rpc("make_owner", {"p_team_id": team.id, "p_user_id": b.id}))
        assert member_role(world, team.id, c) == "member" and member_role(world, team.id, b) == "member"
        # An owner can't remove themselves this way (that's leaving).
        assert not a.api.rpc("remove_member", {"p_team_id": team.id, "p_user_id": a.id, "p_revoke_invites": False}).is_success
        # Control: an owner makes B an owner and removes C, stopping every invite link.
        assert a.api.rpc("make_owner", {"p_team_id": team.id, "p_user_id": b.id}).is_success
        assert member_role(world, team.id, b) == "owner"
        assert a.api.rpc("remove_member", {"p_team_id": team.id, "p_user_id": c.id, "p_revoke_invites": True}).is_success
        assert member_role(world, team.id, c) is None
        assert admin_row(world, "team_invitations", invite)["revoked_at"] is not None
        # Someone outside the team can't be made owner.
        assert not a.api.rpc("make_owner", {"p_team_id": team.id, "p_user_id": c.id}).is_success
    finally:
        world.admin.delete("teams", id=eq(team.id))


def _icon(api, path: str, body: bytes = b"RIFF\x00\x00\x00\x00WEBP", content_type: str = "image/webp") -> httpx.Response:
    return api.http.post(
        f"/storage/v1/object/team-icons/{path}", content=body, headers={**api.headers, "Content-Type": content_type}
    )


def _remove_icon(api, path: str) -> httpx.Response:
    return api.http.request("DELETE", "/storage/v1/object/team-icons", json={"prefixes": [path]}, headers=api.headers)


def test_only_members_add_or_remove_their_teams_icon(world):
    needs(world, "team_page")
    b, c = world.b, world.c
    path = f"{world.t1}/{secrets.token_hex(8)}.webp"
    try:
        assert not _icon(c.api, f"{world.t1}/{secrets.token_hex(8)}.webp").is_success
        assert not _icon(b.api, f"{world.t2}/{secrets.token_hex(8)}.webp").is_success
        assert not _icon(b.api, f"{world.t1}/{secrets.token_hex(8)}.svg", b"<svg/>", "image/svg+xml").is_success
        assert not _icon(b.api, f"{world.t1}/{secrets.token_hex(8)}.webp", b"x" * (2 * 1024 * 1024 + 1)).is_success
        # Control: a member uploads into their team's folder, and anyone can view it.
        response = _icon(b.api, path)
        assert response.is_success, f"{response.status_code}: {response.text}"
        assert world.http.get(f"/storage/v1/object/public/team-icons/{path}").is_success
        # An outsider removes nothing; a member can remove it.
        outsider = _remove_icon(c.api, path)
        assert not (outsider.is_success and outsider.json()), outsider.text
        removed = _remove_icon(b.api, path)
        assert removed.is_success and removed.json(), removed.text
    finally:
        _remove_icon(world.admin, path)


# ── Tasks (feature D, stage 1) ────────────────────────────────────────────────


def new_task(world, creator, title="Write the ETA story", project=None) -> str:
    row = {"project_id": project or world.p1, "title": title, "created_by": creator.id}
    return ok(creator.api.insert("tasks", row))[0]["id"]


def task_row(world, task_id: str) -> dict:
    return admin_row(world, "tasks", task_id)


def test_tasks_are_team_only_and_added_in_your_own_name(world):
    needs(world, "tasks")
    a, b, c = world.a, world.b, world.c
    t = new_task(world, a)  # Control: a member adds a task.
    assert [r["id"] for r in ok(b.api.select("tasks", id=eq(t)))] == [t]  # Control: teammates see it.
    assert_blocked(c.api.select("tasks", id=eq(t)))
    assert_denied(c.api.insert("tasks", {"project_id": world.p1, "title": "x", "created_by": c.id}))
    assert_denied(b.api.insert("tasks", {"project_id": world.p1, "title": "x", "created_by": a.id}))
    # Can't arrive claimed or done, or point at a message you can't see.
    assert_denied(b.api.insert("tasks", {"project_id": world.p1, "title": "x", "created_by": b.id, "status": "done"}))
    assert_denied(b.api.insert("tasks", {"project_id": world.p1, "title": "x", "created_by": b.id, "claimed_by": b.id}))
    assert_denied(
        b.api.insert("tasks", {"project_id": world.p1, "title": "x", "created_by": b.id, "source_message_ids": [world.m_pa]})
    )
    # Control: pointing at a Team Space message is fine.
    assert ok(b.api.insert("tasks", {"project_id": world.p1, "title": "y", "created_by": b.id, "source_message_ids": [world.m_s1_a]}))
    assert not b.api.insert("tasks", {"project_id": world.p1, "title": "  ", "created_by": b.id}).is_success
    assert not b.api.insert("tasks", {"project_id": world.p1, "title": "x" * 201, "created_by": b.id}).is_success


def test_tasks_change_only_through_the_functions(world):
    needs(world, "tasks")
    t = new_task(world, world.a)
    assert_blocked(world.a.api.update("tasks", {"title": "changed"}, id=eq(t)))
    assert_blocked(world.a.api.delete("tasks", id=eq(t)))
    assert task_row(world, t)["title"] == "Write the ETA story"


def test_exactly_one_claim_wins(world):
    needs(world, "tasks")
    a, b = world.a, world.b
    for _ in range(3):  # a race can go either way; run it a few times
        t = new_task(world, a)
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda u: ok(u.api.rpc("claim_task", {"p_task_id": t})), [a, b]))
        winner = task_row(world, t)["claimed_by"]
        assert winner in (a.id, b.id)
        assert results == [winner, winner]  # both are told who has it
        assert task_row(world, t)["status"] == "claimed"
    assert_denied(world.c.api.rpc("claim_task", {"p_task_id": t}))


def test_release_by_claimer_or_owner_only(world):
    needs(world, "tasks")
    a, b = world.a, world.b  # A owns team 1
    t = new_task(world, a)
    assert ok(b.api.rpc("claim_task", {"p_task_id": t})) == b.id
    t2 = new_task(world, a, "second")
    assert ok(b.api.rpc("claim_task", {"p_task_id": t2})) == b.id
    assert_denied(world.c.api.rpc("release_task", {"p_task_id": t}))
    assert b.api.rpc("release_task", {"p_task_id": t}).is_success  # Control: the claimer
    assert task_row(world, t)["status"] == "open" and task_row(world, t)["claimed_by"] is None
    assert a.api.rpc("release_task", {"p_task_id": t2}).is_success  # Control: a team owner
    t3 = new_task(world, b, "third")
    assert ok(a.api.rpc("claim_task", {"p_task_id": t3})) == a.id
    assert_denied(b.api.rpc("release_task", {"p_task_id": t3}))  # a plain member can't release someone's task


def test_only_the_claimer_marks_done_and_it_posts_the_finished_line(world):
    needs(world, "tasks")
    a, b = world.a, world.b
    t = new_task(world, a)
    assert not b.api.rpc("complete_task", {"p_task_id": t, "p_result": "x"}).is_success  # open: nobody has it
    assert ok(b.api.rpc("claim_task", {"p_task_id": t})) == b.id
    assert_denied(a.api.rpc("complete_task", {"p_task_id": t, "p_result": "x"}))  # not the claimer, even as owner
    message_id = ok(b.api.rpc("complete_task", {"p_task_id": t, "p_result": "Script agreed in chat"}))
    done = task_row(world, t)
    assert done["status"] == "done" and done["done_by"] == b.id and done["result"] == "Script agreed in chat"
    line = admin_row(world, "messages", message_id)
    assert line["kind"] == "task_done" and line["task_id"] == t and line["thread_id"] == world.s1
    assert line["sender_id"] == b.id and "Write the ETA story" in line["content"]
    # Control: the finished line can be pinned like any Team Space message.
    assert ok(a.api.update("messages", {"is_decision": True, "pinned_by": a.id, "pinned_at": "2026-10-02T00:00:00Z"}, id=eq(message_id)))
    assert not b.api.rpc("complete_task", {"p_task_id": t, "p_result": "again"}).is_success  # already done


def test_reopen_by_claimer_or_owner_only(world):
    needs(world, "tasks")
    a, b = world.a, world.b
    t = new_task(world, a)
    ok(b.api.rpc("claim_task", {"p_task_id": t}))
    ok(b.api.rpc("complete_task", {"p_task_id": t, "p_result": ""}))
    assert_denied(world.c.api.rpc("reopen_task", {"p_task_id": t}))
    assert b.api.rpc("reopen_task", {"p_task_id": t}).is_success  # Control: the person who did it
    again = task_row(world, t)
    assert again["status"] == "claimed" and again["claimed_by"] == b.id and again["result"] is None
    ok(b.api.rpc("complete_task", {"p_task_id": t, "p_result": ""}))
    assert a.api.rpc("reopen_task", {"p_task_id": t}).is_success  # Control: a team owner
    t2 = new_task(world, b, "A's own")
    ok(a.api.rpc("claim_task", {"p_task_id": t2}))
    ok(a.api.rpc("complete_task", {"p_task_id": t2, "p_result": ""}))
    assert_denied(b.api.rpc("reopen_task", {"p_task_id": t2}))  # a plain member can't reopen someone's task


def test_edit_and_delete_rules(world):
    needs(world, "tasks")
    a, b = world.a, world.b
    t = new_task(world, a)
    assert b.api.rpc("edit_task", {"p_task_id": t, "p_title": "Open: anyone edits", "p_details": None}).is_success  # Control
    assert task_row(world, t)["title"] == "Open: anyone edits"
    ok(a.api.rpc("claim_task", {"p_task_id": t}))
    assert_denied(b.api.rpc("edit_task", {"p_task_id": t, "p_title": "nope", "p_details": None}))
    assert not b.api.rpc("delete_task", {"p_task_id": t}).is_success  # claimed: no delete, by anyone
    assert not a.api.rpc("delete_task", {"p_task_id": t}).is_success
    t2 = new_task(world, a, "open one")
    assert_denied(world.c.api.rpc("delete_task", {"p_task_id": t2}))
    assert b.api.rpc("delete_task", {"p_task_id": t2}).is_success  # Control: open, any member
    assert ok(world.admin.select("tasks", id=eq(t2))) == []


def test_leaving_the_team_releases_your_claims(world):
    needs(world, "tasks")
    needs(world, "team_page")
    a, b = world.a, world.b
    team = fresh_team(world, a, b)
    try:
        t = new_task(world, a, project=team.project)
        ok(b.api.rpc("claim_task", {"p_task_id": t}))
        assert ok(b.api.rpc("leave_team", {"p_team_id": team.id})) == "left"
        assert task_row(world, t)["status"] == "open" and task_row(world, t)["claimed_by"] is None
    finally:
        world.admin.delete("teams", id=eq(team.id))


# ── Agents' OAuth tokens (feature D stage 2, spec §7.2) ──────────────────────


def agent_token(world, user) -> tuple[str, str]:
    """A real coding-agent token for this user, the way Claude Code gets one: register a client,
    ask to authorize, the person clicks Allow (the consent call the /oauth/consent page makes),
    then swap the code for a token. Needs Supabase's OAuth server with dynamic registration on.
    Returns (token, client_id); remove the client afterwards with remove_client."""
    http = world.http
    redirect = "http://localhost:9/callback"
    client = http.post(
        "/auth/v1/oauth/clients/register",
        json={
            "client_name": "Choir e2e agent",
            "redirect_uris": [redirect],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        },
        headers={"apikey": ANON_KEY},
    )
    assert client.is_success, f"{client.status_code}: {client.text}"
    client_id = client.json()["client_id"]
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    authorize = http.get(
        "/auth/v1/oauth/authorize",
        params={
            "response_type": "code", "client_id": client_id, "redirect_uri": redirect, "scope": "email",
            "code_challenge": challenge, "code_challenge_method": "S256", "state": "e2e",
        },
        headers={"apikey": ANON_KEY},
    )  # fmt: skip
    assert authorize.status_code in (302, 303), f"{authorize.status_code}: {authorize.text}"
    authorization_id = parse_qs(urlparse(authorize.headers["location"]).query)["authorization_id"][0]
    # The consent page reads the request first (this ties it to the signed-in person), then approves.
    details = http.get(f"/auth/v1/oauth/authorizations/{authorization_id}", headers=user.api.headers)
    assert details.is_success, f"{details.status_code}: {details.text}"
    consent = http.post(
        f"/auth/v1/oauth/authorizations/{authorization_id}/consent", json={"action": "approve"}, headers=user.api.headers
    )
    assert consent.is_success, f"{consent.status_code}: {consent.text}"
    code = parse_qs(urlparse(consent.json()["redirect_url"]).query)["code"][0]
    token = http.post(
        "/auth/v1/oauth/token",
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect,
              "client_id": client_id, "code_verifier": verifier},
        headers={"apikey": ANON_KEY},
    )  # fmt: skip
    assert token.is_success, f"{token.status_code}: {token.text}"
    return token.json()["access_token"], client_id


def remove_client(world, client_id: str) -> None:
    world.http.delete(f"/auth/v1/admin/oauth/clients/{client_id}", headers=world.admin.headers)


def test_agent_tokens_reach_nothing_directly(world):
    needs(world, "tasks")
    needs(world, "attachments")
    a = world.a
    token, client_id = agent_token(world, a)
    try:
        _agent_side_doors(world, Rest(world.http, ANON_KEY, token))
    finally:
        remove_client(world, client_id)


def _agent_side_doors(world, agent) -> None:
    a = world.a
    task = new_task(world, a, "Agent side door")
    file = _stored(a.api, world.pa)
    ok(_post(a, world.pa, [file]))

    # Control: the same person's own session reads their private thread, key and file, and claims.
    assert len(ok(a.api.select("threads", id=eq(world.pa)))) == 1
    assert len(ok(a.api.select("user_api_keys", id=eq(world.key_a)))) == 1
    assert _download(a.api, file["path"]).is_success

    # Their agent's token: refused on tables, functions, files and uploads.
    assert_denied(agent.select("threads", id=eq(world.pa)))
    assert_denied(agent.select("messages", thread_id=eq(world.pa)))
    assert_denied(agent.select("user_api_keys"))
    assert_denied(agent.insert("messages", {"thread_id": world.s1, "sender_type": "user", "sender_id": a.id, "content": "x"}))
    assert_denied(agent.rpc("claim_task", {"p_task_id": task}))
    assert task_row(world, task)["status"] == "open"
    assert not _download(agent, file["path"]).is_success
    assert not _sign(agent, file["path"]).is_success
    assert not _upload(agent, _file(world.pa)["path"]).is_success
    ok(a.api.rpc("claim_task", {"p_task_id": task}))  # Control: the person still can
