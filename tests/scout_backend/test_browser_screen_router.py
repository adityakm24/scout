"""The live browser screen forwards a viewer's input only while that viewer holds the lease."""

import asyncio
import json

from scout_backend.web_routers import browser_screen


class _Viewer:
    def __init__(self, messages):
        self.messages = list(messages)

    async def receive_text(self):
        if not self.messages:
            raise asyncio.CancelledError
        return json.dumps(self.messages.pop(0))


def test_only_the_lease_holder_drives_the_browser(monkeypatch):
    from tools.bot_desktop import lease

    holder = {"id": "a"}
    monkeypatch.setattr(lease, "viewer_may_send_input", lambda viewer_id, **k: viewer_id == holder["id"])
    click = {"type": "mousePressed", "x": 5, "y": 6, "button": "left", "clickCount": 1}

    def forwarded(viewer_id):
        sent = []
        msgs = _Viewer([click])

        async def run():
            while True:
                msg = json.loads(await msgs.receive_text())
                if lease.viewer_may_send_input(viewer_id):
                    sent.extend(browser_screen._input_commands(msg))

        try:
            asyncio.run(run())
        except asyncio.CancelledError:
            pass
        return sent

    assert forwarded("a") == [("Input.dispatchMouseEvent", {**click, "type": "mousePressed", "modifiers": 0})]
    assert forwarded("b") == []
