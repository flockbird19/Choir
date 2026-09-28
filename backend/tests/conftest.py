"""
Tests never call a real AI model (project rule: no credits in tests). A test that needs a
model patches `sys.modules["anthropic"]`/`["openai"]` or `llm.complete_once` itself; anything
that slips through hits these stubs and fails loudly instead of reaching the network.
"""

import sys
import types

import pytest


class _NoRealModel:
    def __init__(self, *args, **kwargs):
        raise RuntimeError("A test tried to call a real AI model. Patch it with a fake.")


@pytest.fixture(autouse=True)
def no_real_ai_models(monkeypatch):
    stub = types.SimpleNamespace(Anthropic=_NoRealModel, OpenAI=_NoRealModel)
    monkeypatch.setitem(sys.modules, "anthropic", stub)
    monkeypatch.setitem(sys.modules, "openai", stub)
