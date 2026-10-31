import { describe, expect, test } from 'claude-code/testing'

import {
  board,
  ICONS,
  cliLayout,
  CLI_INSET,
  inkOf,
  panelFill,
  ZONE_BORDER,
  ZONE_GAP,
  ZONE_MARGIN,
  zoneColors,
  formatAge,
  freshestQuota,
  mergeQuota,
  paneLines,
  noteCacheStep,
  paintRow,
  parseCacheTtl,
  parsePromptRecord,
  parseQuotaRecord,
  promptsText,
  cacheState,
  codeBlocks,
  contextLevel,
  emptyStatus,
  figureSvg,
  fit,
  formatCountdown,
  formatDayClock,
  formatDuration,
  formatTokens,
  formatUsd,
  fromUsage,
  layout,
  parseCapture,
  promptCost,
  quotaLevel,
  lastResponse,
  runningAgents,
  sessionInfo,
  shortModel,
  shortPath,
  upgrade,
  vscodeColor,
} from '../hooks/status'
import type { Row } from '../hooks/status'
import type { CacheSeen, Status } from '../types'

const NOW = 1_800_000_000_000
const MIN = 60_000

describe('formatting', () => {
  test('model names', async () => {
    expect(shortModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(shortModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 1M')
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(shortModel('custom-model')).toBe('custom-model')
  })

  test('durations, countdowns and dollars', async () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(12 * MIN + 34_000)).toBe('12m34s')
    expect(formatDuration(131 * MIN)).toBe('2h11m')
    expect(formatDuration((3 * 24 + 4) * 60 * MIN)).toBe('3d4h')
    expect(formatCountdown(150 * MIN)).toBe('2h30m')
    expect(formatCountdown(17 * MIN + 59_000)).toBe('17m')
    expect(formatCountdown(30_000)).toBe('<1m')
    expect(formatUsd(0.854)).toBe('~$0.85')
    expect(formatUsd(123.4)).toBe('~$123')
  })

  test('threshold colors', async () => {
    expect([0, 49, 50, 64, 65, 79, 80, 100].map(contextLevel)).toEqual(['normal', 'normal', 'notice', 'notice', 'warning', 'warning', 'critical', 'critical'])
    expect([0, 59, 60, 74, 75, 84, 85, 100].map(quotaLevel)).toEqual(['normal', 'normal', 'notice', 'notice', 'warning', 'warning', 'critical', 'critical'])
    // By the percentage as shown: 49.6 % reads `50%`.
    expect([contextLevel(49.4), contextLevel(49.6)]).toEqual(['normal', 'notice'])
  })

  test('VS Code colors: severity kept readable, faint or unknown keys replaced', async () => {
    expect(['success', 'warning', 'error'].map(tone => vscodeColor(tone as never))).toEqual(['success', 'yellow', 'error'])
    expect([vscodeColor('subtle'), vscodeColor('merged'), vscodeColor('suggestion'), vscodeColor(undefined)]).toEqual([
      'inactive',
      undefined,
      undefined,
      undefined,
    ])
  })

  test('VS Code dashboard: tokens, weekday clock, the large figures', async () => {
    expect([950, 184_321, 999_499, 999_500, 1_000_000, 1_500_000].map(formatTokens)).toEqual(['950', '184k', '999k', '1M', '1M', '1.5M'])
    expect(formatDayClock(new Date(2026, 10, 2, 9, 5).getTime())).toBe('Mon 09:05')
    // Sized to the text as Segoe UI draws it at 15 px semibold, held to that length in another font.
    const pct = figureSvg('77%', 'notice')
    expect(pct.width).toBe(30)
    expect(pct.source).toContain('textLength="28.68" lengthAdjust="spacingAndGlyphs"')
    expect(pct.source).toContain('font-size="15" font-weight="600"')
    // A level takes the palette's light or dark color by the panel's text color, with a plain fallback;
    // a label the main text's the same way.
    const dark = 'clamp(0, (r - 128) * 255, 1)'
    expect(pct.source).toContain(`fill="#bf8700" style="fill:rgb(from currentColor calc(119 + 136 * ${dark}) calc(83 + 141 * ${dark}) calc(0 + 117 * ${dark}))"`)
    expect(pct.source).toContain('>77%</text>')
    expect(pct.source).not.toContain('fill-opacity')
    expect(figureSvg('5h', null).source).toContain(`fill="currentColor" style="fill:rgb(from currentColor calc(23 + 220 * ${dark})`)
    expect(figureSvg('100%', 'critical').width).toBe(36)
    expect(figureSvg('20%', 'normal', true).source).toContain('fill-opacity="0.55"')
  })
})

const cellsOf = (runs: { text: string }[]) => runs.reduce((sum, run) => sum + [...run.text].reduce((n, ch) => n + (/\p{Emoji_Presentation}/u.test(ch) ? 2 : 1), 0), 0)

describe('terminal zones', () => {
  test('a wide character counts two cells, and a fill never splits one', async () => {
    const row = { key: 'cache', left: [{ text: 'DB' }, { text: ' ' }, { text: '🔥' }], right: [], meter: 25 }
    const painted = paintRow(row, 12, '#t', '#f')
    expect(painted.map(run => run.text).join('')).toBe(' DB 🔥      ')
    expect(cellsOf(painted)).toBe(12)
    // Three of twelve cells filled: the padding and `DB`.
    expect(painted.filter(run => run.bg === '#f').map(run => run.text).join('')).toBe(' DB')
    // Five would end inside the flame: it stays out, whole.
    expect(paintRow({ ...row, meter: 42 }, 12, '#t', '#f').filter(run => run.bg === '#f').map(run => run.text).join('')).toBe(' DB ')
  })

  test('a row painted cell by cell: padding, figures at both edges, a meter under its first cells', async () => {
    const row = { key: 'five', left: [{ text: '5h', isBold: true }], right: [{ text: '50%', color: 'warning' as const }], meter: 50 }
    const painted = paintRow(row, 20, '#tint', '#fill')
    expect(painted.map(run => run.text).join('')).toBe(' 5h             50% ')
    // Ten of twenty cells filled: the split falls inside the gap.
    expect(painted.map(run => [run.text, run.bg])).toEqual([
      [' ', '#fill'],
      ['5h', '#fill'],
      ['       ', '#fill'],
      ['      ', '#tint'],
      ['50%', '#tint'],
      [' ', '#tint'],
    ])
    expect(painted.find(run => run.text === '50%')?.color).toBe('warning')
    // A fill splits a figure it reaches into; 1 % still shows a cell, 0 % none; no fill color, no meter.
    expect(paintRow({ ...row, meter: 90 }, 20, '#t', '#f').filter(run => run.bg === '#f').map(run => run.text).join('')).toBe(' 5h             50')
    expect(paintRow({ ...row, meter: 1 }, 20, '#t', '#f').filter(run => run.bg === '#f').map(run => run.text).join('')).toBe(' ')
    expect(paintRow({ ...row, meter: 0 }, 20, '#t', '#f').some(run => run.bg === '#f')).toBe(false)
    expect(paintRow(row, 20).every(run => run.bg === undefined)).toBe(true)
  })

  test('the zones, their borders, gaps and margins fill the width; too narrow for them: none', async () => {
    const status = { ...emptyStatus('S'), folder: '/work/app', model: 'claude-opus-5-5' }
    const now = 1_000_000
    for (const columns of [71, 80, 100, 180]) {
      const cli = cliLayout(status, now, columns)!
      const inside = cli.zones.reduce((sum, zone) => sum + zone.width + ZONE_BORDER, 0)
      expect(inside + 2 * ZONE_GAP + 2 * ZONE_MARGIN).toBe(columns)
    }
    expect(cliLayout(status, now, 70)).toBeNull()
    // The header keeps to its margin, its controls in it however long the path.
    const fitted = cliLayout({ ...status, folder: `/${'long/'.repeat(40)}app` }, now, 71)!
    expect(fitted.header.right.map(seg => seg.text)).toEqual(['Opus 5.5 ▾', 'Effort ▾', '[ Copy ]', '[ ≡ ]'])
    const used = fitted.header.groups.flat().concat(fitted.header.right).reduce((sum, seg) => sum + seg.text.length + 1, -1)
    expect(used).toBeLessThanOrEqual(71 - 2 * CLI_INSET)
    // Nothing for the footer: no footer. An agent at work: there it is.
    expect(cliLayout(status, now, 100)!.footer).toBeNull()
    const agents = [{ id: 'a', name: 'x', status: 'running', startedAt: now, isEstimated: false }]
    expect(cliLayout({ ...status, agents }, now, 100)!.footer?.right.map(seg => seg.text)).toEqual(['1 agent'])
  })

  test('a meter names its level beside its percentage', async () => {
    const status = { ...emptyStatus('S'), usage: { ctx: 72, five: { pct: 84, resetsAt: 9_000_000 }, seven: { pct: 85, resetsAt: 9_000_000 } } }
    const zones = cliLayout(status, 1_000_000, 100)!.zones
    const row = (key: string) => zones.flatMap(zone => zone.rows).find(found => found.key === key)!
    expect([row('context-use').level, row('five').level, row('seven').level]).toEqual(['warning', 'warning', 'critical'])
    expect(row('context-use').left[0]?.level).toBe('warning')
    expect(row('seven').right[0]?.level).toBe('critical')
  })

  test('band colors per theme family; none where the theme is unknown, automatic or ANSI-only', async () => {
    for (const theme of ['light', 'light-daltonized', 'dark', 'dark-daltonized']) {
      expect(panelFill(theme)).toBeDefined()
      expect(zoneColors(theme)?.borders.context).toBeDefined()
    }
    for (const theme of ['auto', 'light-ansi', 'dark-ansi', 'custom:mine', undefined]) {
      expect(panelFill(theme)).toBeUndefined()
      expect(zoneColors(theme)).toBeUndefined()
    }
  })

  test('a run’s color: the band’s ink on a fill, a darker tone where the theme’s is faint, a level’s own', async () => {
    const light = zoneColors('light')
    expect(inkOf({}, light)).toBe('#172334')
    expect(inkOf({ isDim: true }, light)).toBe('#46546f')
    expect(inkOf({ color: 'warning' }, light)).toBe('#7a5600')
    expect(inkOf({ color: 'error' }, light)).toBe('error')
    expect(inkOf({ color: 'warning' }, zoneColors('light-daltonized'))).toBe('#8a4f00')
    expect(inkOf({ color: 'success' }, zoneColors('light-daltonized'))).toBe('success')
    expect(inkOf({ color: 'warning' }, zoneColors('dark'))).toBe('warning')
    expect(inkOf({}, zoneColors('dark'))).toBe('#f3f6fa')
    // A level outranks a color.
    expect(inkOf({ level: 'critical', color: 'success' }, light)).toBe('#a11e33')
    expect(inkOf({ level: 'normal' }, zoneColors('dark'))).toBe('#73e9ad')
    // No fill: the terminal's foreground is right, whatever its background; a level as a theme key.
    expect(inkOf({}, undefined)).toBeUndefined()
    expect(inkOf({ color: 'warning' }, undefined)).toBe('warning')
    expect((['normal', 'notice', 'warning', 'critical'] as const).map(level => inkOf({ level }, undefined))).toEqual(['success', 'warning', 'claude', 'error'])
  })

  test('the levels are the approved palette, exactly', async () => {
    const pairs = (theme: string) => (['normal', 'notice', 'warning', 'critical'] as const).map(level => [zoneColors(theme)!.levels[level].fill, zoneColors(theme)!.levels[level].text])
    expect(pairs('light')).toEqual([['#c5e8d3', '#11623e'], ['#f7e9af', '#775300'], ['#f6ceab', '#91430f'], ['#f2c1c7', '#a11e33']])
    expect(pairs('dark')).toEqual([['#285743', '#73e9ad'], ['#645326', '#ffe075'], ['#754825', '#ffb26d'], ['#73343c', '#ff8d9a']])
    expect([zoneColors('light')!.ink, zoneColors('dark')!.ink]).toEqual(['#172334', '#f3f6fa'])
  })

  test('the cache icon is the bare drum: one code point, no emoji selector, which would change its width', async () => {
    expect([...ICONS.cache].map(char => char.codePointAt(0))).toEqual([0x1f6e2])
  })

  test('every level stands out from its panel: percentages readable on the fill and off it', async () => {
    const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
    const lum = (hex: string) => [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16))).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0)
    const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    for (const theme of ['light', 'light-daltonized', 'dark', 'dark-daltonized']) {
      const colors = zoneColors(theme)!
      for (const { fill, text } of Object.values(colors.levels)) {
        expect(contrast(text, fill)).toBeGreaterThanOrEqual(4.1)
        expect(contrast(colors.ink, fill)).toBeGreaterThanOrEqual(6.9)
        expect(contrast(colors.muted, fill)).toBeGreaterThanOrEqual(4.5)
        for (const tint of [colors.context, colors.meta, colors.quota, panelFill(theme)!]) expect(contrast(text, tint)).toBeGreaterThanOrEqual(6)
      }
    }
  })
})

describe('figures', () => {
  test('the VS Code board shows what is known and nothing more', async () => {
    const empty = board(emptyStatus('S1'), NOW)
    // Nothing decided about earlier compactions yet: unknown, not 0.
    expect(empty.context).toEqual({ meter: null, tokens: null, cache: null, compactions: '—' })
    expect(empty.last).toEqual({ label: 'Last', time: null, cost: null })
    expect(empty.session).toEqual({ prompts: null, time: null, cost: null })
    expect([empty.five, empty.seven]).toEqual([null, null])
    const status = {
      ...emptyStatus('S1'),
      usage: { ctx: 75, ctxTokens: 150_000, ctxWindow: 200_000, five: { pct: 95 }, seven: { pct: 10, resetsAt: NOW - MIN } },
      prompt: { phase: 'running' as const, startedAt: NOW - 65_000 },
      promptBase: { n: 1, isExact: true },
      promptCount: 2,
      compactions: 2,
      compactionBase: 0,
    }
    const shown = board(status, NOW)
    expect(shown.context).toEqual({ meter: { pct: 75, level: 'warning' }, tokens: '150k/200k', cache: null, compactions: '2' })
    expect(shown.last).toEqual({ label: 'Prompt', time: '1m05s', cost: null })
    expect(shown.session.prompts).toBe('3')
    // The same estimate as the terminal's, without its `~`.
    expect(board({ ...status, usage: { ...status.usage, costUsd: 8.42 } }, NOW).session.cost).toBe('$8.42')
    // No reset reported: the figure without a countdown. A reset already past: no reading at all.
    expect(shown.five).toEqual({ pct: 95, level: 'critical', left: null, at: null, age: null })
    expect(shown.seven).toBeNull()
    // Earlier compactions unknown: what was counted, as a floor.
    expect(board({ ...status, compactionBase: null }, NOW).context.compactions).toBe('≥2')
    expect(board({ ...status, compactionBase: null, compactions: 0 }, NOW).context.compactions).toBe('—')
    expect(board({ ...status, compactionBase: 3, compactions: 0 }, NOW).context.compactions).toBe('3')
  })

  test('the cache tracked without a capture: warm with an estimated time left, cold an hour after its last use', async () => {
    const OPUS = 'claude-opus-5-5'
    const seen = (at: number, over: Partial<CacheSeen> = {}): CacheSeen => ({ at, doneAt: at, stepModel: OPUS, ttl: null, ...over })
    const cacheAt = (status: Status, ms: number) => board(status, NOW + ms).context.cache
    const base: Status = { ...emptyStatus('S1'), model: OPUS }
    const track = noteCacheStep(undefined, OPUS, seen(NOW), NOW)
    const warm: Status = { ...base, cacheTrack: track }
    const COLD = { left: null, isWarm: false, tone: 'warning' }
    // Nothing seen: unknown. Seen: an estimate from the 5-minute TTL, then unknown while the TTL
    // could still be the hour, then cold once no TTL could keep it.
    expect(cacheAt(base, 0)).toBeNull()
    expect(cacheAt(warm, 30_000)).toEqual({ left: '~4m', isWarm: true, tone: null })
    expect(cacheAt(warm, 4 * MIN)).toEqual({ left: '~1m', isWarm: true, tone: null })
    expect(cacheAt(warm, 4 * MIN + 1)).toBeNull()
    expect(cacheAt(warm, 60 * MIN - 1)).toBeNull()
    expect(cacheAt(warm, 60 * MIN)).toEqual(COLD)
    expect(cacheAt(warm, 24 * 60 * MIN)).toEqual(COLD)
    // Timed from when its usage arrived, not when it went out: a long answer keeps it warm longer.
    const slow: Status = { ...base, cacheTrack: noteCacheStep(undefined, OPUS, seen(NOW, { doneAt: NOW + 3 * MIN }), NOW) }
    expect(cacheAt(slow, 61 * MIN)).toBeNull()
    expect(cacheAt(slow, 63 * MIN)).toEqual(COLD)
    // A later request of any kind (a subagent's sharing the prefix, one stopped before its usage)
    // may have renewed it: cold only an hour after that one.
    const renewed: Status = { ...warm, cacheTrack: { ...track, lastStepAt: NOW + 50 * MIN } }
    expect(cacheAt(renewed, 60 * MIN)).toBeNull()
    expect(cacheAt(renewed, 110 * MIN)).toEqual(COLD)
    // An entry recorded without its arrival time (an earlier version's state): never cold.
    const { doneAt: _, ...undated } = seen(NOW)
    expect(cacheAt({ ...base, cacheTrack: noteCacheStep(undefined, OPUS, undated, NOW) }, 24 * 60 * MIN)).toBeNull()
    // The setting's 5 minutes and its hour: estimates as well.
    expect(cacheAt({ ...base, cacheTrack: noteCacheStep(undefined, OPUS, seen(NOW, { ttl: '5m' }), NOW) }, MIN)?.left).toBe('~4m')
    const hour: Status = { ...base, cacheTrack: noteCacheStep(undefined, OPUS, seen(NOW, { ttl: '1h' }), NOW) }
    expect(cacheAt(hour, 30_000)).toEqual({ left: '~59m', isWarm: true, tone: null })
    expect(cacheAt(hour, 59.5 * MIN)).toBeNull()
    // No cache tokens reported, or requests under this model that named another: unknown, however long since.
    const uncached: Status = { ...base, cacheTrack: noteCacheStep(undefined, OPUS, seen(NOW, { isUncached: true }), NOW) }
    expect(cacheAt(uncached, 0)).toBeNull()
    expect(cacheAt(uncached, 2 * 60 * MIN)).toBeNull()
    const mixed = noteCacheStep(track, OPUS, seen(NOW, { stepModel: 'claude-sonnet-5-5' }), NOW)
    expect(mixed.seen[OPUS]?.isMixed).toBe(true)
    expect(cacheAt({ ...base, cacheTrack: mixed }, 0)).toBeNull()
    expect(cacheAt({ ...base, cacheTrack: mixed }, 2 * 60 * MIN)).toBeNull()
    expect(noteCacheStep(mixed, OPUS, seen(NOW + MIN), NOW + MIN).seen[OPUS]?.isMixed).toBe(true)
    // Another session model: nothing seen of its cache, unknown, not cold.
    expect(cacheAt({ ...warm, model: 'claude-sonnet-5-5' }, 0)).toBeNull()
    expect(cacheAt({ ...warm, model: 'claude-sonnet-5-5' }, 2 * 60 * MIN)).toBeNull()
    // Entries past the longest TTL go.
    expect(Object.keys(noteCacheStep(track, 'claude-sonnet-5-5', seen(NOW + 61 * MIN), NOW + 61 * MIN).seen)).toEqual(['claude-sonnet-5-5'])
    // A status line capture, where there is one, is the authority, its Cold included.
    const capture = { source: 'statusline' as const, isWarm: true, expiresAt: NOW + 17 * MIN, ttl: '1h', hitRatio: 0.9 }
    expect(cacheAt({ ...warm, cache: capture }, 0)?.left).toBe('17m')
    expect(cacheAt({ ...warm, cache: { ...capture, expiresAt: NOW - 1 } }, 0)).toEqual({ left: null, isWarm: false, tone: 'warning' })
    expect([parseCacheTtl('5m'), parseCacheTtl('1h'), parseCacheTtl('2h'), parseCacheTtl(undefined)]).toEqual(['5m', '1h', null, null])
  })

  test('the person’s prompts: exact, a floor, unknown, or undecided', async () => {
    expect([0, 59_000, 60_000, 59 * 60_000, 3 * 3_600_000 + 5 * 60_000, 2 * 86_400_000].map(formatAge)).toEqual(['<1m', '<1m', '1m', '59m', '3h', '2d'])
    expect(promptsText(undefined, 4)).toBeNull()
    expect(promptsText({ n: 10, isExact: true }, 2)).toBe('12')
    expect(promptsText({ n: 0, isExact: true }, 0)).toBe('0')
    expect(promptsText({ n: 0, isExact: false }, 3)).toBe('≥3')
    expect(promptsText({ n: 0, isExact: false }, 0)).toBe('—')
    expect(parsePromptRecord({ v: 1, n: 4, isExact: false })).toEqual({ v: 1, n: 4, isExact: false })
    for (const bad of [null, 'x', { v: 2, n: 4, isExact: true }, { v: 1, n: -1, isExact: true }, { v: 1, n: 4 }]) {
      expect(parsePromptRecord(bad)).toBeNull()
    }
  })

  test('cached windows: recorded with their reset, kept only while they stand, the newer reading first', async () => {
    const live = { five: { pct: 30, resetsAt: NOW + 60 * MIN }, seven: { pct: 20 } }
    const stored = { v: 1 as const, seven: { pct: 15, resetsAt: NOW + 1440 * MIN, observedAt: NOW - 5 * MIN } }
    // A live window with a reset replaces; one without a reset is not recorded, the stored one stays.
    expect(mergeQuota(stored, live, NOW)).toEqual({
      v: 1,
      five: { pct: 30, resetsAt: NOW + 60 * MIN, observedAt: NOW },
      seven: stored.seven,
    })
    expect(mergeQuota({ v: 1, five: { pct: 9, resetsAt: NOW - 1, observedAt: NOW - MIN } }, {}, NOW)).toEqual({ v: 1 })
    expect(parseQuotaRecord({ v: 1, five: { pct: 1, observedAt: 2 }, seven: { pct: 3, resetsAt: 4, observedAt: 5 } })).toEqual({
      v: 1,
      seven: { pct: 3, resetsAt: 4, observedAt: 5 },
    })
    expect(parseQuotaRecord({ v: 2 })).toBeNull()
    const base = { ...emptyStatus('S1'), quotaCache: { five: { pct: 40, resetsAt: NOW + 60 * MIN, observedAt: NOW - 12 * MIN } } }
    // Cached, with its age, while no live window stands.
    expect(board(base, NOW).five).toMatchObject({ pct: 40, age: '12m', left: '1h00m' })
    // Both standing, so the same window, whose use only grows: the higher is the newer. A live
    // reading at or above the recorded one wins; an idle session's lower one gives way to the
    // reading another session of this home recorded since.
    expect(board({ ...base, usage: { five: { pct: 50, resetsAt: NOW + 30 * MIN } } }, NOW).five).toMatchObject({ pct: 50, age: null })
    expect(board({ ...base, usage: { five: { pct: 40, resetsAt: NOW + 60 * MIN } } }, NOW).five).toMatchObject({ pct: 40, age: null })
    const idle: Status = { ...base, usage: { five: { pct: 25, resetsAt: NOW + 60 * MIN } } }
    expect(board(idle, NOW).five).toMatchObject({ pct: 40, age: '12m', left: '1h00m' })
    expect(freshestQuota(idle.usage.five, base.quotaCache.five, NOW)).toEqual(base.quotaCache.five)
    // A window that cannot be told the same (no reset reported, another reset): the live reading.
    expect(freshestQuota({ pct: 25 }, base.quotaCache.five, NOW)).toEqual({ pct: 25 })
    expect(freshestQuota({ pct: 25, resetsAt: NOW + 30 * MIN }, base.quotaCache.five, NOW)).toEqual({ pct: 25, resetsAt: NOW + 30 * MIN })
    // The terminal's compact rows and the pane show the same reading.
    expect(layout(idle, NOW, 120).rows.find(r => r.key === 'usage')!.groups.flat().map(s => s.text)).toContain('40%')
    expect(paneLines(idle, NOW).find(line => line.label === '5-hour')?.value).toMatch(/^40% used · resets /)
    // A live window past its reset gives way to a standing cached one; a cached one past its reset is gone.
    expect(board({ ...base, usage: { five: { pct: 99, resetsAt: NOW - MIN } } }, NOW).five).toMatchObject({ pct: 40, age: '12m' })
    expect(board(base, NOW + 61 * MIN).five).toBeNull()
  })

  test('usage keeps only what was reported', async () => {
    expect(fromUsage({ startedAt: 5, context: {}, rateLimits: [] })).toEqual({ startedAt: 5 })
    const usage = fromUsage({
      context: { percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 68, resetsAt: new Date(NOW).toISOString() }],
      cost: { usd: 1 },
    }, { startedAt: 7 })
    expect(usage).toEqual({ startedAt: 7, ctx: 42, five: { pct: 68, resetsAt: NOW }, costUsd: 1 })
  })

  test('prompt cost is the ledger delta while running and frozen once done', async () => {
    expect(promptCost({ phase: 'running', startedAt: 0, costAtStart: 1 }, 1.5)).toBe(0.5)
    expect(promptCost({ phase: 'done', startedAt: 0, costAtStart: 1, costUsd: 0.25 }, 9)).toBe(0.25)
    expect(promptCost({ phase: 'running', startedAt: 0 }, 1.5)).toBeUndefined()
  })

  test('capture is accepted only for this session', async () => {
    const text = JSON.stringify({ session_id: 'S1', prompt_cache: { warm: true, ttl: '5m', expires_at: NOW / 1000, hit_ratio: 0.5 } })
    expect(parseCapture(text, 'S1')).toEqual({ source: 'statusline', isWarm: true, expiresAt: NOW, isObserved: null, ttl: '5m', hitRatio: 0.5 })
    expect(parseCapture(text, 'S2')).toBeNull()
    expect(parseCapture('not json', 'S1')).toBeNull()
    expect(parseCapture(JSON.stringify({ session_id: 'S1' }), 'S1')).toBeNull()
  })

  test('cache warm, expiring and cold; cold only when confirmed', async () => {
    const cache = { source: 'statusline' as const, isWarm: true, expiresAt: NOW + 17 * MIN, isObserved: true, ttl: '1h', hitRatio: null }
    expect(cacheState(cache, NOW)?.label).toBe('Warm')
    expect(cacheState(cache, NOW + 16.5 * MIN)?.label).toBe('Expiring')
    expect(cacheState(cache, NOW + 18 * MIN)?.label).toBe('Cold')
    expect(cacheState({ ...cache, isWarm: false, expiresAt: null }, NOW)?.label).toBe('Cold')
    // Unknown, never Cold: no expiry to count down, or a cold flag for a cache never seen.
    expect(cacheState({ ...cache, expiresAt: null }, NOW)).toBeNull()
    expect(cacheState({ ...cache, isWarm: false, expiresAt: null, isObserved: null }, NOW)).toBeNull()
    expect(cacheState({ ...cache, isWarm: false, expiresAt: null, isObserved: false }, NOW)).toBeNull()
  })

  test('agents at work (pending, running, waiting on their own background work) count; idle and ended do not', async () => {
    const list = [
      { id: 'a', status: 'running', description: 'A', type: 'Explore' },
      { id: 'b', status: 'idle', description: 'B', type: 'teammate' },
      { id: 'c', status: 'running', name: 'cee', description: 'C', type: 'general-purpose' },
      { id: 'd', status: 'waiting', description: 'D', type: 'general-purpose' },
      { id: 'e', status: 'pending', description: 'E', type: 'general-purpose' },
      { id: 'f', status: 'completed', description: 'F', type: 'general-purpose' },
      { id: 'g', status: 'killed', description: 'G', type: 'general-purpose' },
    ]
    const rows = runningAgents(list, { a: { model: 'claude-haiku-5-5', startedAt: NOW - MIN } }, [], NOW)
    expect(rows.map(row => [row.id, row.name, row.status, row.model, row.startedAt, row.isEstimated])).toEqual([
      ['a', 'A', 'running', 'claude-haiku-5-5', NOW - MIN, false],
      ['c', 'cee', 'running', undefined, NOW, true],
      ['d', 'D', 'waiting', undefined, NOW, true],
      ['e', 'E', 'pending', undefined, NOW, true],
    ])
  })

  test('a value an earlier version stored is declined', async () => {
    expect(upgrade({ v: 0, sessionId: 'S' })).toBeNull()
    expect(upgrade(emptyStatus('S'))?.sessionId).toBe('S')
  })
})

describe('copy sources', () => {
  const text = (t: string) => ({ type: 'text', text: t })
  const user = (...blocks: object[]) => ({ role: 'user', content: blocks as { type: string }[] })
  const assistant = (...blocks: object[]) => ({ role: 'assistant', content: blocks as { type: string }[] })
  const REMINDER = text('<system-reminder>\nctx\n</system-reminder>\n')

  test('the response is the final answer only: progress before a tool call, thinking and tool rows skipped', async () => {
    const messages = [
      user(text('older prompt')),
      assistant(text('older answer')),
      user(REMINDER, text('prompt')),
      assistant({ type: 'thinking', thinking: 'x' }, text(' A '), { type: 'tool_use', id: '1' }),
      user({ type: 'tool_result', tool_use_id: '1', content: 'out' }, text('reminder')),
      assistant(text(''), { type: 'tool_use', id: '2' }),
      user({ type: 'tool_result', tool_use_id: '2', content: 'out' }),
      assistant(text('B'), text('C')),
    ]
    expect(lastResponse(messages)).toBe('B\n\nC')
    expect(lastResponse([])).toBe('')
    // An answer the engine hands over as consecutive assistant messages is one answer.
    expect(lastResponse([user(text('q')), assistant(text('A')), assistant(text('B'))])).toBe('A\n\nB')
    expect(lastResponse([user(text('q')), assistant(text('done')), user(text('q2')), assistant(text('A')), assistant({ type: 'tool_use', id: '3' })])).toBe('done')
  })

  // The shape a 2.1.310 session held live and after resume: a slash command merged into the next
  // prompt's row, a background agent's notice and its reply, an interrupted prompt, then a
  // command alone.
  const session = [
    user(REMINDER, text('Do it: ALPHA then read then OMEGA')),
    assistant(text('ALPHA-START tea is a drink.'), { type: 'tool_use', id: 't1', name: 'Read' }),
    user({ type: 'tool_result', tool_use_id: 't1', content: 'README' }),
    assistant(text('OMEGA-END done.')),
    user(REMINDER, text('<local-command-caveat>Caveat</local-command-caveat>'), text('<command-name>/model</command-name>'), text('<local-command-stdout>Set model</local-command-stdout>'), text('Launch a background agent')),
    assistant({ type: 'thinking', thinking: 'x' }, { type: 'tool_use', id: 't2', name: 'Agent' }),
    user({ type: 'tool_result', tool_use_id: 't2', content: 'started' }),
    assistant(text('BG-STARTED')),
    user(text('Another Claude session sent a message:\n<agent-message from="a1">done</agent-message>')),
    assistant(text('The background agent finished.')),
    user(REMINDER, text('<system-reminder>\n[SYSTEM NOTIFICATION - NOT USER INPUT]\n</system-reminder>'), text('Write an essay')),
    assistant({ type: 'thinking', thinking: 'x' }, text('INTERRUPTED-ESSAY: tea')),
    user(text('[Request interrupted by user]')),
    assistant(text('No response requested.')),
    user(text('<command-name>/nth-status</command-name>'), text('<local-command-stdout>opened</local-command-stdout>')),
  ]

  test('a notice’s answer is the latest response; interrupted prompts and slash commands never replace it', async () => {
    expect(lastResponse(session)).toBe('The background agent finished.')
    expect(lastResponse(session.slice(0, 4))).toBe('OMEGA-END done.')
    expect(lastResponse(session.slice(0, 8))).toBe('BG-STARTED')
    expect(lastResponse(session.slice(0, 10))).toBe('The background agent finished.')
  })

  // The shape of the failing 2.1.310 session: the person's turn ends while a background agent
  // works, its hand-back opens the next turn, and the final report closes that turn.
  test('the final report after a subagent hand-back is copied, not the progress before it', async () => {
    const report = 'New conversations now get short titles.\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    const messages = [
      user(REMINDER, text('Update the integration')),
      assistant(text('I’ll look at the integration first.'), { type: 'tool_use', id: 'a', name: 'Bash' }),
      user({ type: 'tool_result', tool_use_id: 'a', content: 'x' }),
      assistant({ type: 'thinking', thinking: 'x' }, { type: 'tool_use', id: 'b', name: 'Agent' }),
      user({ type: 'tool_result', tool_use_id: 'b', content: 'started' }, REMINDER),
      assistant(text('The architect is still working on the design.')),
      user(text('Another Claude session sent a message:\n<agent-message from="a9">[Subagent hand-back] …</agent-message>'), REMINDER),
      assistant(text('The handoff recommends one small mod.'), { type: 'tool_use', id: 'c', name: 'Write' }),
      user({ type: 'tool_result', tool_use_id: 'c', content: 'ok' }),
      assistant(text('Verified. Cleaning up.'), { type: 'tool_use', id: 'd', name: 'Bash' }),
      user({ type: 'tool_result', tool_use_id: 'd', content: 'ok' }),
      assistant({ type: 'thinking', thinking: 'x' }, text(report)),
      user(text('<local-command-caveat>Caveat</local-command-caveat>'), text('<command-name>/copy</command-name>'), text('<local-command-stdout>Copied</local-command-stdout>')),
    ]
    expect(lastResponse(messages)).toBe(report)
    // While the report's turn still runs, the answer before the hand-back is the latest complete one.
    expect(lastResponse(messages.slice(0, 11))).toBe('The architect is still working on the design.')
  })

  test('a running turn is not complete; the one before is copied', async () => {
    const running = [...session.slice(0, 4), user(text('next')), assistant(text('working'), { type: 'tool_use', id: 't9' }), user({ type: 'tool_result', tool_use_id: 't9', content: '' })]
    expect(lastResponse(running)).toBe('OMEGA-END done.')
    expect(lastResponse([...session.slice(0, 4), user(text('just sent'))])).toBe('OMEGA-END done.')
  })

  test('whatever opened the turn, its answer counts; a prompt typed after an interrupt is answered', async () => {
    expect(lastResponse([user({ type: 'image', source: {} }), assistant(text('I see a cat'))])).toBe('I see a cat')
    expect(lastResponse([user(REMINDER), assistant(text('hello'))])).toBe('hello')
    const retyped = [user(text('essay')), assistant(text('cut')), user(text('[Request interrupted by user]'), text('shorter please'), REMINDER), assistant(text('Short essay.'))]
    expect(lastResponse(retyped)).toBe('Short essay.')
  })

  test('code blocks: backtick and tilde fences, info string, unclosed fence', async () => {
    expect(codeBlocks('no code')).toEqual([])
    expect(codeBlocks('```x``` inline span\ntext')).toEqual([])
    const md = 'a\n```ts title\nconst x = 1\n```\ntext\n~~~~\n```\ninner\n~~~~\n  ```\nopen\nend'
    expect(codeBlocks(md)).toEqual([
      { lang: 'ts', code: 'const x = 1' },
      { lang: '', code: '```\ninner' },
      { lang: '', code: 'open\nend' },
    ])
  })

  test('session info opens with the project and leaves out the cost note', async () => {
    const status = { ...emptyStatus('S'), folder: 'repo', branch: { name: 'main', isWorktree: false } }
    const text = sessionInfo(status, NOW)
    expect(text.split('\n')[0]).toBe('nth-status · repo · main')
    expect(text).not.toContain('Cost:')
    expect(text.split('\n').at(-1)).toBe('Agents: 0 running')
  })
})

describe('layout', () => {
  const row: Row = {
    key: 'r',
    groups: [
      [{ key: 'a', text: 'aaaa' }, { key: 'b', text: 'bbbb', drop: 2 }],
      [{ key: 'c', text: 'cccc', drop: 1 }],
    ],
    right: [],
  }

  test('a path is cut from the left, keeping its last directories whole', async () => {
    expect(shortPath('C:\\path\\to\\work\\repos\\nth-dev-kit', 44)).toBe('C:\\path\\to\\work\\repos\\nth-dev-kit')
    expect(shortPath('C:\\path\\to\\work\\repos\\nth-dev-kit', 22)).toBe('…\\repos\\nth-dev-kit')
    expect(shortPath('/home/me/projects/very/deep/repo', 16)).toBe('…/very/deep/repo')
    expect(shortPath('/x/an-extremely-long-folder-name', 12)).toBe('…folder-name')
  })

  test('the project row gives the path what the branch leaves, up to 44 columns', async () => {
    const status = { ...emptyStatus('S'), folder: 'C:\\Users\\someone\\source\\repos\\company\\platform\\services\\api', branch: { name: 'main', isWorktree: false } }
    const folder = (columns: number) => layout(status, NOW, columns).rows[0]!.groups[0]!.find(s => s.key === 'folder')!.text
    expect(folder(150).length).toBeLessThanOrEqual(44)
    expect(folder(150).startsWith('…')).toBe(true)
    expect(folder(150).endsWith('\\services\\api')).toBe(true)
    expect(folder(40).length).toBeLessThanOrEqual(40 - 9)
  })

  test('labels are muted; only the percentages carry a level', async () => {
    const status = { ...emptyStatus('S'), model: 'claude-opus-5-5', usage: { ctx: 85, five: { pct: 10 } } }
    const segs = layout(status, NOW, 100).rows.find(r => r.key === 'usage')!.groups[1]!
    expect(segs.map(s => [s.text, s.level ?? (s.isDim ? 'dim' : 'plain')])).toEqual([
      ['Ctx', 'dim'],
      ['85%', 'critical'],
      ['5h', 'dim'],
      ['10%', 'normal'],
    ])
  })

  test('fit drops the lowest rank first and removes emptied groups', async () => {
    expect(fit(row, 100).groups.flat().map(seg => seg.key)).toEqual(['a', 'b', 'c'])
    expect(fit(row, 9).groups.flat().map(seg => seg.key)).toEqual(['a', 'b'])
    expect(fit(row, 4).groups).toEqual([[{ key: 'a', text: 'aaaa' }]])
  })

  test('rows with nothing to show are left out; narrow keeps rows 1 and 2 and the controls', async () => {
    const status = { ...emptyStatus('S'), folder: 'repo', model: 'claude-opus-5-5', usage: { ctx: 10 } }
    expect(layout(status, NOW, 100).rows.map(r => r.key)).toEqual(['project', 'usage', 'session'])
    const full = { ...status, usage: { ctx: 10, startedAt: NOW - MIN } }
    expect(layout(full, NOW, 100).rows.map(r => r.key)).toEqual(['project', 'usage', 'session'])
    const narrow = layout(full, NOW, 30).rows
    expect(narrow.map(r => r.key)).toEqual(['project', 'usage', 'session'])
    expect(narrow[2]!.groups).toEqual([])
    expect(narrow[2]!.right.map(s => s.text)).toEqual(['[ Copy ]', '[ ≡ ]'])
  })

  test('the session row drops its cost, then its label, then the agent count; Copy and Actions stay', async () => {
    const status = {
      ...emptyStatus('S'),
      usage: { startedAt: NOW - 80 * MIN, costUsd: 7.72 },
      agents: [{ id: 'a', name: 'x', status: 'running', startedAt: NOW, isEstimated: true }],
    }
    const session = (columns: number, isTerminal = true) => {
      const row = layout(status, NOW, columns, isTerminal).rows.find(r => r.key === 'session')!
      return [...row.groups.flat(), ...row.right].map(s => s.text)
    }
    // The terminal's Actions is one glyph, so all of it fits sooner.
    expect(session(44)).toEqual(['Session', '1h20m', '~$7.72', '1 agent', '[ Copy ]', '[ ≡ ]'])
    expect(session(43)).toEqual(['Session', '1h20m', '1 agent', '[ Copy ]', '[ ≡ ]'])
    expect(session(39)).toEqual(['1 agent', '[ Copy ]', '[ ≡ ]'])
    expect(session(20)).toEqual(['[ Copy ]', '[ ≡ ]'])
    // Elsewhere it keeps its word.
    expect(session(60, false)).toEqual(['Session', '1h20m', '~$7.72', '1 agent', '[ Copy ]', '[ Actions ▾ ]'])
    expect(session(51, false)).toEqual(['Session', '1h20m', '1 agent', '[ Copy ]', '[ Actions ▾ ]'])
    expect(session(44, false)).toEqual(['1h20m', '1 agent', '[ Copy ]', '[ Actions ▾ ]'])
    expect(session(30, false)).toEqual(['[ Copy ]', '[ Actions ▾ ]'])
    const crowded: Row = { key: 's', groups: [[{ key: 't', text: '1h20m' }]], right: [{ key: 'a', text: '1 agent', drop: 7 }, { key: 'c', text: 'Copy' }] }
    expect(fit(crowded, 12).right.map(s => s.text)).toEqual(['Copy'])
  })

  test('cache and prompt share row 3; session and agents row 4', async () => {
    const status = {
      ...emptyStatus('S'),
      folder: 'repo',
      model: 'claude-opus-5-5',
      usage: { startedAt: NOW - 80 * MIN, costUsd: 7.72 },
      cache: { source: 'statusline' as const, isWarm: true, expiresAt: NOW - MIN, isObserved: true, ttl: '1h', hitRatio: null },
      prompt: { phase: 'done' as const, startedAt: NOW - 20 * MIN, durationMs: 12 * MIN + 34_000, costAtStart: 6.87, costUsd: 0.85 },
      agents: [{ id: 'a', name: 'x', status: 'running', startedAt: NOW, isEstimated: true }],
    }
    const text = (key: string) =>
      layout(status, NOW, 100).rows.find(r => r.key === key)!.groups.map(g => g.map(s => s.text).join(' ')).join(' │ ')
    expect(text('activity')).toBe('Cache Cold │ Last 12m34s ~$0.85')
    expect(text('session')).toBe('Session 1h20m ~$7.72')
    expect(layout(status, NOW, 100).rows.find(r => r.key === 'session')!.right.map(s => s.text)).toEqual([
      '1 agent',
      '[ Copy ]',
      '[ ≡ ]',
    ])
    const running = { ...status, prompt: { phase: 'running' as const, startedAt: NOW - 5000, costAtStart: 7 } }
    expect(
      layout(running, NOW, 100).rows.find(r => r.key === 'activity')!.groups[1]!.map(s => s.text),
    ).toEqual(['Prompt', '5s', '~$0.72'])
  })
})
