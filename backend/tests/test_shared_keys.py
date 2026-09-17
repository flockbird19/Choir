"""
Lent keys, pooling and rate-limit alerts in Team Space (F3, F4, F5).

Order for a Team Space reply: pool keys (least recently used first), the owner's key,
then fallback keys. A rate limit before any text switches to the next key and tells
the key's owner (at most once per 10 minutes). Lent keys never reach private threads
or other projects.
"""

import json
import sys
import types
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend import llm, shared_keys
from tests.fakes import FakeClient

NAMES = {"u-owner": "Venu", "u-ravi": "Ravi", "u-meera": "Meera", "u-gone": "Gone"}


def make_db(shared_rows=(), notifications=()):
    return FakeClient(
        teams=[{"id": "team-1", "name": "hackathon"}],
        projects=[
            {
                "id": "p1",
                "team_id": "team-1",
                "name": "Hack Relay",
                "created_by": "u-owner",
                "shared_model_provider": "anthropic",
                "shared_model_name": "claude-haiku-4-5",
            },
            {"id": "p2", "team_id": "team-1", "name": "Other", "created_by": "u-owner", "shared_model_provider": "anthropic"},
        ],
        team_members=[
            {"team_id": "team-1", "user_id": "u-owner", "role": "owner", "joined_at": "1"},
            {"team_id": "team-1", "user_id": "u-ravi", "role": "member", "joined_at": "2"},
            {"team_id": "team-1", "user_id": "u-meera", "role": "member", "joined_at": "3"},
        ],
        threads=[
            {"id": "shared", "project_id": "p1", "type": "shared", "owner_id": None},
            {"id": "shared-2", "project_id": "p2", "type": "shared", "owner_id": None},
            {"id": "ravi-private", "project_id": "p1", "type": "private", "owner_id": "u-ravi"},
        ],
        messages=[{"thread_id": "shared", "sender_type": "user", "sender_id": "u-ravi", "content": "@ai hi", "created_at": "1"}],
        shared_keys=[dict(row) for row in shared_rows],
        notifications=[dict(row) for row in notifications],
    )


def lend(row_id, user_id, provider, mode, last_used_at=None, project_id="p1"):
    return {
        "id": row_id,
        "project_id": project_id,
        "user_id": user_id,
        "provider": provider,
        "mode": mode,
        "last_used_at": last_used_at,
    }


KEYS = {
    ("u-owner", "anthropic"): "sk-owner",
    ("u-ravi", "anthropic"): "sk-ravi",
    ("u-ravi", "openai"): "sk-ravi-openai",
    ("u-meera", "anthropic"): "sk-meera",
    ("u-meera", "groq"): "sk-meera-groq",
    ("u-gone", "anthropic"): "sk-gone",
}


def run(db, thread_id="shared", user_id="u-ravi", limited=(), limited_after_text=(), keys=KEYS, saved=None):
    """Stream a reply. Keys in `limited` fail with a 429 before any text; keys in
    `limited_after_text` fail after one chunk. Returns (keys tried in order, frames, decrypted keys)."""
    tried: list[tuple[str, str]] = []
    decrypted: list[tuple[str, str]] = []

    def fake_get_api_key(uid, provider):
        key = keys.get((uid, provider))
        if key:
            decrypted.append((uid, provider))
        return key

    def text_for(api_key):
        if api_key in limited:
            raise RuntimeError("Error code: 429 - rate_limit_error")
        yield "Hello"
        if api_key in limited_after_text:
            raise RuntimeError("Error code: 429 - rate_limit_error")
        yield " team"

    class FakeMessages:
        def __init__(self, api_key):
            self.api_key = api_key

        @contextmanager
        def stream(self, **kwargs):
            tried.append((self.api_key, kwargs["model"]))
            yield types.SimpleNamespace(text_stream=text_for(self.api_key))

    class FakeCompletions:
        def __init__(self, api_key):
            self.api_key = api_key

        @contextmanager
        def create(self, **kwargs):
            tried.append((self.api_key, kwargs["model"]))
            chunks = (
                types.SimpleNamespace(choices=[types.SimpleNamespace(delta=types.SimpleNamespace(content=t))])
                for t in text_for(self.api_key)
            )
            yield chunks

    fake_anthropic = types.SimpleNamespace(
        Anthropic=lambda **kw: types.SimpleNamespace(messages=FakeMessages(kw["api_key"]))
    )
    fake_openai = types.SimpleNamespace(
        OpenAI=lambda **kw: types.SimpleNamespace(chat=types.SimpleNamespace(completions=FakeCompletions(kw["api_key"])))
    )

    with (
        patch.object(llm, "get_db", return_value=db),
        patch.object(llm, "get_api_key", side_effect=fake_get_api_key),
        patch.object(llm, "_fetch_user_name", side_effect=NAMES.get),
        patch.object(llm, "_save_assistant_message", side_effect=lambda *args: (saved if saved is not None else []).append(args) or "msg-1"),
        patch.dict(sys.modules, {"anthropic": fake_anthropic, "openai": fake_openai}),
    ):
        frames = [json.loads(f.removeprefix("data: ")) for f in llm.stream_ai_response(thread_id, user_id, "anthropic", "claude-opus-5", None)]
    return tried, frames, decrypted


def notices(frames):
    return [f["notice"] for f in frames if "notice" in f]


def test_owner_key_is_used_when_nobody_pools():
    db = make_db([lend("f1", "u-meera", "anthropic", "fallback")])
    tried, frames, decrypted = run(db)
    assert tried == [("sk-owner", "claude-haiku-4-5")]
    assert notices(frames) == []
    assert frames[-1] == {"done": True, "message_id": "msg-1"}
    # Only the key actually used is decrypted.
    assert decrypted == [("u-owner", "anthropic")]


def test_pool_picks_least_recently_used_key_and_records_the_use():
    db = make_db([
        lend("pool-ravi", "u-ravi", "anthropic", "pool", last_used_at="2026-09-17T10:00:00+00:00"),
        lend("pool-meera", "u-meera", "anthropic", "pool", last_used_at="2026-09-17T09:00:00+00:00"),
    ])
    tried, _, _ = run(db)
    assert tried == [("sk-meera", "claude-haiku-4-5")]
    rows = {row["id"]: row for row in db._tables["shared_keys"]}
    assert rows["pool-meera"]["last_used_at"] > "2026-09-17T10:00:00+00:00"

    # The next request rotates to the other pooled key.
    tried, _, _ = run(db)
    assert tried == [("sk-ravi", "claude-haiku-4-5")]


def test_never_used_pool_key_goes_first():
    db = make_db([
        lend("pool-ravi", "u-ravi", "anthropic", "pool", last_used_at="2026-09-17T10:00:00+00:00"),
        lend("pool-meera", "u-meera", "anthropic", "pool"),
    ])
    tried, _, _ = run(db)
    assert tried[0][0] == "sk-meera"


def test_pool_falls_back_to_owner_key_when_no_pooled_key_is_usable():
    # Meera stopped having a saved key; her pool row is skipped.
    db = make_db([lend("pool-meera", "u-meera", "anthropic", "pool")])
    keys = {k: v for k, v in KEYS.items() if k[0] != "u-meera"}
    tried, _, _ = run(db, keys=keys)
    assert tried == [("sk-owner", "claude-haiku-4-5")]


def test_fallback_keys_are_not_a_first_choice():
    # The owner has no key: the caller's own key is used, never the fallback key.
    db = make_db([lend("f1", "u-meera", "anthropic", "fallback")])
    keys = {k: v for k, v in KEYS.items() if k[0] != "u-owner"}
    tried, _, _ = run(db, keys=keys)
    assert [key for key, _ in tried] == ["sk-ravi"]

    # ...and it is not swapped for a lent key when it hits a rate limit.
    tried, frames, _ = run(db, keys=keys, limited={"sk-ravi"})
    assert [key for key, _ in tried] == ["sk-ravi"]
    assert "Rate limit reached" in frames[-1]["error"]

    keys = {("u-meera", "anthropic"): "sk-meera"}
    tried, frames, _ = run(db, keys=keys)
    assert tried == []
    assert "No API key found" in frames[0]["error"]


def test_rate_limit_before_text_retries_with_fallback_key_and_alerts_owner():
    db = make_db([lend("f1", "u-meera", "groq", "fallback")])
    tried, frames, _ = run(db, limited={"sk-owner"})

    # A lent key for another provider uses that provider's default model.
    assert tried == [("sk-owner", "claude-haiku-4-5"), ("sk-meera-groq", "llama-3.3-70b-versatile")]
    assert notices(frames) == ["Using Meera's key"]
    assert {"notice": "Using Meera's key", "model": "llama-3.3-70b-versatile"} in frames
    assert "".join(f.get("text", "") for f in frames) == "Hello team"
    assert frames[-1]["done"] is True
    assert not any("error" in f for f in frames)

    [alert] = db._tables["notifications"]
    assert alert["user_id"] == "u-owner"
    assert alert["project_id"] == "p1"
    assert alert["team_id"] == "team-1"
    assert alert["kind"] == "key_rate_limited"
    assert alert["payload"] == {"provider": "anthropic", "project_name": "Hack Relay", "thread_id": "shared"}
    assert db._tables["shared_keys"][0]["last_used_at"] is not None


def test_rate_limited_pool_key_tries_next_pool_key_then_owner_then_fallback():
    db = make_db([
        lend("pool-ravi", "u-ravi", "anthropic", "pool", last_used_at="2026-09-17T09:00:00+00:00"),
        lend("pool-meera", "u-meera", "anthropic", "pool", last_used_at="2026-09-17T10:00:00+00:00"),
        lend("f-ravi", "u-ravi", "openai", "fallback"),
    ])
    tried, frames, _ = run(db, limited={"sk-ravi", "sk-meera", "sk-owner"})
    assert [key for key, _ in tried] == ["sk-ravi", "sk-meera", "sk-owner", "sk-ravi-openai"]
    assert tried[-1][1] == "gpt-4o"
    assert notices(frames) == ["Using Meera's key", "Using Venu's key", "Using Ravi's key"]
    assert frames[-1]["done"] is True
    assert sorted(n["user_id"] for n in db._tables["notifications"]) == ["u-meera", "u-owner", "u-ravi"]


def test_every_key_rate_limited_ends_with_an_error():
    db = make_db([lend("f1", "u-meera", "anthropic", "fallback")])
    tried, frames, _ = run(db, limited={"sk-owner", "sk-meera"})
    assert len(tried) == 2
    assert "Rate limit reached" in frames[-1]["error"]


def test_alert_is_sent_at_most_once_per_owner_and_project_every_ten_minutes():
    recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    old = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    project = {"id": "p1", "team_id": "team-1", "name": "Hack Relay"}

    db = make_db(notifications=[{"user_id": "u-owner", "project_id": "p1", "kind": "key_rate_limited", "created_at": recent}])
    assert shared_keys.notify_rate_limited(db, "u-owner", project, "shared", "anthropic") is False
    # Another person, or another project, still gets one.
    assert shared_keys.notify_rate_limited(db, "u-ravi", project, "shared", "anthropic") is True
    assert shared_keys.notify_rate_limited(db, "u-owner", {**project, "id": "p2"}, "shared-2", "anthropic") is True
    assert len(db._tables["notifications"]) == 3

    db = make_db(notifications=[{"user_id": "u-owner", "project_id": "p1", "kind": "key_rate_limited", "created_at": old}])
    assert shared_keys.notify_rate_limited(db, "u-owner", project, "shared", "anthropic") is True


def test_repeated_rate_limits_in_one_window_alert_once():
    db = make_db()
    run(db, limited={"sk-owner"})
    run(db, limited={"sk-owner"})
    assert len(db._tables["notifications"]) == 1


def test_no_retry_after_text_has_streamed():
    db = make_db([lend("f1", "u-meera", "anthropic", "fallback")])
    tried, frames, _ = run(db, limited_after_text={"sk-owner"})
    assert [key for key, _ in tried] == ["sk-owner"]
    assert notices(frames) == []
    assert frames[0] == {"text": "Hello"}
    assert "Rate limit reached" in frames[-1]["error"]
    # The owner still hears about it.
    assert len(db._tables["notifications"]) == 1


def test_partial_reply_is_still_saved_when_rate_limited_mid_stream():
    saved: list = []
    run(make_db(), limited_after_text={"sk-owner"}, saved=saved)
    assert saved == [("shared", "Hello", "anthropic", "claude-haiku-4-5")]


def test_lent_keys_are_never_used_in_private_threads():
    db = make_db([lend("pool-meera", "u-meera", "anthropic", "pool"), lend("f1", "u-meera", "groq", "fallback")])
    keys = {("u-meera", "anthropic"): "sk-meera", ("u-meera", "groq"): "sk-meera-groq"}
    tried, frames, _ = run(db, thread_id="ravi-private", user_id="u-ravi", keys=keys)
    assert tried == []
    assert "No API key found" in frames[0]["error"]
    assert db._tables["shared_keys"][0]["last_used_at"] is None


def test_private_thread_rate_limit_does_not_switch_keys_or_alert():
    db = make_db([lend("f1", "u-meera", "anthropic", "fallback")])
    tried, frames, _ = run(db, thread_id="ravi-private", user_id="u-ravi", limited={"sk-ravi"})
    assert [key for key, _ in tried] == ["sk-ravi"]
    assert "Rate limit reached" in frames[-1]["error"]
    assert db._tables["notifications"] == []


def test_lent_keys_are_never_used_in_other_projects():
    db = make_db([lend("pool-meera", "u-meera", "anthropic", "pool", project_id="p1")])
    tried, _, _ = run(db, thread_id="shared-2")
    assert [key for key, _ in tried] == ["sk-owner"]

    db = make_db([lend("f1", "u-meera", "anthropic", "fallback", project_id="p1")])
    tried, frames, _ = run(db, thread_id="shared-2", limited={"sk-owner"})
    assert [key for key, _ in tried] == ["sk-owner"]
    assert "Rate limit reached" in frames[-1]["error"]


def test_people_who_left_the_team_lend_nothing():
    db = make_db([lend("pool-gone", "u-gone", "anthropic", "pool")])
    tried, _, _ = run(db)
    assert [key for key, _ in tried] == ["sk-owner"]
