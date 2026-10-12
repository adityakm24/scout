"""Shared FAL.ai SDK plumbing: the lazy ``fal_client`` import every FAL-backed tool uses (it added
~64 ms per CLI invocation when imported eagerly). Callers cache the module on their own global so
tests can monkeypatch it."""

from __future__ import annotations

from typing import Any


def import_fal_client() -> Any:
    """Import ``fal_client`` (via ``pm`` when available) and return
    the module reference.

    Callers cache the result on their own module global so tests can monkeypatch it.
    """
    try:
        from pm import ensure_import as _lazy_ensure
    except ImportError:
        # pm itself unavailable (externally-managed env, partial install) —
        # the plain import below is the authority on availability.
        pass
    else:
        try:
            _lazy_ensure("fal")
        except ImportError:
            pass  # same authority rule: let the plain import decide
        except Exception as exc:  # noqa: BLE001 — pm surfaces install hints
            raise ImportError(str(exc))
    import fal_client  # type: ignore  # noqa: WPS433 — intentionally lazy
    return fal_client
