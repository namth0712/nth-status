# Development

## Prerequisites

- Claude Code with mods support (checked with 2.1.310 to 2.1.312).
- `sh` on `PATH` for the status line script and the repository tools (Git
  Bash on Windows).
- No package manager or Node project: the tests run on Claude Code's own
  runner (`claude-code/testing`).

## Validate and test

Run the tools on a scratch copy of the plugin files, so the checkout keeps
exactly the bytes a release is identified by, and use a throwaway config
home so nothing is written to yours:

```sh
# macOS/Linux shells, Git Bash
copy="$(mktemp -d)/nth-status"
mkdir -p "$copy" && cp -R .claude-plugin hooks types tests "$copy"/
CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin validate "$copy"
CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin test "$copy"
```

```powershell
# PowerShell
$copy = Join-Path ([IO.Path]::GetTempPath()) "nth-status-$(New-Guid)"
New-Item -ItemType Directory $copy | Out-Null
Copy-Item -Recurse .claude-plugin, hooks, types, tests $copy
$env:CLAUDE_CONFIG_DIR = Join-Path ([IO.Path]::GetTempPath()) "claude-$(New-Guid)"
claude plugin validate $copy
claude plugin test $copy
```

`validate` must list only the hooks in
[the band reference](status-and-hooks.md#hooks). The suites in `tests/`
cover the layouts, every figure with full, partial and missing data, the
pickers, Copy and Actions, the detail pane and the VS Code dashboard.

## Try a change live

Load the copy into one session, with an installed copy turned off for that
process by a settings file:

```sh
# off.json: { "enabledPlugins": { "nth-status@namth0712-nth-status": false, "nth-status@skills-dir": false } }
claude --plugin-dir "$copy" --settings off.json
```

## Before a commit

```sh
sh tools/check-portability.sh
```

It reports files that contain machine-specific paths, email addresses or
your local identifiers.

## Releasing

A release is identified by `version` in `.claude-plugin/plugin.json`
(`MAJOR.MINOR.PATCH`) and by the LF-canonical sha256 of the six
[release files](installation.md#release-files). Raise MAJOR when an existing
installation cannot be updated in place (a changed install path, state
schema or procedure input), MINOR for new behavior, PATCH for fixes.

1. Move the `Unreleased` entries in [CHANGELOG.md](../CHANGELOG.md) under the
   new version, noting any change to the install contract (paths, state,
   procedure steps) or to the task-progress height contract.
2. Set `version` in `.claude-plugin/plugin.json`.
3. Run [validate and test](#validate-and-test) and
   `sh tools/check-portability.sh`; both must pass. `claude plugin validate .`
   at the repository root also checks `.claude-plugin/marketplace.json`.
4. In a throwaway config home, install from the marketplace (a local copy of
   the repository works: `claude plugin marketplace add <folder>`), then
   install the previous release with the legacy procedure and Update it, and
   check the reports.
5. Print the release identity: `sh tools/release-digests.sh`.
6. Commit, tag `v<version>` (for example `v0.1.0`), and push by hand.
   Marketplace users receive a release only through a new `version`: with the
   same version, `claude plugin update` reports it is already current.

### nth-dev-kit compatibility

nth-dev-kit installs one pinned nth-status release: the version and the
digests printed by `tools/release-digests.sh`, which cover the six release
files and `docs/installation.md`. For the kit to install a new release by
default, update its `packages/compatibility.json` with that output. Until
then the kit keeps installing its pinned version, and Update to the new
release remains each user's choice.

Beyond refreshing the pin, a release needs a kit change only when it changes
something the kit relies on: the release file list, `docs/installation.md`,
the state file location, or the task-progress height contract. Edits to
other documentation never affect the pin.
