# Changelog

## Unreleased

- Terminal: the band is readable under the light themes whatever background the
  terminal has. Text on the band's fill names the theme's text color instead of
  taking the terminal's default foreground, which was near-white on the light
  fill in a dark terminal (and the reverse for a dark theme in a light one). The
  light palette is clearer.
- Terminal: the dashboard's three blocks each have their own border, with a
  one-cell gap between them and an even margin, in place of one frame around
  everything. `[ Copy ]` and Actions move to the header beside Model and Effort,
  and the footer shows only while it holds `RC On` or agents, so the height is
  five or six rows and the task-progress height contract is unchanged. The
  compact rows now take over under about 76 columns instead of 70.
- Terminal: the Actions control is now `[ ≡ ]`, the cache icon `DB` and the warm
  icon `🔥`, in place of `[ Actions ▾ ]`, `⛁` and `♨`, which many terminal fonts
  draw badly.
- Terminal and VS Code: four levels for context, 5h and 7d, on both the progress
  fill and the percentage. Context: Notice at 50 %, Warning at 65 %, Critical at
  80 %. 5h and 7d: 60 %, 75 %, 85 %. VS Code loses its own 70/90 % scale, and the
  fills are no longer gray.
- VS Code: Model and Effort can be changed from the dashboard, with the
  terminal's picker interaction. A Model pick runs `/model` and saves `model`
  in user settings; an Effort pick runs `/effort` and holds for the session.
  The extension's own selector is not told of these and can show the old value.

## 0.1.0

Initial public release, and the first release as its own repository.
nth-status was previously embedded in nth-dev-kit
(`agents/claude/integrations/nth-status/`, `nth-status.md`,
`nth-status-statusline.sh` there).

- Native install: `.claude-plugin/marketplace.json` makes the repository the
  `namth0712-nth-status` marketplace (`/plugin marketplace add
  namth0712/nth-status`, then `/plugin install
  nth-status@namth0712-nth-status`). The plugin manager handles install,
  update, disable and uninstall. A plugin cannot set `statusLine`, so the
  capture status line is an optional, hand-added setup (README).
- Under a marketplace install the mod finds `<config>` above `plugins/`, and
  it reads captures beside the script the `statusLine` names: the marketplace
  clone's `scripts/nth-status/`, or the legacy `nth-dev-kit-hooks/nth-status/`.
  A legacy status line keeps working after switching to the marketplace
  plugin, which takes precedence over a `skills-dir` copy.
- Fix: the VS Code dashboard (and the terminal dashboard without the status
  line capture) shows `Cache Cold` once an hour, the longest prompt cache
  TTL, has passed since the session's last cache use and its last request of
  any kind, instead of staying unknown. The tracked cache records when usage
  arrived (`CacheSeen.doneAt`) and when the latest request ended
  (`CacheTrack.lastStepAt`).
- Fix: 5h and 7d show the newest standing reading, this session's or the one
  another session of the same config home recorded, in the terminal
  dashboard, compact rows and pane as in VS Code. Idle sessions re-read it
  every 15 seconds, so their figures no longer freeze at their last response
  or show `—` after a reset another session has already seen.
- Compared with the last embedded copy, `.claude-plugin/plugin.json`,
  `hooks/register.tsx`, `hooks/status.ts` and `types/index.d.ts` differ;
  `hooks/hooks.json` and `scripts/nth-status-statusline.sh` are unchanged.
  Install paths, the state file and its schema are unchanged, so existing
  installations are adopted as they are, and Update replaces the four
  changed files. The capture script's header still names the old
  `nth-status.md` so its installed bytes stay the same.
- Legacy procedures (`nth-status@skills-dir`) are in
  [docs/installation.md](docs/installation.md). They read the release from
  `STATUS_SOURCE`, a local checkout of this repository, instead of the kit
  library. nth-dev-kit pins this release by the digests that
  `sh tools/release-digests.sh` prints.
- The kit's "Global Update refresh" is replaced by an explicit Update. The
  kit's Default enable installs only where nothing is installed; on an
  enabled installation it reports whether it matches the kit's pin and
  writes nothing.
- Documentation: a README with screenshots and a demo, and
  [docs/](docs/) for the status band reference, installation, architecture,
  troubleshooting and development. Provenance rules formerly linked from the
  kit's `INSTALL.md` are stated in the installation doc.
- MIT license.
- Test fixtures use generic paths and names.
- Added `tools/check-portability.sh` (privacy and portability check) and
  `tools/release-digests.sh` (the release identity the kit pins).
