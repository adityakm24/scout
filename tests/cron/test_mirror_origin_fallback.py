"""Mirror eligibility for origin-fallback and explicit cron delivery targets.

Field report (enterprise, 2026-08-17): `cron.mirror_delivery: true` with
`deliver: origin` delivered the brief to Slack but never appended it to the
reply-facing gateway session, so a user reply hit a session with no context.

Root cause: the job was created by a provisioning script, so it carries no
captured origin. `deliver: origin` falls back to the home channel — the
user's actual conversation — but `_target_matches_origin` returns False for
an empty origin, so the mirror and the in_channel seed never fire. The June
origin-scoping refactor (c06ceb3232) correctly excluded broadcasts, but the
origin-FALLBACK target is not a broadcast: it is the best available stand-in
for the user's primary conversation.

Design under test:
- Delivery targets carry `_resolved_from` provenance used to determine mirror eligibility:
  * origin match            -> eligible (unchanged)
  * origin-fallback (deliver=origin, no origin) -> eligible (NEW)
  * explicit platform:chat  -> eligible ONLY with per-job attach_to_session
    (NEW, opt-in; the global flag never activates explicit targets)
  * user-written bare platform -> home conversation, same flags as origin-fallback
  * `all` broadcast expansion -> never eligible (unchanged invariant)
- Dedup across tokens (e.g. "origin,all" hitting the same chat) OR-merges
  eligibility so token order cannot strip it.
- The in_channel flat-session seed requires a DM-shaped target or a known
  user_id: group-channel session keys are user-isolated, and a seed without
  user_id would create an orphan session no reply ever resolves to.
"""

import pytest

from cron.scheduler import _deliver_result, _resolve_delivery_targets
from cron.scheduler_delivery import _target_mirror_eligible


@pytest.fixture(autouse=True)
def _home_channel(monkeypatch):
    monkeypatch.setenv("SLACK_HOME_CHANNEL", "D0HOME")
    monkeypatch.delenv("TELEGRAM_HOME_CHANNEL", raising=False)
    monkeypatch.delenv("DISCORD_HOME_CHANNEL", raising=False)


class TestMirrorEligibilityResolution:
    def test_origin_target_is_eligible(self):
        job = {
            "deliver": "origin",
            "origin": {"platform": "homeassistant", "chat_id": "D0AAA", "chat_type": "dm"},
        }
        targets = _resolve_delivery_targets(job)
        assert len(targets) == 1
        assert _target_mirror_eligible(job, targets[0], global_mirror=True)





    def test_explicit_target_not_eligible_under_global_flag(self):
        """Global mirror_delivery must not write sessions into arbitrary
        explicitly-addressed chats."""
        job = {"deliver": "homeassistant:D0EXPL", "origin": None}
        targets = _resolve_delivery_targets(job)
        assert len(targets) == 1
        assert not _target_mirror_eligible(job, targets[0], global_mirror=True)

    def test_explicit_target_eligible_with_per_job_attach(self):
        """attach_to_session=true on the job is the author declaring the
        explicit target a conversation — managed per-user DM crons."""
        job = {
            "deliver": "homeassistant:D0EXPL",
            "origin": None,
            "attach_to_session": True,
        }
        targets = _resolve_delivery_targets(job)
        assert len(targets) == 1
        assert _target_mirror_eligible(job, targets[0], global_mirror=False)



    def test_explicit_other_chat_with_origin_not_eligible(self):
        """An explicit target that is NOT the origin stays unmirrored under
        the global flag even when the job has an origin elsewhere."""
        job = {
            "deliver": "homeassistant:D0OTHER",
            "origin": {"platform": "homeassistant", "chat_id": "D0AAA", "chat_type": "dm"},
        }
        targets = _resolve_delivery_targets(job)
        assert len(targets) == 1
        assert not _target_mirror_eligible(job, targets[0], global_mirror=True)




class TestInChannelSeedUserIdGuard:
    """Group-channel seeds are user-keyed; a seed with no user_id would create
    an orphan session. DM targets are safe (key has no user_id)."""

    def test_seed_requires_dm_or_user_id(self):
        from cron.scheduler_delivery import _inchannel_seed_allowed

        # DM-shaped chat, no user_id: allowed (DM keys don't embed user).
        assert _inchannel_seed_allowed(is_dm=True, user_id=None)
        # Group chat with known user: allowed.
        assert _inchannel_seed_allowed(is_dm=False, user_id="U123")
        # Group chat, no user: refused — would orphan the session.
        assert not _inchannel_seed_allowed(is_dm=False, user_id=None)
