"""A minimal fake of the supabase-py client's fluent query builder, just
enough to exercise the backend without touching a real Supabase project.
Supports select/insert/update/upsert with eq/gte/gt/in_ filters, order, limit
and execute. Inserts, updates and upserts change the fake's tables, so tests
can inspect them.
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
        self._upsert: dict[str, Any] | None = None
        self._on_conflict: str | None = None
        self._limit: int | None = None

    def select(self, *_args: Any, **_kwargs: Any) -> "FakeQuery":
        return self

    def insert(self, row: dict[str, Any]) -> "FakeQuery":
        self._insert = row
        return self

    def update(self, values: dict[str, Any]) -> "FakeQuery":
        self._update = values
        return self

    def upsert(self, row: dict[str, Any], on_conflict: str | None = None) -> "FakeQuery":
        self._upsert = row
        self._on_conflict = on_conflict
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self._filters.append((column, "eq", value))
        return self

    def gte(self, column: str, value: Any) -> "FakeQuery":
        self._filters.append((column, "gte", value))
        return self

    def gt(self, column: str, value: Any) -> "FakeQuery":
        self._filters.append((column, "gt", value))
        return self

    def in_(self, column: str, values: Any) -> "FakeQuery":
        self._filters.append((column, "in", list(values)))
        return self

    def limit(self, count: int) -> "FakeQuery":
        self._limit = count
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
            if op == "gt" and (actual is None or actual <= value):
                return False
            if op == "in" and actual not in value:
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
        if self._upsert is not None:
            keys = (self._on_conflict or "id").split(",")
            for existing in self._table:
                if all(existing.get(k) == self._upsert.get(k) for k in keys):
                    existing.update(self._upsert)
                    return FakeResult([dict(existing)])
            self._table.append(dict(self._upsert))
            return FakeResult([dict(self._upsert)])
        rows = [row for row in self._data if self._matches(row)]
        if self._limit is not None:
            rows = rows[: self._limit]
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
