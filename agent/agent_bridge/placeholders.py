"""Blind token injection: ``{{USER_ADDRESS}}`` becomes the person's address inside the page only.

The Browser Agent names a placeholder; this module resolves the value from the vault (``profile``
and ``address`` items), finds the matching fields by their autocomplete purpose and writes them
through the supervisor's CDP socket. The value never enters a tool result, a log or the model's
context, and it is registered with the redaction boundary so a later page read cannot echo it.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from agent.agent_bridge.protocol import PLACEHOLDERS

# placeholder -> (vault kind, vault field, autocomplete token of the page field it fills)
_FIELDS: Dict[str, Tuple[str, str, str]] = {
    "USER_FULL_NAME": ("profile", "full_name", "name"),
    "USER_FIRST_NAME": ("profile", "first_name", "given-name"),
    "USER_LAST_NAME": ("profile", "last_name", "family-name"),
    "USER_EMAIL": ("profile", "email", "email"),
    "USER_PHONE": ("profile", "phone", "tel"),
    "USER_ADDRESS_LINE1": ("address", "address_line1", "address-line1"),
    "USER_ADDRESS_LINE2": ("address", "address_line2", "address-line2"),
    "USER_CITY": ("address", "city", "address-level2"),
    "USER_REGION": ("address", "state", "address-level1"),
    "USER_POSTAL_CODE": ("address", "postal_code", "postal-code"),
    "USER_COUNTRY": ("address", "country", "country-name"),
}
_GROUPS = {"USER_ADDRESS": ("USER_ADDRESS_LINE1", "USER_ADDRESS_LINE2", "USER_CITY", "USER_REGION",
                            "USER_POSTAL_CODE", "USER_COUNTRY")}
assert set(_FIELDS) | set(_GROUPS) == set(PLACEHOLDERS)

# What the consent prompt calls each placeholder (code-written, never model text).
_PLAIN = {
    "USER_FULL_NAME": "name", "USER_FIRST_NAME": "first name", "USER_LAST_NAME": "last name",
    "USER_EMAIL": "email address", "USER_PHONE": "phone number", "USER_ADDRESS": "address",
    "USER_ADDRESS_LINE1": "street address", "USER_ADDRESS_LINE2": "address line 2", "USER_CITY": "city",
    "USER_REGION": "state or region", "USER_POSTAL_CODE": "postal code", "USER_COUNTRY": "country",
}

_IDENTITY_HEURISTICS = (
    (re.compile(r"\b(first|given|fore)\s*name\b|\bfname\b"), "given-name"),
    (re.compile(r"\b(last|family|sur)\s*name\b|\blname\b|\bsurname\b"), "family-name"),
    (re.compile(r"\bfull\s*name\b|^name$|\byour name\b"), "name"),
    (re.compile(r"\be-?mail\b"), "email"),
    (re.compile(r"\b(phone|mobile|telephone|cell)\b"), "tel"),
)
_IDENTITY_TOKENS = ("name", "given-name", "family-name", "email", "tel")


def expand(placeholder: str) -> Tuple[str, ...]:
    return _GROUPS.get(placeholder, (placeholder,))


def describe(placeholder: str) -> str:
    return _PLAIN[placeholder]


def tokens_for(placeholder: str) -> Dict[str, str]:
    """autocomplete token -> placeholder, for every field *placeholder* covers."""
    return {_FIELDS[p][2]: p for p in expand(placeholder)}


def classify(control) -> Optional[str]:
    """The autocomplete purpose of one inspected page control (vault classifier for addresses)."""
    from agent.vault_login_classifier import ADDRESS_AUTOFILL_TOKENS, classify_checkout_control

    tokens = [t for t in control.autocomplete.lower().split() if t]
    for token in _IDENTITY_TOKENS:
        if token in tokens:
            return token
    if control.type == "email":
        return "email"
    if control.type == "tel":
        return "tel"
    if control.type == "password":
        return None
    checkout = classify_checkout_control(control)
    if checkout is not None and (checkout.token in ADDRESS_AUTOFILL_TOKENS or checkout.token == "country-name"):
        return checkout.token
    searchable = " ".join(part for part in (control.name, control.label) if part).lower()
    for pattern, token in _IDENTITY_HEURISTICS:
        if pattern.search(searchable):
            return token
    return None


def resolve_values(placeholder: str) -> Dict[str, str]:
    """placeholder field -> value from the local vault (first ``profile`` / ``address`` item).

    Server-side only: callers must never put these values in a result, a log or an exception.
    """
    from agent.vault_store import get_vault_store

    store = get_vault_store()
    first_by_kind: Dict[str, Dict[str, str]] = {}
    for meta in store.list_items():
        if meta.kind in ("profile", "address") and meta.kind not in first_by_kind:
            first_by_kind[meta.kind] = store.resolve_secret(meta.id)
    values: Dict[str, str] = {}
    for p in expand(placeholder):
        kind, field, _ = _FIELDS[p]
        value = (first_by_kind.get(kind) or {}).get(field, "")
        if value:
            values[p] = value
    return values


def missing_profile_fields(placeholders: List[str]) -> List[str]:
    """Placeholders with no saved value at all (the User Agent should tell the person)."""
    return [p for p in placeholders if not resolve_values(p)]
