"""Tests for auth-aware retry in the Mattermost WS loop.

Mattermost's _ws_loop previously caught all exceptions with a broad
``except Exception`` and retried forever, so permanent auth failures (401,
403) looped indefinitely instead of stopping. These tests verify that auth
errors now stop the reconnect. The Matrix sync-loop counterpart lives in
tests/gateway/test_matrix.py::TestMatrixSyncLoop.
"""




# ---------------------------------------------------------------------------
# Mattermost: _ws_loop auth-aware retry
# ---------------------------------------------------------------------------


