# Scout CLI Reference

Live sources when anything looks stale: `scout --help`, `scout <command> --help`.

### Global Flags

```
scout [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
scout chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
scout setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
scout model                Interactive model/provider picker
scout fallback [add|remove|list]  Fallback provider chain
scout config [show|edit|get|set|unset|path|env-path|check|migrate]
scout login / logout       OAuth sign-in / clear stored auth
scout doctor [--fix]       Check dependencies and config
scout status [--all]       Component status
```

### Tools & Skills

```
scout tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

scout skills list|browse|search QUERY|inspect ID
scout skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
scout skills config        Enable/disable skills per platform
scout skills check|update|uninstall|publish PATH
scout skills tap add REPO  Add a GitHub repo as a skill source
scout bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
scout mcp add NAME (--url or --command) | remove | list | test NAME
scout mcp catalog | install NAME     Curated catalog install
scout mcp configure NAME             Toggle tool selection
scout mcp serve                      Run Scout as an MCP server
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
scout gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `scout photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
### Sessions

```
scout sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
scout cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
scout webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
scout profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
scout profile rename A B | alias NAME | export NAME | import FILE
scout profile migrate-identity A B   Retry a completed rename's session/routing identity migration
```

### Credentials & Pools

```
scout auth                 Interactive credential manager
scout auth add [PROVIDER]  Add OAuth or API-key credential (spaceshipresearch, openai-codex, qwen-oauth, …)
scout auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
scout desktop / gui        Native desktop app
scout dashboard            Web admin panel + embedded chat (--stop / --status)
scout proxy                OpenAI-compatible local proxy backed by an OAuth provider
scout kanban <verb>        Multi-agent work-queue board
scout project              Named multi-folder workspaces
scout skin list|use|set    Switch/tweak skins (see references/themes.md)
scout pets <verb>          Pet mascots (see references/petdex.md)
scout memory setup|status|off|reset   Memory provider
scout secrets bitwarden|onepassword   External secret stores
scout moa                  Mixture-of-Agents slots
scout hooks / security / backup / import / checkpoints / console
scout logs [-f] [errors]   View agent/error logs
scout send                 One-off message through a gateway platform
scout pairing / plugins / insights / journey / computer-use
scout acp                  ACP server (IDE integration)
scout completion bash|zsh|fish
scout update / uninstall / claw migrate
```

Plugin- and provider-supplied subcommands (e.g. `scout photon setup`) only appear once their plugin is installed/active.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `scout config edit` |
| Tools / toolsets | `scout tools list` |
| Skills catalog | `scout skills browse` |
| Provider setup | `scout model` |
| Env variables | `scout config env-path` |
| Gateway logs | `~/.scout/logs/gateway.log` (or `scout logs`) |
| Sessions | `scout sessions browse` (reads state.db) |
