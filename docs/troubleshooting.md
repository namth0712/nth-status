# Troubleshooting

## The panel does not appear

1. Run `claude plugin list` in the same environment (`CLAUDE_CONFIG_DIR`
   included). It must show `nth-status@namth0712-nth-status` as enabled. If
   not, [install](../README.md#install) it in that profile, or run
   `claude plugin enable nth-status@namth0712-nth-status`.
2. Check that `enabledPlugins` does not set it to `false` in your user,
   project or local settings. (A legacy install appears as
   `nth-status@skills-dir`.)
3. Start a new session, or run `/reload-plugins`.
4. Headless `-p` and Agent SDK sessions draw no panel.

## A figure is missing or shows `—`

A figure stays hidden or shows `—` until Claude Code reports it; nth-status
never guesses.

| Figure | Why it can be missing |
|---|---|
| 5h, 7d | No reading yet in this profile, the window has reset and no session of the profile has had a response since, or no subscription login (API-key accounts report no quota) |
| Cache (terminal) | No status line capture (see below), or no cache seen yet |
| Cache (VS Code) | Estimated from requests: `—` before the first one, after a model switch, compaction, reload or `/clear`, and from under a minute left until `Cold` an hour after the last cache use |
| Cost | No session cost ledger on this surface |
| Branch | Not a Git working tree |
| Effort | The model has no effort setting |

## No cache countdown in the terminal

The exact countdown needs the silent capture status line, which a plugin
cannot set for you. It is missing when you have not added the
[optional status line](../README.md#cache-countdown-optional), when you use
your own `statusLine` instead, or when a project's `statusLine` overrides
it. The dashboard then shows the mod's own estimate (`~4m`).

- The command must name the script in the marketplace clone
  (`<config>/plugins/marketplaces/namth0712-nth-status/scripts/`) or the one
  the legacy procedure installed (`<config>/nth-dev-kit-hooks/`). A copy of
  the script anywhere else is not read.
- `sh` must be on `PATH` (Git Bash on Windows).
- A legacy install's status line was added by its Install procedure: to
  change it, use that procedure's options (`CACHE=skip`) or Disable.

## Known limits

- An empty row above the footer, and footer hints such as `esc to interrupt`
  hidden while a prompt runs: any custom status line does this, the optional
  capture included. Leave it out to avoid it.
- `Cache Cold` shows only after a real expiry: one cache TTL idle in the
  terminal, one hour (the longest TTL) after the last cache use in VS Code.
- After `Esc` returns to the prompt, or a click lands outside the panel, an
  open choice row or menu stays open until the next prompt, a choice, or a
  click in the panel.
- A Model pick saves `model` in your user settings and an Effort pick saves
  the level as the model's default, as typing `/model` or `/effort` does.
- In VS Code, the panel can refuse images for a few minutes; the figures then
  show as text and emoji.

## Procedure conflicts (legacy installs)

The legacy [procedures](installation.md) Install, Update and Disable stop
before writing when something is not provably theirs, and name it.

| Report | Meaning | Fix |
|---|---|---|
| A mod file or the script is changed | It no longer matches what Install recorded | Restore the recorded content and rerun; or move the edited file out of its folder, run Disable, then Install |
| A recorded file is missing | Deleted outside a procedure | Run Disable, then Install |
| An unrecorded file in `skills/nth-status/` | Not created by a procedure | Move it away, then rerun |
| `statusLine` is user-owned | It existed before Install, or the state was lost | Leave it (the cache countdown stays hidden) or see [above](#no-cache-countdown-in-the-terminal) |
| Invalid state file | Not JSON, unknown schema, an unexpected path or a reparse point | Nothing is changed; repair `<config>/nth-dev-kit-hooks/nth-status.state.json` by hand from the [schema](installation.md#runtime-files-and-ownership) |
| `STATUS_SOURCE` is not the pinned version (nth-dev-kit) | Your checkout differs from the release the kit pins | Check out the release the kit names and rerun the kit procedure |
| `<config>` path contains `"`, `$` or a backtick | The path is embedded in the `statusLine` command | Use a config directory without these characters |

An Install interrupted between the `statusLine` write and the state write
needs one manual step: see
[interruption](installation.md#repeat-runs-interruption-and-rollback).

## Diagnostics

All read-only:

- `claude plugin list`: the plugin is loaded in this config home.
- `claude plugin marketplace list`: the `namth0712-nth-status` marketplace is
  added.
- `<config>/nth-dev-kit-hooks/nth-status.state.json` (legacy installs only):
  what Install recorded.
  The hashes identify the installed release.
- `<config>/plugins/marketplaces/namth0712-nth-status/scripts/nth-status/statusline-<session id>.json`
  (optional status line) or
  `<config>/nth-dev-kit-hooks/nth-status/statusline-<session id>.json` (legacy): the
  latest status line capture for a session.
- `claude --debug`: hook errors.
