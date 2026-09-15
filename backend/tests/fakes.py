"""A minimal fake of the supabase-py client's fluent query builder, just
enough to exercise backend.db without touching a real Supabase project.
Only .select()/.eq()/.limit()/.execute() are implemented, since that's all
backend.db currently uses.
"""

from typing import Any

from postgrest.exceptions import APIError


class FakeResult:
    def __init__(self, data: list[dict[str, Any]]):
        self.data = data


class FakeQuery:
    def __init__(self, data: list[dict[str, Any]], error: APIError | None = None):
        self._data = list(data)
        self._filters: dict[str, Any] = {}
        self._error = error

    def select(self, *_args: Any, **_kwargs: Any) -> "FakeQuery":
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self._filters[column] = value
        return self

    def limit(self, _count: int) -> "FakeQuery":
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        return all(row.get(k) == v for k, v in self._filters.items())

    def execute(self) -> FakeResult:
        if self._error:
            raise self._error
        return FakeResult([row for row in self._data if self._matches(row)])


class FakeClient:
    """Construct with keyword args named after tables, e.g.
    FakeClient(threads=[...], projects=[...], team_members=[...]).
    `errors` maps a table name to the APIError its queries should raise.
    """

    def __init__(self, errors: dict[str, APIError] | None = None, **tables: list[dict[str, Any]]):
        self._tables = tables
        self._errors = errors or {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self._tables.get(name, []), self._errors.get(name))
