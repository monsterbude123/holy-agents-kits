"""Core helpers for the template package."""

from __future__ import annotations

GREETING = "hello from the IDEA Python profile"


def greet(name: str) -> str:
    """Return a greeting for ``name``."""
    return f"{GREETING}, {name}"


def add(left: int, right: int) -> int:
    """Return the sum of two integers."""
    return left + right
