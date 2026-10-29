# Changelog

## Unreleased

- Native install: `.claude-plugin/marketplace.json` makes the repository the
  `namth0712-nth-status` marketplace (`/plugin marketplace add
  namth0712/nth-status`, then `/plugin install
  nth-status@namth0712-nth-status`). The plugin manager now handles install,
  update, disable and uninstall. A plugin cannot set `statusLine`, so the
  capture status line is an optional, hand-added setup (README).
- Runtime (`hooks/register.tsx`): under a marketplace install the mod finds
  `<config>` above `plugins/`, and it reads captures beside the script the
  `statusLine` names: the marketplace clone's
  `scripts/nth-status/`, or the legacy `nth-dev-kit-hooks/nth-status/`. A
  legacy status line keeps working after switching to the marketplace plugin,
  which takes precedence over a `skills-dir` copy.
- Legacy: `docs/installation.md` and `scripts/nth-status-statusline.sh` are
  unchanged, so the pinned procedure still runs as before; installations made
  with it are left as they are. 0.1.0 remains the initial public release;
  its runtime digests differ from what nth-dev-kit pins today, so the kit's
  pin needs refreshing (`sh tools/release-digests.sh`) before the kit installs
  it.

- Fix: the VS Code dashboard (and the terminal dashboard without the status
  line capture) now shows `Cache Cold` once an hour, the longest prompt cache
  TTL, has passed since the session's last cache use and its last request of
  any kind, instead of staying unknown. The tracked cache records when usage
  arrived (`CacheSeen.doneAt`) and when the latest request ended
  (`CacheTrack.lastStepAt`).
- Fix: 5h and 7d show the newest standing reading, this session's or the one
  another session of the same config home recorded, in the terminal
  dashboard, compact rows and pane as in VS Code. Idle sessions re-read it
  every 15 seconds, so their figures no longer freeze at their last response
  or show `—` after a reset another session has already seen.
- These change `hooks/register.tsx`, `hooks/status.ts` and `types/index.d.ts`,
  so the release digests change; nth-dev-kit's pin needs updating before the
  kit installs this release. `docs/installation.md` is unchanged.
- Added the MIT license.
- Documentation: a rewritten README with screenshots and a demo;
  `docs/configuration.md`, `docs/vscode-integration.md` and
  `docs/releasing.md` are folded into the README,
  [docs/status-and-hooks.md](docs/status-and-hooks.md) and
  [docs/development.md](docs/development.md).

## 0.1.0 (not yet tagged)

First release as its own repository. nth-status was previously embedded in
nth-dev-kit (`agents/claude/integrations/nth-status/`, `nth-status.md`,
`nth-status-statusline.sh` there).

- Runtime: identical to the last embedded copy except one comment each in
  `hooks/status.ts` (a path example) and `hooks/register.tsx`. Install paths,
  the state file and its schema are unchanged, so existing installations are
  adopted as they are; Update replaces those two files only. The capture script's header still
  names the old `nth-status.md` so its installed bytes stay the same.
- Procedures moved to [docs/installation.md](docs/installation.md). They read
  the release from `STATUS_SOURCE`, a local checkout of this repository,
  instead of the kit library.
- The kit's "Global Update refresh" is replaced by an explicit Update. The
  kit's Default enable installs only where nothing is installed; on an
  enabled installation it reports whether it matches the kit's pin and
  writes nothing.
- The embedded `nth-status.md` is split into the [README](README.md) and
  [docs/](docs/). Provenance rules formerly linked from the kit's
  `INSTALL.md` are stated in the installation doc.
- Test fixtures use generic paths and names.
- Added `tools/check-portability.sh` (privacy and portability check) and
  `tools/release-digests.sh` (the release identity the kit pins).
