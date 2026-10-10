<p align="center">
  <img src="assets/scout-mark.svg" alt="Scout" width="96">
</p>

# Scout

Scout is a personal AI assistant that lives on your computer and your phone. It remembers what
matters to you, learns new skills as you use it, works with your email and calendar, runs tasks on a
schedule, and asks before it does anything consequential: sending mail, spending money, changing
your accounts.

The same assistant is available everywhere you are:

| Surface | What it is |
|---|---|
| **Desktop app** | A native window for macOS, Windows and Linux (`apps/desktop/`). |
| **Phone app** | iOS and Android (`mobile/`), with live progress on the lock screen and notifications while the app is closed. |
| **Messaging** | Talk to Scout from Telegram, WhatsApp, Discord, Slack and other chat apps (`scout gateway`). |
| **Terminal** | An interactive CLI and TUI (`scout`). |

## What it can do

- **Remembers you.** Preferences, people and facts carry across conversations (`MEMORY.md`, `USER.md`).
- **Learns skills.** Reusable procedures it can write, refine and share; a library ships in `skills/`.
- **Works with your accounts.** Gmail, Calendar and Drive through the Google Workspace skill, plus MCP
  connectors.
- **Acts on a schedule.** Reminders, recurring checks ("Heartbeat") and one-off tasks, such as placing
  an order at the right time, run through the built-in scheduler.
- **Uses real tools.** A terminal, a browser, files, web search and voice, behind approval rules you control.
- **Your choice of model.** Bring a key for any supported provider, or a local model.

## Getting started

Scout runs from a checkout of this repository.

```bash
git clone https://github.com/adityakm24/scout.git
cd scout
./setup-scout.sh     # installs Python, Node and dependencies into Scout's own environment
source ./activate    # puts that environment on your shell's PATH
scout setup          # choose a model provider and enter its key
scout                # start chatting
```

Then pick the surface you want:

```bash
scout desktop        # build and open the desktop app
scout gateway        # connect messaging apps (Telegram, WhatsApp, ...)
scout doctor         # check the install if something looks wrong
```

The phone app pairs with a running Scout; see [`mobile/AGENTS.md`](mobile/AGENTS.md) for building it.

## Everyday commands

```bash
scout model          # switch provider or model
scout tools          # turn tools on or off
scout skills         # browse, install and manage skills
scout cron list      # see scheduled tasks
scout config get X   # read a setting (config lives in ~/.scout/config.yaml)
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
