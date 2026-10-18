"""``scout-server``: the hosted backend's process entry point.

Scout is used through its apps; there is no human CLI. A deployment (Docker,
systemd) runs this to start the backend the apps connect to. It marks the
process as the app backend, so the ``scout`` command stays available to the
agent's own terminal and the backend's subprocesses, and nowhere else.
"""

from __future__ import annotations

import argparse
import atexit
import os
import secrets
import subprocess
import sys


def _start_gateway() -> subprocess.Popen:
    """The gateway serves webhooks, the HTTP API and Home Assistant beside the app backend."""
    # The backend's ownership proof stays with the backend.
    env = {k: v for k, v in os.environ.items() if k not in {"SCOUT_DASHBOARD_SESSION_TOKEN", "SCOUT_DESKTOP"}}
    gateway = subprocess.Popen([sys.executable, "-m", "scout_cli.main", "gateway", "run"], env=env)

    def _stop() -> None:
        if gateway.poll() is None:
            gateway.terminate()
            try:
                gateway.wait(timeout=10)
            except subprocess.TimeoutExpired:
                gateway.kill()

    atexit.register(_stop)
    return gateway


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="scout-server", description="Run the Scout backend.")
    parser.add_argument("--host", default="127.0.0.1", help="Interface to bind (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=9119, help="Port to listen on (default 9119)")
    parser.add_argument("--no-gateway", action="store_true", help="Do not start the gateway process")
    args = parser.parse_args(argv)

    # Inherited by everything the backend starts, including the agent's terminal.
    os.environ["AI_AGENT"] = "scout-agent"
    os.environ["SCOUT_AGENT"] = "true"
    # The apps own this backend: it runs the cron scheduler in-process. The per-run
    # session token is the ownership proof (scout_cli.process_identity).
    os.environ["SCOUT_DESKTOP"] = "1"
    os.environ.setdefault("SCOUT_DASHBOARD_SESSION_TOKEN", secrets.token_urlsafe(32))

    if not args.no_gateway:
        _start_gateway()

    from scout_cli.main import main as scout_main

    # Dashboard mode serves the web app too; --no-open because a server has no browser.
    sys.argv = ["scout", "dashboard", "--no-open", "--host", args.host, "--port", str(args.port)]
    scout_main()


if __name__ == "__main__":
    main()
