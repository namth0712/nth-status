# Status band reference

What the panel shows, how its controls behave, and the hooks the mod
registers.

## Layouts

- **Terminal dashboard** (where it fits): one rounded panel of four rows. A
  header with the folder, branch, `Model ▾` and `Effort ▾`; two rows of three
  zones (context and cache, prompt and session, 5h and 7d quotas); a footer
  with `RC On`, the agents at work, `[ Copy ]` and `[ Actions ▾ ]`. The
  context and quota rows double as meters, with a gray fill proportional to
  the percentage.
- **Compact rows**: in the desktop app, and in a terminal too narrow (under
  about 65 columns) or too short for the dashboard. Without room for the
  border, the same rows are drawn without it.
- **Narrowing**: the path shortens first, then less important segments drop
  (reset times, `worktree`, 7d, icons, labels). `[ Copy ]` and
  `[ Actions ▾ ]` never drop.

A choice row, menu or folder detail opens as one extra row inside the panel.
Only one is open at a time.

## Figures

| Figure | Shows | Hidden or `—` when |
|---|---|---|
| Folder | Working directory, shortened from the left (`…\projects\app`) | Never |
| Branch | Current branch, `worktree` in a linked worktree, `detached <sha>` | Not a Git working tree |
| `RC On` | A Remote Control client is attached to this session | No client attached |
| Model, Effort | The session's model and effort level | Effort hidden for models without effort |
| Context | Percentage used and tokens (`97k/1M`) | Until reported |
| 5h, 7d | Quota used, time to reset and reset time: the newest reading of this session or of another session of the same profile | No reading in this profile yet, past its reset, or no subscription login |
| Cache | Time until the prompt cache expires; `Warm`, `Expiring` in the last minute, `Cold` only once confirmed | No status line capture, or no cache seen yet |
| Compactions | `↻ N` compactions in this conversation (`≥N` when earlier ones are unknown) | Until known |
| Prompt / Last | `Prompt` and its live duration while the main turn runs; then `Last` with its duration and cost (`Last ✕` if interrupted) | Before the first prompt |
| Session | Prompt count, session duration and total cost | Cost hidden where Claude Code keeps no cost ledger |
| Agents | Agents at work (pending, running or waiting) | No agent at work |

Notes:

- Colors mark severity on the percentage only: context under 50 % green,
  under 80 % yellow, else red; 5h and 7d under 60 % green, under 85 % yellow,
  else red.
- `~$` is the API-equivalent estimate from Claude Code's cost ledger
  (`/cost`), not your bill. A prompt's cost includes subagent spend during
  that prompt.
- `Prompt`/`Last` follow the main turn only. A background agent can keep
  working after the turn ends; the band then reads `Last`, and the agent
  count stays up.
- The terminal cache countdown comes from the silent status line capture.
  Without it the dashboard shows the mod's own estimate (`~4m`, `Cold` an
  hour after the last cache use, as in [VS Code](#vs-code)) or nothing. The
  countdown is read from a file and never refreshes the cache.
- Claude Code reports 5h and 7d only with a session's own responses, so an
  idle session's figures would stand still. nth-status records each reading
  per profile and shows whichever is newer, re-reading every 15 seconds while
  idle. Profiles never share readings.

## Controls

Every control is a button: a click or `Enter` presses it. `Ctrl+X` then
`Tab` focuses the panel's controls in order (folder, Model, Effort, agents,
Copy, Actions); `Tab` or `←`/`→` move, and `Esc` returns to the prompt.

| Control | Does |
|---|---|
| Folder | Opens a row with the whole path, `Copy path` and `Close` |
| Model ▾ | Opens the model choices (current one marked `●`, then `Cancel`). A choice switches the session model and, like `/model`, saves `model` in your user settings |
| Effort ▾ | Opens the effort levels. A choice runs `/effort <level>`, which also saves the level as that model's default |
| Agents | Opens the detail pane |
| `[ Copy ]` | Terminal: runs the built-in `/copy`. Desktop app: copies the last completed response as Markdown, without progress text, thinking or tool output |
| `[ Actions ▾ ]` | *Copy code* (one block: copies it; several: lists them), *Diff* (runs `/diff`), *Agents* (opens the pane), *Copy prompt* (your last typed prompt), *Session info* (a plain-text summary of the figures) |

A row closes on a choice, `Cancel`/`Close`, a second press of its control,
moving focus away, a click elsewhere in the panel, or the next prompt.
Claude Code does not tell a mod when `Esc` returns to the prompt or a click
lands outside the panel, so those leave the row open.

Copies go through Claude Code's clipboard path and end in a toast, such as
`Copied path` or `No code block in the last response`. None of the controls
makes a model call.

## Detail pane

`/nth-status` (or the agents count, or Actions → Agents) opens the
`nth-status` pane beside the transcript: session and prompt durations and
costs, model and effort, context, both quotas with local reset times and
countdowns, cache state, Remote Control, and each working agent's name,
model, state and elapsed time. `Esc` closes it.

## VS Code

The Claude Code extension's chat panel draws a read-only dashboard in the
editor's theme: a header with the path, branch, model and effort, then three
blocks (context and cache, prompt and session, 5h and 7d). It has no pickers,
buttons or agent count. Change the model and effort with the extension's own
selectors; the dashboard follows them.

- The cache is estimated from the session's requests (`~4m` with the
  five-minute TTL, up to about an hour with `promptCacheTtl: "1h"`). It reads
  `Cold` once an hour, the longest TTL, has passed since the session's last
  request (a subagent's included), and turns warm again with the next one
  that uses the cache. It shows `—`
  before the first request, after a model switch, compaction, reload or
  `/clear`, and between the estimate running out and that hour.
- A 5h or 7d reading recorded by another session of the same profile shows
  faded and marked `cached <age>` when this session has no newer one (before
  its first response, or while it is idle).
- If the panel refuses images for a while, the figures show as text and emoji
  instead.

## Hooks

`claude plugin validate` lists the hooks `session.start/end/measure/attach/detach`,
`session.compact` (observed: it counts compactions and drops the tracked
cache), `turn.start/step/complete` (`turn.step` observed: the effort and each
request's usage), `prompt.submit` (observed only), `agent.spawn`,
`tool.call` (`EnterWorktree`, `ExitWorktree`), `command.run` (`nth-status`;
`model` and `effort`, observed only), `ui.focus` (the band, observed: it
closes an open row) and `ui.render` (`AbovePrompt`, the `nth-status` pane).
