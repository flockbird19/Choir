"""
Startup schema check and CORS origin config.

The 2026-09-14 outage happened because code needing `ai_request_log` and
`thread_reads` shipped before those tables existed. The backend now refuses to
start in that state, naming the missing tables.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import main
from backend.db import REQUIRED_TABLES, find_missing_tables
from tests.fakes import FakeClient


def _missing(table: str) -> APIError:
    return APIError({"code": "PGRST205", "message": f"Could not find the table 'public.{table}' in the schema cache"})


def test_no_missing_tables():
    assert find_missing_tables(FakeClient()) == []  # type: ignore[arg-type]


def test_reports_every_missing_table():
    db = FakeClient(errors={"thread_reads": _missing("thread_reads"), "ai_request_log": _missing("ai_request_log")})
    assert find_missing_tables(db) == ["thread_reads", "ai_request_log"]  # type: ignore[arg-type]


def test_other_database_errors_are_not_reported_as_missing_tables():
    db = FakeClient(errors={"teams": APIError({"code": "PGRST301", "message": "JWT expired"})})
    with pytest.raises(APIError):
        find_missing_tables(db)  # type: ignore[arg-type]


def test_required_tables_cover_catch_me_up_and_rate_limiter():
    assert {"thread_reads", "ai_request_log"} <= set(REQUIRED_TABLES)


def test_backend_refuses_to_start_when_tables_are_missing():
    with patch.object(main, "get_db", return_value=FakeClient(errors={"messages": _missing("messages")})):
        with pytest.raises(RuntimeError, match="missing required tables: messages"):
            with TestClient(main.app):
                pass


def test_backend_starts_when_all_tables_exist():
    with patch.object(main, "get_db", return_value=FakeClient()):
        with TestClient(main.app) as client:
            assert client.get("/").status_code == 200


def test_allowed_origins_default_to_local_dev():
    assert main.parse_allowed_origins(None) == ["http://localhost:3000", "http://127.0.0.1:3000"]


def test_allowed_origins_from_env_are_trimmed():
    assert main.parse_allowed_origins(" https://choir.app/ , https://preview.choir.app ,") == [
        "https://choir.app",
        "https://preview.choir.app",
    ]
