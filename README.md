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
| **Web app** | A browser dashboard served by your own Scout (`scout dashboard`, `web/`). |
| **Phone app** | iOS and Android (`mobile/`), with live progress on the lock screen and notifications while the app is closed. |

Scout itself runs on a machine you own. The apps connect to it; nothing is hosted for you.

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

## Getting started

Scout runs from a checkout of this repository.

```bash
git clone https://github.com/adityakm24/scout.git
cd scout
./setup-scout.sh     # installs Python, Node and dependencies into Scout's own environment
source ./activate    # puts that environment on your shell's PATH
scout setup          # choose a model provider and enter its key
scout desktop        # build and open the desktop app
```

To use Scout from a browser instead, run `scout dashboard`; it opens the web app on port 9119. The phone app
pairs with a running Scout; see [`mobile/AGENTS.md`](mobile/AGENTS.md) for building it.

The `scout` command is for setup and administration, not for chatting. There is no terminal chat:
conversations happen in the apps.

## Administration

```bash
scout model          # switch provider or model
scout tools          # turn tools on or off
scout skills         # browse, install and manage skills
scout cron list      # see scheduled tasks
scout gateway        # background service for cron, webhooks and the HTTP API
scout doctor         # check the install if something looks wrong
```

API keys and other secrets go in `~/.scout/.env`; everything else is in `~/.scout/config.yaml`.

## Developing

```bash
source ./activate
scripts/run_tests.sh                 # Python test suite (always use this, never bare pytest)
cd apps/desktop && npm run dev       # desktop app with live reload
```

[`AGENTS.md`](AGENTS.md) describes the architecture and the rules for changing it, with a guide per
area (`agent/`, `gateway/`, `tools/`, `apps/desktop/`, ...). [`CONTRIBUTING.md`](CONTRIBUTING.md) covers
setup, tests and pull requests.

## License

MIT. See [`LICENSE`](LICENSE).
