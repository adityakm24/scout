<p align="center">
  <img src="assets/icon-master.svg" alt="Scout" width="96">
</p>

# Scout

Scout is a personal AI assistant you talk to from the desktop app, the web app or your phone. It
remembers what matters to you, learns new skills as you use it, works with your email and calendar,
runs tasks on a schedule, and asks before it does anything consequential: sending mail, spending
money, changing your accounts.

| Surface | What it is |
|---|---|
| **Desktop app** | A native window for macOS, Windows and Linux (`apps/desktop/`). |
| **Web app** | The website, served by the Scout backend (`web/`). |
| **Phone app** | iOS and Android (`mobile/`), with live progress on the lock screen and notifications while the app is closed. |

The Scout backend runs on a server. The apps connect to it; Scout is used only through the apps.

## What it can do

- **Remembers you.** Preferences, people and facts carry across conversations.
- **Learns skills.** Reusable procedures it can write, refine and share; a library ships in `skills/`.
- **Works with your accounts.** Gmail, Calendar and Drive through the Google Workspace skill, plus MCP
  connectors.
- **Acts on a schedule.** Reminders, recurring checks ("Heartbeat") and one-off tasks run through the
  built-in scheduler, and deliver their results to your Bot Chat.
- **Uses real tools.** The agent gets its own sandboxed terminal, a browser, files, web search and
  voice, behind approval rules you control. You can watch its terminal from the desktop app.
- **Your choice of model.** Bring a key for any supported provider, or run a local model.
- **Integrations.** Incoming webhooks, an OpenAI-compatible HTTP API and Home Assistant.

## Running the backend

There is no command line for people. A server runs the backend, and every app connects to it:

```bash
docker build -t scout .
docker run -p 9119:9119 -v scout-data:/opt/data scout
```

Outside Docker, the process entry point is `scout-server --host 0.0.0.0 --port 9119`. It serves the
apps' API and the website, runs scheduled jobs, and starts the gateway for webhooks, the HTTP API and
Home Assistant. Secrets go in `.env` and settings in `config.yaml` under the data directory.

The desktop app connects to the backend URL in `apps/desktop/backend.json`, which is fixed at build time.

## Developing

```bash
source ./activate
scripts/run_tests.sh                 # Python test suite (always use this, never bare pytest)
scout-server                         # backend on 127.0.0.1:9119
cd apps/desktop && npm run dev       # desktop app with live reload, connected to it
```

[`AGENTS.md`](AGENTS.md) describes the architecture and the rules for changing it, with a guide per
area (`agent/`, `gateway/`, `tools/`, `apps/desktop/`, ...). [`CONTRIBUTING.md`](CONTRIBUTING.md) covers
setup, tests and pull requests.

## License

MIT. See [`LICENSE`](LICENSE).
