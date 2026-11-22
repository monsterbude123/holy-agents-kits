from __future__ import annotations

from py_project.core import add, greet


def test_greet_mentions_name() -> None:
    assert "idea" in greet("idea").lower()


def test_add() -> None:
    assert add(2, 3) == 5
