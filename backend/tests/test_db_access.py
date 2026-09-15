"""
Access-control tests for backend.db.verify_thread_access / verify_team_access.

These two functions are the entire authorization layer for /api/chat,
/api/digest, and /api/export, since RLS is bypassed by the service-role key
FastAPI uses. A regression here (like the one found in schema.sql, where the
`messages` RLS policies checked only that a thread existed rather than that
the caller had access to it) would let any authenticated user read or write
any thread. These tests exist to catch that class of bug at this layer too.
"""

from unittest.mock import patch

from backend.db import verify_team_access, verify_thread_access
from tests.fakes import FakeClient


@patch("backend.db.get_db")
def test_private_thread_owner_has_access(mock_get_db):
    mock_get_db.return_value = FakeClient(
        threads=[{"id": "t1", "type": "private", "owner_id": "user-1"}]
    )
    assert verify_thread_access("user-1", "t1") is True


@patch("backend.db.get_db")
def test_private_thread_non_owner_denied(mock_get_db):
    mock_get_db.return_value = FakeClient(
        threads=[{"id": "t1", "type": "private", "owner_id": "user-1"}]
    )
    assert verify_thread_access("user-2", "t1") is False


@patch("backend.db.get_db")
def test_shared_thread_team_member_has_access(mock_get_db):
    mock_get_db.return_value = FakeClient(
        threads=[{"id": "t1", "type": "shared", "project_id": "p1"}],
        projects=[{"id": "p1", "team_id": "team-1"}],
        team_members=[{"team_id": "team-1", "user_id": "user-1"}],
    )
    assert verify_thread_access("user-1", "t1") is True


@patch("backend.db.get_db")
def test_shared_thread_non_member_denied(mock_get_db):
    mock_get_db.return_value = FakeClient(
        threads=[{"id": "t1", "type": "shared", "project_id": "p1"}],
        projects=[{"id": "p1", "team_id": "team-1"}],
        team_members=[{"team_id": "team-1", "user_id": "someone-else"}],
    )
    assert verify_thread_access("user-2", "t1") is False


@patch("backend.db.get_db")
def test_shared_thread_member_of_a_different_team_denied(mock_get_db):
    # Regression guard for the schema.sql `messages` policy bug: being a team
    # member anywhere must not grant access to every team's shared thread.
    mock_get_db.return_value = FakeClient(
        threads=[{"id": "t1", "type": "shared", "project_id": "p1"}],
        projects=[{"id": "p1", "team_id": "team-1"}],
        team_members=[{"team_id": "team-2", "user_id": "user-1"}],
    )
    assert verify_thread_access("user-1", "t1") is False


@patch("backend.db.get_db")
def test_nonexistent_thread_denied(mock_get_db):
    mock_get_db.return_value = FakeClient(threads=[])
    assert verify_thread_access("user-1", "missing-thread") is False


@patch("backend.db.get_db")
def test_team_member_has_team_access(mock_get_db):
    mock_get_db.return_value = FakeClient(
        team_members=[{"team_id": "team-1", "user_id": "user-1"}]
    )
    assert verify_team_access("user-1", "team-1") is True


@patch("backend.db.get_db")
def test_non_member_denied_team_access(mock_get_db):
    mock_get_db.return_value = FakeClient(
        team_members=[{"team_id": "team-1", "user_id": "someone-else"}]
    )
    assert verify_team_access("user-2", "team-1") is False
