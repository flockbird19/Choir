"""A minimal fake of the supabase-py client's fluent query builder, just
enough to exercise the access-control logic in backend.db without touching a
real Supabase project. Only .select()/.eq()/.execute() and .delete()/.insert()
are implemented, since that's all backend.db currently uses.
"""

from typing import Any


class FakeResult:
    def __init__(self, data: list[dict[str, Any]]):
        self.data = data


class FakeQuery:
    def __init__(self, data: list[dict[str, Any]]):
        self._data = list(data)
        self._filters: dict[str, Any] = {}

    def select(self, *_args: Any, **_kwargs: Any) -> "FakeQuery":
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self._filters[column] = value
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        return all(row.get(k) == v for k, v in self._filters.items())

    def execute(self) -> FakeResult:
        return FakeResult([row for row in self._data if self._matches(row)])


class FakeClient:
    """Construct with keyword args named after tables, e.g.
    FakeClient(threads=[...], projects=[...], team_members=[...]).
    """

    def __init__(self, **tables: list[dict[str, Any]]):
        self._tables = tables

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self._tables.get(name, []))
