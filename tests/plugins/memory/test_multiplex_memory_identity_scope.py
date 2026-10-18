"""Multiplex invariant: memory-provider identity/tenant/endpoint never comes from the default profile.

Under ``gateway.multiplex_profiles`` ``os.environ`` is the DEFAULT profile's ``.env``. When a secondary
profile's scope does not define MEM0_USER_ID / SUPERMEMORY_CONTAINER_TAG / RETAINDB_PROJECT /
OPENVIKING_* / SCOUT_HONCHO_HOST, the provider must fall back to its own default
(per-profile partition), NOT write the secondary's memories into the default profile's account.
"""
from __future__ import annotations

import pytest

from agent import secret_scope


