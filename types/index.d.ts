export type TPromptPhase = 'running' | 'done' | 'aborted'

export type TCacheSource = 'statusline'

export type Quota = {
  /** Percent of the window used, 0-100. */
  pct: number
  /** Epoch milliseconds when the window resets. */
  resetsAt?: number
}

export type Usage = {
  ctx?: number
  /** Tokens the last response was answered over, and the model's window. */
  ctxTokens?: number
  ctxWindow?: number
  five?: Quota
  seven?: Quota
  /** Session total, API-equivalent US dollars. */
  costUsd?: number
  /** When the session's figures count from, epoch milliseconds. */
  startedAt?: number
}

export type PromptRun = {
  phase: TPromptPhase
  startedAt: number
  durationMs?: number
  /** Session cost when the prompt started; the prompt's cost is the delta. */
  costAtStart?: number
  costUsd?: number
}

export type Cache = {
  source: TCacheSource
  isWarm: boolean
  /** Epoch milliseconds when the cached prefix goes cold; null when nothing is cached. */
  expiresAt: number | null
  /** The engine saw this session cache a prefix (`caching_observed`); null when not reported. */
  isObserved?: boolean | null
  ttl: string | null
  hitRatio: number | null
}

/** A main-thread request whose usage the engine reported, as the VS Code dashboard tracks the cache. */
export type CacheSeen = {
  /** Epoch milliseconds just before the request went out: its entry lives from no later than this. */
  at: number
  /** Epoch milliseconds when its usage arrived: its entry was read or written no later than this. */
  doneAt?: number
  /** The model the request named (`turn.step`'s `model`). */
  stepModel: string
  /** The `promptCacheTtl` setting at the request; null when not set, so the TTL is unknown. */
  ttl: '5m' | '1h' | null
  /** Requests under this session model named different models (a plan mode, a fallback). */
  isMixed?: boolean
  /** The usage reported no cache read or write: caching off, or not reported. */
  isUncached?: boolean
}

/**
 * The main conversation's prompt cache as the mod saw it, where no status line capture arrives;
 * dropped by anything seen to change the cached prefix (compaction, a plugin reload, `/clear`).
 */
export type CacheTrack = {
  /** The last request under each session model (as `Status.model`), none older than an hour. */
  seen: Record<string, CacheSeen>
  /**
   * Epoch milliseconds when the session's latest request of any kind ended (a subagent's, one with
   * no usage): any may have renewed the entry, so none can be cold within an hour of it.
   */
  lastStepAt?: number
}

/** A live window as recorded for later sessions: its reading, its reset and when it was seen. */
export type CachedQuota = {
  pct: number
  /** Epoch milliseconds; a reading is never shown at or after it. */
  resetsAt: number
  /** Epoch milliseconds of the `session.measure` that carried it. */
  observedAt: number
}

/** `$.store` key `prompts:<sessionId>`: the person's prompts in that session so far. */
export type PromptRecord = { v: 1; n: number; isExact: boolean }

/** `$.store` key `quota`: the last live windows of this config home. */
export type QuotaRecord = { v: 1; five?: CachedQuota; seven?: CachedQuota }

export type Spawn = {
  model: string
  startedAt: number
}

export type AgentRow = {
  id: string
  name: string
  status: string
  model?: string
  /** From the spawn; else when first seen running (`isEstimated`). */
  startedAt: number
  isEstimated: boolean
}

export type ModelRow = {
  /** The `/config` Model row's value (an alias). */
  value: string
  options: string[]
  isLocked: boolean
}

export type Status = {
  v: 1
  sessionId: string
  /** The session's working directory, the whole path. */
  folder: string | null
  branch: { name: string; isWorktree: boolean } | null
  /** The main loop's model id, as `/model` shows it. */
  model: string | null
  modelRow: ModelRow | null
  /** The main loop's effort from its last request; null while unknown. */
  effort: string | null
  /** False once a main-loop request went out without effort (the model takes none). */
  hasEffort: boolean
  usage: Usage
  prompt: PromptRun | null
  agents: AgentRow[]
  spawns: Record<string, Spawn>
  /** A Remote Control client is attached to this terminal session. */
  isRemote: boolean
  remoteSurfaces: string[]
  /** The settings' status line is the nth-status capture script, so a cache reading can arrive. */
  hasCacheSource: boolean
  cache: Cache | null
  /**
   * The person's prompts before this process counted any: from this session's store record, or
   * 0, exact for a session that began empty; inexact (earlier prompts unknown) otherwise. Absent
   * until decided, once per session.
   */
  promptBase?: { n: number; isExact: boolean }
  /** The person's prompts counted on top of `promptBase`. */
  promptCount?: number
  /** The last live 5h and 7d readings this config home recorded, from its store. */
  quotaCache?: { five?: CachedQuota; seven?: CachedQuota }
  /** Main-conversation compactions that stood since the mod began counting; absent: none yet. */
  compactions?: number
  /**
   * Compactions before the mod began counting: 0 when the session started with an empty
   * conversation, null when it already had one (resumed, forked, or the mod loaded later), so
   * earlier compactions are unknown; absent until decided.
   */
  compactionBase?: number | null
  /** The main conversation's cache as tracked from its requests; absent until one reported usage. */
  cacheTrack?: CacheTrack
}

declare module 'claude-code' {
  interface PluginState {
    'nth-status': { status: Status | null }
  }
}
