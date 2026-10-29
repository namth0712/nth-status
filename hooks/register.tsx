import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderChildren, RenderNode } from 'claude-code'

import type { CacheSeen, PromptRecord, QuotaRecord, Status } from '../types'
import {
  EFFORTS,
  FIGURE_HEIGHT,
  ICON_SIZE,
  SEVERITY,
  SVG_ICONS,
  agentLines,
  aliasLabel,
  board,
  CLI_ROWS,
  cliLayout,
  codeBlocks,
  emptyStatus,
  figureSvg,
  fromUsage,
  layout,
  paneLines,
  parseCapture,
  panelFill,
  pruneSpawns,
  lastResponse,
  mergeQuota,
  noteCacheStep,
  parseCacheTtl,
  paintRow,
  parsePromptRecord,
  parseQuotaRecord,
  runningAgents,
  sessionInfo,
  shortModel,
  shortPath,
  upgrade,
  vscodeColor,
  ZONE_GAP,
  zoneColors,
} from './status'
import type { BoardQuota, CodeBlock, Row, Seg } from './status'

// Observe-only: it never denies or rewrites an event, calls a model, or adds a tool or prompt text.
// The two pickers change the session through the engine's own paths: the `/config` Model row and
// the built-in `/effort` command, exactly as the person would. Copy and Actions write only the
// clipboard, open this mod's panes, or run the built-in `/copy` (the terminal's Copy) or `/diff`.
// VS Code draws a read-only dashboard instead: no picker, Copy or Actions; the extension's own
// selectors own the model and effort there.

const status = atom({ plugin: 'nth-status', key: 'status' } as const, null)
const PANE = 'nth-status'
const COMMAND = 'nth-status'
const CAPTURE_SCRIPT = 'nth-status-statusline'
/** The marketplace this plugin is published in: its clone holds the script a status line can name. */
const MARKETPLACE = 'namth0712-nth-status'
const TICK_MS = 1000
/** Idle redraws for the minute-level countdowns, in ticks. */
const IDLE_TICKS = 15
const GIT_TIMEOUT_MS = 3000
/** Border and padding take two columns each side. */
const PANEL_COLUMNS = 4
const PANEL_MIN_COLUMNS = 36
/**
 * Rows left for task-progress's band, which this hook cannot measure (a panel cut short would lose
 * its bottom border). Its terminal contract: its own 4-row panel only where 6 rows stay for this
 * panel too, else one row. So the reserve follows the height, not a fixed count.
 */
const TASK_PANEL_ROWS = 4
const STATUS_PANEL_ROWS = 6
const taskBandRows = (maxRows: number) => (maxRows >= TASK_PANEL_ROWS + STATUS_PANEL_ROWS ? TASK_PANEL_ROWS : 1)

function parent(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '')
}

const sameDir = (a: string, b: string) =>
  a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** This session's status as held, without creating one. */
async function shown($: EngineInterface): Promise<Status | null> {
  const held = upgrade(await read($, status))
  return held?.sessionId === (await $.session.id()) ? held : null
}

async function change($: EngineInterface, apply: (s: Status) => Status): Promise<void> {
  const sessionId = await $.session.id()
  await update($, status, held => {
    const current = upgrade(held)
    return apply(current?.sessionId === sessionId ? current : emptyStatus(sessionId))
  })
}

/** What a request's usage reports about the prompt cache. */
type TCacheUsage = { cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** A main-thread request as it went out: when, in which session, under which session model. */
type TSent = { at: number; sessionId: string; sessionModel: string }

/**
 * Tracks the prompt cache from a main-thread request's reported usage, for VS Code where no capture
 * arrives: kept under the session model it ran in, timed from `at`, taken just before it went out
 * (the cache was read or written as it began, however long its answer took). A request with no
 * usage, or a subagent's, says nothing of the main cache's time left. A write for a session that
 * has ended (`/clear`) is dropped. Nothing is sent; only `promptCacheTtl` is read.
 */
async function noteCacheUse($: EngineInterface, step: { model: string }, usage: TCacheUsage, sent: TSent): Promise<void> {
  const ttl = parseCacheTtl(await $.settings.read({ key: 'promptCacheTtl' }).catch(() => null))
  const isUncached = usage.cache_read_input_tokens + usage.cache_creation_input_tokens === 0
  const doneAt = await $.clock.now()
  const entry: CacheSeen = { at: sent.at, doneAt, stepModel: step.model, ttl, ...(isUncached ? { isUncached: true } : {}) }
  if ((await $.session.id()) !== sent.sessionId) return
  await change($, s => ({ ...s, cacheTrack: noteCacheStep(s.cacheTrack, sent.sessionModel, entry, sent.at) }))
}

/**
 * Any request of the session ended (a subagent's sharing the prefix, one with no usage): it may
 * have renewed the main cache, so the track holds off `Cold` for an hour from now.
 */
async function noteStepEnd($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await change($, s => ({ ...s, cacheTrack: { seen: s.cacheTrack?.seen ?? {}, ...s.cacheTrack, lastStepAt: now } }))
}

/** Runs a refresh whose failure only leaves the last figures standing. */
async function quietly(work: Promise<unknown>): Promise<void> {
  try {
    await work
  } catch {
    // Unavailable data stays hidden; the band never shows a guess.
  }
}

/**
 * `<config>`: CLAUDE_CONFIG_DIR, else the folder this mod is installed under: above `skills/`, or
 * above `plugins/` for a marketplace install (`<config>/plugins/cache/<marketplace>/<plugin>/<version>`).
 */
async function configDir($: EngineInterface): Promise<string | null> {
  const folder = parent($.plugin.root)
  const cache = parent(parent(folder))
  const installedIn =
    basename(folder) === 'skills'
      ? parent(folder)
      : basename(cache) === 'cache' && basename(parent(cache)) === 'plugins'
        ? parent(parent(cache))
        : null
  return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? installedIn
}

async function refreshProject($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  let branch: Status['branch'] = null
  try {
    const git = await $.process.run(
      ['git', 'rev-parse', '--path-format=absolute', '--abbrev-ref', 'HEAD', '--git-dir', '--git-common-dir'],
      { cwd, timeoutMs: GIT_TIMEOUT_MS },
    )
    const [name, gitDir, commonDir] = git.stdout.split(/\r?\n/)
    if (git.exitCode === 0 && name) {
      let label = name
      if (name === 'HEAD') {
        const sha = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { cwd, timeoutMs: GIT_TIMEOUT_MS })
        label = sha.exitCode === 0 && sha.stdout.trim() ? `detached ${sha.stdout.trim()}` : 'detached'
      }
      branch = { name: label, isWorktree: Boolean(gitDir && commonDir && !sameDir(gitDir, commonDir)) }
    }
  } catch {
    // No git, or it did not answer in time: the branch is hidden.
  }
  await change($, s => ({ ...s, folder: cwd, branch }))
}

async function refreshModel($: EngineInterface): Promise<void> {
  const model = await $.session.model()
  const row = (await $.config.list()).find(r => r.key === 'model' && r.kind === 'choice')
  const modelRow =
    row && row.options && row.options.length > 0
      ? { value: row.value == null ? '' : String(row.value), options: [...row.options], isLocked: row.isLocked }
      : null
  let isSwitched = false
  await change($, s => {
    // Effort is kept per model: a switch shows the new model's setting until a request confirms it.
    isSwitched = s.model !== null && s.model !== model
    return { ...s, model, modelRow, ...(isSwitched ? { effort: null } : {}) }
  })
  if (isSwitched) await quietly(refreshEffortSetting($))
}

/** The level the settings gave at the last read: a change of it shows at once. */
let settingsLevel: string | null = null

/**
 * The effort the settings give this session's model: the inline `flag` layer's `effortLevel` (where
 * VS Code's own selector writes; it outranks the files), else its `modelSettings` entry, else
 * `effortLevel`. Shown while no request has reported one, and whenever the settings change.
 */
async function refreshEffortSetting($: EngineInterface): Promise<void> {
  const model = await $.session.model()
  const flag = (await $.settings.read({ source: 'flag' })).effortLevel
  const perModel = await $.settings.read({ key: 'modelSettings' })
  const models = perModel && typeof perModel === 'object' ? (perModel as Record<string, unknown>) : {}
  const entry = models[model] ?? models[model.replace(/\[1m\]$/i, '')]
  const own = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).effortLevel : undefined
  const level =
    typeof flag === 'string' ? flag : typeof own === 'string' ? own : await $.settings.read({ key: 'effortLevel' })
  if (typeof level !== 'string') return
  const isChanged = settingsLevel !== null && settingsLevel !== level
  settingsLevel = level
  await change($, s => (s.effort === null || (isChanged && s.effort !== level) ? { ...s, effort: level } : s))
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  await change($, s => ({ ...s, usage: fromUsage(usage, s.usage) }))
}

/** `$.store` (per config home, so two homes never meet): one key per session's prompt count, at most `PROMPT_RECORDS`; the windows. */
const PROMPT_KEY_PREFIX = 'prompts:'
const PROMPT_RECORDS = 200
const QUOTA_KEY = 'quota'
/** The least time between two writes of an unchanged reading. */
const QUOTA_WRITE_MS = 60_000

/**
 * The person's prompts before this process counted any, decided once per session: this session's
 * store record (written by any earlier process of the same session id), else 0, exact only for a
 * conversation that began empty; a forked one, or the mod installed later, has earlier prompts no
 * API can count (the conversation keeps none from before its last compaction).
 */
async function refreshPromptBase($: EngineInterface): Promise<void> {
  if ((await shown($))?.promptBase !== undefined) return
  const record = parsePromptRecord(await $.store.get(`${PROMPT_KEY_PREFIX}${await $.session.id()}`))
  const base = record
    ? { n: record.n, isExact: record.isExact }
    : { n: 0, isExact: (await $.session.turns()) === 0 && (await $.session.messages()).length === 0 }
  await change($, s => (s.promptBase !== undefined ? s : { ...s, promptBase: base }))
}

/** Sessions whose record this process already moved to the end of the store's order. */
const promptKeysMoved = new Set<string>()

/** One more of the person's prompts, kept under the session's id for a later resume. */
async function countPrompt($: EngineInterface): Promise<void> {
  const key = `${PROMPT_KEY_PREFIX}${await $.session.id()}`
  const counted: { record?: PromptRecord } = {}
  await change($, s => {
    const base = s.promptBase ?? { n: 0, isExact: false }
    const promptCount = (s.promptCount ?? 0) + 1
    counted.record = { v: 1, n: base.n + promptCount, isExact: base.isExact }
    return { ...s, promptBase: base, promptCount }
  })
  if (!counted.record) return
  if (!promptKeysMoved.has(key)) {
    promptKeysMoved.add(key)
    // The store keeps insertion order: drop the least recently used beyond the cap, then move this
    // session's record last by deleting it before it is set again.
    const others = (await $.store.keys()).filter(k => k.startsWith(PROMPT_KEY_PREFIX) && k !== key)
    for (const old of others.slice(0, Math.max(0, others.length - (PROMPT_RECORDS - 1)))) await $.store.delete(old)
    await $.store.delete(key)
  }
  await $.store.set(key, counted.record)
}

const quotaCacheOf = (record: QuotaRecord | null): Status['quotaCache'] =>
  record ? { ...(record.five ? { five: record.five } : {}), ...(record.seven ? { seven: record.seven } : {}) } : undefined

/** The last reading this process wrote: an unchanged one is written again at most once a minute. */
let quotaWritten: { sig: string; at: number } | null = null

/**
 * A live reading, kept for later sessions of this config home: before their first response they
 * show it as cached until its reset. Recorded from `session.measure` only when a response just
 * arrived (`rateLimits` or `cost` changed), so its time is the time it was seen.
 */
async function recordQuota($: EngineInterface, e: { rateLimits: Parameters<typeof fromUsage>[0]['rateLimits']; changed: readonly string[] }): Promise<void> {
  if (!e.changed.includes('rateLimits') && !e.changed.includes('cost')) return
  const live = fromUsage({ rateLimits: e.rateLimits })
  if (!live.five && !live.seven) return
  const now = await $.clock.now()
  const sig = JSON.stringify([live.five, live.seven])
  if (quotaWritten?.sig === sig && now - quotaWritten.at < QUOTA_WRITE_MS) return
  quotaWritten = { sig, at: now }
  const record = mergeQuota(parseQuotaRecord(await $.store.get(QUOTA_KEY)), live, now)
  await $.store.set(QUOTA_KEY, record)
  await change($, s => ({ ...s, quotaCache: quotaCacheOf(record) }))
}

/** The windows this config home last recorded, read for a session without live ones. */
async function refreshQuotaCache($: EngineInterface): Promise<void> {
  const cached = quotaCacheOf(parseQuotaRecord(await $.store.get(QUOTA_KEY)))
  await change($, ({ quotaCache: _, ...s }) => (cached ? { ...s, quotaCache: cached } : s))
}

/** A VS Code panel draws this session: its own selectors change the model and effort unseen. */
let isVscodeAttached = false

async function refreshSurfaces($: EngineInterface): Promise<void> {
  const surfaces = await $.session.surfaces()
  isVscodeAttached = surfaces.includes('vscode')
  const remote = surfaces.filter(surface => surface !== 'terminal')
  // Verified only: a client drawing this terminal session from elsewhere (a phone, the web).
  const isRemote = surfaces.includes('terminal') ? remote.length > 0 : remote.includes('mobile')
  await change($, s => ({ ...s, isRemote, remoteSurfaces: isRemote ? remote : [] }))
}

async function refreshAgents($: EngineInterface): Promise<void> {
  const list = await $.agent.list()
  const now = await $.clock.now()
  await change($, s => ({
    ...s,
    agents: runningAgents(list, s.spawns, s.agents, now),
    spawns: pruneSpawns(s.spawns, list.map(agent => agent.id), now),
  }))
}

/**
 * The capture script writes beside itself, so its folder follows the command: the marketplace
 * clone's copy (`<config>/plugins/marketplaces/<marketplace>/scripts/`), else the one Install put in
 * `<config>/nth-dev-kit-hooks/`.
 */
function captureDir(config: string, command: string): string {
  return command.replace(/\\/g, '/').includes(`/plugins/marketplaces/${MARKETPLACE}/`)
    ? `${config}/plugins/marketplaces/${MARKETPLACE}/scripts/nth-status`
    : `${config}/nth-dev-kit-hooks/nth-status`
}

async function refreshCache($: EngineInterface): Promise<void> {
  const setting = await $.settings.read({ key: 'statusLine' })
  const command =
    setting && typeof setting === 'object' ? String((setting as Record<string, unknown>).command ?? '') : ''
  const hasCacheSource = command.includes(CAPTURE_SCRIPT)
  let cache: Status['cache'] = null
  const config = hasCacheSource ? await configDir($) : null
  if (config) {
    const sessionId = await $.session.id()
    const file = `${captureDir(config, command)}/statusline-${sessionId.replace(/[^A-Za-z0-9_-]/g, '-')}.json`
    if (await $.fs.exists(file)) cache = parseCapture(await $.fs.read(file), sessionId)
  }
  await change($, s => ({ ...s, hasCacheSource, cache }))
}

/**
 * Whether the compactions before the mod began are known, decided once per session: none when the
 * conversation was empty (a resumed one is loaded before `session.start`), unknown when it already
 * held messages (resumed, forked, or the mod loaded later), since no API reports past compactions.
 */
async function refreshCompactionBase($: EngineInterface): Promise<void> {
  if ((await shown($))?.compactionBase !== undefined) return
  const isEmpty = (await $.session.turns()) === 0 && (await $.session.messages()).length === 0
  await change($, s => (s.compactionBase !== undefined ? s : { ...s, compactionBase: isEmpty ? 0 : null }))
}

function refreshAll($: EngineInterface): Promise<void> {
  return Promise.all([
    quietly(refreshCompactionBase($)),
    quietly(refreshPromptBase($)),
    quietly(refreshQuotaCache($)),
    quietly(refreshProject($)),
    quietly(refreshModel($)),
    quietly(refreshEffortSetting($)),
    quietly(refreshUsage($)),
    quietly(refreshSurfaces($)),
    quietly(refreshAgents($)),
    quietly(refreshCache($)),
  ]).then(() => undefined)
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'nth-status', focus: true, closeOnEscape: true })
}

async function pickModel($: EngineInterface, value: string): Promise<void> {
  try {
    const set = await $.config.set({ key: 'model', value })
    if ('deny' in set && set.deny) $.ui.toast(`Model not changed: ${set.deny}`)
  } catch (error) {
    $.ui.toast(`Model not changed: ${String(error)}`)
  }
  await quietly(refreshModel($))
}

async function pickEffort($: EngineInterface, value: string): Promise<void> {
  try {
    const ran = await $.command.run({ command: 'effort', args: value })
    const text = ran.text ?? ''
    // The engine's next request confirms it (turn.step); until then show what /effort set.
    const level = effortSet(value, text)
    if (level) {
      await change($, s => ({ ...s, effort: level }))
    } else {
      $.ui.toast(`Effort not changed${text ? `: ${text}` : ''}`)
    }
  } catch (error) {
    $.ui.toast(`Effort not changed: ${String(error)}`)
  }
}

// ---- Rows that open under a control: Model and Effort choices, the Actions menu, the folder ----

type TPicker = 'model' | 'effort'
type TOpen = TPicker | 'actions' | 'folder'

/** The one row open in the band, under the control that opened it; null when none. */
let picker: TOpen | null = null
/** The band's site id, for moving its focus ring (`$.ui.focus`). */
let bandId: string | null = null

/** The controls an open row owns: the ring moving onto anything else closes the row. */
const OWNED: Record<TOpen, RegExp> = {
  model: /^(model|pick:.*)$/,
  effort: /^(effort|pick:.*)$/,
  actions: /^(actions|act:.*|code:.*)$/,
  folder: /^(folder|path:.*)$/,
}

const effortLabel = (effort: string | null) =>
  effort !== null && (EFFORTS as readonly string[]).includes(effort)
    ? effort.charAt(0).toUpperCase() + effort.slice(1)
    : 'Default'

type Choice = { value: string; label: string; isCurrent: boolean }

/** The open picker's choices, or null. Model: the `/config` row's options; Effort: the levels. */
function pickerChoices(value: Status): { kind: TPicker; options: Choice[] } | null {
  if (picker === 'model' && value.modelRow && value.model) {
    const row = value.modelRow
    const current = shortModel(value.model)
    return {
      kind: 'model',
      options: row.options.map(option => ({
        value: option,
        label: option === row.value ? current : aliasLabel(option),
        isCurrent: option === row.value,
      })),
    }
  }
  if (picker === 'effort') {
    return {
      kind: 'effort',
      options: EFFORTS.map(level => ({ value: level, label: effortLabel(level), isCurrent: level === value.effort })),
    }
  }
  return null
}

/** Moves the band's ring onto one of this mod's controls; refused quietly when the band lacks the keys. */
async function focusBand($: EngineInterface, key: string): Promise<void> {
  if (bandId) await quietly($.ui.focus({ requestId: bandId, key }))
}

/** The key the ring moves to as a row opens: the current choice, the first menu entry, Copy path. */
async function firstKey($: EngineInterface, kind: TOpen): Promise<string> {
  if (kind === 'actions') return `act:${MENU[0]!.value}`
  if (kind === 'folder') return 'path:copy'
  const value = await shown($)
  const current = value ? pickerChoices(value)?.options.find(option => option.isCurrent) : undefined
  return `pick:${current?.value ?? 'cancel'}`
}

async function togglePicker($: EngineInterface, kind: TOpen): Promise<void> {
  picker = picker === kind ? null : kind
  codeChoice = null
  $.ui.invalidate('ui.render')
  if (picker) await focusBand($, await firstKey($, picker))
}

async function closePicker($: EngineInterface): Promise<void> {
  const kind = picker
  picker = null
  codeChoice = null
  $.ui.invalidate('ui.render')
  if (kind) await focusBand($, kind)
}

async function choose($: EngineInterface, kind: TPicker, choice: string): Promise<void> {
  await closePicker($)
  await (kind === 'model' ? pickModel($, choice) : pickEffort($, choice))
}

let timer: { cancel: () => void } | null = null
let ticks = 0
/** Ticks left re-reading the cache after a prompt: the status line runs just after the response. */
let cacheFollowUps = 0

/** Every second: live figures while a prompt or an agent runs, else a redraw for the countdowns. */
async function tick($: EngineInterface): Promise<void> {
  ticks += 1
  const current = await shown($)
  if (!current) return void (await refreshAll($))
  const isBusy = current.prompt?.phase === 'running' || current.agents.length > 0
  if (isBusy) {
    await Promise.all([quietly(refreshUsage($)), quietly(refreshAgents($))])
    if (ticks % 5 === 0) await quietly(refreshCache($))
    // Waiting on background agents can last long: a newer reading another session recorded still shows.
    if (ticks % IDLE_TICKS === 0) await quietly(refreshQuotaCache($))
    $.ui.invalidate('ui.render')
  } else if (cacheFollowUps > 0) {
    cacheFollowUps -= 1
    await quietly(refreshCache($))
  } else if (ticks % IDLE_TICKS === 0) {
    // An idle session's live windows stand still: pick up a newer reading another session of this
    // home just recorded (`freshestQuota` keeps whichever is newer).
    await Promise.all([
      quietly(refreshCache($)),
      quietly(refreshAgents($)),
      quietly(refreshModel($)),
      quietly(refreshQuotaCache($)),
    ])
    $.ui.invalidate('ui.render')
  }
  // VS Code's selectors raise no event a mod sees (2.1.311): follow the model and effort they set,
  // background agents or not (a request's own effort still confirms it at turn.step).
  if (isVscodeAttached) {
    if ((await $.session.model()) !== current.model) await quietly(refreshModel($))
    await quietly(refreshEffortSetting($))
  }
}

// ---- Copy and Actions ----

type Captured = {
  sessionId: string
  /** The person's last typed prompt (no slash command, no hidden prompt). */
  prompt: string | null
}

/** Kept in this process only: large text has no place in the redrawn status atom. */
let captured: Captured = { sessionId: '', prompt: null }

async function capturedFor($: EngineInterface): Promise<Captured> {
  const sessionId = await $.session.id()
  if (captured.sessionId !== sessionId) {
    captured = { sessionId, prompt: null }
    codeChoice = null
    picker = null
  }
  return captured
}

/**
 * The response Copy and Copy code take, read from the conversation history when pressed, so a
 * resumed session or a mod loaded mid-session copies what is on screen.
 */
async function latestResponse($: EngineInterface): Promise<string> {
  const messages = await $.session.messages({ as: 'api' })
  return Array.isArray(messages) ? lastResponse(messages) : ''
}

/** A press or pick never fails silently: any engine refusal ends in a toast. */
async function safely($: EngineInterface, what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    $.ui.toast(`${what} failed: ${String(error)}`)
  }
}

/** The blocks Copy code offers while the menu is a chooser; null otherwise. */
let codeChoice: CodeBlock[] | null = null
const MENU = [
  { value: 'copy-code', label: 'Copy code' },
  { value: 'diff', label: 'Diff' },
  { value: 'agents', label: 'Agents' },
  { value: 'copy-prompt', label: 'Copy prompt' },
  { value: 'session-info', label: 'Session info' },
] as const

type TSurface = Parameters<EngineInterface['ui']['copy']>[0]['surface']

/** Copies through the engine's clipboard path (as `/copy` writes) and says what happened. */
async function copyText($: EngineInterface, text: string, surface: TSurface, what: string): Promise<void> {
  try {
    const copied = await $.ui.copy({ text, ...(surface ? { surface } : {}) })
    $.ui.toast(copied.isCopied ? `Copied ${what}` : `Copy failed: ${copied.reason.replace('-', ' ')}`)
  } catch (error) {
    $.ui.toast(`Copy failed: ${String(error)}`)
  }
}

/** The built-in `/copy`, whole: its picker, clipboard path and transcript line are its own. */
async function runCopyCommand($: EngineInterface): Promise<void> {
  await $.command.run({ command: 'copy' })
}

async function copyResponse($: EngineInterface, surface: TSurface): Promise<void> {
  const response = await latestResponse($)
  if (!response) return void $.ui.toast('No completed response yet')
  await copyText($, response, surface, `response (${response.length} chars)`)
}

function copyCode($: EngineInterface, block: CodeBlock, surface: TSurface): Promise<void> {
  const count = block.code.split('\n').length
  return copyText($, block.code, surface, `code block (${count} line${count === 1 ? '' : 's'})`)
}

/** A short chooser label: `2. python · 3 lines · print(2)`. */
function blockLabel(block: CodeBlock, i: number): string {
  const lines = block.code.split('\n')
  const first = lines.find(line => line.trim())?.trim() ?? ''
  const label = `${i + 1}. ${block.lang || 'code'} · ${lines.length} line${lines.length === 1 ? '' : 's'} · ${first}`
  return label.length > 48 ? `${label.slice(0, 47)}…` : label
}

/** A menu entry: the row closes and the action runs; Copy code with several blocks reopens it as a chooser. */
async function runAction($: EngineInterface, action: string, surface: TSurface): Promise<void> {
  await closePicker($)
  if (action === 'copy-code') {
    const response = await latestResponse($)
    const blocks = response ? codeBlocks(response) : []
    if (blocks.length === 0) return void $.ui.toast('No code block in the last response')
    if (blocks.length === 1) return copyCode($, blocks[0]!, surface)
    // Several: the menu row lists the blocks to choose from, in the band.
    picker = 'actions'
    codeChoice = blocks
    $.ui.invalidate('ui.render')
    await focusBand($, 'code:0')
  } else if (action === 'diff') {
    try {
      await $.command.run({ command: 'diff' })
    } catch (error) {
      $.ui.toast(`Diff unavailable: ${String(error)}`)
    }
  } else if (action === 'agents') {
    await openPane($)
  } else if (action === 'copy-prompt') {
    const { prompt } = await capturedFor($)
    if (!prompt) return void $.ui.toast('No prompt yet in this session')
    await copyText($, prompt, surface, `prompt (${prompt.length} chars)`)
  } else if (action === 'session-info') {
    const value = await shown($)
    if (!value) return void $.ui.toast('No session data yet')
    await copyText($, sessionInfo(value, await $.clock.now()), surface, 'session info')
  }
}

/** The effort a `/effort <level>` run set, when its answer reports that level and no failure. */
function effortSet(level: string, text: string): string | null {
  if (!(EFFORTS as readonly string[]).includes(level)) return null
  // A run from a press or pick answers with no text (checked live on 2.1.310): it did not fail.
  if (!text.trim()) return level
  if (/\b(invalid|unknown|not supported|cannot|failed)\b/i.test(text)) return null
  // A level over the model's cap is set lower: "... set to 'high' instead".
  const capped = /set to '([a-z]+)' instead/i.exec(text)?.[1]?.toLowerCase()
  if (capped && (EFFORTS as readonly string[]).includes(capped)) return capped
  return new RegExp(`\\b${level}\\b`, 'i').test(text) ? level : null
}

// ---- VS Code dashboard ----

/** Each block's fixed tint, faint on light and dark panels alike, and its border, a little stronger. */
const TINTS = {
  context: { fill: '#3b82f60d', border: '#3b82f63d' },
  meta: { fill: '#a855f70d', border: '#a855f73d' },
  quota: { fill: '#14b8a60d', border: '#14b8a63d' },
} as const
/**
 * How the room beyond each block's own figures is shared, the three in a row: a panel at its widest
 * (680 px) lands near 30 / 32 / 38 %. At 500 px the figures themselves set the widths (about
 * 25 / 37 / 38 %), as Prompt and Session need the most.
 */
const SHARES = { context: 40, meta: 23, quota: 37 } as const
/**
 * The quota block's least width, in the panel's `ch` (a digit, 7 px): what `7d 6d4h Tue 03:00 23%`
 * takes, so the block keeps its place while it has no reading yet.
 */
const QUOTA_MIN = 23
/** A meter row's neutral track and fill (gray with alpha, both themes); a cached reading's fill at half. */
const TRACK = '#80808014'
const FILL = '#80808033'
const FILL_CACHED = '#8080801a'
/** Rows are framed alike, meter or not: rounded, with a border no one sees. */
const CLEAR = '#00000000'
/**
 * Row heights in the panel's `lh` (18.2 px at 13 px). Two rows, their gap, the padding and the
 * border make a block about 66 px high; a stacked band takes the low rows, so the three blocks one
 * per row stay within the panel's 12 lines.
 */
const ROW = { height: 1.3, gap: 0.2, padding: 0.25 } as const
const LOW_ROW = { height: 1.15, gap: 0, padding: 0.1 } as const
/**
 * Under this many columns the blocks no longer sit two in a row (Context and Prompt/Session take
 * about 280 px at the panel's 9.2 px column), so they stack. The blocks wrap by their own figures;
 * this only picks the row height.
 */
const VS_STACKED = 33
/** What an icon reads as where the panel shows no picture. */
const ICON_ALTS = { cache: '🛢️', warm: '🔥', cold: '⌛', prompts: '💬' } as const
/** The header path's most characters. */
const VS_PATH_MAX = 60
/** Characters of the panel's text a column holds, about: a column is 9.2 px, a character some 7. */
const CHARS_PER_COLUMN = 1.25

/**
 * The widths that take a fill of `pct` % (whole) back to its row's whole width, outermost first:
 * the engine takes only whole percentages up to 999 %, so a narrow fill widens in steps.
 */
function widen(pct: number): string[] {
  const steps: string[] = []
  let rest = 10_000 / pct
  while (rest > 999) {
    steps.push('999%')
    rest = (rest * 100) / 999
  }
  return [...steps, `${Math.round(rest)}%`]
}

/**
 * The header (path and branch; model and effort as text) and three blocks below it, inside the
 * panel's own frame: Context, Prompt and Session, the 5h and 7d quotas, each block two rows. A
 * meter row is its own background meter, a neutral fill over a neutral track with its figures
 * drawn above. Severity alone is colored; everything else is the panel's text colors.
 */
function vscodeBand(el: ElementTable<'vscode'>, value: Status, now: number, columns: number): RenderNode {
  const { Box, Text, Svg } = el
  const shown = board(value, now)
  const muted = { color: 'inactive' } as const
  const metrics = columns < VS_STACKED ? LOW_ROW : ROW

  const figure = (key: string, text: string, color: string | null, isFaded = false) => {
    const { source, width } = figureSvg(text, color, isFaded)
    return <Svg key={key} source={source} alt={text} width={width} height={FIGURE_HEIGHT} />
  }
  // An icon not drawn (the panel can refuse a picture for a while) shows its alt: the emoji it stands for.
  const icon = (key: keyof typeof SVG_ICONS) => (
    <Svg key={key} source={SVG_ICONS[key]} alt={ICON_ALTS[key]} width={ICON_SIZE} height={ICON_SIZE} />
  )
  const group = (key: string, items: RenderChildren) => (
    <Box key={key} flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={0.4}>
      {items}
    </Box>
  )
  // The left figures, and the right one at the far edge, a gap apart at the least: a block takes
  // the width its figures need, so nothing overlaps as they grow.
  const figures = (left: RenderChildren, right: RenderChildren) => [group('left', left), right ? group('right', right) : null]
  const line = (body: RenderChildren) => (
    <Box flexGrow={1} flexDirection="row" flexWrap="nowrap" justifyContent="space-between" alignItems="center" columnGap={0.6} paddingX={0.4}>
      {body}
    </Box>
  )
  // A meter fills `pct` % of its track. The panel has no layering, so the figures sit inside the
  // fill, widened back to the row's whole width, and are drawn above both. The padding sits inside
  // the widened box: a box's width leaves its padding out.
  const widened = ([width = '100%', ...rest]: string[], body: RenderChildren): RenderNode => (
    <Box width={width} flexShrink={0} flexDirection="row" flexWrap="nowrap">
      {rest.length > 0 ? widened(rest, body) : line(body)}
    </Box>
  )
  const row = (key: string, left: RenderChildren, right: RenderChildren, meter?: { pct: number | null; fill: string }) => {
    const pct = meter?.pct == null ? 0 : Math.round(Math.min(100, meter.pct))
    return (
      <Box
        key={key}
        height={metrics.height}
        flexDirection="row"
        flexWrap="nowrap"
        borderStyle="round"
        borderColor={CLEAR}
        overflow="hidden"
        backgroundColor={meter ? TRACK : undefined}
      >
        {meter && pct > 0 ? (
          <Box width={`${pct}%`} flexShrink={0} flexDirection="row" flexWrap="nowrap" backgroundColor={meter.fill}>
            {widened(widen(pct), figures(left, right))}
          </Box>
        ) : (
          line(figures(left, right))
        )}
      </Box>
    )
  }
  // No width of their own: each takes what its figures need, then its share of the room left, and
  // they wrap to another row only when the figures do not fit side by side.
  const block = (key: keyof typeof SHARES, rows: RenderNode[], minWidth?: number) => (
    <Box
      key={key}
      flexDirection="column"
      flexGrow={SHARES[key]}
      minWidth={minWidth}
      rowGap={metrics.gap}
      paddingX={0.3}
      paddingY={metrics.padding}
      borderStyle="round"
      borderColor={TINTS[key].border}
      backgroundColor={TINTS[key].fill}
    >
      {rows}
    </Box>
  )
  const known = (key: string, text: string | null) =>
    text === null || text === '—' ? (
      <Text key={key} {...muted}>
        —
      </Text>
    ) : (
      <Text key={key}>{text}</Text>
    )

  const { context: ctx, last, session, five, seven } = shown
  const cache = ctx.cache
  const context = block('context', [
    row(
      'context-use',
      ctx.meter ? figure('context-pct', `${Math.round(ctx.meter.pct)}%`, SEVERITY[ctx.meter.tone]) : known('context-pct', null),
      ctx.tokens !== null && (
        <Text key="tokens" {...muted}>
          {ctx.tokens}
        </Text>
      ),
      { pct: ctx.meter?.pct ?? null, fill: FILL },
    ),
    // The cache as the mod tracked it from the session's requests (no capture arrives here): warm
    // with an estimate of its time left (`~`), `Cold` an hour after its last use, else `—`.
    row(
      'context-cache',
      [
        icon('cache'),
        cache ? (
          <Text key="cache-left" color={cache.tone ? SEVERITY[cache.tone] : undefined}>
            {cache.left ?? 'Cold'}
          </Text>
        ) : (
          known('cache-left', null)
        ),
        cache && icon(cache.isWarm ? 'warm' : 'cold'),
      ],
      [
        <Text key="compacted" {...muted}>
          ↻
        </Text>,
        known('compactions', ctx.compactions),
      ],
    ),
  ])
  const meta = block('meta', [
    row(
      'last',
      [
        <Text key="last-label" {...muted}>
          {last.label}
        </Text>,
        known('last-time', last.time),
      ],
      last.cost !== null && <Text key="last-cost">{last.cost}</Text>,
    ),
    row(
      'session',
      [
        <Text key="session-label" {...muted}>
          Session
        </Text>,
        // `—` or `≥N` when the earlier prompts are unknown; nothing while undecided.
        session.prompts !== null && group('prompt-count', [known('prompts', session.prompts), icon('prompts')]),
        known('session-time', session.time),
      ],
      session.cost !== null && <Text key="session-cost">{session.cost}</Text>,
    ),
  ])
  // No reading (none yet in this engine process, none on this account, or past its reset): the
  // track alone and a neutral `—`, never a guessed figure. A cached one is faded, its age in place
  // of the reset clock.
  const window = (key: 'five' | 'seven', label: string, q: BoardQuota | null) =>
    row(
      key,
      [
        figure(`${key}-label`, label, null),
        q?.left != null && <Text key={`${key}-left`}>{q.left}</Text>,
        q?.age != null ? (
          <Text key={`${key}-at`} {...muted}>{`cached ${q.age}`}</Text>
        ) : (
          q?.at != null && (
            <Text key={`${key}-at`} {...muted}>
              {q.at}
            </Text>
          )
        ),
      ],
      q ? figure(`${key}-pct`, `${Math.round(q.pct)}%`, SEVERITY[q.tone], q.age !== null) : known(`${key}-pct`, null),
      { pct: q?.pct ?? null, fill: q?.age != null ? FILL_CACHED : FILL },
    )
  const quota = block('quota', [window('five', '5h', five), window('seven', '7d', seven)], QUOTA_MIN)

  const branch = value.branch
  const model = value.model === null ? null : [shortModel(value.model), ...(value.hasEffort ? [effortLabel(value.effort)] : [])].join(' · ')
  // One row: the path takes what the branch and the model leave; past that, the model wraps below.
  const room =
    Math.floor(columns * CHARS_PER_COLUMN) - (branch ? branch.name.length + (branch.isWorktree ? 12 : 3) : 0) - (model ? model.length + 4 : 0)
  const folder = value.folder ? shortPath(value.folder, Math.max(12, Math.min(VS_PATH_MAX, room))) : null
  return (
    <Box flexDirection="column" rowGap={0.3}>
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1.5}>
        <Text wrap="truncate-end">
          {folder !== null && <Text bold>{folder}</Text>}
          {folder !== null && branch && <Text {...muted}>{' · '}</Text>}
          {branch?.name}
          {branch?.isWorktree && <Text {...muted}>{' worktree'}</Text>}
        </Text>
        {model !== null && <Text {...muted}>{model}</Text>}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={0.4} rowGap={0.2}>
        {context}
        {meta}
        {quota}
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // A plugin reload may change the tools or prompt sections the cached prefix holds.
    await quietly(change($, s => (s.cacheTrack ? { ...s, cacheTrack: undefined } : s)))
    await $.command.register({
      name: COMMAND,
      description: 'Show nth-status details: session, quotas, cache and running agents',
    })
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => void quietly(tick($)))
    void refreshAll($)
    return started
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear') {
      await update($, status, () => null)
      captured = { sessionId: '', prompt: null }
      codeChoice = null
      picker = null
    }
    return ended
  })

  on('session.measure', async ($, e, next) => {
    await quietly(change($, s => ({ ...s, usage: fromUsage(e, s.usage) })))
    await quietly(recordQuota($, e))
    return next(e)
  })

  // A compaction of the main conversation that stood: VS Code's dashboard counts them. Untouched,
  // and no `.catch`: its fallback would run the compaction (a model request) a second time.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.messages) {
      // The summary replaces the conversation: what was seen cached no longer serves it.
      await quietly(change($, s => ({ ...s, compactions: (s.compactions ?? 0) + 1, cacheTrack: undefined })))
    }
    return compacted
  })

  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    await quietly(refreshSurfaces($))
    return attached
  })

  on('session.detach', async ($, e, next) => {
    const detached = await next(e)
    await quietly(refreshSurfaces($))
    return detached
  })

  // Recorded before the turn runs, so its own turn.complete always lands after.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      void quietly(refreshAgents($))
      return next(e)
    }
    const now = await $.clock.now()
    // A picker left open does not outlive the prompt that follows it.
    picker = null
    await quietly(
      (async () => {
        const usage = await $.session.usage()
        await change($, s => ({
          ...s,
          usage: fromUsage(usage, s.usage),
          prompt: { phase: 'running', startedAt: now, ...(usage.cost ? { costAtStart: usage.cost.usd } : {}) },
        }))
      })(),
    )
    return next(e)
  })

  // The main loop's effort as each request goes out (after any downgrade); never rewritten. The
  // usage each request reports tracks the prompt cache (`noteCacheUse`); the result passes as is.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      void quietly(
        change($, s => (s.effort === effort && s.hasEffort === (effort !== null) ? s : { ...s, effort, hasEffort: effort !== null })),
      )
    }
    let sent: TSent | null = null
    if (e.agentId === undefined) {
      try {
        const at = await $.clock.now()
        sent = { at, sessionId: await $.session.id(), sessionModel: await $.session.model() }
      } catch {
        sent = null
      }
    }
    const result = yield* next(e)
    if (sent !== null && result.usage) void quietly(noteCacheUse($, e, result.usage, sent))
    void quietly(noteStepEnd($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined) {
      await quietly(refreshAgents($))
      return completed
    }
    await quietly(refreshUsage($))
    await quietly(
      change($, s => {
        if (!s.prompt || s.prompt.phase !== 'running') return s
        const costUsd =
          s.prompt.costAtStart !== undefined && s.usage.costUsd !== undefined
            ? Math.max(0, s.usage.costUsd - s.prompt.costAtStart)
            : undefined
        return {
          ...s,
          prompt: {
            ...s.prompt,
            phase: e.isAborted ? 'aborted' : 'done',
            durationMs: e.durationMs,
            ...(costUsd !== undefined ? { costUsd } : {}),
          },
        }
      }),
    )
    // A new answer: a code chooser still open offers the blocks of the one before.
    if (e.reason === 'answer') codeChoice = null
    cacheFollowUps = 5
    void Promise.all([quietly(refreshProject($)), quietly(refreshModel($)), quietly(refreshCache($))])
    return completed
  })

  // The person's own prompts: Copy prompt's source, and the count VS Code's dashboard shows. A
  // prompt the person wrote is typed at the terminal (`composer`), sent through Remote Control
  // (`bridge`), or typed in an SDK host's composer such as VS Code's (`sdk`, checked on 2.1.311);
  // never a slash command, a meta prompt, a task notification or a peer's message. Never changed.
  on('prompt.submit', async ($, e, next) => {
    const isWritten = (e.origin.kind === 'composer' || e.origin.kind === 'bridge' || e.origin.kind === 'sdk') && !e.isMeta && !e.command
    // Decided before the prompt enters: a session that began empty still reads as empty.
    if (isWritten && e.text.trim()) await quietly(refreshPromptBase($))
    const submitted = await next(e)
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const sent = typeof submitted.text === 'string' ? submitted.text : e.text
    if (isWritten && !submitted.drop && sent.trim()) await quietly(countPrompt($))
    if (isPerson && !submitted.drop) {
      await quietly(
        capturedFor($).then(c => {
          const text = typeof submitted.text === 'string' ? submitted.text : e.text
          if (!e.isMeta && !e.command && text.trim()) c.prompt = text
        }),
      )
    }
    return submitted
  }).catch(($, e, next) => next(e))

  // A `/model` or `/effort` the person typed: shown at once, the command itself untouched.
  on('command.run', { command: /^(model|effort)$/ }, async ($, e, next) => {
    const ran = await next(e)
    if (e.command === 'model') {
      void quietly(refreshModel($))
    } else {
      const level = effortSet(e.args.trim().toLowerCase(), ran.text ?? '')
      if (level) await quietly(change($, s => ({ ...s, effort: level })))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // The spawn's model and start, for the agent rows; the spawn itself passes untouched.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const agentId = spawned.agentId
    if (agentId) {
      const now = await $.clock.now()
      await quietly(change($, s => ({ ...s, spawns: { ...s.spawns, [agentId]: { model: spawned.model, startedAt: now } } })))
      void quietly(refreshAgents($))
    }
    return spawned
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /^(EnterWorktree|ExitWorktree)$/ }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) void quietly(refreshProject($))
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async $ => {
    if ((await $.session.surfaces()).length === 0) return { text: 'No surface here draws the nth-status pane.' }
    await openPane($)
    return { text: 'nth-status details opened.' }
  })

  // An open row closes when the band's ring moves to a control it does not own: Tab or an arrow
  // away, a click on another control, or on any other part of the band (which puts the ring on its
  // first control). Claude Code raises nothing for Esc or a click outside the band (2.1.310), so
  // those leave the row open; the next prompt closes it.
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    const moved = await next(e)
    if (picker && e.element !== undefined && !OWNED[picker].test(e.element)) {
      picker = null
      codeChoice = null
      $.ui.invalidate('ui.render')
    }
    return moved
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const below = await next(e)
    const value = await shown($)
    if (!value) return below
    const now = await $.clock.now()
    // VS Code's panel draws in the editor's own theme and frames the band itself: its own read-only
    // dashboard there.
    if (e.surface === 'vscode') {
      const vscode = $.ui.resolve(e)
      return (
        <vscode.Box flexDirection="column" rowGap={0.5}>
          {below}
          {vscodeBand(vscode, value, now, e.props.bodyColumns)}
        </vscode.Box>
      )
    }
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // The terminal's dashboard (a header, three zones side by side, a footer) in one rounded panel,
    // where the zones fit side by side and its rows fit with other bands' room kept; else, and in
    // the desktop app, the compact rows: a rounded panel where it fits, else the bare rows.
    const cli = e.surface === 'terminal' ? cliLayout(value, now, e.props.bodyColumns - PANEL_COLUMNS) : null
    const isZoned = cli !== null && e.props.maxRows >= CLI_ROWS + (picker ? 1 : 0) + 2 + taskBandRows(e.props.maxRows)
    const inside = layout(value, now, e.props.bodyColumns - PANEL_COLUMNS)
    const isPanel =
      isZoned ||
      (e.props.bodyColumns - PANEL_COLUMNS >= PANEL_MIN_COLUMNS &&
        e.props.maxRows >= inside.rows.length + (picker ? 1 : 0) + 2 + taskBandRows(e.props.maxRows))
    const { rows } = isPanel ? inside : layout(value, now, e.props.bodyColumns)
    const theme = isPanel ? await $.settings.read({ key: 'theme' }) : undefined
    const fill = isPanel ? panelFill(theme) : undefined

    bandId = e.requestId
    const choices = pickerChoices(value)

    // Model and Effort are Buttons, not Selects: a click anywhere in the band focuses its first
    // control, and a focused Select opens at once, so a stray click opened the Model menu. A
    // focused Button only shows the ring; its choices open on a press, as a row of Buttons.
    const drawSeg = (seg: Seg) => {
      if (seg.kind === 'model' && value.modelRow && !value.modelRow.isLocked && value.model) {
        return (
          <Button key="model" plain onPress={() => void togglePicker($, 'model')}>
            {`${shortModel(value.model)} ${picker === 'model' ? '▴' : '▾'}`}
          </Button>
        )
      }
      if (seg.kind === 'effort' && value.hasEffort) {
        return (
          <Button key="effort" plain onPress={() => void togglePicker($, 'effort')}>
            {`${effortLabel(value.effort)} ${picker === 'effort' ? '▴' : '▾'}`}
          </Button>
        )
      }
      if (seg.kind === 'agents') {
        return (
          <Button key="agents" plain onPress={() => void openPane($)}>
            <Text color="suggestion">{seg.text}</Text>
          </Button>
        )
      }
      // Copy is the primary action, Actions a secondary menu button: the terminal draws both as
      // `[ label ]`, the primary in the accent color, and inverts either under the pointer or ring.
      // A terminal press is the built-in `/copy`, run as if typed; elsewhere the response goes to
      // the pressing surface's clipboard.
      if (seg.kind === 'copy') {
        return (
          <Button
            key="copy"
            variant="primary"
            onPress={press =>
              void safely($, 'Copy', () =>
                press.surface === 'terminal' ? runCopyCommand($) : copyResponse($, press.surface),
              )
            }
          >
            Copy
          </Button>
        )
      }
      if (seg.kind === 'actions') {
        return (
          <Button key="actions" variant="secondary" onPress={() => void togglePicker($, 'actions')}>
            {`Actions ${picker === 'actions' ? '▴' : '▾'}`}
          </Button>
        )
      }
      if (seg.kind === 'folder') {
        return (
          <Button key="folder" plain onPress={() => void togglePicker($, 'folder')}>
            <Text bold>{seg.text}</Text>
          </Button>
        )
      }
      // A picker that cannot change anything is plain text, never a dead control.
      const text = seg.kind === 'model' || seg.kind === 'effort' ? seg.text.replace(/ ▾$/, '') : seg.text
      return (
        <Text color={seg.color} dimColor={seg.isDim} bold={seg.isBold} wrap="truncate-end">
          {text}
        </Text>
      )
    }

    const spaced = (segs: Seg[]) => segs.flatMap((seg, i) => (i === 0 ? [drawSeg(seg)] : [<Text> </Text>, drawSeg(seg)]))

    const drawRow = (row: Row) => (
      <Box key={row.key} flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexShrink={1}>
          {row.groups.flatMap((group, i) => (i === 0 ? spaced(group) : [<Text dimColor> │ </Text>, ...spaced(group)]))}
        </Box>
        {row.right.length > 0 && (
          <Box flexDirection="row">
            <Text> </Text>
            {spaced(row.right)}
          </Box>
        )}
      </Box>
    )

    // The open picker's choices, under the model row: one Button each (the current one marked), then
    // Cancel; wraps when the row is too narrow.
    const pickerRow = choices && (
      <Box key="picker" flexDirection="row" flexWrap="wrap" columnGap={2}>
        {choices.options.map(option => (
          <Button key={`pick:${option.value}`} plain onPress={() => void choose($, choices.kind, option.value)}>
            {option.isCurrent ? <Text bold>{`● ${option.label}`}</Text> : option.label}
          </Button>
        ))}
        <Button key="pick:cancel" plain onPress={() => void closePicker($)}>
          <Text dimColor>Cancel</Text>
        </Button>
      </Box>
    )
    // The Actions menu, under the session row: one Button per action; while Copy code offers several
    // blocks, one per block instead, then Cancel.
    const blocks = codeChoice
    const menuRow = picker === 'actions' && (
      <Box key="menu" flexDirection="row" flexWrap="wrap" columnGap={2} justifyContent="flex-end">
        {blocks
          ? blocks.map((block, i) => (
              <Button key={`code:${i}`} plain onPress={press => void (closePicker($), safely($, 'Copy code', () => copyCode($, block, press.surface)))}>
                {blockLabel(block, i)}
              </Button>
            ))
          : MENU.map(item => (
              <Button key={`act:${item.value}`} plain onPress={press => void safely($, item.label, () => runAction($, item.value, press.surface))}>
                {item.label}
              </Button>
            ))}
        {blocks && (
          <Button key="code:cancel" plain onPress={() => void closePicker($)}>
            <Text dimColor>Cancel</Text>
          </Button>
        )}
      </Box>
    )

    // The folder's whole path, under the project row: wrapped as long as it is, with Copy path.
    const folderRow = picker === 'folder' && value.folder && (
      <Box key="folder-detail" flexDirection="row" columnGap={2}>
        <Box flexShrink={1}>
          <Text wrap="wrap">{value.folder}</Text>
        </Box>
        <Box flexDirection="row" flexShrink={0} columnGap={2}>
          <Button key="path:copy" plain onPress={press => void (closePicker($), copyText($, value.folder!, press.surface, 'path'))}>
            Copy path
          </Button>
          <Button key="path:close" plain onPress={() => void closePicker($)}>
            <Text dimColor>Close</Text>
          </Button>
        </Box>
      </Box>
    )

    // Each zone row is painted cell by cell: the zone's tint, a meter's neutral fill under its first
    // cells, the figures over both (the terminal draws no layers).
    const colors = zoneColors(theme)
    if (isZoned && cli) {
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} {...(fill ? { backgroundColor: fill } : {})}>
            {drawRow(cli.header)}
            {pickerRow || folderRow}
            <Box key="zones" flexDirection="row" columnGap={ZONE_GAP}>
              {cli.zones.map(zone => (
                <Box key={zone.key} flexDirection="column" width={zone.width} flexShrink={0}>
                  {zone.rows.map(row => (
                    <Text key={row.key} wrap="truncate-end">
                      {paintRow(row, zone.width, colors?.[zone.key], colors?.fill).map((run, i) => (
                        <Text key={`${row.key}-${i}`} color={run.color} backgroundColor={run.bg} bold={run.isBold} dimColor={run.isDim}>
                          {run.text}
                        </Text>
                      ))}
                    </Text>
                  ))}
                </Box>
              ))}
            </Box>
            {drawRow(cli.footer)}
            {menuRow}
          </Box>
        </Box>
      )
    }

    const openedUnder = (key: string) =>
      key === 'usage' ? pickerRow : key === 'session' ? menuRow : key === 'project' ? folderRow : null
    const drawn = rows.flatMap(row => {
      const extra = openedUnder(row.key)
      return extra ? [drawRow(row), extra] : [drawRow(row)]
    })

    return (
      <Box flexDirection="column">
        {below}
        {isPanel ? (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="subtle"
            paddingX={1}
            {...(fill ? { backgroundColor: fill } : {})}
          >
            {drawn}
          </Box>
        ) : (
          drawn
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const value = await shown($)
    const now = await $.clock.now()
    // VS Code: its secondary text for the labels, its readable colors, and a label column of fixed
    // width, since its proportional font does not line up padded text.
    const isVscode = e.surface === 'vscode'
    const muted = isVscode ? ({ color: 'inactive' } as const) : ({ dimColor: true } as const)
    if (!value) return <Text {...muted}>nth-status: no session data yet.</Text>
    const agents = agentLines(value, now)
    const nameWidth = Math.min(28, Math.max(4, ...agents.map(agent => agent.name.length)))
    const modelWidth = Math.max(5, ...agents.map(agent => agent.model.length))
    return (
      <Box flexDirection="column">
        {paneLines(value, now).map(line => (
          <Box flexDirection="row">
            <Box flexShrink={0} {...(isVscode ? { width: 10 } : {})}>
              <Text {...muted}>{line.label.padEnd(9)}</Text>
            </Box>
            <Text color={isVscode ? vscodeColor(line.color) : line.color} wrap="truncate-end">
              {line.value}
            </Text>
          </Box>
        ))}
        <Text bold>{`Running agents (${agents.length})`}</Text>
        {agents.length === 0 && <Text {...muted}>none</Text>}
        {agents.map(agent => (
          <Text wrap="truncate-end">
            {`${agent.name.slice(0, nameWidth).padEnd(nameWidth)}  ${agent.model.padEnd(modelWidth)}  ${agent.status}  ${agent.elapsed}`}
          </Text>
        ))}
      </Box>
    )
  })
}
