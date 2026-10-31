# Status band reference

What the panel shows, how its controls behave, and the hooks the mod
registers.

## Layouts

- **Terminal dashboard** (where it fits): five rows, six with a footer. A
  header with the folder, branch, `Model ▾`, `Effort ▾`, `[ Copy ]` and
  `[ ≡ ]` (Actions); three bordered blocks side by side, two rows each (context
  and cache, prompt and session, 5h and 7d quotas); a footer with `RC On` and
  the agents at work, only while there is one. The context and quota rows
  double as meters, filled behind their text in proportion to the percentage,
  in the color of its [level](#levels).
- **Compact rows**: in the desktop app, and in a terminal too narrow (under
  about 76 columns) or too short for the dashboard: one rounded panel. Without
  room for the border, the same rows are drawn without it.
- **Narrowing**: the path shortens first, then less important segments drop
  (reset times, `worktree`, 7d, icons, labels). `[ Copy ]` and `[ ≡ ]` never
  drop.

A choice row, menu or folder detail opens as one extra row in the band. Only
one is open at a time.

Under the `dark` and `light` themes and their daltonized variants the band
paints its own background and names every text color, so it reads the same
whatever background the terminal has (a light theme in a dark terminal shows a
light card). Under any other theme (`auto`, ANSI, custom) it paints none and
keeps the terminal's own foreground.

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

### Levels

Context, 5h and 7d share four levels, by the percentage as shown. A row's fill
and its percentage take the same level, in the terminal and in VS Code; the
detail pane colors its percentages the same way.

| Level | Context | 5h, 7d | Color |
|---|---|---|---|
| Normal | 0-49 % | 0-59 % | Green (blue in the colorblind-friendly themes) |
| Notice | 50-64 % | 60-74 % | Yellow |
| Warning | 65-79 % | 75-84 % | Orange |
| Critical | 80 % and above | 85 % and above | Red |

The terminal draws no fill under `auto`, ANSI and custom themes, whose
background it cannot vouch for; the percentages there take the theme's own
colors.

VS Code is not told the editor's theme, and its panel takes one fixed color for
a box. Its percentages still get the palette's exact color for the theme, as
they are pictures that can read the panel's text color. Each fill is one
translucent color that lands close to the palette on both Light Modern and Dark
Modern, and other editor themes shift it a little. Text beside them keeps the
panel's own color.

Notes:

- `🛢` marks the prompt cache in the terminal, `🔥` a warm one, and `≡` is the
  Actions control. Each keeps its width in the terminals checked (mintty,
  Windows Terminal, the classic console, VS Code's); how `🛢` looks depends on
  the terminal's fonts, in color or in one color.
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
`Tab` focuses the panel's controls in order (folder, Model, Effort, Copy,
Actions, agents); `Tab` or `←`/`→` move, and `Esc` returns to the prompt.

| Control | Does |
|---|---|
| Folder | Opens a row with the whole path, `Copy path` and `Close` |
| Model ▾ | Opens the model choices (current one marked `●`, then `Cancel`). A choice switches the session model and, like `/model`, saves `model` in your user settings |
| Effort ▾ | Opens the effort levels. A choice runs `/effort <level>`, which also saves the level as that model's default |
| Agents | Opens the detail pane |
| `[ Copy ]` | Terminal: runs the built-in `/copy`. Desktop app: copies the last completed response as Markdown, without progress text, thinking or tool output |
| `[ ≡ ]` (Actions; `Actions ▾` in the desktop app) | *Copy code* (one block: copies it; several: lists them), *Diff* (runs `/diff`), *Agents* (opens the pane), *Copy prompt* (your last typed prompt), *Session info* (a plain-text summary of the figures) |

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

The Claude Code extension's chat panel draws a dashboard in the editor's theme:
a header with the path, branch, `Model ▾` and `Effort ▾`, then three blocks
(context and cache, prompt and session, 5h and 7d). It has no Copy, Actions or
agent count.

The pickers work as in the terminal: a press opens the choices under the
header, the current one filled and marked `●`, then `Cancel`. The row closes on
a choice, `Cancel`, a second press or the next prompt, and pressing the other
picker swaps it. The panel tells a mod nothing about focus, so a click elsewhere
leaves it open. A locked Model row is plain text, and a model without effort has
no Effort picker.

| Picker | A choice |
|---|---|
| Model | Runs `/model <choice>`, then saves `model` in your user settings, as the extension's own selector does |
| Effort | Runs `/effort <level>`, which holds for this session and is not saved |

The extension's own selectors work beside them, and the dashboard follows them.
What the VS Code surface leaves open:

- Each choice appears in the transcript as `Prompt from the nth-status plugin:
  /model sonnet` with its answer, as if typed. A mod cannot run these commands
  silently there. They start no model request. Choosing the model already in
  force runs nothing. Choosing again the model the last `/model` named, after
  the extension's selector moved away from it, runs `/model` twice: first with
  the model in force, which the session needs to take the change.
- The extension's selector under the prompt is not told of a choice made here:
  it can keep showing the old model and effort until its next slash command or
  reconnect, and choosing the level it already shows does nothing. Requests use
  what the dashboard shows. No mod API can refresh it.

The rest of the dashboard:

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
