"""A minimal fake of the supabase-py client's fluent query builder, just
enough to exercise the backend without touching a real Supabase project.
Supports select/insert/update with eq/gte filters, order, limit and execute.
Inserts and updates change the fake's tables, so tests can inspect them.
"""

from datetime import datetime, timezone
from typing import Any

from postgrest.exceptions import APIError


class FakeResult:
    def __init__(self, data: list[dict[str, Any]]):
        self.data = data


class FakeQuery:
    def __init__(self, table: list[dict[str, Any]], error: APIError | None = None):
        self._table = table
        self._data = list(table)
        self._filters: list[tuple[str, str, Any]] = []
        self._error = error
        self._insert: dict[str, Any] | None = None
        self._update: dict[str, Any] | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "FakeQuery":
        return self

    def insert(self, row: dict[str, Any]) -> "FakeQuery":
        self._insert = row
        return self

    def update(self, values: dict[str, Any]) -> "FakeQuery":
        self._update = values
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self._filters.append((column, "eq", value))
        return self

    def gte(self, column: str, value: Any) -> "FakeQuery":
        self._filters.append((column, "gte", value))
        return self

    def limit(self, _count: int) -> "FakeQuery":
        return self

    def order(self, column: str, desc: bool = False, **_kwargs: Any) -> "FakeQuery":
        # None sorts first, like `nullsfirst`.
        self._data.sort(key=lambda row: row.get(column) or "", reverse=desc)
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        for column, op, value in self._filters:
            actual = row.get(column)
            if op == "eq" and actual != value:
                return False
            if op == "gte" and (actual is None or actual < value):
                return False
        return True

    def execute(self) -> FakeResult:
        if self._error:
            raise self._error
        if self._insert is not None:
            # Like a column default of now().
            row = {"created_at": datetime.now(timezone.utc).isoformat(), **self._insert}
            self._table.append(row)
            return FakeResult([dict(row)])
        rows = [row for row in self._data if self._matches(row)]
        if self._update is not None:
            for row in rows:
                row.update(self._update)
        return FakeResult(rows)


class FakeClient:
    """Construct with keyword args named after tables, e.g.
    FakeClient(threads=[...], projects=[...], team_members=[...]).
    `errors` maps a table name to the APIError its queries should raise.
    """

    def __init__(self, errors: dict[str, APIError] | None = None, **tables: list[dict[str, Any]]):
        self._tables = tables
        self._errors = errors or {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self._tables.setdefault(name, []), self._errors.get(name))
