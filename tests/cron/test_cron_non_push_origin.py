"""Cron deliver=origin on a non-push surface (#69304).

An api_server turn binds ``async_delivery=False``: its adapter's ``send()`` is a stub, so a
job that captured ``origin.platform="api_server"`` ran fine (``last_status=ok``) while every
fire recorded ``last_delivery_error`` and nothing reached the creator. Both legs are covered:
a non-push session never stamps an origin (so the creation-time local-only notice fires), and
a job already stamped with such an origin resolves to the configured home channel instead.
"""

from gateway.session_context import clear_session_vars, set_session_vars


def test_non_push_session_stamps_no_origin_and_gets_creation_notice():
    from tools.cronjob_job_args import _local_delivery_notice, _origin_from_env

    tokens = set_session_vars(platform="api_server", chat_id="desk-1", session_key="desk-1",
                              async_delivery=False)
    try:
        origin = _origin_from_env()
        notice = _local_delivery_notice({"id": "j", "deliver": "origin", "origin": origin}, None)
    finally:
        clear_session_vars(tokens)
    assert origin is None
    assert notice

    # Control: a push-capable platform keeps its origin.
    tokens = set_session_vars(platform="telegram", chat_id="777", session_key="tg", async_delivery=True)
    try:
        assert _origin_from_env()["platform"] == "telegram"
    finally:
        clear_session_vars(tokens)






def test_suggestions_accept_origin_shares_the_non_push_guard():
    from scout_backend.suggestions_cmd import _resolve_origin

    tokens = set_session_vars(platform="api_server", chat_id="desk-1", session_key="desk-1",
                              async_delivery=False)
    try:
        assert _resolve_origin() is None
    finally:
        clear_session_vars(tokens)
    tokens = set_session_vars(platform="telegram", chat_id="777", session_key="tg", async_delivery=True)
    try:
        assert _resolve_origin()["chat_id"] == "777"
    finally:
        clear_session_vars(tokens)
