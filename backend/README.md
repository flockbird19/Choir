# Choir backend

FastAPI service for AI replies, Catch Me Up and exports. Uses `uv`.

```sh
uv sync
uv run uvicorn main:app --reload --port 8000
uv run pytest -q
```

## Database access-rule (RLS) tests

`tests/test_rls.py` checks the live Supabase access rules from the outside: it signs in temporary
users with the public anon key and confirms they can't read or change data they shouldn't. It
creates `choir.e2e.rls.<random>@example.com` users and a test workspace, and deletes them at the
end, even when a test fails.

The tests are skipped unless you opt in, because they talk to the real project:

```sh
# from backend/, with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
RLS_TESTS=1 SUPABASE_ANON_KEY=<anon key> uv run pytest -q tests/test_rls.py
```

The anon key is `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `frontend/.env.local`. Tests for columns or
tables that the live database doesn't have yet (run `schema.sql` first) skip with a reason.

In CI they run only when the repository secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are set.
