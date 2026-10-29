import type { AgentRow, Cache, CachedQuota, CacheSeen, CacheTrack, PromptRecord, PromptRun, Quota, QuotaRecord, Spawn, Status, Usage } from '../types'

// Pure: no `$`. The hooks module gathers the figures; this formats and lays them out.

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const ICONS = { folder: '⌂', branch: '⎇', remote: '⇅', cache: '⛁', warm: '♨', cold: '❄', prompts: '✉', compacted: '↻' } as const

/** Below this many columns only rows 1 and 2 and the agent count show. */
const NARROW = 40
const CACHE_WARNING_MS = 60_000

export type TTone = 'success' | 'warning' | 'error'

export type TSegKind = 'text' | 'model' | 'effort' | 'agents' | 'copy' | 'actions' | 'folder'

/** Theme keys only, so the panel follows the person's light or dark theme. */
export type TSegColor = TTone | 'suggestion' | 'subtle' | 'merged'

export type Seg = {
  key: string
  text: string
  kind?: TSegKind
  color?: TSegColor
  isDim?: boolean
  isBold?: boolean
  /** Dropped as width shrinks, lowest first; absent: always kept. */
  drop?: number
}

/** One row: groups split by a dim `│`, and segments drawn at the right end. */
export type Row = { key: string; groups: Seg[][]; right: Seg[] }

export type Layout = { rows: Row[] }

export function emptyStatus(sessionId: string): Status {
  return {
    v: 1,
    sessionId,
    folder: null,
    branch: null,
    model: null,
    modelRow: null,
    effort: null,
    hasEffort: true,
    usage: {},
    prompt: null,
    agents: [],
    spawns: {},
    isRemote: false,
    remoteSurfaces: [],
    hasCacheSource: false,
    cache: null,
  }
}

/** A value an earlier version stored is declined. */
export function upgrade(value: unknown): Status | null {
  if (!value || typeof value !== 'object') return null
  const status = value as Partial<Status>
  return status.v === 1 && typeof status.sessionId === 'string' ? (status as Status) : null
}

// ---- formatting ----

const FAMILY = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i

/** `claude-opus-5-5` -> `Opus 5.5`, `claude-sonnet-5-5[1m]` -> `Sonnet 5.5 1M`; anything else as given. */
export function shortModel(id: string): string {
  const match = FAMILY.exec(id.trim())
  if (!match) return id
  const [, family = '', major, minor, wide] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase()
  return `${name} ${major}${minor ? `.${minor}` : ''}${wide ? ' 1M' : ''}`
}

/** A `/config` Model option as a picker label: `opus[1m]` -> `Opus 1M`. */
export function aliasLabel(alias: string): string {
  const wide = alias.endsWith('[1m]')
  const base = wide ? alias.slice(0, -4) : alias
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}${wide ? ' 1M' : ''}`
}

/** `45s`, `12m34s`, `2h11m`, `3d4h`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600) % 24
  const d = Math.floor(total / 86400)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** A countdown to the minute: `17m`, `2h30m`, `3d4h`; `<1m` under a minute. */
export function formatCountdown(ms: number): string {
  if (ms < 60_000) return '<1m'
  const total = Math.floor(ms / 60_000)
  const m = total % 60
  const h = Math.floor(total / 60) % 24
  const d = Math.floor(total / 1440)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  return `${m}m`
}

/** API-equivalent dollars, always marked with `~`. */
export function formatUsd(usd: number): string {
  const value = Math.max(0, usd)
  return `~$${value >= 100 ? value.toFixed(0) : value.toFixed(2)}`
}

export function formatPercent(pct: number): string {
  return `${Math.round(pct)}%`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Local time of day, with the weekday when more than a day away. */
export function formatClock(at: number, now: number): string {
  const date = new Date(at)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return at - now >= 86_400_000 ? `${DAYS[date.getDay()]} ${time}` : time
}

/** Weekday and local time, however near: `Mon 09:00`. */
export function formatDayClock(at: number): string {
  const date = new Date(at)
  return `${DAYS[date.getDay()]} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** `950`, `184k`, `1M`, `1.5M`. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 999_500) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/**
 * A faint panel fill for the person's theme. No theme key names a background, so it is a raw
 * color chosen per theme family; none where the theme is unknown, automatic or ANSI-only.
 */
export function panelFill(theme: unknown): string | undefined {
  if (theme === 'dark' || theme === 'dark-daltonized') return '#22252b'
  if (theme === 'light' || theme === 'light-daltonized') return '#f2f3f5'
  return undefined
}

/**
 * A color as VS Code's chat panel should get it. Its renderer (2.1.311) draws `subtle` in the
 * editor's disabled color, `warning` as the menu's plain text, and no `merged`: there the
 * secondary text color, the theme's terminal yellow and the plain text color read instead. The
 * branch keeps the plain text color too: the panel's accent is a focus color, faint on light themes.
 */
export function vscodeColor(color: TSegColor | undefined): string | undefined {
  if (color === 'subtle') return 'inactive'
  if (color === 'warning') return 'yellow'
  return color === 'merged' || color === 'suggestion' ? undefined : color
}

/** VS Code's dashboard severity, one scale for context, 5h and 7d: under 70 % green, under 90 % amber, else red. */
export function severityTone(pct: number): TTone {
  return pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success'
}

/**
 * VS Code's severity colors, raw: its percentages are pictures no theme color reaches, so they and
 * the cache's time take the same mid-tones, each at least 3:1 on a white and on a near-black panel.
 */
export const SEVERITY: Record<TTone, string> = { success: '#2ea043', warning: '#bf8700', error: '#e5534b' }

export function contextTone(pct: number): TTone {
  return pct >= 80 ? 'error' : pct >= 50 ? 'warning' : 'success'
}

export function quotaTone(pct: number): TTone {
  return pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success'
}

// ---- gathering ----

type UsageInput = {
  startedAt?: number
  context?: { percent?: number; tokens?: number; window?: number }
  rateLimits?: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

function quota(limits: UsageInput['rateLimits'], kind: string): Quota | undefined {
  const found = limits?.find(limit => limit.kind === kind)
  if (!found || typeof found.percentUsed !== 'number') return undefined
  const resetsAt = found.resetsAt ? Date.parse(found.resetsAt) : NaN
  return Number.isFinite(resetsAt) ? { pct: found.percentUsed, resetsAt } : { pct: found.percentUsed }
}

/** `$.session.usage()` or a `session.measure` input, as the band keeps it; absent figures stay absent. */
export function fromUsage(input: UsageInput, previous: Usage = {}): Usage {
  const usage: Usage = {}
  const startedAt = input.startedAt ?? previous.startedAt
  if (startedAt !== undefined) usage.startedAt = startedAt
  if (typeof input.context?.percent === 'number') usage.ctx = input.context.percent
  if (typeof input.context?.tokens === 'number') usage.ctxTokens = input.context.tokens
  if (typeof input.context?.window === 'number') usage.ctxWindow = input.context.window
  const five = quota(input.rateLimits, 'five_hour')
  const seven = quota(input.rateLimits, 'seven_day')
  if (five) usage.five = five
  if (seven) usage.seven = seven
  if (typeof input.cost?.usd === 'number') usage.costUsd = input.cost.usd
  return usage
}

/** The prompt cache from the status line capture, only for this session. */
export function parseCapture(text: string, sessionId: string): Cache | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (record.session_id !== sessionId) return null
  const cache = record.prompt_cache
  if (!cache || typeof cache !== 'object') return null
  const pc = cache as Record<string, unknown>
  return {
    source: 'statusline',
    isWarm: pc.warm === true,
    expiresAt: typeof pc.expires_at === 'number' ? pc.expires_at * 1000 : null,
    isObserved: typeof pc.caching_observed === 'boolean' ? pc.caching_observed : null,
    ttl: typeof pc.ttl === 'string' ? pc.ttl : null,
    hitRatio: typeof pc.hit_ratio === 'number' ? pc.hit_ratio : null,
  }
}

export type CacheState = { label: 'Warm' | 'Expiring' | 'Cold'; remainingMs: number; tone: TTone }

/**
 * Cold only when confirmed: the reported expiry has passed, or the engine says a prefix it saw
 * cached is no longer warm. Anything else it cannot vouch for is unknown (null), never Cold.
 */
export function cacheState(cache: Cache, now: number): CacheState | null {
  const isExpired = cache.expiresAt !== null && cache.expiresAt <= now
  if (isExpired || (!cache.isWarm && cache.isObserved === true)) return { label: 'Cold', remainingMs: 0, tone: 'warning' }
  if (!cache.isWarm || cache.expiresAt === null) return null
  const remainingMs = cache.expiresAt - now
  if (remainingMs <= CACHE_WARNING_MS) return { label: 'Expiring', remainingMs, tone: 'warning' }
  return { label: 'Warm', remainingMs, tone: 'success' }
}

/**
 * A prompt cache entry lives at least 5 minutes from the request that last read or wrote it, an
 * hour at most when written with the hour's TTL (or renewed since).
 */
const CACHE_MIN_MS = 5 * 60_000
const CACHE_MAX_MS = 60 * 60_000
const CACHE_TTL_MS = { '5m': CACHE_MIN_MS, '1h': CACHE_MAX_MS } as const

/** The `promptCacheTtl` setting, the engine's first word on the main thread's TTL; anything else is unknown. */
export function parseCacheTtl(value: unknown): CacheSeen['ttl'] {
  return value === '5m' || value === '1h' ? value : null
}

/**
 * The track after a main-thread request under `key` (the session model) reported its usage: it
 * replaces the key's earlier entry, marked mixed once requests under that model named different
 * models (a plan mode, a fallback), and entries past the longest TTL go.
 */
export function noteCacheStep(track: CacheTrack | undefined, key: string, entry: CacheSeen, now: number): CacheTrack {
  const before = track?.seen[key]
  const seen: Record<string, CacheSeen> = {}
  for (const [k, v] of Object.entries(track?.seen ?? {})) if (now - v.at < CACHE_MAX_MS) seen[k] = v
  seen[key] = before !== undefined && (before.isMixed === true || before.stepModel !== entry.stepModel) ? { ...entry, isMixed: true } : entry
  return { ...track, seen }
}

/**
 * `isEstimate`: the time left is not guaranteed. A tracked cache's always is: the entry's TTL from
 * the request that last read or wrote it (5 minutes, or the `promptCacheTtl` setting's hour, which
 * nothing the engine reports confirms), and a prefix change no event reports can end its use sooner.
 */
export type TrackedCacheState = CacheState & { isEstimate?: boolean }

/**
 * The main conversation's cache as the mod saw it, where no capture arrives (VS Code): warm only
 * from a request under the current session model that read or wrote it, no compaction, model
 * change or plugin reload since, timed from the moment that request went out, its time left an
 * estimate; nothing once under a minute of it is left. Cold once the longest TTL has passed since
 * that request's usage arrived and since the session's latest request of any kind (a subagent
 * sharing the prefix, one stopped before its usage may have renewed it): no entry outlives an hour
 * unrenewed, and every request of the session passes `turn.step`, the same standard the engine's
 * own expiry in the capture meets. Between the two the TTL is unknown, and so is the state (null).
 */
export function trackedCacheState(status: Status, now: number): TrackedCacheState | null {
  const entry = status.model === null ? undefined : status.cacheTrack?.seen[status.model]
  if (!entry || entry.isMixed || entry.isUncached) return null
  const lastUse = entry.doneAt === undefined ? undefined : Math.max(entry.doneAt, status.cacheTrack?.lastStepAt ?? 0)
  if (lastUse !== undefined && now - lastUse >= CACHE_MAX_MS) return { label: 'Cold', remainingMs: 0, tone: 'warning' }
  const remainingMs = CACHE_TTL_MS[entry.ttl ?? '5m'] - (now - entry.at)
  if (remainingMs < CACHE_WARNING_MS) return null
  return { label: 'Warm', remainingMs, tone: 'success', isEstimate: true }
}

type AgentInput = { id: string; status: string; name?: string; description: string; type: string }

/**
 * The agent states Claude Code counts as still at work: about to start, running a turn, or held on
 * background work of its own (its "Waiting for N background agents"). Idle teammates and ended
 * agents are not counted.
 */
const ACTIVE_AGENT: readonly string[] = ['pending', 'running', 'waiting']

/** The agents at work now: a spawn's model and start when this mod saw it, else first seen at work. */
export function runningAgents(
  list: readonly AgentInput[],
  spawns: Record<string, Spawn>,
  previous: readonly AgentRow[],
  now: number,
): AgentRow[] {
  return list
    .filter(agent => ACTIVE_AGENT.includes(agent.status))
    .map(agent => {
      const spawn = spawns[agent.id]
      const seen = previous.find(row => row.id === agent.id)
      const row: AgentRow = {
        id: agent.id,
        name: agent.name || agent.description || agent.type,
        status: agent.status,
        startedAt: spawn?.startedAt ?? seen?.startedAt ?? now,
        isEstimated: spawn === undefined && (seen?.isEstimated ?? true),
      }
      if (spawn?.model) row.model = spawn.model
      return row
    })
}

/** A spawn not listed yet is kept this long, so a list that lags the spawn does not lose it. */
const SPAWN_GRACE_MS = 60_000

/** Spawn records kept only for agents still listed (or just spawned). */
export function pruneSpawns(
  spawns: Record<string, Spawn>,
  listedIds: readonly string[],
  now: number,
): Record<string, Spawn> {
  return Object.fromEntries(
    Object.entries(spawns).filter(([id, spawn]) => listedIds.includes(id) || now - spawn.startedAt < SPAWN_GRACE_MS),
  )
}

/** The prompt's cost so far: the session ledger's growth since it started (subagents' spend included). */
export function promptCost(prompt: PromptRun, costUsd: number | undefined): number | undefined {
  if (prompt.costUsd !== undefined && prompt.phase !== 'running') return prompt.costUsd
  if (prompt.costAtStart === undefined || costUsd === undefined) return undefined
  return Math.max(0, costUsd - prompt.costAtStart)
}

export function promptElapsed(prompt: PromptRun, now: number): number {
  return prompt.phase === 'running' ? now - prompt.startedAt : (prompt.durationMs ?? 0)
}

// ---- layout ----

function width(row: Row): number {
  const groups = row.groups.filter(group => group.length > 0)
  const segs = (list: Seg[]) => list.reduce((sum, seg) => sum + seg.text.length, 0) + Math.max(0, list.length - 1)
  const left = groups.reduce((sum, group) => sum + segs(group), 0) + Math.max(0, groups.length - 1) * 3
  const right = row.right.length > 0 ? segs(row.right) + 2 : 0
  return left + right
}

/** Drops the lowest-ranked segments until the row fits (the rest is truncated by the surface). */
export function fit(row: Row, columns: number): Row {
  let current = row
  while (width(current) > columns) {
    const ranks = [...current.groups.flat(), ...current.right].flatMap(seg => (seg.drop === undefined ? [] : [seg.drop]))
    if (ranks.length === 0) break
    // Every segment of the lowest rank goes at once, so a label never stays without its value.
    const lowest = Math.min(...ranks)
    current = {
      ...current,
      groups: current.groups.map(group => group.filter(seg => seg.drop !== lowest)),
      right: current.right.filter(seg => seg.drop !== lowest),
    }
  }
  return { ...current, groups: current.groups.filter(group => group.length > 0) }
}

const isEmpty = (row: Row) => row.groups.every(group => group.length === 0) && row.right.length === 0

/** The folder path's most columns on a wide band. */
const PATH_MAX = 44
/** Below this the path is cut to its last part alone, however short. */
const PATH_MIN = 12

/**
 * A path cut to `max` columns from the left, keeping its last directories whole where they fit:
 * `C:\path\to\projects\nth-dev-kit` → `…\projects\nth-dev-kit`.
 */
export function shortPath(path: string, max: number): string {
  if (path.length <= max) return path
  const parts = path.split(/(?=[\\/])/)
  let kept = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = parts[i]! + kept
    if (next.length + 1 > max) break
    kept = next
  }
  if (kept) return `…${kept}`
  const last = parts.at(-1) ?? path
  return `…${last.slice(Math.max(0, last.length - (max - 1)))}`
}

function branchSegs(status: Status): Seg[] {
  if (!status.branch) return []
  return [
    { key: 'branch-icon', text: ICONS.branch, isDim: true, drop: 5 },
    { key: 'branch', text: status.branch.name, color: 'suggestion' },
    ...(status.branch.isWorktree ? [{ key: 'worktree', text: 'worktree', isDim: true, drop: 2 }] : []),
  ]
}

/** `RC On`, only while a remote client is attached. */
function remoteSegs(status: Status): Seg[] {
  return status.isRemote
    ? [
        { key: 'remote-icon', text: ICONS.remote, color: 'success', drop: 5 },
        { key: 'remote', text: 'RC On', color: 'success', isBold: true },
      ]
    : []
}

/** The path and the branch, the path taking what the rest of `key`'s row leaves, up to PATH_MAX. */
function projectRow(status: Status, columns: number, key = 'project', right = remoteSegs(status)): Row {
  const left: Seg[] = []
  const tail = branchSegs(status)
  if (status.folder) {
    // Never wrapped, never taller.
    const others = width({ key, groups: [[{ key: 'icon', text: ICONS.folder }, ...tail]], right })
    const room = Math.max(PATH_MIN, Math.min(PATH_MAX, columns - others - 1))
    left.push({ key: 'folder-icon', text: ICONS.folder, isDim: true, drop: 5 })
    left.push({ key: 'folder', text: shortPath(status.folder, room), kind: 'folder', isBold: true })
  }
  return { key, groups: [[...left, ...tail]], right }
}

/** A muted label and its value, dropped together. */
function metric(key: string, label: string, value: string, color: TSegColor, drop?: number): Seg[] {
  const rank = drop === undefined ? {} : { drop }
  return [
    { key: `${key}-label`, text: label, isDim: true, ...rank },
    { key, text: value, color, ...rank },
  ]
}

/** The Model and Effort pickers, drawn as Buttons by the band. */
function pickerSegs(status: Status): Seg[] {
  const pickers: Seg[] = []
  if (status.model) pickers.push({ key: 'model', text: `${shortModel(status.model)} ▾`, kind: 'model' })
  if (status.hasEffort && status.model) {
    pickers.push({ key: 'effort', text: `${status.effort ?? 'Effort'} ▾`, kind: 'effort' })
  }
  return pickers
}

function usageRow(status: Status, now: number): Row {
  const pickers = pickerSegs(status)
  const meters: Seg[] = []
  const { ctx } = status.usage
  const five = freshestQuota(status.usage.five, status.quotaCache?.five, now)
  const seven = freshestQuota(status.usage.seven, status.quotaCache?.seven, now)
  // Only the percentages carry the severity color; their labels stay muted.
  if (ctx !== undefined) meters.push(...metric('ctx', 'Ctx', formatPercent(ctx), contextTone(ctx)))
  if (five) {
    meters.push(...metric('five', '5h', formatPercent(five.pct), quotaTone(five.pct)))
    if (five.resetsAt !== undefined && five.resetsAt > now) {
      meters.push({ key: 'five-reset', text: `(${formatCountdown(five.resetsAt - now)})`, isDim: true, drop: 1 })
    }
  }
  if (seven) meters.push(...metric('seven', '7d', formatPercent(seven.pct), quotaTone(seven.pct), 3))
  return { key: 'usage', groups: [pickers, meters], right: [] }
}

/** Cache state and the running (`Prompt`) or last finished (`Last`) prompt. */
function activityRow(status: Status, now: number): Row {
  const cache: Seg[] = []
  const state = status.cache ? cacheState(status.cache, now) : null
  if (state) {
    cache.push({ key: 'cache', text: 'Cache', isDim: true, drop: 6 })
    if (state.label !== 'Cold') {
      cache.push({ key: 'cache-left', text: formatCountdown(state.remainingMs), isBold: true, color: state.tone })
    }
    cache.push({ key: 'cache-state', text: state.label, color: state.tone, ...(state.label === 'Cold' ? {} : { drop: 4 }) })
  }
  const prompt: Seg[] = []
  if (status.prompt) {
    const run = status.prompt
    const label = run.phase === 'running' ? 'Prompt' : run.phase === 'aborted' ? 'Last ✕' : 'Last'
    prompt.push({ key: 'prompt', text: label, isDim: true })
    // A finished prompt keeps its own duration; only a running one counts on.
    prompt.push({ key: 'prompt-time', text: formatDuration(promptElapsed(run, now)), isBold: true })
    const cost = promptCost(run, status.usage.costUsd)
    if (cost !== undefined) prompt.push({ key: 'prompt-cost', text: formatUsd(cost), color: 'merged' })
  }
  return { key: 'activity', groups: [cache, prompt], right: [] }
}

function agentsSeg(status: Status): Seg[] {
  const count = status.agents.length
  // Dropped last of the session row; Actions → Agents still reaches the pane without it.
  return count > 0
    ? [{ key: 'agents', text: `${count} agent${count === 1 ? '' : 's'}`, kind: 'agents', color: 'suggestion', drop: 7 }]
    : []
}

/** The two controls, never dropped: `Copy` and the `Actions ▾` menu, drawn as terminal buttons. */
function controlsSeg(): Seg[] {
  return [
    { key: 'copy', text: '[ Copy ]', kind: 'copy' },
    { key: 'actions', text: '[ Actions ▾ ]', kind: 'actions' },
  ]
}

function sessionRow(status: Status, now: number): Row {
  const session: Seg[] = []
  if (status.usage.startedAt !== undefined) {
    session.push({ key: 'session', text: 'Session', isDim: true, drop: 6 })
    // To the minute: the idle band redraws every 15 s, so seconds would look frozen.
    session.push({ key: 'session-time', text: formatCountdown(now - status.usage.startedAt), isBold: true })
    if (status.usage.costUsd !== undefined) {
      session.push({ key: 'session-cost', text: formatUsd(status.usage.costUsd), color: 'merged', drop: 4 })
    }
  }
  return { key: 'session', groups: [session], right: [...agentsSeg(status), ...controlsSeg()] }
}

/** The band's rows for the columns inside the panel; rows with nothing to show are left out. */
export function layout(status: Status, now: number, columns: number): Layout {
  const rows: Row[] =
    columns < NARROW
      ? [projectRow(status, columns), usageRow(status, now), { key: 'session', groups: [], right: [...agentsSeg(status), ...controlsSeg()] }]
      : [projectRow(status, columns), usageRow(status, now), activityRow(status, now), sessionRow(status, now)]
  return { rows: rows.map(row => fit(row, columns)).filter(row => !isEmpty(row)) }
}

// ---- the terminal's three zones ----

/** One run of zone text, as one `Text` draws it. */
export type Run = { text: string; color?: TSegColor; isBold?: boolean; isDim?: boolean }

/** A zone row: runs at the left and at the right edge; a meter fills `meter` % of the row behind them. */
export type ZoneRow = { key: string; left: Run[]; right: Run[]; meter?: number }

export type TZone = 'context' | 'meta' | 'quota'

export type Zone = { key: TZone; width: number; rows: ZoneRow[] }

/** A painted run: its text, style and background. */
export type Painted = Run & { bg?: string }

/** The terminal's dashboard: a header, three zones side by side, a footer. */
export type CliLayout = { header: Row; zones: Zone[]; footer: Row }

/** The header, the zones' two rows and the footer. */
export const CLI_ROWS = 4
/** Cells between two zones. */
export const ZONE_GAP = 1
/**
 * Each zone's least width in cells, its one-cell padding each side included: what its figures
 * take at their longest (`100%  1.5M/1.5M`; `Session ≥99✉ 12h03m  ~$17.79`; `7d 6d23h Tue 03:00  100%`,
 * or `7d 6d23h  100%` without the reset clock), so a figure changing length does not move the zones.
 */
const ZONE_MIN = { context: 16, meta: 28, quota: 25 } as const
const ZONE_MIN_NO_CLOCK = 15
/** How the cells beyond the zones' own are shared. */
const ZONE_SHARES = { context: 30, meta: 32, quota: 38 } as const

const cells = (text: string) => [...text].length
const runsWidth = (runs: Run[]) => runs.reduce((sum, run) => sum + cells(run.text), 0)
const zoneWidth = (rows: ZoneRow[]) => Math.max(...rows.map(row => runsWidth(row.left) + (row.right.length > 0 ? 2 + runsWidth(row.right) : 0))) + 2
const SPACE: Run = { text: ' ' }
const UNKNOWN: Run = { text: '—', isDim: true }

/**
 * The terminal's dashboard for the columns inside the panel, or null where the three zones do not
 * fit side by side (the band then draws its compact rows). The figures are the VS Code board's,
 * with the terminal's own thresholds (context 50/80 %, quotas 60/85 %), its `~$` costs, and live
 * quotas only, as the terminal always showed; the reset clocks go first when space is short.
 */
export function cliLayout(status: Status, now: number, columns: number): CliLayout | null {
  const shown = board(status, now)
  const { context: ctx, last, session } = shown
  const usd = (cost: number | undefined): Run[] => (cost === undefined ? [] : [{ text: formatUsd(cost), color: 'merged' }])

  const cache = ctx.cache
  const cacheRuns: Run[] = !cache
    ? [UNKNOWN]
    : cache.left === null
      ? [{ text: 'Cold', color: 'warning' }, SPACE, { text: ICONS.cold, color: 'warning' }]
      : [{ text: cache.left, isBold: true, color: cache.tone ?? 'success' }, SPACE, { text: ICONS.warm, color: cache.tone ?? 'success' }]
  const context: ZoneRow[] = [
    {
      key: 'context-use',
      left: status.usage.ctx === undefined ? [UNKNOWN] : [{ text: formatPercent(status.usage.ctx), isBold: true, color: contextTone(status.usage.ctx) }],
      right: ctx.tokens === null ? [] : [{ text: ctx.tokens, isDim: true }],
      ...(status.usage.ctx === undefined ? {} : { meter: status.usage.ctx }),
    },
    {
      key: 'context-cache',
      left: [{ text: ICONS.cache, isDim: true }, SPACE, ...cacheRuns],
      right: [{ text: ICONS.compacted, isDim: true }, SPACE, ctx.compactions === '—' ? UNKNOWN : { text: ctx.compactions }],
    },
  ]

  const run = status.prompt
  const meta: ZoneRow[] = [
    {
      key: 'last',
      left: [{ text: last.label, isDim: true }, SPACE, last.time === null ? UNKNOWN : { text: last.time, isBold: true }],
      right: usd(run ? promptCost(run, status.usage.costUsd) : undefined),
    },
    {
      key: 'session',
      left: [
        { text: 'Session', isDim: true },
        SPACE,
        // `—` or `≥N` when the earlier prompts are unknown; nothing while undecided.
        ...(session.prompts === null ? [] : [session.prompts === '—' ? UNKNOWN : { text: session.prompts }, { text: ICONS.prompts, isDim: true }, SPACE]),
        session.time === null ? UNKNOWN : { text: session.time, isBold: true },
      ],
      right: usd(status.usage.costUsd),
    },
  ]

  for (const hasClock of [true, false]) {
    const window = (key: 'five' | 'seven', label: string): ZoneRow => {
      const q = shown[key]
      return {
        key,
        left: [
          { text: label, isBold: true },
          ...(q?.left ? [SPACE, { text: q.left }] : []),
          ...(hasClock && q?.at ? [SPACE, { text: q.at, isDim: true }] : []),
        ],
        // No standing reading (none in this process or this config home, or past its reset): `—`.
        right: q ? [{ text: formatPercent(q.pct), isBold: true, color: quotaTone(q.pct) }] : [UNKNOWN],
        ...(q ? { meter: q.pct } : {}),
      }
    }
    const quota = [window('five', '5h'), window('seven', '7d')]
    const need = {
      context: Math.max(ZONE_MIN.context, zoneWidth(context)),
      meta: Math.max(ZONE_MIN.meta, zoneWidth(meta)),
      quota: Math.max(hasClock ? ZONE_MIN.quota : ZONE_MIN_NO_CLOCK, zoneWidth(quota)),
    }
    const extra = columns - 2 * ZONE_GAP - need.context - need.meta - need.quota
    if (extra < 0) continue
    const total = ZONE_SHARES.context + ZONE_SHARES.meta + ZONE_SHARES.quota
    const contextWidth = need.context + Math.floor((extra * ZONE_SHARES.context) / total)
    const metaWidth = need.meta + Math.floor((extra * ZONE_SHARES.meta) / total)
    return {
      header: fit(projectRow(status, columns, 'header', pickerSegs(status)), columns),
      zones: [
        { key: 'context', width: contextWidth, rows: context },
        { key: 'meta', width: metaWidth, rows: meta },
        { key: 'quota', width: columns - 2 * ZONE_GAP - contextWidth - metaWidth, rows: quota },
      ],
      footer: fit({ key: 'footer', groups: [remoteSegs(status)], right: [...agentsSeg(status), ...controlsSeg()] }, columns),
    }
  }
  return null
}

/**
 * A zone row drawn `width` cells wide: one cell of padding each side, the left runs, the right ones
 * at the far edge, and the zone's tint behind them; a meter's first `meter` % of the cells take the
 * neutral fill instead, the text drawn over both. Runs split where the fill ends.
 */
export function paintRow(row: ZoneRow, width: number, tint?: string, fill?: string): Painted[] {
  const gap = Math.max(1, width - 2 - runsWidth(row.left) - runsWidth(row.right))
  const runs: Run[] = [SPACE, ...row.left, { text: ' '.repeat(gap) }, ...row.right, SPACE]
  const pct = row.meter === undefined || fill === undefined ? 0 : Math.round(Math.min(100, row.meter))
  const filled = pct <= 0 ? 0 : Math.min(width, Math.max(1, Math.round((pct / 100) * width)))
  const out: Painted[] = []
  let at = 0
  for (const run of runs) {
    const chars = [...run.text]
    const cut = Math.max(0, Math.min(chars.length, filled - at))
    for (const [part, bg] of [[chars.slice(0, cut), fill], [chars.slice(cut), tint]] as const) {
      if (part.length === 0) continue
      const prev = out.at(-1)
      const isSame = prev && prev.bg === bg && prev.color === run.color && prev.isBold === run.isBold && prev.isDim === run.isDim
      if (isSame) prev.text += part.join('')
      else out.push({ ...run, text: part.join(''), ...(bg === undefined ? {} : { bg }) })
    }
    at += chars.length
  }
  return out
}

/**
 * The zones' faint tints and a meter's neutral fill, raw per theme family as the panel's own fill
 * (no theme key names a background); none where the theme is unknown, automatic or ANSI-only.
 */
export function zoneColors(theme: unknown): (Record<TZone, string> & { fill: string }) | undefined {
  if (theme === 'dark' || theme === 'dark-daltonized') return { context: '#232a36', meta: '#2a2634', quota: '#212d2c', fill: '#3a404b' }
  if (theme === 'light' || theme === 'light-daltonized') return { context: '#e8eef8', meta: '#f0eaf7', quota: '#e6f3f0', fill: '#d2d6dd' }
  return undefined
}

// ---- VS Code dashboard ----

export type Meter = { pct: number; tone: TTone }

/** `age` is set for a cached reading (how long ago it was seen), null for a live one. */
export type BoardQuota = Meter & { left: string | null; at: string | null; age: string | null }

/** What VS Code's dashboard shows, formatted; each part null until known. */
export type Board = {
  context: {
    meter: Meter | null
    /** `184k/200k`. */
    tokens: string | null
    /** `left` is null when cold, `~4m` an estimated time left; `tone` null while comfortably warm. */
    cache: { left: string | null; isWarm: boolean; tone: TTone | null } | null
    /** `3`, `≥2` (some counted, the earlier ones unknown) or `—` (unknown). */
    compactions: string
  }
  last: { label: string; time: string | null; cost: string | null }
  /** `prompts`: `12`, `≥3` (earlier prompts unknown), `—`, or null while undecided. */
  session: { prompts: string | null; time: string | null; cost: string | null }
  five: BoardQuota | null
  seven: BoardQuota | null
}

/** Two resets this close name the same window: a window's successor resets hours later. */
const SAME_RESET_MS = 60_000

/**
 * The reading to show for a window: this process's live one, or the one this config home last
 * recorded (any of its sessions, after a response), whichever is newer while it stands. The live
 * one is what this process's last response reported, so it freezes while the session is idle, and
 * none exists before its first response or off a subscription. Of two standing readings of the
 * same window (the same reset), whose use only grows, the higher is the newer; when the window
 * cannot be told apart (no reset reported, another account's), the live one. A reading past its
 * reset no longer applies (the engine drops it too, until the next response): null.
 */
export function freshestQuota(live: Quota | undefined, cached: CachedQuota | undefined, now: number): Quota | CachedQuota | null {
  const standing = live !== undefined && (live.resetsAt === undefined || live.resetsAt > now) ? live : undefined
  const recorded = cached !== undefined && cached.resetsAt > now ? cached : undefined
  if (standing && recorded) {
    const isSameWindow = standing.resetsAt !== undefined && Math.abs(standing.resetsAt - recorded.resetsAt) < SAME_RESET_MS
    return isSameWindow && recorded.pct > standing.pct ? recorded : standing
  }
  return standing ?? recorded ?? null
}

/** A window as shown: `freshestQuota`'s reading, with its age when it is a recorded one. */
function boardQuota(
  live: Quota | undefined,
  cached: CachedQuota | undefined,
  now: number,
  clock: (at: number) => string,
): BoardQuota | null {
  const quota = freshestQuota(live, cached, now)
  if (!quota) return null
  return {
    pct: quota.pct,
    tone: severityTone(quota.pct),
    left: quota.resetsAt === undefined ? null : formatCountdown(quota.resetsAt - now),
    at: quota.resetsAt === undefined ? null : clock(quota.resetsAt),
    age: 'observedAt' in quota ? formatAge(now - quota.observedAt) : null,
  }
}

/** How long ago, coarsely: `<1m`, `12m`, `2h`, `3d`. */
export function formatAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

/** The person's prompts as shown: null while undecided, `—` or `≥N` when earlier ones are unknown. */
export function promptsText(base: Status['promptBase'], counted: number): string | null {
  if (!base) return null
  const total = base.n + counted
  if (base.isExact) return String(total)
  return total > 0 ? `≥${total}` : '—'
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** A `prompts:<sessionId>` store value, or null when it is not one this version wrote. */
export function parsePromptRecord(value: unknown): PromptRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.v !== 1 || !isCount(record.n) || typeof record.isExact !== 'boolean') return null
  return { v: 1, n: Math.floor(record.n), isExact: record.isExact }
}

function parseCachedQuota(value: unknown): CachedQuota | undefined {
  if (!value || typeof value !== 'object') return undefined
  const q = value as Record<string, unknown>
  return isCount(q.pct) && isCount(q.resetsAt) && isCount(q.observedAt)
    ? { pct: q.pct, resetsAt: q.resetsAt, observedAt: q.observedAt }
    : undefined
}

/** The `quota` store value, or null when it is not one this version wrote. */
export function parseQuotaRecord(value: unknown): QuotaRecord | null {
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>).v !== 1) return null
  const record = value as Record<string, unknown>
  const five = parseCachedQuota(record.five)
  const seven = parseCachedQuota(record.seven)
  return { v: 1, ...(five ? { five } : {}), ...(seven ? { seven } : {}) }
}

/**
 * The record after a live reading at `now`: each live window with a reset replaces the stored one;
 * a window the reading lacks keeps the stored entry only while that one stands.
 */
export function mergeQuota(stored: QuotaRecord | null, live: Usage, now: number): QuotaRecord {
  const merged: QuotaRecord = { v: 1 }
  for (const key of ['five', 'seven'] as const) {
    const window = live[key]
    const kept = stored?.[key]
    if (window && window.resetsAt !== undefined && window.resetsAt > now) {
      merged[key] = { pct: window.pct, resetsAt: window.resetsAt, observedAt: now }
    } else if (kept && kept.resetsAt > now) {
      merged[key] = kept
    }
  }
  return merged
}

/** Compactions as shown: the base is the count before the mod began, null when it cannot know. */
function compactionsText(base: number | null | undefined, counted: number): string {
  if (typeof base === 'number') return String(base + counted)
  return counted > 0 ? `≥${counted}` : '—'
}

/** The dashboard's dollars: the same estimate as `formatUsd`, without the `~` its blocks have no room for. */
const boardUsd = (usd: number) => formatUsd(usd).replace('~', '')

export function board(status: Status, now: number): Board {
  const { usage, prompt } = status
  // The status line capture when there is one (the terminal); else what the mod tracked itself.
  const state: TrackedCacheState | null = status.cache ? cacheState(status.cache, now) : trackedCacheState(status, now)
  const cost = prompt ? promptCost(prompt, usage.costUsd) : undefined
  return {
    context: {
      meter: usage.ctx === undefined ? null : { pct: usage.ctx, tone: severityTone(usage.ctx) },
      tokens:
        usage.ctxTokens !== undefined && usage.ctxWindow !== undefined
          ? `${formatTokens(usage.ctxTokens)}/${formatTokens(usage.ctxWindow)}`
          : null,
      cache: state && {
        left: state.label === 'Cold' ? null : `${state.isEstimate ? '~' : ''}${formatCountdown(state.remainingMs)}`,
        isWarm: state.label !== 'Cold',
        tone: state.label === 'Warm' ? null : state.tone,
      },
      compactions: compactionsText(status.compactionBase, status.compactions ?? 0),
    },
    // The same `Prompt` / `Last` / `Last ✕` as the terminal's activity row.
    last: prompt
      ? {
          label: prompt.phase === 'running' ? 'Prompt' : prompt.phase === 'aborted' ? 'Last ✕' : 'Last',
          time: formatDuration(promptElapsed(prompt, now)),
          cost: cost === undefined ? null : boardUsd(cost),
        }
      : { label: 'Last', time: null, cost: null },
    session: {
      prompts: promptsText(status.promptBase, status.promptCount ?? 0),
      time: usage.startedAt === undefined ? null : formatCountdown(now - usage.startedAt),
      cost: usage.costUsd === undefined ? null : boardUsd(usage.costUsd),
    },
    five: boardQuota(usage.five, status.quotaCache?.five, now, at => formatClock(at, now)),
    seven: boardQuota(usage.seven, status.quotaCache?.seven, now, formatDayClock),
  }
}

/** Advances at 15 px semibold in the panel's font as Windows draws it (Segoe UI), measured there. */
const FIGURE_GLYPHS: Record<string, number> = {
  '0': 8.33, '1': 6.04, '2': 8.33, '3': 8.33, '4': 8.64, '5': 8.33, '6': 8.37, '7': 8.04, '8': 8.33, '9': 8.37,
  '%': 12.6, h: 8.73, d: 9.04,
}
export const FIGURE_HEIGHT = 20

/**
 * A 15 px semibold figure (`77%`, `5h`) as a picture: the panel's Text takes no size or weight
 * but bold. The panel hands a picture its font and text color (`currentColor`); a severity color
 * takes a little of it, darker on a light theme and lighter on a dark one, as it sits on a meter's
 * gray fill. The baseline matches the 13 px text centered beside it. Sized to the text as Segoe UI
 * draws it, and `textLength` holds a wider font to that width rather than let it clip. Faded when
 * cached.
 */
export function figureSvg(text: string, color: string | null, isFaded = false): { source: string; width: number } {
  const length = [...text].reduce((sum, ch) => sum + (FIGURE_GLYPHS[ch] ?? 9), 0)
  const width = Math.ceil(length + 0.5)
  const fill = color === null ? 'fill="currentColor"' : `fill="${color}" style="fill:color-mix(in srgb,${color} 78%,currentColor)"`
  return {
    width,
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${FIGURE_HEIGHT}" width="${width}" height="${FIGURE_HEIGHT}">` +
      `<text x="0.25" y="15.4" font-size="15" font-weight="600" textLength="${length.toFixed(2)}" lengthAdjust="spacingAndGlyphs" ` +
      `${fill}${isFaded ? ' fill-opacity="0.55"' : ''}>${text}</text></svg>`,
  }
}

export const ICON_SIZE = 13
const icon = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${ICON_SIZE}" height="${ICON_SIZE}">` +
  `<g fill="none" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
/** The dashboard's icons, line drawings in the panel's text color, softened like its secondary text. */
export const SVG_ICONS = {
  cache: icon('<ellipse cx="8" cy="3.8" rx="5" ry="2"/><path d="M3 3.8v8.4c0 1.1 2.2 2 5 2s5-.9 5-2V3.8M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>'),
  warm: icon('<path d="M8 1.6c.5 2.4 4 3.6 4 7.6a4 4 0 0 1-8 0c0-1.7.8-2.9 1.7-3.7.2 1.3.8 2.1 1.6 2.4C7.1 6 7.3 3.7 8 1.6z"/>'),
  cold: icon('<path d="M4 1.8h8M4 14.2h8M5 1.8v2.3c0 1.7 3 2.4 3 3.9s-3 2.2-3 3.9v2.3M11 1.8v2.3c0 1.7-3 2.4-3 3.9s3 2.2 3 3.9v2.3"/>'),
  prompts: icon('<path d="M2.5 3h11v7.5H7.5L4.5 13v-2.5h-2z"/>'),
} as const

// ---- detail pane ----

export type PaneLine = { label: string; value: string; color?: TTone | 'subtle' }

function quotaLine(label: string, quota: Quota | undefined, now: number): PaneLine {
  if (!quota) return { label, value: 'unavailable (no subscription reading yet)', color: 'subtle' }
  const reset =
    quota.resetsAt !== undefined && quota.resetsAt > now
      ? ` · resets ${formatClock(quota.resetsAt, now)} (in ${formatCountdown(quota.resetsAt - now)})`
      : ''
  return { label, value: `${formatPercent(quota.pct)} used${reset}`, color: quotaTone(quota.pct) }
}

export function paneLines(status: Status, now: number): PaneLine[] {
  const lines: PaneLine[] = []
  const { usage, prompt } = status
  lines.push({
    label: 'Session',
    value:
      usage.startedAt === undefined
        ? 'unknown'
        : `${formatCountdown(now - usage.startedAt)}${usage.costUsd !== undefined ? ` · ${formatUsd(usage.costUsd)}` : ''}`,
  })
  if (prompt) {
    const cost = promptCost(prompt, usage.costUsd)
    const phase = prompt.phase === 'running' ? 'running' : prompt.phase === 'aborted' ? 'interrupted' : 'done'
    lines.push({
      label: prompt.phase === 'running' ? 'Prompt' : 'Last',
      value: `${formatDuration(promptElapsed(prompt, now))}${cost !== undefined ? ` · ${formatUsd(cost)}` : ''} · ${phase}`,
    })
  } else {
    lines.push({ label: 'Prompt', value: 'none yet', color: 'subtle' })
  }
  lines.push({ label: 'Cost', value: '~$ is the API-equivalent estimate, not your bill', color: 'subtle' })
  const model = status.model ? shortModel(status.model) : 'unknown'
  const effort = status.hasEffort ? ` · effort ${status.effort ?? 'unknown'}` : ' · no effort setting'
  lines.push({ label: 'Model', value: `${model}${status.model && model !== status.model ? ` (${status.model})` : ''}${effort}` })
  lines.push(
    usage.ctx === undefined
      ? { label: 'Context', value: 'unknown until the first response', color: 'subtle' }
      : { label: 'Context', value: `${formatPercent(usage.ctx)} used`, color: contextTone(usage.ctx) },
  )
  lines.push(quotaLine('5-hour', freshestQuota(usage.five, status.quotaCache?.five, now) ?? undefined, now))
  lines.push(quotaLine('7-day', freshestQuota(usage.seven, status.quotaCache?.seven, now) ?? undefined, now))
  const state = status.cache ? cacheState(status.cache, now) : null
  if (status.cache && !state) {
    lines.push({ label: 'Cache', value: 'unknown (no confirmed expiry reported yet)', color: 'subtle' })
  } else if (status.cache && state) {
    const parts = [
      state.label === 'Cold' ? 'cold' : `${state.label.toLowerCase()} · ${formatCountdown(state.remainingMs)} left`,
      status.cache.expiresAt !== null && state.label !== 'Cold' ? `expires ${formatClock(status.cache.expiresAt, now)}` : null,
      status.cache.ttl ? `TTL ${status.cache.ttl}` : null,
      status.cache.hitRatio !== null ? `hit ${Math.round(status.cache.hitRatio * 100)}%` : null,
    ]
    lines.push({ label: 'Cache', value: parts.filter(Boolean).join(' · '), color: state.tone })
  } else {
    lines.push({
      label: 'Cache',
      value: status.hasCacheSource ?'unknown until the first response' : 'unavailable (nth-status status line not installed)',
      color: 'subtle',
    })
  }
  lines.push(
    status.isRemote
      ? { label: 'Remote', value: `client attached (${status.remoteSurfaces.join(', ')})`, color: 'success' }
      : { label: 'Remote', value: 'no Remote Control client attached', color: 'subtle' },
  )
  return lines
}

/** A plain-text summary of what the pane shows, for Actions → Session info. */
export function sessionInfo(status: Status, now: number): string {
  const head = ['nth-status', status.folder, status.branch?.name].filter(Boolean).join(' · ')
  const lines = paneLines(status, now)
    .filter(line => line.label !== 'Cost')
    .map(line => `${line.label}: ${line.value}`)
  return [head, ...lines, `Agents: ${status.agents.length} running`].join('\n')
}

// ---- copy ----

type ApiBlock = { type: string; [field: string]: unknown }
type ApiLike = { role: string; content: readonly ApiBlock[] }

const isText = (block: ApiBlock, pattern: RegExp) => block.type === 'text' && typeof block.text === 'string' && pattern.test(block.text)
const INTERRUPT_MARK = /^\s*\[Request interrupted by user/
const isInterruptMark = (message: ApiLike) => message.content.some(block => isText(block, INTERRUPT_MARK))

/**
 * A user row the model was never asked to answer: an interrupt mark is its last block, reminders
 * aside. What follows it is the engine's filler (`No response requested.`); a prompt typed after
 * an interrupt joins the same row and comes after the mark.
 */
function endsOnInterrupt(message: ApiLike): boolean {
  const last = message.content.filter(block => !isText(block, /^\s*<system-reminder>/)).at(-1)
  return last !== undefined && isText(last, INTERRUPT_MARK)
}

/**
 * The latest completed response, as Markdown, from the conversation history
 * (`$.session.messages({ as: "api" })`): the model's final answer, which is what the built-in
 * `/copy` copies. That is the last assistant message before a user row (or the end) that calls
 * no tool: its text blocks in order, a blank line between them, thinking left out (consecutive
 * assistant messages count as one, so a split answer is copied whole). Text written before a
 * tool call is progress, not the answer. Whatever opened the turn, the person's prompt or an
 * engine notice such as a subagent's hand-back, makes no difference; the main conversation holds
 * no subagent transcript. An answer still calling tools, or one an interrupt mark follows, is
 * not complete, and the engine's filler after an interrupt is no answer: the one before is
 * tried. '' when none qualifies.
 */
export function lastResponse(messages: readonly ApiLike[]): string {
  let end = messages.length
  while (end > 0) {
    while (end > 0 && messages[end - 1]!.role !== 'assistant') end--
    let start = end
    while (start > 0 && messages[start - 1]!.role === 'assistant') start--
    const answer = messages.slice(start, end)
    const interrupted = end < messages.length && isInterruptMark(messages[end]!)
    const filler = start > 0 && endsOnInterrupt(messages[start - 1]!)
    const complete = !interrupted && !filler && !answer.some(message => message.content.some(block => block.type === 'tool_use'))
    const text = complete
      ? answer
          .flatMap(message => message.content)
          .filter(block => block.type === 'text' && typeof block.text === 'string')
          .map(block => (block.text as string).trim())
          .filter(Boolean)
          .join('\n\n')
      : ''
    if (text) return text
    end = start
  }
  return ''
}

export type CodeBlock = { lang: string; code: string }

/** Fenced code blocks (``` or ~~~, three or more) in Markdown; an unclosed fence runs to the end. */
export function codeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let open: { char: string; size: number; lang: string; lines: string[] } | null = null
  for (const line of markdown.split(/\r?\n/)) {
    if (!open) {
      // A backtick fence's info string holds no backtick (else the line is inline code).
      const start = /^ {0,3}(?:(`{3,})([^`]*)|(~{3,})(.*))$/.exec(line)
      if (start) {
        const fence = start[1] ?? start[3]!
        const lang = (start[2] ?? start[4] ?? '').trim().split(/\s+/)[0] ?? ''
        open = { char: fence[0]!, size: fence.length, lang, lines: [] }
      }
      continue
    }
    const fence = open.char === '`' ? '`' : '~'
    if (new RegExp(`^ {0,3}${fence}{${open.size},}\\s*$`).test(line)) {
      blocks.push({ lang: open.lang, code: open.lines.join('\n') })
      open = null
    } else {
      open.lines.push(line)
    }
  }
  if (open) blocks.push({ lang: open.lang, code: open.lines.join('\n') })
  return blocks
}

export type AgentLine = { key: string; name: string; model: string; status: string; elapsed: string }

export function agentLines(status: Status, now: number): AgentLine[] {
  return status.agents.map(agent => ({
    key: agent.id,
    name: agent.name,
    model: agent.model ? shortModel(agent.model) : '—',
    status: agent.status,
    elapsed: `${agent.isEstimated ? '≥' : ''}${formatDuration(now - agent.startedAt)}`,
  }))
}
