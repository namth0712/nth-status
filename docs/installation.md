# Installation and lifecycle

nth-status is installed by agent-executed procedures: you ask Claude Code to
follow one of the sections below, and it inspects, decides, and writes each
step itself. There is no installer program, and no procedure commits or
otherwise changes Git state.

| Procedure | Run by | Does |
|---|---|---|
| [Install](#install) | You, or nth-dev-kit's [Default enable](#default-enable-kit-managed) | Copies the mod and the capture script into one config home and records what it wrote |
| [Update](#update) | You | Moves an installed copy to the version in `STATUS_SOURCE` (newer or older) |
| [Disable](#disable) | You | Removes what Install recorded and leaves an opt-out |
| [Default enable](#default-enable-kit-managed) | nth-dev-kit Global Install/Update | Installs the kit's pinned version where nothing is installed; otherwise only reports |

## Inputs

- `STATUS_SOURCE`: a trusted local checkout of this repository at the version
  to install (a release tag or a reviewed commit). Procedures read files from
  it and never fetch, clone, pull, check out, or otherwise change it.
- `CACHE=skip` (Install only, optional): install without the capture script
  and `statusLine`. The cache item then stays hidden in the terminal.
- `<config>` is not an input: it is the active Claude Code config home,
  `CLAUDE_CONFIG_DIR` when set, otherwise the runtime's default (`~/.claude`).
  See [Profile isolation](#profile-isolation).

Ask for a procedure in a Claude Code session started in the config home you
want to change, for example:

    Follow "Install" in <STATUS_SOURCE>/docs/installation.md with STATUS_SOURCE = <STATUS_SOURCE>.

## States

| State | What exists in `<config>` | Who changes it |
|---|---|---|
| Not installed | No `nth-dev-kit-hooks/nth-status.state.json` | Install (directly, or through the kit's Default enable) |
| Enabled | State file with `"enabled": true`, plus the mod copy, capture script and `statusLine` entry it records | Install, Update, Disable |
| Opted out | State file `{ "schemaVersion": 1, "enabled": false }` | Disable writes it; only an explicit Install leaves it |

## Release files

A release is identified by its version (`version` in
`.claude-plugin/plugin.json`) and by the lowercase SHA-256 of the
LF-canonical content (CRLF, then any lone CR, converted to LF) of these six
files. Nothing else in the repository is installed.

| In `STATUS_SOURCE` | Installed as |
|---|---|
| `.claude-plugin/plugin.json` | `<config>/skills/nth-status/.claude-plugin/plugin.json` |
| `hooks/hooks.json` | `<config>/skills/nth-status/hooks/hooks.json` |
| `hooks/register.tsx` | `<config>/skills/nth-status/hooks/register.tsx` |
| `hooks/status.ts` | `<config>/skills/nth-status/hooks/status.ts` |
| `types/index.d.ts` | `<config>/skills/nth-status/types/index.d.ts` |
| `scripts/nth-status-statusline.sh` | `<config>/nth-dev-kit-hooks/nth-status-statusline.sh` |

The installed paths, the `nth-dev-kit-hooks/` folder name and the state file
are the same as when nth-status shipped inside nth-dev-kit, so existing
installations keep working (see [Adopting an existing installation](#adopting-an-existing-installation)).

## Runtime files and ownership

| Item | Owner proof |
|---|---|
| `<config>/skills/nth-status/`: the five mod files above (LF bytes) | sha256 of each, recorded |
| `<config>/nth-dev-kit-hooks/nth-status-statusline.sh`: capture script (LF bytes) | sha256, recorded |
| `statusLine` in `<config>/settings.json`, added only when that key was absent | exact object, recorded |
| `<config>/nth-dev-kit-hooks/nth-status.state.json`: provenance | — |
| `<config>/nth-dev-kit-hooks/nth-status/statusline-<session id>.json`: captures the script writes | engine-produced runtime data; Disable deletes them |
| `<config>/plugins/store/nth-status_<source>.json`: the mod's `$.store`, written by the engine (see [architecture](architecture.md#stored-data)) | engine-owned, not recorded; Disable leaves it |

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "mod": { "path": "skills/nth-status", "files": { "<relative path>": "<sha256>" } },
  "capture": {
    "mode": "on",
    "script": { "path": "nth-dev-kit-hooks/nth-status-statusline.sh", "sha256": "<sha256>" },
    "statusLine": { "type": "command", "command": "sh \"<config>/nth-dev-kit-hooks/nth-status-statusline.sh\"" }
  }
}
```

`capture.mode` is `"on"` or `"skip"`; with `"skip"`, or while a user-owned
`statusLine` exists, `script` and `statusLine` are `null`. The recorded
`mod.files` and `capture.script` hashes are also the installed release's
identity: they equal the [release file](#release-files) digests of the
version last installed.

Claude Code auto-loads the folder as `nth-status@skills-dir` (honoring
`CLAUDE_CONFIG_DIR`); no marketplace, `enabledPlugins` or other settings
change is needed. A user's `enabledPlugins["nth-status@skills-dir"]: false`
is user configuration and is never changed.

Provenance rules, applied by every procedure:

- Record only what a procedure itself wrote. An entry that existed before it
  (a `statusLine` you set, a file already present) is left alone and not
  recorded.
- An item is owned only while present with exactly its recorded hash or
  value. Update or remove it only then, and update the record afterwards.
- Recorded but changed: preserve it and report a conflict. Present but not
  recorded: you own it, so it is preserved.
- Equal content, a matching name or a path never proves who created an entry.
- A state file that is not valid JSON or has an unknown `schemaVersion` is
  never overwritten: report a conflict and skip everything that depends on it.
- Write the state file only when a record changes. It holds no credentials,
  secrets or session data.

Install, Update and Disable never touch other skills, plugins, hooks or
settings, nth-dev-kit's other integrations (session-title, task-progress,
CodeGraph), or the kit library under `<config>/nth-dev-kit/`.

## Install

Run directly, or by the kit's [Default enable](#default-enable-kit-managed).
An explicit Install also leaves the opted-out state. Inputs: `STATUS_SOURCE`,
optional `CACHE=skip` (on an enabled state it removes the recorded script and
`statusLine` as in Disable step 3 and records `"skip"`).

1. Resolve `<config>` (`CLAUDE_CONFIG_DIR` when set, otherwise the runtime
   default) and state which directory, and why, before changing anything.
   Reject a `<config>` path containing `"`, `$` or a backtick (it is embedded
   in the `statusLine` command).
2. Confirm on the running version, probing uncertain points only in a
   throwaway `CLAUDE_CONFIG_DIR`: `claude plugin validate` on a scratch copy
   lists only the hooks in [Hooks](status-and-hooks.md#hooks), one command
   (`nth-status`) and env reads of `CLAUDE_CONFIG_DIR` only; `claude plugin
   list` shows `nth-status@skills-dir` loaded. If unsupported, stop and
   report; do not switch to another loading mechanism.
3. Read the six [release files](#release-files) from `STATUS_SOURCE`. All must
   exist, and `plugin.json`'s `name` must be `nth-status`; otherwise stop.
   Compute each file's LF-canonical sha256 and report them with the version.
   When the kit runs this procedure it has already checked them against its
   pin.
4. Validate the state file if present: invalid JSON, an unknown
   `schemaVersion`, a mod path other than exactly `skills/nth-status`, a
   recorded file outside the five mod paths, a script path other than
   exactly `nth-dev-kit-hooks/nth-status-statusline.sh`, a
   symlink/junction/reparse point on any path, or a target outside `<config>`
   is a conflict: stop.
5. Preflight before writing anything: each mod file and the script is
   missing → write; canonically equal to the source copy → keep; equal to its
   recorded sha256 → replace; anything else → conflict. Any other file in
   `skills/nth-status/` is a conflict (an existing folder this procedure does
   not own is reported and left alone). Parse `settings.json`; invalid JSON is
   a conflict. On any conflict stop and write nothing.
6. Write the planned mod files as LF bytes, `.claude-plugin/plugin.json`
   last.
7. Unless `CACHE=skip`, check `statusLine` first. Absent: write the script,
   then add
   `{ "type": "command", "command": "sh \"<config>/nth-dev-kit-hooks/nth-status-statusline.sh\"" }`
   (the resolved, forward-slash `<config>`) and record both. Exactly the
   recorded object: keep it and refresh the script as in step 5. Anything
   else is user-owned: leave it, do not write the script (delete a recorded
   one whose hash matches), record `statusLine: null` and `script: null`, and
   report that the cache item stays hidden. Never modify other entries.
8. Write the state file (`enabled: true`, hashes, capture record) only if its
   content changes.
9. Verify before running any `claude` command in `<config>`: settings differ
   from the original only in an added `statusLine`, and each file matches its
   record; piping a sample status line input to the installed script prints
   nothing and writes its capture file (delete that sample afterwards). Then
   `claude plugin list` shows the plugin loaded. Report the installed version,
   that it applies to new sessions, and the empty status row and hidden footer
   hints when a `statusLine` was added.

Rerunning Install is safe and changes nothing when everything is current.

## Update

Moves an enabled installation to the version checked out in `STATUS_SOURCE`:
a newer one to upgrade, an older one to roll back. It touches only
nth-status's own items, never the kit library or another integration, so a
status update needs no kit release.

1. Resolve `<config>` as Install step 1. No state file: stop and report that
   Install installs nth-status. `enabled: false`: stop without reading or
   writing anything else (Install leaves the opt-out).
2. Validate the state file as in Install step 4. On conflict change nothing
   active and report it.
3. Read and digest the release files as Install step 3. If `STATUS_SOURCE` no
   longer ships the mod, leave everything and report that Disable can remove
   it.
4. Preflight the five mod files and, when recorded, the script:
   canonically equal → no write (correct a stale recorded hash); exactly the
   recorded hash → replace with the source's LF bytes; missing → conflict,
   not recreated; anything else → customized, conflict. A mod file new in the
   source is written only if its path is absent; a recorded file the source
   dropped is deleted only if its hash matches. On any conflict write nothing
   and report it.
5. Capture, after the files: a recorded `statusLine` still exactly present →
   keep. Recorded but missing or changed → you removed or replaced it: drop
   the record, delete the script if its hash matches, set `mode: "skip"`,
   never re-add. `mode: "on"` with no recorded `statusLine` and no
   `statusLine` key now → add it and the script as Install step 7.
6. Write order: mod files, `.claude-plugin/plugin.json` last, script,
   settings, then the state file only if a record changed. On an I/O failure
   stop and report exactly what was written; a rerun revalidates.
7. Verify as Install step 9 and report the version before and after, then the
   replaced, unchanged and conflicting items.

A second run with the same `STATUS_SOURCE` writes nothing.

## Disable

Disable is the opt-out: afterwards nth-dev-kit's Global Install/Update leave
nth-status off. It needs no `STATUS_SOURCE`.

1. Validate the state file as in Install step 4. No state file: report any
   `skills/nth-status/` folder as user-owned, then write the opted-out state.
2. Delete each recorded mod file and the script whose sha256 matches; a
   missing one is resolved; a changed one stays and is reported as a
   conflict. Leave unrecorded files, report them, then remove the mod's
   directories only if empty.
3. Remove `statusLine` only if it exactly equals the recorded object (a
   changed one is user-owned: leave it). Write `settings.json` only if
   something was removed. Delete `nth-dev-kit-hooks/nth-status/statusline-*.json`
   captures and that folder if empty.
4. Write `{ "schemaVersion": 1, "enabled": false }` when no file conflict
   remains; otherwise keep only the conflicting file records with
   `"enabled": false`, so a rerun reports the same conflict.

## Default enable (kit-managed)

nth-dev-kit makes nth-status part of its Claude setup. Its Global Install and
Global Update run this section only after their own library is verified, and
only after checking `STATUS_SOURCE` against the kit's pin
(`packages/compatibility.json` in the kit: the version and the digests of the
six release files and of this document). A mismatch stops the status step
before it reads anything here. By the state file:

- absent: [Install](#install) with no options;
- `"enabled": true`: validate the state as in Install step 4 and check that
  every recorded file still equals its record (otherwise report the
  conflict). Then compare each recorded `mod.files` hash with the pin's entry
  for the same path, and a recorded `capture.script.sha256` with the pin's
  `scripts/nth-status-statusline.sh` (an unrecorded script is no difference),
  and report "matches the pinned version", or "differs" naming the files,
  with "run Update with `STATUS_SOURCE` at the pinned version". Nothing is
  written: a kit update never changes an installed nth-status. The kit's
  Global Update applies these same checks from its own prompt, without
  `STATUS_SOURCE`;
- `"enabled": false` (opted out): nothing is read or written.

An invalid state is a conflict: it is reported and changes nothing active;
the kit's library result is unaffected. The kit's Project Start bootstrap
does not run it (it reports that the next Global Install/Update enables
nth-status).

## Adopting an existing installation

An installation made by nth-dev-kit before nth-status became its own
repository uses the same paths, state file and schema, so there is no
migration step: its recorded hashes prove what it owns.

- Kit-managed: the kit's next Global Install/Update reports whether it
  matches the pin. Release 0.1.0 differs from the last embedded copy only in
  `hooks/status.ts` and `hooks/register.tsx` (a comment each; see
  [CHANGELOG](../CHANGELOG.md)), so the report names those files.
- To move it to a release, run [Update](#update) with `STATUS_SOURCE` at that
  release. It replaces only files still equal to their records.
- A file you edited is a conflict: Update writes nothing and names it.
  Restore the file to its recorded content and rerun Update; or move the
  edited file out of its folder, run Disable (it removes the rest and records
  the opt-out), then Install.
- A `skills/nth-status/` folder with no state file is yours: Install reports
  it and writes nothing.

## Repeat runs, interruption and rollback

- Repeat: Install and Update with the same source write nothing; Disable on
  the opted-out state writes nothing.
- Interrupted run: files are written in a fixed order (mod files,
  `plugin.json` last, script, settings, state), and every rerun revalidates
  what is actually present, so rerun the same procedure.
- One interruption needs a manual step: Install stopped after adding
  `statusLine` and before writing the state file. The rerun cannot prove it
  added that entry, so it reports the `statusLine` as user-owned and records
  no capture (the cache item still works, but Disable will not remove it).
  If the reported `statusLine` is exactly the command in Install step 7 for
  this `<config>`, remove that key from `<config>/settings.json`, delete
  `<config>/nth-dev-kit-hooks/nth-status-statusline.sh`, and rerun Install.
- Roll back to an earlier release: [Update](#update) with `STATUS_SOURCE` at
  that release. Remove nth-status entirely: [Disable](#disable).
- nth-dev-kit releases from before the split refresh nth-status from their
  own embedded copy, once their library update succeeds. That refresh
  replaces only files still equal to their records, under the same rules.

## Profile isolation

Every procedure resolves exactly one `<config>` and writes only inside it:
`skills/nth-status/`, `nth-dev-kit-hooks/nth-status*`, and the `statusLine`
key of its `settings.json`. It never reads or writes another config home,
never reads credentials, sessions or logs, and never copies authentication
material. The mod's store and captures are per config home too.

To install into another config home, start Claude Code with that home and run
the procedure there:

| Shell | Start Claude Code with another config home |
|---|---|
| macOS/Linux shells, Git Bash | `CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude` |
| PowerShell | `$env:CLAUDE_CONFIG_DIR = "$HOME\.claude-work"; claude` |

Check the result in that home with `claude plugin list` (it lists
`nth-status@skills-dir`) and, in a new session, the band above the prompt.
