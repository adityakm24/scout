# Contributing to Scout

Thanks for working on Scout. [`AGENTS.md`](AGENTS.md) is the architecture guide and the rulebook for
changes (caching invariants, where new capability belongs, code shape, testing). Read it, and the
`AGENTS.md` for the area you are changing, before you start.

## Development setup

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Git** | With the `git-lfs` extension installed |
| **Python 3.14** | The project requires `>=3.14,<3.15`; PM (Scout's package manager) provides the pinned interpreter |
| **Node.js** | Use the PM pin, or a version accepted by the root `package.json`: `^22.22.0`, `^24.11.0`, or `>=26.0.0` |

### Development environment

Pick a development home first, so experimental code never touches your real Scout data:

```bash
export SCOUT_HOME="$HOME/.scout-dev"
./setup-scout.sh
source ./activate     # PowerShell: . .\activate.ps1
scout --version
```

Activate from the repository root in each new shell. Activation provisions a fresh checkout and syncs
stale dependencies, then defines `scout` as a function for this worktree. `deactivate` restores the
previous shell. Use `scout setup` to configure the development home rather than copying production
credentials into it.

Dependencies are owned by PM: change `pyproject.toml`, run `scout pm lock`, and commit
`pyproject.toml` with `uv.lock`. Never change a PM-built environment with raw `pip` or `uv`.

### Test environment

Build an independent interpreter for tests and editor tools (the output directory must not exist yet):

```bash
python -m pm.build_env --source . --out .venv --group dev --group test
```

To keep it outside the checkout, use an absolute path and set `SCOUT_PYTHON` to its interpreter.
The test runner finds a repository `.venv` automatically and clears `PYTHONPATH`, so pytest must be
installed in that interpreter's own environment.

### JavaScript workspaces

From the repository root, `npm ci` installs the desktop, TUI, dashboard and shared workspaces. The
phone app in `mobile/` is separate (its own lockfile); see [`mobile/AGENTS.md`](mobile/AGENTS.md).

Logos and icons are generated from `assets/scout-mark.svg` and `assets/backgrounds/`:
`node scripts/generate-icons.mjs` renders them with the Scout runtime Python. Rerun it after
changing a source SVG.

## Running tests

Always use the runner, never bare `pytest`. It clears credentials, isolates `SCOUT_HOME`, pins
`TZ`/`LANG`, and runs each test file in its own subprocess:

```bash
scripts/run_tests.sh                          # everything
scripts/run_tests.sh tests/agent/ -v          # one area
scripts/run_tests.sh tests/agent/test_x.py -k name
```

For JavaScript changes run the workspace's own checks, e.g. in `apps/desktop`:
`npx tsc --noEmit -p .`, `npx eslint src`, `npx vitest run`.

## Making changes

- Fix the whole bug class, not one call site; reproduce it first and say where it manifests.
- Add one or two tests that pin the behavior (a relationship between pieces of data), not a snapshot
  of current values. A test should fail on the code before your fix.
- New capability goes at the edges (a skill, a CLI command, a plugin) before it goes into the core
  tool list; see the Footprint Ladder in `AGENTS.md`.
- Secrets live in `~/.scout/.env`; every other setting belongs in `config.yaml`.
- Keep commits focused, with messages that explain why.

## Reporting issues

Open an issue with your OS, `scout --version`, the full error and steps to reproduce. Report
security problems privately; see [`SECURITY.md`](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
