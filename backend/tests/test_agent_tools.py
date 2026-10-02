"""Feature D stage 2: what a connected coding agent can read and do (agent_tools.py, agent_mcp.py). Fake database, no AI."""

import asyncio
from unittest.mock import patch

import pytest

from backend import agent_mcp, agent_tools as tools, llm
from tests.fakes import FakeClient

PRIYA, DEVON = "u-priya", "u-devon"


def world():
    return FakeClient(
        agent_grants=[
            {"id": "g1", "user_id": PRIYA, "project_id": "p1", "client_id": "claude", "client_name": "Claude Code", "revoked_at": None},
            {"id": "g2", "user_id": DEVON, "project_id": "p1", "client_id": "old", "client_name": "Cursor", "revoked_at": "2026-10-01"},
        ],
        projects=[{"id": "p1", "team_id": "team1", "name": "Routing"}],
        team_members=[
            {"team_id": "team1", "user_id": PRIYA, "role": "owner", "joined_at": "1"},
            {"team_id": "team1", "user_id": DEVON, "role": "member", "joined_at": "2"},
        ],
        profiles=[{"id": PRIYA, "display_name": "Priya"}, {"id": DEVON, "display_name": "Devon"}],
        threads=[
            {"id": "shared", "project_id": "p1", "type": "shared", "name": "Team Space"},
            {"id": "devon-private", "project_id": "p1", "type": "private", "owner_id": DEVON, "name": "Mine"},
        ],
        messages=[
            {"id": "m-team", "thread_id": "shared", "sender_type": "user", "sender_id": DEVON, "content": "Routing v2 needs tests",
             "created_at": "2026-10-01T10:00:00+00:00"},
            {"id": "m-private", "thread_id": "devon-private", "sender_type": "user", "sender_id": DEVON,
             "content": "my secret plan", "created_at": "2026-10-01T10:01:00+00:00"},
        ],
        tasks=[
            {"id": "aaaaaaaa-0000-0000-0000-000000000001", "project_id": "p1", "title": "Move routing to v2", "status": "open",
             "claimed_by": None, "created_at": "1", "source_message_ids": ["m-team", "m-private"]},
            {"id": "bbbbbbbb-0000-0000-0000-000000000002", "project_id": "p1", "title": "Devon's task", "status": "claimed",
             "claimed_by": DEVON, "created_at": "2", "thread_id": "devon-private"},
        ],
        notifications=[],
    )  # fmt: skip


@pytest.fixture
def db():
    fake = world()
    with patch.object(llm, "get_db", return_value=fake):
        tools._calls.clear()
        yield fake


def grant():
    found = tools.find_grant(PRIYA, "claude")
    assert found
    return found


T1, T2 = "aaaaaaaa", "bbbbbbbb"


def test_only_an_active_grant_for_someone_still_on_the_team_counts(db):
    assert grant().project_id == "p1"
    assert tools.find_grant(DEVON, "old") is None  # disconnected
    assert tools.find_grant(PRIYA, "other-tool") is None
    db.table("team_members").delete().eq("user_id", PRIYA).execute()
    assert tools.find_grant(PRIYA, "claude") is None  # left the team


def test_claim_is_for_the_person_and_loses_to_an_earlier_claim(db):
    g = grant()
    assert "Claimed" in tools.claim_task(g, T1)
    task = tools.find_task(g, T1)
    assert task["claimed_by"] == PRIYA and task["via_client"] == "Claude Code"
    with pytest.raises(tools.AgentError, match="Devon already has it"):
        tools.claim_task(g, T2)


def test_an_agent_works_only_on_its_own_persons_claimed_task(db):
    g = grant()
    for call in (lambda: tools.start_task(g, T2), lambda: tools.read_task_thread(g, T2),
                 lambda: tools.post_update(g, T2, "hi"), lambda: tools.start_task(g, T1)):  # fmt: skip
        with pytest.raises(tools.AgentError):
            call()


def test_start_opens_one_private_thread_and_updates_go_only_there(db):
    g = grant()
    tools.claim_task(g, T1)
    with pytest.raises(tools.AgentError, match="Start the task first"):
        tools.post_update(g, T1, "Working on it")
    tools.start_task(g, T1)
    tools.start_task(g, T1)  # again: same thread
    threads = [t for t in db.table("threads").select().execute().data if t["name"].startswith("Task ·")]
    assert len(threads) == 1
    thread = threads[0]
    assert thread["owner_id"] == PRIYA and thread["type"] == "private" and thread["ai_auto_reply"] is False
    tools.post_update(g, T1, "Switched 3 of 5 calls")
    posted = db.table("messages").select().eq("sender_type", "agent").execute().data
    assert [(m["thread_id"], m["sender_id"], m["via_client"]) for m in posted] == [(thread["id"], PRIYA, "Claude Code")]


def test_a_task_thread_must_still_be_the_persons_own(db):
    g = grant()
    tools.claim_task(g, T1)
    # A task pointing at someone else's private thread is never read or written through.
    db.table("tasks").update({"thread_id": "devon-private"}).eq("id", tools.find_task(g, T1)["id"]).execute()
    with pytest.raises(tools.AgentError):
        tools.read_task_thread(g, T1)


def test_caps_on_messages(db):
    g = grant()
    tools.claim_task(g, T1)
    tools.start_task(g, T1)
    for bad in ("", "x" * 2001):
        with pytest.raises(tools.AgentError):
            tools.post_update(g, T1, bad)
    for _ in range(tools.MESSAGES_PER_HOUR):
        tools.post_update(g, T1, "update")
    with pytest.raises(tools.AgentError, match="this hour"):
        tools.post_update(g, T1, "one too many")


def test_calls_are_rate_limited_per_connection(db):
    g = grant()
    for _ in range(tools.CALLS_PER_MINUTE):
        tools.check_rate(g)
    with pytest.raises(tools.AgentError, match="Too many calls"):
        tools.check_rate(g)


def test_review_card_notifies_the_person_and_a_new_one_replaces_it(db):
    g = grant()
    tools.claim_task(g, T1)
    tools.start_task(g, T1)
    tools.request_review(g, T1, "Done: moved all calls", "PR #12 merged", ["https://github.com/x/pull/12", "javascript:alert(1)"])
    task = tools.find_task(g, T1)
    card = db.table("messages").select().eq("id", task["review_message_id"]).execute().data[0]
    assert card["kind"] == "task_review" and card["review_state"] == "open"
    assert card["review"]["links"] == ["https://github.com/x/pull/12"]  # only web links
    assert task["status"] == "claimed"  # only the person marks it done
    note = db.table("notifications").select().execute().data[0]
    assert note["user_id"] == PRIYA and note["kind"] == "task_review" and note["payload"]["tool"] == "Claude Code"
    tools.request_review(g, T1, "Also fixed the tests", "PR #12 and #13")
    assert card["review_state"] is None  # replaced
    assert tools.find_task(g, T1)["review_message_id"] != card["id"]


def test_the_agent_reads_its_persons_send_back_note(db):
    g = grant()
    tools.claim_task(g, T1)
    tools.start_task(g, T1)
    thread = tools.find_task(g, T1)["thread_id"]
    db.table("messages").insert({"thread_id": thread, "sender_type": "user", "sender_id": PRIYA, "content": "Add the tests please"}).execute()
    text = tools.read_task_thread(g, T1)
    assert "Priya: Add the tests please" in text


def test_sources_are_team_space_only_never_a_private_message(db):
    text = tools.get_task(grant(), T1)
    assert "Routing v2 needs tests" in text
    assert "secret" not in text


def test_brief_and_search_read_team_space_only(db):
    g = grant()
    brief = tools.project_brief(g)
    assert "Routing v2 needs tests" in brief and "Move routing to v2" in brief and "secret" not in brief
    assert "Routing v2" in tools.search_team_space(g, "routing")
    assert "Nothing" in tools.search_team_space(g, "secret")


def test_release_gives_the_task_back(db):
    g = grant()
    tools.claim_task(g, T1)
    tools.start_task(g, T1)
    tools.release_task(g, T1, "Blocked on the API key")
    task = tools.find_task(g, T1)
    assert task["status"] == "open" and task["claimed_by"] is None and task["via_client"] is None


def test_no_tool_can_mark_done_and_the_shortcuts_are_listed():
    names = {t.name for t in asyncio.run(agent_mcp.mcp_server.list_tools())}
    assert names == {"get_project_brief", "list_tasks", "get_task", "search_team_space", "claim_task", "start_task",
                     "read_task_thread", "post_update", "request_review", "release_task"}  # fmt: skip
    assert {p.name for p in asyncio.run(agent_mcp.mcp_server.list_prompts())} == {"next", "task", "review", "status"}


def test_agent_messages_are_labelled_with_the_tool_never_as_the_person():
    msg = {"sender_type": "agent", "sender_id": PRIYA, "via_client": "Claude Code", "content": "hi"}
    assert llm.sender_label(msg, {PRIYA: "Priya"}) == "Claude Code (Priya's agent)"
    assert "(you)" not in llm.transcript([msg], {PRIYA: "Priya"}, llm.user_tz(None), me=PRIYA)
    assert "not the person" in llm._to_chat_messages([msg])[0]["content"]
