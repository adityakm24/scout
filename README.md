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

## How private data stays off the web

Scout runs as two agents, each in its own NVIDIA OpenShell sandbox. A page that takes over the
browser cannot then read mail, files or the calendar, and it cannot talk the other agent into
leaking them.

| Agent | Sandbox | What it can do |
|---|---|---|
| **User Agent** | `scout-user` | Read-only access to personal context (mail, files, calendar, memory). No open web. Google's APIs are limited to read-only calls at the OS policy layer, so a send cannot leave the sandbox even if the model asks for one. |
| **Browser Agent** | `scout-browser` | Browses the public web and holds no personal data. Its only network path is Scout's egress proxy, which refuses private networks and cloud-metadata addresses. |

NVIDIA NeMo Guardrails checks every message that crosses back, inside a third sandbox
(`scout-guard`) that has no network after it is installed. The rail is deterministic: it does
not call a model. If the guard cannot answer, the message is refused. NVIDIA NemoClaw is the
zero-trust policy those rails enforce: untrusted text (pages, mail, tool output) is data, not
instructions.

The bridge between the agents follows four rules:

1. **No natural-language chat.** The Browser Agent may only request data or report status through
   rigid JSON: a status enum, a reason enum, and typed result fields (number, date, short text, a
   short list, and so on). Code validates that object, then NeMo Guardrails checks it again.
   Unknown keys, prose, and injection signatures are dropped, never repaired.
2. **Audit by metadata.** The User Agent watches progress through an action log of tool name,
   domain and outcome, plus the domain allowlist. It does not read raw page HTML.
3. **Blind token injection.** The Browser Agent asks for `{{USER_ADDRESS}}` (or email, name,
   phone). An external step writes the real value into the matching form fields. The browsing
   model never sees it, and the tool result reports only that the fields were filled.
4. **Out-of-band approval.** The User Agent is read-only by default. Sending mail, changing the
   calendar, or any other write outside the sandbox runs only after a confirmation the model
   cannot answer. The card is written by code from the exact arguments, and a missing answer is
   a refusal. Sharing a saved detail with a site asks the same way, once per site.

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
