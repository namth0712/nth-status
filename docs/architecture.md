# Architecture

nth-status is a Claude Code mod packaged as a plugin (a hooks module that
draws the band and the pane), plus one silent status line script. It only
observes: it never denies or rewrites a tool call, prompt, spawn or model
request, adds no tool or prompt text, and makes no model call. The pickers
change the session only through Claude Code's own `/config` Model row and
`/effort` command, and in VS Code its `/model` command as well.

## Source layout

| Path | Role |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest: name, version, the `types` entry |
| `.claude-plugin/marketplace.json` | Makes the repository the `namth0712-nth-status` marketplace, listing this plugin (`source: "./"`) |
| `hooks/hooks.json` | Names the hooks module (`./register.tsx`) |
| `hooks/register.tsx` | Hook registration, data refresh, drawing of the band and the `/nth-status` pane |
| `hooks/status.ts` | Pure figures and layout: formatting, width fitting, cache and quota logic |
| `types/index.d.ts` | Shared types |
| `scripts/nth-status-statusline.sh` | Capture-only status line command |
| `tests/` | `claude plugin test` suites (not installed) |
| `tools/` | Development scripts (not installed) |

The repository root is the plugin root, so `claude plugin validate`,
`claude plugin test` and `claude --plugin-dir` take a copy of it directly.

Where it is installed, and how the mod finds `<config>` there when
`CLAUDE_CONFIG_DIR` is unset:

| Install | Plugin root | Loaded as | `<config>` is |
|---|---|---|---|
| Marketplace | `<config>/plugins/cache/namth0712-nth-status/nth-status/<version>/` (a copy of the repository) | `nth-status@namth0712-nth-status` | the folder above `plugins/` |
| Legacy procedure, nth-dev-kit | `<config>/skills/nth-status/` (the six [release files](installation.md#release-files)) | `nth-status@skills-dir` | the folder above `skills/` |

Both layouts are part of the install contract. Where both exist, the
marketplace plugin loads and the `skills-dir` copy is shown as not loaded.

## Data sources

| Figure | Source |
|---|---|
| Folder, branch, worktree | `$.session.cwd()`, `git rev-parse` through `$.process.run` |
| Model, effort | `$.session.model()`, the `/config` Model row, main-loop `turn.step`, the effort settings |
| Context, 5h and 7d quota | `$.session.usage()` and `session.measure` |
| Prompt and session time and cost | `turn.start`/`turn.complete`, the session cost ledger, `$.session.usage().startedAt` |
| Agents at work | `$.agent.list()` and observed `agent.spawn` results |
| Remote Control | `session.attach` (`$.session.surfaces()`) |
| Prompt cache (terminal) | The status line capture file (below) |
| Prompt cache (VS Code, or no capture) | Estimated by the mod from main-thread `turn.step` usage |

## Why a status line

No mod API carries the prompt cache expiry, and a plugin cannot set the
user's `statusLine`; the status line input carries it
(`prompt_cache.expires_at`, Claude Code 2.1.251+). The capture script prints
nothing and writes its input beside itself, to
`nth-status/statusline-<session id>.json` (captures idle for two days are
pruned). The mod reads only the file whose `session_id` matches, and only
while the `statusLine` command names the capture script, from the folder of
the script the command names:

| `statusLine` names | Captures read from |
|---|---|
| The marketplace clone's script, `<config>/plugins/marketplaces/namth0712-nth-status/scripts/` (the README's optional setup) | `<config>/plugins/marketplaces/namth0712-nth-status/scripts/nth-status/` |
| Any other command naming the script (the legacy procedure's `<config>/nth-dev-kit-hooks/`) | `<config>/nth-dev-kit-hooks/nth-status/` |

The command runs through `sh` (Git Bash on Windows). Like any custom status
line, it leaves an empty row above the footer and hides footer hints such as
`esc to interrupt` while a prompt runs, and a project or local `statusLine`
overrides it.

## Stored data

`<config>/plugins/store/nth-status_<source>.json` is the mod's `$.store`,
written by Claude Code:

- `prompts:<sessionId>`: `{ v: 1, n, isExact }`, the person's prompt count
  per session, at most 200 records, least recently used dropped;
- `quota`: `{ v: 1, five?, seven?: { pct, resetsAt, observedAt } }`, the last
  live 5h and 7d readings any session of this config home saw. A session
  shows it while it stands and is newer than its own reading: only one
  window of a kind stands at a time and its use only grows, so the higher
  reading is the newer.

The store is per config home and per install (`<source>` differs between
the marketplace and `skills-dir`), so a switch starts it fresh. It is owned
by Claude Code: no procedure records it, and Disable leaves it.

## Compatibility contracts

- **Install paths and state.** The `nth-dev-kit-hooks/` runtime folder, the
  state file and its schema are kept unchanged so existing installations
  keep working. See [installation](installation.md).
- **Marketplace.** The marketplace name `namth0712-nth-status` and the clone
  path of `scripts/nth-status-statusline.sh` are what the README's optional
  `statusLine` names and the mod recognizes; renaming either breaks that
  setup.
- **nth-dev-kit pin.** nth-dev-kit pins one nth-status release by the digests
  of the six release files and of `docs/installation.md`
  (`sh tools/release-digests.sh` prints them). Changing any of these files
  needs a matching update of the kit's pin before the kit installs that
  release; see [development](development.md#releasing).
- **Task-progress band.** nth-dev-kit's optional task-progress mod draws
  above this band, which cannot measure it. nth-status assumes its height
  contract: 4 rows (its own panel) where the band's `maxRows` is 10 or more,
  else 1. A change on either side needs the other.
