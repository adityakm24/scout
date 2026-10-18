"""Every platform adapter's ``send_voice`` must accept the ``is_voice`` keyword the base media
dispatch passes (``BasePlatformAdapter._deliver_media_from_response`` →
``send_voice(..., is_voice=is_voice)``). An explicit signature without it raises ``TypeError`` and
the attachment is silently dropped (#102221, #116776 — Matrix; same class in line/mattermost/weixin)."""

from __future__ import annotations



