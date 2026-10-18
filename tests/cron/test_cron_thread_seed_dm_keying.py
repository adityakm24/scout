"""Cron thread-seed must key EXACTLY like the reply that will continue it.

Live incident (Alice, 2026-08-20 01:08, job 8e21a957b77b): the continuable
cron thread seed created its session row with chat_type="thread", but a
Slack DM thread reply arrives with chat_type="dm" — build_session_key puts
them in different rows (agent:main:homeassistant:thread:D...:<ts> vs
agent:main:homeassistant:dm:D...:<ts>), so the user's reply hit a session that had
never seen the brief. Slack channel and Matrix room thread replies key on the
PARENT chat's type (``group``), Discord on ``thread`` — the seed mirrors the
adapter (``_THREAD_REPLY_CHAT_TYPE``); the DM lane is the unswept sibling of
the flat-seed is_dm fix (dcca9d8cfe).

Contract under test: the KEY of the seeded session equals the KEY the
user's in-thread reply will build. Asserting on build_session_key output —
not on SessionSource field shapes — pins the end-to-end contract.
"""

from unittest.mock import MagicMock, patch

from cron.scheduler_delivery import _seed_cron_channel_session, _seed_cron_thread_session
from gateway.config import Platform
from gateway.session import SessionSource, build_session_key


def _seeded_source(store):
    store.get_or_create_session.assert_called_once()
    return store.get_or_create_session.call_args[0][0]


def test_dm_thread_seed_key_matches_dm_reply_key():
    """A brief threaded under a Slack DM must seed the same session row a
    DM in-thread reply resolves to (chat_type='dm', not 'thread')."""
    store = MagicMock()
    adapter = MagicMock()
    adapter._session_store = store

    with patch("gateway.mirror.mirror_to_session", return_value=True):
        _seed_cron_thread_session(
            {"id": "j1", "name": "digest"}, adapter, "homeassistant",
            "D0BJTDCSR7C", "1787188136.448949", "Three bullets",
            chat_name=None, is_dm=True,
        )

    reply_source = SessionSource(
        platform=Platform.HOMEASSISTANT,
        chat_id="D0BJTDCSR7C",
        chat_type="dm",
        user_id="U0B5F8EEYAD",
        thread_id="1787188136.448949",
    )
    assert build_session_key(_seeded_source(store)) == build_session_key(
        reply_source
    ), (
        "seeded key diverges from the DM reply's key — the brief lands in a "
        "row no reply ever resolves to (continuation amnesia)"
    )






def test_dm_seed_default_is_backward_compatible():
    """Callers that don't pass is_dm keep today's thread-keyed behavior —
    the new parameter must not silently rekey non-DM call sites (Discord
    keys an in-thread reply on the ``thread`` slot)."""
    store = MagicMock()
    adapter = MagicMock()
    adapter._session_store = store

    with patch("gateway.mirror.mirror_to_session", return_value=True):
        _seed_cron_thread_session(
            {"id": "j3"}, adapter, "homeassistant", "123", "9001", "brief",
        )

    assert _seeded_source(store).chat_type == "thread"




def test_scoped_dm_thread_seed_key_matches_scoped_reply_key():
    """Slack keys embed the workspace scope_id (build_session_key puts the
    team segment in every Slack dm/group/thread key). A seed built without
    it creates agent:main:homeassistant:dm:<chat>:<thread> while the real reply keys
    agent:main:homeassistant:dm:<team>:<chat>:<thread> — a row no scoped reply ever
    resolves to. The seed must carry the origin's scope_id."""
    store = MagicMock()
    adapter = MagicMock()
    adapter._session_store = store

    with patch("gateway.mirror.mirror_to_session", return_value=True):
        _seed_cron_thread_session(
            {"id": "j4", "name": "digest"}, adapter, "homeassistant",
            "D0BJTDCSR7C", "1787188136.448949", "Three bullets",
            chat_name=None, is_dm=True, scope_id="T0AAAA111",
        )

    reply_source = SessionSource(
        platform=Platform.HOMEASSISTANT,
        chat_id="D0BJTDCSR7C",
        chat_type="dm",
        user_id="U0B5F8EEYAD",
        thread_id="1787188136.448949",
        scope_id="T0AAAA111",
    )
    assert build_session_key(_seeded_source(store)) == build_session_key(
        reply_source
    ), (
        "seeded key lacks the workspace scope segment — a scoped Slack "
        "reply resolves to a different row (continuation amnesia)"
    )




def test_scoped_flat_channel_seed_key_matches_scoped_reply_key():
    """The flat in_channel seed must reproduce the scoped key too."""
    store = MagicMock()
    adapter = MagicMock()
    adapter._session_store = store

    with patch("gateway.mirror.mirror_to_session", return_value=True):
        _seed_cron_channel_session(
            {"id": "j6", "name": "digest"}, adapter, "homeassistant",
            "C0AAAAAAAA", "Three bullets", is_dm=False,
            user_id="U0B5F8EEYAD", chat_name="ops", scope_id="T0AAAA111",
        )

    reply_source = SessionSource(
        platform=Platform.HOMEASSISTANT,
        chat_id="C0AAAAAAAA",
        chat_type="group",
        user_id="U0B5F8EEYAD",
        thread_id=None,
        scope_id="T0AAAA111",
    )
    assert build_session_key(_seeded_source(store)) == build_session_key(
        reply_source
    )


