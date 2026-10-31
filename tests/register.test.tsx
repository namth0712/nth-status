import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'nth-status'
const SURFACES = ['terminal', 'desktop', 'vscode'] as const
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const MIN = 60_000

type World = {
  sessionId: string
  model: string
  modelRow: { value: string; options: string[]; isLocked: boolean } | null
  effortSetting?: string
  modelSettings?: Record<string, { effortLevel?: string }>
  /** The inline `flag` layer, where VS Code's own effort selector writes. */
  flagEffort?: string
  theme?: string
  usage: {
    startedAt: number
    context: { window: number; percent?: number; tokens?: number }
    rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
    cost?: { usd: number }
  }
  surfaces: string[]
  agents: { id: string; status: string; name?: string; description: string; type: string }[]
  git: { exitCode: number; stdout: string }
  statusLine?: { type: string; command: string }
  capture?: object
  /** Where the capture is, when a test pins it: any other path holds none. */
  capturePath?: string
  configDenies?: string
  effortText?: string
  /** What `/model` answers instead of switching: a refusal. */
  modelRefusal?: string
  configSets: { key: string; value: unknown }[]
  commands: { command: string; args: string }[]
  toasts: string[]
  opened: string[]
  apiMessages: { role: 'user' | 'assistant'; content: { type: string; [field: string]: unknown }[] }[]
  copies: string[]
  copyResult?: object
  /** User turns of the loaded conversation (`$.session.turns()`). */
  turns?: number
  /** The plugin's `$.store`, in insertion order; `storeSets` counts the writes per key. */
  store?: Record<string, unknown>
  storeSets?: Record<string, number>
  /** A refusal the engine beneath gives every prompt. */
  dropPrompt?: string
  /** What the next `turn.step` request reports as its usage; null: no response came. */
  stepUsage?: object | null
  /** The `promptCacheTtl` setting. */
  cacheTtl?: string
  /** Called as a `turn.step` request reaches the engine; awaited before it answers (a long request). */
  onStepStart?: () => void
  stepGate?: Promise<void>
}

function fullWorld(): World {
  return {
    sessionId: 'S1',
    model: 'claude-opus-5-5',
    modelRow: { value: 'opus', options: ['default', 'sonnet', 'opus', 'haiku'], isLocked: false },
    usage: {
      startedAt: NOW - (2 * 60 + 11) * MIN,
      context: { window: 1_000_000, percent: 42 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 68, resetsAt: new Date(NOW + 150 * MIN).toISOString() },
        { kind: 'seven_day', percentUsed: 35, resetsAt: new Date(NOW + 3 * 1440 * MIN).toISOString() },
      ],
      cost: { usd: 8.42 },
    },
    surfaces: ['terminal'],
    agents: [],
    git: { exitCode: 0, stdout: 'feat/gameplay\n/repo/.git\n/repo/.git\n' },
    configSets: [],
    commands: [],
    toasts: [],
    opened: [],
    apiMessages: [],
    copies: [],
  }
}

/** The engine beneath the plugin, answering from the world the test sets. */
function engine(on: On, world: World) {
  const clock = mock.clock(on, { now: NOW })
  const store = (world.store ??= {})
  const sets = (world.storeSets ??= {})
  on('store.get', ($, e) => ({ value: store[e.key] }) as never)
  on('store.set', ($, e) => {
    store[e.key] = e.value
    sets[e.key] = (sets[e.key] ?? 0) + 1
    return { value: undefined } as never
  })
  on('store.delete', ($, e) => {
    delete store[e.key]
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  on('session.id', () => ({ value: world.sessionId }))
  on('session.cwd', () => ({ value: '/work/acme-web-frontend' }))
  on('session.model', () => ({ value: world.model }))
  on('session.usage', () => ({ value: world.usage }) as never)
  on('session.surfaces', () => ({ value: world.surfaces }) as never)
  on('session.turns', () => ({ value: world.turns ?? 0 }) as never)
  on('session.compact', ($, e) => ({ messages: e.messages }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('agent.list', () => ({ value: world.agents }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
  on('process.run', () => ({ value: { ...world.git, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('settings.read', ($, e) => {
    if (e.source === 'flag') return { value: world.flagEffort ? { effortLevel: world.flagEffort } : {} } as never
    return {
      value: {
        ...(world.statusLine ? { statusLine: world.statusLine } : {}),
        ...((world.flagEffort ?? world.effortSetting) ? { effortLevel: world.flagEffort ?? world.effortSetting } : {}),
        ...(world.modelSettings ? { modelSettings: world.modelSettings } : {}),
        ...(world.theme ? { theme: world.theme } : {}),
        ...(world.cacheTtl ? { promptCacheTtl: world.cacheTtl } : {}),
      },
    } as never
  })
  on('config.list', () => ({
    value: world.modelRow
      ? [
          {
            key: 'model',
            label: 'Model',
            kind: 'choice',
            value: world.modelRow.value,
            options: world.modelRow.options,
            provider: { plugin: 'engine', tier: 'core' },
            isLocked: world.modelRow.isLocked,
          },
        ]
      : [],
  }) as never)
  on('config.set', ($, e) => {
    if (world.configDenies) return { deny: world.configDenies } as never
    world.configSets.push({ key: e.key, value: e.value })
    if (e.key === 'model' && world.modelRow) {
      world.modelRow.value = String(e.value)
      world.model = `claude-${String(e.value)}-5-5`
    }
    return { value: e.value } as never
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }) as never)
  on('command.run', ($, e) => {
    world.commands.push({ command: e.command, args: e.args })
    if (e.command === 'model') {
      if (world.modelRefusal) return { text: world.modelRefusal } as never
      if (world.modelRow) world.modelRow.value = e.args
      world.model = `claude-${e.args}-5-5`
      return { text: `Set model to \`${e.args}\` for this session only` } as never
    }
    return { text: world.effortText ?? `Set effort level to ${e.args} (this session only): …` } as never
  })
  on('ui.open', ($, e) => {
    world.opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(String((e as { text: unknown }).text))
    return { value: undefined } as never
  })
  on('fs.exists', ($, e) => ({
    // The engine hands the path on absolute in the platform's form (a drive and backslashes on Windows).
    value:
      world.capture !== undefined &&
      (world.capturePath === undefined
        ? /statusline-S1\.json$/.test(e.path)
        : e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '') === world.capturePath),
  }))
  on('fs.read', () => ({ value: JSON.stringify(world.capture ?? null) }) as never)
  on('session.messages', () => ({ value: world.apiMessages }) as never)
  on('prompt.submit', ($, e) => (world.dropPrompt ? { drop: world.dropPrompt } : { text: e.text }) as never)
  on('classic.SessionStart', () => ({}) as never)
  on('turn.step', async function* ($, e) {
    world.onStepStart?.()
    if (world.stepGate) await world.stepGate
    const usage = world.stepUsage ?? null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: usage ? 'end_turn' : null, usage } as never
  })
  on('ui.copy', ($, e) => {
    world.copies.push(e.text)
    return { value: world.copyResult ?? { isCopied: true } } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  return clock
}

async function start($: Engine, clock: ReturnType<typeof mock.clock>) {
  await $.session.start({ cwd: '/work/acme-web-frontend', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

const PROPS = (bodyColumns: number, maxRows = 6) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows,
  bodyColumns,
  scroll: { offset: 0, bodyRows: maxRows },
  view: {},
})

/** The band's text, one string per row Box, segments joined as drawn. */
async function band($: Engine, surface: (typeof SURFACES)[number] = 'terminal', bodyColumns = 100) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: PROPS(bodyColumns) })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text).join('')
  await ui.unmount()
  return texts
}

/** The text a picker's Button shows (`Opus 5.5 ▾`), or undefined when it is not a Button. */
async function trigger($: Engine, key: 'model' | 'effort') {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: PROPS(100) })
  const found = await ui.find({ key })
  await ui.unmount()
  return found?.type === 'Button' ? found.text : undefined
}

/** Presses a band Button by key. */
async function press($: Engine, key: string) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: PROPS(100) })
  await ui.press({ key })
  await ui.unmount()
}

/** The keys of the open picker's choice Buttons, in order. */
async function choiceKeys($: Engine) {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: PROPS(100) })
  const keys = (await ui.findAll({ type: 'Button' })).map(found => found.key ?? '').filter(key => key.startsWith('pick:'))
  await ui.unmount()
  return keys
}

const turn = (agentId?: string) => ({ text: 'go', turnId: 't', ...(agentId ? { agentId } : {}) }) as never
const ended = (durationMs: number, isAborted = false, agentId?: string) =>
  ({
    answer: '',
    durationMs,
    isAborted,
    turnId: 't',
    reason: isAborted ? 'aborted' : 'answer',
    ...(agentId ? { agentId } : {}),
  }) as never

describe('rows', () => {
  test('all four rows from full data, in the terminal and the desktop app', async ($, on) => {
    const world = fullWorld()
    world.agents = [{ id: 'a1', status: 'running', name: 'explorer', description: 'Find code', type: 'Explore' }]
    const clock = engine(on, world)
    await start($, clock)
    for (const surface of ['terminal', 'desktop'] as const) {
      const text = await band($, surface)
      expect(text).toContain('acme-web-frontend')
      expect(text).toContain('feat/gameplay')
      expect(text).toContain('Ctx 42%')
      expect(text).toContain('5h 68%')
      expect(text).toContain('(2h30m)')
      expect(text).toContain('7d 35%')
      expect(text).toContain('1 agent')
      expect(text).toContain('Session')
      expect(text).toContain('2h11m')
      expect(text).toContain('~$8.42')
      expect(text).not.toContain('RC On')
      expect(text).not.toContain('Cache')
    }
  })

  test('unavailable data is hidden, never faked', async ($, on) => {
    const world = fullWorld()
    world.usage = { startedAt: NOW, context: { window: 1_000_000 }, rateLimits: [] }
    world.git = { exitCode: 128, stdout: '' }
    const clock = engine(on, world)
    await start($, clock)
    const text = await band($)
    expect(text).toContain('acme-web-frontend')
    expect(text).not.toContain('Ctx')
    expect(text).not.toContain('5h')
    expect(text).not.toContain('7d')
    expect(text).not.toContain('~$')
    expect(text).not.toContain('⎇')
  })

  test('a linked worktree is marked; a detached head shows as detached', async ($, on) => {
    const world = fullWorld()
    world.git = { exitCode: 0, stdout: 'wt-branch\n/repo/.git/worktrees/wt\n/repo/.git\n' }
    const clock = engine(on, world)
    await start($, clock)
    expect(await band($)).toContain('worktree')
  })

  test('narrow terminals drop the reset countdown and 7d before the essentials', async ($, on) => {
    const clock = engine(on, fullWorld())
    await start($, clock)
    const narrow = await band($, 'terminal', 30)
    expect(narrow).toContain('Ctx 42%')
    expect(narrow).not.toContain('(2h30m)')
    expect(narrow).not.toContain('Session')
  })

  test('another band beneath keeps its place above this one', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>inner band</Text>
    })
    const clock = engine(on, fullWorld())
    await start($, clock)
    const text = await band($)
    expect(text.indexOf('inner band')).toBe(0)
    expect(text).toContain('Ctx 42%')
  })
})

describe('time and cost', () => {
  test('prompt duration and cost delta; subagent turns are not prompts', async ($, on) => {
    const world = fullWorld()
    world.usage.cost = { usd: 1 }
    const clock = engine(on, world)
    await start($, clock)
    await $.turn.start(turn())
    world.usage.cost = { usd: 1.85 }
    await clock.advance(5000)
    await $.turn.start(turn('a1'))
    await $.turn.complete(ended(1, false, 'a1'))
    expect(await band($)).toContain('~$0.85')
    await $.turn.complete(ended(12 * MIN + 34_000))
    world.usage.cost = { usd: 2.5 }
    const text = await band($)
    expect(text).toContain('12m34s')
    expect(text).toContain('~$0.85')
  })

  test('an interrupted prompt is marked', async ($, on) => {
    const clock = engine(on, fullWorld())
    await start($, clock)
    await $.turn.start(turn())
    await $.turn.complete(ended(3000, true))
    expect(await band($)).toContain('Last ✕')
  })

  test('a finished prompt shows as Last and stops counting until the next one starts', async ($, on) => {
    const world = fullWorld()
    world.usage.cost = { usd: 1 }
    const clock = engine(on, world)
    await start($, clock)
    await $.turn.start(turn())
    world.usage.cost = { usd: 1.5 }
    await clock.advance(4000)
    expect(await band($)).toMatch(/Prompt\s*4s\s*~\$0\.50/)
    await $.turn.complete(ended(4000))
    await clock.advance(60_000)
    expect(await band($)).toMatch(/Last\s*4s\s*~\$0\.50/)
    await $.turn.start(turn())
    expect(await band($)).toMatch(/Prompt\s*0s/)
  })

  test('the band sits below another band: three bordered zones, one panel, or bare rows, as the height allows', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>inner band</Text>
    })
    const clock = engine(on, fullWorld())
    await start($, clock)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: PROPS(100, 10) })
    const panels = (await ui.findAll({ type: 'Box' })).filter(found => found.props.borderStyle === 'round')
    expect(panels.map(found => found.key)).toEqual(['context', 'meta', 'quota'])
    const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text).join('')
    await ui.unmount()
    expect(texts.indexOf('inner band')).toBe(0)
    // Three rows at this width, the border's two and task-progress's one-row band (its own panel
    // takes four rows only from ten): still a panel at six.
    const six = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: PROPS(100, 6) })
    expect((await six.findAll({ type: 'Box' })).filter(found => found.props.borderStyle === 'round').length).toBe(1)
    await six.unmount()
    // Too few rows to keep room for other bands: bare rows, never a panel cut short.
    const short = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: PROPS(100, 5) })
    expect((await short.findAll({ type: 'Box' })).filter(found => found.props.borderStyle === 'round').length).toBe(0)
    await short.unmount()
  })

  test('/clear starts the band over', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await $.turn.start(turn())
    await $.turn.complete(ended(3000))
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    world.sessionId = 'S2'
    await start($, clock)
    expect(await band($)).not.toContain('Prompt')
  })
})

describe('pickers', () => {
  test('Model and Effort are Buttons, so focusing one opens nothing; the choices open on a press', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: PROPS(100) })
      expect((await ui.find({ key: 'model' }))?.type).toBe('Button')
      expect((await ui.find({ key: 'effort' }))?.type).toBe('Button')
      // The only Select left is the Actions menu: a click that focuses the band opens no picker.
      // No Select is left in the band: a click that focuses it opens nothing.
      expect(await ui.findAll({ type: 'Select' })).toEqual([])
      await ui.unmount()
    }
    expect(await trigger($, 'model')).toBe('Opus 5.5 ▾')
    expect(await choiceKeys($)).toEqual([])
    await press($, 'model')
    expect(await trigger($, 'model')).toBe('Opus 5.5 ▴')
    expect(await choiceKeys($)).toEqual(['pick:default', 'pick:sonnet', 'pick:opus', 'pick:haiku', 'pick:cancel'])
    await press($, 'pick:cancel')
    expect(await choiceKeys($)).toEqual([])
    expect(world.configSets).toEqual([])
  })

  test('picking a model changes the /config Model row', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await press($, 'model')
    await press($, 'pick:sonnet')
    expect(world.configSets).toEqual([{ key: 'model', value: 'sonnet' }])
    expect(await trigger($, 'model')).toBe('Sonnet 5.5 ▾')
    expect(await choiceKeys($)).toEqual([])
  })

  test('a refused model change is reported and nothing changes', async ($, on) => {
    const world = fullWorld()
    world.configDenies = 'managed by policy'
    const clock = engine(on, world)
    await start($, clock)
    await press($, 'model')
    await press($, 'pick:haiku')
    expect(world.toasts.join()).toContain('Model not changed')
    expect(await trigger($, 'model')).toBe('Opus 5.5 ▾')
  })

  test('a locked model row is plain text, not a picker', async ($, on) => {
    const world = fullWorld()
    world.modelRow = { value: 'opus', options: ['opus'], isLocked: true }
    const clock = engine(on, world)
    await start($, clock)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: PROPS(100) })
    expect(await ui.find({ key: 'model' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('')).toContain('Opus 5.5')
    await ui.unmount()
  })

  test('picking an effort runs the built-in /effort and shows the level, with or without its text', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await press($, 'effort')
    expect(await choiceKeys($)).toEqual(['pick:low', 'pick:medium', 'pick:high', 'pick:xhigh', 'pick:max', 'pick:cancel'])
    await press($, 'pick:medium')
    expect(world.commands).toEqual([{ command: 'effort', args: 'medium' }])
    expect(await trigger($, 'effort')).toBe('Medium ▾')
    // From a press, 2.1.310 answers with no text; the level still shows.
    world.effortText = ''
    await press($, 'effort')
    await press($, 'pick:low')
    expect(await trigger($, 'effort')).toBe('Low ▾')
    // A level over the model's cap shows what was set.
    world.effortText = "Effort 'max' exceeds the cap for Opus 5.5; set to 'high' instead"
    await press($, 'effort')
    await press($, 'pick:max')
    expect(await trigger($, 'effort')).toBe('High ▾')
  })

  test('effort comes from the model own setting before any request, and follows a model switch', async ($, on) => {
    const world = fullWorld()
    world.effortSetting = 'medium'
    world.modelSettings = { 'claude-opus-5-5': { effortLevel: 'high' }, 'claude-sonnet-5-5': { effortLevel: 'low' } }
    const clock = engine(on, world)
    await start($, clock)
    expect(await trigger($, 'effort')).toBe('High ▾')
    await press($, 'model')
    await press($, 'pick:sonnet')
    await clock.settle()
    expect(await trigger($, 'effort')).toBe('Low ▾')
  })

  test('an unlisted /config value shows the running model; with no level known Effort reads Default', async ($, on) => {
    const world = fullWorld()
    world.modelRow = { value: '', options: ['default', 'sonnet', 'opus'], isLocked: false }
    const clock = engine(on, world)
    await start($, clock)
    expect(await trigger($, 'model')).toBe('Opus 5.5 ▾')
    expect(await trigger($, 'effort')).toBe('Default ▾')
    await press($, 'model')
    await press($, 'pick:cancel')
    expect(world.configSets).toEqual([])
    expect(world.commands).toEqual([])
  })

  test('a typed /effort shows at once; the command runs untouched', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await $.command.run({ command: 'effort', args: 'low' } as never)
    expect(world.commands).toEqual([{ command: 'effort', args: 'low' }])
    expect(await trigger($, 'effort')).toBe('Low ▾')
  })

  test('an open picker closes when the next prompt starts', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await press($, 'effort')
    expect((await choiceKeys($)).length).toBe(6)
    await $.turn.start(turn())
    expect(await choiceKeys($)).toEqual([])
    await $.turn.complete(ended(100))
  })
})

const typed = (text: string, extra: object = {}) =>
  ({ text, wait: false, origin: { kind: 'composer' }, ...extra }) as never

/** A turn the person's prompt starts: a text, a tool call and its result, then a closing text. */
async function personTurn($: Engine, world: World, prompt: string, first: string, last: string) {
  await $.prompt.submit(typed(prompt))
  await $.turn.start(turn())
  world.apiMessages = [
    ...world.apiMessages,
    { role: 'user', content: [{ type: 'text', text: prompt }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: first },
        { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'TOOL OUTPUT' }] },
    { role: 'assistant', content: [{ type: 'text', text: last }] },
  ]
  await $.turn.complete({ ...(ended(2000) as object), answer: last } as never)
}

/** The band; the desktop app's Copy is the mod's own, the terminal's the built-in `/copy`. */
async function mountBand($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: PROPS(100, 10) })
}

/** Opens the Actions menu and presses one of its entries. */
async function pickAction($: Engine, value: string) {
  await press($, 'actions')
  await press($, `act:${value}`)
}

/** The keys of the Actions row's Buttons (menu entries or code blocks), in order. */
async function menuKeys($: Engine) {
  const ui = await mountBand($)
  const keys = (await ui.findAll({ type: 'Button' })).map(found => found.key ?? '').filter(key => /^(act|code):/.test(key))
  await ui.unmount()
  return keys
}

describe('terminal zones', () => {
  /** The terminal band with room for its dashboard: 100 columns, 10 rows. */
  const zoned = ($: Engine, bodyColumns = 100, maxRows = 10, surface: 'terminal' | 'desktop' = 'terminal') =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: PROPS(bodyColumns, maxRows) })
  type TBand = Awaited<ReturnType<typeof zoned>>
  /** Each zone row's text, as painted, by its zone. */
  const zoneRows = async (ui: TBand) => {
    const zones = await ui.find({ key: 'zones' })
    if (!zones) return null
    const rows: Record<string, string[]> = {}
    for (const key of ['context', 'meta', 'quota']) {
      const zone = await ui.find({ key })
      rows[key] = (zone?.children ?? []).map(child => textOf(child))
    }
    return rows
  }
  type TNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const textOf = (node: unknown): string => (typeof node === 'string' ? node : ((node as TNode | null)?.children ?? []).map(textOf).join(''))
  /** The painted runs whose text is exactly `part`. */
  const runsWith = async (ui: TBand, part: string) => (await ui.findAll({ type: 'Text' })).filter(found => found.text === part)

  test('a header with the controls and three bordered zones, a footer only with something to show', async ($, on) => {
    const world = fullWorld()
    world.theme = 'dark'
    world.usage.context = { window: 200_000, percent: 42, tokens: 84_000 }
    const clock = engine(on, world)
    await start($, clock)
    await $.turn.start(turn())
    world.usage.cost = { usd: 9.0 }
    await $.turn.complete(ended(395_000))
    const ui = await zoned($)
    // Each zone its own frame, in its own hue; no frame around them.
    const frames = (await ui.findAll({ type: 'Box' })).filter(found => found.props.borderStyle === 'round')
    expect(frames.map(found => [found.key, found.props.borderColor])).toEqual([
      ['context', '#46556e'],
      ['meta', '#54496c'],
      ['quota', '#3f5e59'],
    ])
    const rows = await zoneRows(ui)
    expect(rows).not.toBeNull()
    const [context, meta, quota] = [rows!.context!, rows!.meta!, rows!.quota!]
    expect(context[0]).toMatch(/^ 42% +84k\/200k $/)
    expect(context[1]).toMatch(/^ DB — +↻ 0 $/)
    expect(meta[0]).toMatch(/^ Last 6m35s +~\$0\.58 $/)
    expect(meta[1]).toMatch(/^ Session \d+✉ 2h11m +~\$9\.00 $/)
    expect(quota[0]).toMatch(/^ 5h 2h30m \d\d:\d\d +68% $/)
    expect(quota[1]).toMatch(/^ 7d 3d0h (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d +35% $/)
    // Rows fill their zone's inside exactly; the zones, their gaps and an even margin fill the band's width.
    const widths = await Promise.all(['context', 'meta', 'quota'].map(async key => (await ui.find({ key }))?.props.width as number))
    for (const [i, key] of ['context', 'meta', 'quota'].entries()) for (const row of rows![key]!) expect([...row].length).toBe(widths[i]! - 2)
    const zones = (await ui.find({ key: 'zones' }))?.props
    expect([zones?.columnGap, zones?.paddingX]).toEqual([1, 1])
    expect(widths.reduce((sum, w) => sum + w, 0) + 2 * 1 + 2 * 1).toBe(100)
    // The header holds the folder, branch, both pickers, Copy and Actions; no footer with nothing to show.
    const keys = (await ui.findAll({ type: 'Button' })).map(found => found.key)
    expect(keys).toEqual(['folder', 'model', 'effort', 'copy', 'actions'])
    expect(await ui.find({ key: 'footer' })).toBeUndefined()
    // The controls never give up room to a long branch: the branch is what truncates.
    const holder = (await ui.findAll({ type: 'Box' })).find(found => found.children.some(child => (child as { props?: { key?: string } }).props?.key === 'actions'))
    expect(holder?.props.flexShrink).toBe(0)
    // A percentage and its fill take its level: 42 % Normal, 68 % Notice, 35 % Normal.
    expect((await runsWith(ui, '42%'))[0]?.props.color).toBe('#6ee7a8')
    expect((await runsWith(ui, '68%'))[0]?.props.color).toBe('#ffd866')
    expect((await runsWith(ui, '35%'))[0]?.props.color).toBe('#6ee7a8')
    expect((await runsWith(ui, '~$9.00'))[0]?.props.color).toBe('merged')
    // Each zone its own faint tint; the meters' fills in their levels' colors.
    const bgs = (await ui.findAll({ type: 'Text' })).map(found => found.props.backgroundColor).filter(Boolean)
    expect(new Set(bgs)).toEqual(new Set(['#232a36', '#2a2634', '#212d2c', '#1d4d38', '#524516']))
    await ui.unmount()
    expect(world.commands).toEqual([])
  })

  test('the pickers, the folder detail and the Actions menu open where they did and still work', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    // Twelve rows: room for the open row too (at ten it would take the compact rows, as the
    // panel dropped its border, rather than show cut short).
    const order = async () => {
      const ui = await zoned($, 100, 12)
      const keys = (await ui.findAll({ type: 'Box' })).map(found => found.key).filter(key => ['picker', 'zones', 'folder-detail', 'menu'].includes(key ?? ''))
      const buttons = (await ui.findAll({ type: 'Button' })).map(found => found.key)
      await ui.unmount()
      return { keys, buttons }
    }
    const pressZoned = async (key: string) => {
      const ui = await zoned($, 100, 12)
      await ui.press({ key })
      await ui.unmount()
    }
    await pressZoned('model')
    let shown = await order()
    expect(shown.keys).toEqual(['picker', 'zones'])
    expect(shown.buttons).toContain('pick:sonnet')
    await pressZoned('pick:sonnet')
    expect(world.configSets).toEqual([{ key: 'model', value: 'sonnet' }])
    await pressZoned('folder')
    shown = await order()
    expect(shown.keys).toEqual(['folder-detail', 'zones'])
    await pressZoned('path:close')
    await pressZoned('actions')
    shown = await order()
    expect(shown.keys).toEqual(['menu', 'zones'])
    await pressZoned('act:session-info')
    expect(world.copies.at(-1)).toContain('acme-web-frontend')
    await pressZoned('copy')
    expect(world.commands.at(-1)).toEqual({ command: 'copy', args: '' })
  })

  test('narrow, short, the desktop app, or an unknown theme: the compact rows as before', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    const compact = async (columns: number, rows: number, surface: 'terminal' | 'desktop' = 'terminal') => {
      const ui = await zoned($, columns, rows, surface)
      const isZoned = (await ui.find({ key: 'zones' })) !== undefined
      const text = (await ui.findAll({ type: 'Text' })).map(found => found.text).join('')
      await ui.unmount()
      return { isZoned, text }
    }
    // Too narrow for the three side by side (the reset clocks go first), too short with another
    // band's room kept, or another surface.
    expect((await compact(76, 10)).isZoned).toBe(true)
    expect((await compact(60, 10)).isZoned).toBe(false)
    expect((await compact(60, 10)).text).toContain('Ctx 42%')
    expect((await compact(100, 6)).isZoned).toBe(false)
    expect((await compact(100, 10, 'desktop')).isZoned).toBe(false)
    expect((await compact(100, 10, 'desktop')).text).toContain('Ctx 42%')
    // No theme to tint by: the zones without a fill, framed in the theme's own subtle color.
    const ui = await zoned($)
    expect((await ui.findAll({ type: 'Text' })).filter(found => found.props.backgroundColor !== undefined)).toEqual([])
    expect((await ui.find({ key: 'context' }))?.props.borderColor).toBe('subtle')
    await ui.unmount()
  })

  /** The band's drawn text with no color of its own: left to the terminal's default foreground. */
  const leftToTerminal = async (ui: TBand) =>
    (await ui.findAll({ type: 'Text' })).filter(
      found =>
        found.text.trim() !== '' &&
        found.children.every(child => typeof child === 'string') &&
        found.props.color === undefined &&
        found.props.dimColor !== true,
    )

  test('on a raw fill no text is left to the terminal’s foreground, which a light fill in a dark terminal loses', async ($, on) => {
    const world = fullWorld()
    world.agents = [{ id: 'a1', status: 'running', name: 'explorer', description: 'Find code', type: 'Explore' }]
    const clock = engine(on, world)
    await start($, clock)
    await $.turn.start(turn())
    await $.turn.complete(ended(395_000))
    for (const theme of ['light', 'light-daltonized', 'dark', 'dark-daltonized']) {
      world.theme = theme
      // The dashboard, then the compact rows in their panel.
      for (const [columns, rows] of [[100, 10], [60, 10]] as const) {
        const ui = await zoned($, columns, rows)
        expect(await leftToTerminal(ui)).toEqual([])
        await ui.unmount()
      }
    }
    // Every row that opens inside the panel, too.
    world.theme = 'light'
    for (const [open, close] of [['model', 'pick:cancel'], ['actions', 'actions'], ['folder', 'path:close']] as const) {
      const pressZoned = async (key: string) => {
        const ui = await zoned($, 100, 12)
        await ui.press({ key })
        await ui.unmount()
      }
      await pressZoned(open)
      const ui = await zoned($, 100, 12)
      expect(await leftToTerminal(ui)).toEqual([])
      await ui.unmount()
      await pressZoned(close)
    }
  })

  test('with no fill the text keeps the terminal’s own foreground', async ($, on) => {
    const world = fullWorld()
    world.theme = 'auto'
    const clock = engine(on, world)
    await start($, clock)
    const ui = await zoned($)
    expect(await leftToTerminal(ui)).not.toEqual([])
    expect((await ui.findAll({ type: 'Text' })).filter(found => found.props.color === 'text')).toEqual([])
    await ui.unmount()
  })

  test('each level has its fill and its percentage, per theme family, with main text in the band’s own ink', async ($, on) => {
    const world = fullWorld()
    world.usage.rateLimits = [
      { kind: 'five_hour', percentUsed: 68, resetsAt: new Date(NOW + 150 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 80, resetsAt: new Date(NOW + 3 * 1440 * MIN).toISOString() },
    ]
    world.usage.context = { window: 1_000_000, percent: 90, tokens: 900_000 }
    const clock = engine(on, world)
    await start($, clock)
    // Context 90 % Critical, 5h 68 % Notice, 7d 80 % Warning.
    for (const [theme, critical, notice, warning, ink] of [
      ['light', ['#f8c0bc', '#9e1220'], ['#f6e39b', '#735400'], ['#fbcfa3', '#a03f00'], '#1b2a4a'],
      ['light-daltonized', ['#f8c0bc', '#9e1220'], ['#f6e39b', '#735400'], ['#fbcfa3', '#a03f00'], '#1b2a4a'],
      ['dark', ['#60272b', '#ff8a80'], ['#524516', '#ffd866'], ['#5e3a14', '#ffa94d'], '#f2f5f9'],
      ['dark-daltonized', ['#60272b', '#ff8a80'], ['#524516', '#ffd866'], ['#5e3a14', '#ffa94d'], '#f2f5f9'],
    ] as const) {
      world.theme = theme
      const ui = await zoned($)
      for (const [pct, level] of [['90%', critical], ['68%', notice], ['80%', warning]] as const) {
        const [run] = await runsWith(ui, pct)
        expect(run?.props.color).toBe(level[1])
      }
      const bgs = (await ui.findAll({ type: 'Text' })).map(found => found.props.backgroundColor)
      for (const level of [critical, notice, warning]) expect(bgs).toContain(level[0])
      const leaf = (await ui.findAll({ type: 'Text' })).find(found => found.children.every(child => typeof child === 'string') && found.text.includes('2h30m'))
      expect(leaf?.props.color).toBe(ink)
      await ui.unmount()
    }
    // The compact rows' percentages take the same colors.
    world.theme = 'light'
    const compact = await zoned($, 60, 10)
    expect((await runsWith(compact, '68%'))[0]?.props.color).toBe('#735400')
    await compact.unmount()
    // No fill of its own: the theme's keys, all four distinct.
    world.theme = 'auto'
    const plain = await zoned($)
    expect((await runsWith(plain, '90%'))[0]?.props.color).toBe('error')
    expect((await runsWith(plain, '68%'))[0]?.props.color).toBe('warning')
    expect((await runsWith(plain, '80%'))[0]?.props.color).toBe('claude')
    await plain.unmount()
  })

  test('the daltonized themes draw the lowest level blue, as their own success is', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    for (const [theme, fill, text] of [
      ['light-daltonized', '#bcdcf2', '#00558a'],
      ['dark-daltonized', '#1b3f5e', '#7cc4ff'],
    ] as const) {
      world.theme = theme
      const ui = await zoned($)
      expect((await runsWith(ui, '42%'))[0]?.props.color).toBe(text)
      expect((await ui.findAll({ type: 'Text' })).map(found => found.props.backgroundColor)).toContain(fill)
      await ui.unmount()
    }
  })

  test('a warm cache shows its flame, two cells wide: the row still fills its zone exactly', async ($, on) => {
    const world = fullWorld()
    world.theme = 'light'
    world.statusLine = { type: 'command', command: 'sh /cfg/nth-dev-kit-hooks/nth-status-statusline.sh' }
    world.capture = { session_id: 'S1', prompt_cache: { warm: true, expires_at: (NOW + 17 * MIN) / 1000 } }
    const clock = engine(on, world)
    await start($, clock)
    const ui = await zoned($)
    const rows = await zoneRows(ui)
    expect(rows!.context![1]).toMatch(/^ DB 17m 🔥 +↻ 0 $/)
    const width = (await ui.find({ key: 'context' }))?.props.width as number
    expect([...rows!.context![1]!].length + 1).toBe(width - 2)
    await ui.unmount()
  })

  test('the footer holds Remote Control and the agents, only while there is one', async ($, on) => {
    const world = fullWorld()
    world.agents = [{ id: 'a1', status: 'running', name: 'explorer', description: 'Find code', type: 'Explore' }]
    const clock = engine(on, world)
    await start($, clock)
    const ui = await zoned($)
    const keys = (await ui.findAll({ type: 'Button' })).map(found => found.key)
    expect(keys).toEqual(['folder', 'model', 'effort', 'copy', 'actions', 'agents'])
    await ui.press({ key: 'agents' })
    expect(world.opened).toEqual(['nth-status'])
    await ui.unmount()
  })

  test('Copy and Actions keep their brackets in the panel’s ink on a fill; a surface’s own button elsewhere', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    const controls = async (surface: 'terminal' | 'desktop') => {
      const ui = await zoned($, 100, 10, surface)
      const found = await Promise.all(['copy', 'actions'].map(key => ui.find({ key })))
      await ui.unmount()
      return found.map(button => ({ text: button?.text, plain: button?.props.plain, variant: button?.props.variant }))
    }
    world.theme = 'light'
    expect(await controls('terminal')).toEqual([
      { text: '[ Copy ]', plain: true, variant: undefined },
      { text: '[ ≡ ]', plain: true, variant: undefined },
    ])
    expect(await controls('desktop')).toEqual([
      { text: 'Copy', plain: undefined, variant: 'primary' },
      { text: 'Actions ▾', plain: undefined, variant: 'secondary' },
    ])
    world.theme = 'auto'
    expect(await controls('terminal')).toEqual([
      { text: 'Copy', plain: undefined, variant: 'primary' },
      { text: '≡', plain: undefined, variant: 'secondary' },
    ])
  })

  test('the terminal shows the newest standing reading: this home’s recorded one before a response, and while idle', async ($, on) => {
    const world = fullWorld()
    world.usage.rateLimits = []
    world.store = { quota: { v: 1, five: { pct: 40, resetsAt: NOW + 60 * MIN, observedAt: NOW - 12 * MIN } } }
    const clock = engine(on, world)
    await start($, clock)
    const quotaRows = async () => {
      const ui = await zoned($)
      const rows = await zoneRows(ui)
      await ui.unmount()
      return rows!.quota!
    }
    // Before this session's first response: the reading this home recorded; no reading for 7d: `—`.
    expect(await quotaRows()).toEqual([expect.stringMatching(/^ 5h .* 40% $/), expect.stringMatching(/^ 7d +— $/)])
    // This session's response reports the window: live, and newer.
    world.usage.rateLimits = [{ kind: 'five_hour', percentUsed: 45, resetsAt: new Date(NOW + 60 * MIN).toISOString() }]
    await $.session.measure({ context: world.usage.context, rateLimits: world.usage.rateLimits, changed: ['rateLimits', 'cost'] } as never)
    expect((await quotaRows())[0]).toMatch(/ 45% $/)
    // Idle, while another session of this home records a newer reading: picked up at the next idle refresh.
    world.store!.quota = { v: 1, five: { pct: 83, resetsAt: NOW + 60 * MIN, observedAt: NOW + 2 * MIN } }
    await clock.advance(15_000)
    expect((await quotaRows())[0]).toMatch(/ 83% $/)
    // Waiting on a background agent (a busy band): a newer recorded reading still shows.
    world.agents = [{ id: 'a1', status: 'running', name: 'explorer', description: 'Find code', type: 'Explore' }]
    world.store!.quota = { v: 1, five: { pct: 90, resetsAt: NOW + 60 * MIN, observedAt: NOW + 3 * MIN } }
    await clock.advance(15_000)
    expect((await quotaRows())[0]).toMatch(/ 90% $/)
    world.agents = []
    // Past the window's reset: no reading, not the old figure.
    await clock.advance(61 * MIN)
    expect((await quotaRows())[0]).toMatch(/^ 5h +— $/)
  })
})

describe('copy and actions', () => {
  test('the terminal Copy runs the built-in /copy and nothing else', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await personTurn($, world, 'do it', 'ALPHA first part.', 'OMEGA closing part.')
    const ui = await mountBand($)
    await ui.press({ key: 'copy' })
    await ui.unmount()
    expect(world.commands).toEqual([{ command: 'copy', args: '' }])
    expect(world.copies).toEqual([])
    expect(world.toasts).toEqual([])
  })

  test('Copy takes the final answer of the last completed turn, nothing else', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await personTurn($, world, 'do it', 'ALPHA first part.', 'OMEGA closing part.')
    const ui = await mountBand($, 'desktop')
    await ui.press({ key: 'copy' })
    await ui.unmount()
    expect(world.copies).toEqual(['OMEGA closing part.'])
    expect(world.toasts.join()).toContain('Copied response (19 chars)')
  })

  test('a response completed before the mod loaded, or before a resume, is copied from history', async ($, on) => {
    const world = fullWorld()
    world.apiMessages = [
      { role: 'user', content: [{ type: 'text', text: 'asked before the mod loaded' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'EARLIER first.' }, { type: 'tool_use', id: 't1' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'EARLIER last.' }] },
    ]
    const clock = engine(on, world)
    await start($, clock)
    const ui = await mountBand($, 'desktop')
    await ui.press({ key: 'copy' })
    await ui.unmount()
    expect(world.copies).toEqual(['EARLIER last.'])
  })

  test('a turn the engine starts itself answers last; an interrupted one keeps that answer', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await personTurn($, world, 'do it', 'MAIN answer.', 'More.')
    await $.turn.start(turn())
    world.apiMessages = [...world.apiMessages, { role: 'user', content: [{ type: 'text', text: '<task-notification>' }] }, { role: 'assistant', content: [{ type: 'text', text: 'noted' }] }]
    await $.turn.complete({ ...(ended(500) as object), answer: 'noted' } as never)
    await $.prompt.submit(typed('again'))
    await $.turn.start(turn())
    world.apiMessages = [
      ...world.apiMessages,
      { role: 'user', content: [{ type: 'text', text: 'again' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'cut sho' }] },
      { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] },
    ]
    await $.turn.complete(ended(500, true))
    const ui = await mountBand($, 'desktop')
    await ui.press({ key: 'copy' })
    await ui.unmount()
    expect(world.copies).toEqual(['noted'])
  })

  test('a prompt typed over a running turn makes that turn, or the next, the person’s', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    // An engine-started turn the person types into.
    await $.turn.start(turn())
    await $.prompt.submit(typed('also this', { turnId: 't' }))
    world.apiMessages = [{ role: 'user', content: [{ type: 'text', text: 'also this' }] }, { role: 'assistant', content: [{ type: 'text', text: 'ANSWERED' }] }]
    await $.turn.complete({ ...(ended(500) as object), answer: 'ANSWERED' } as never)
    const ui = await mountBand($, 'desktop')
    await ui.press({ key: 'copy' })
    await ui.unmount()
    expect(world.copies).toEqual(['ANSWERED'])
  })

  test('/clear forgets the response, the prompt and an open code chooser', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await personTurn($, world, 'code', 'Checking.', '```js\na\n```\n\n```py\nb\n```')
    await pickAction($, 'copy-code')
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    world.sessionId = 'S2'
    world.apiMessages = []
    await start($, clock)
    expect(await menuKeys($)).toEqual([])
    const ui = await mountBand($, 'desktop')
    await ui.press({ key: 'copy' })
    await ui.unmount()
    expect(world.copies).toEqual([])
    expect(world.toasts.join()).toContain('No completed response yet')
  })

  test('nothing to copy, or no clipboard, is said and nothing is faked', async ($, on) => {
    const world = fullWorld()
    world.copyResult = { isCopied: false, reason: 'no-clipboard' }
    const clock = engine(on, world)
    await start($, clock)
    let ui = await mountBand($, 'desktop')
    await ui.press({ key: 'copy' })
    await ui.unmount()
    expect(world.copies).toEqual([])
    expect(world.toasts.join()).toContain('No completed response yet')
    await personTurn($, world, 'do it', 'A.', 'B.')
    ui = await mountBand($, 'desktop')
    await ui.press({ key: 'copy' })
    await ui.unmount()
    expect(world.toasts.join()).toContain('Copy failed: no clipboard')
  })

  test('Actions toggles a row of Buttons; an entry runs and closes it; diff and agents work', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    expect(await menuKeys($)).toEqual([])
    await press($, 'actions')
    expect(await menuKeys($)).toEqual(['act:copy-code', 'act:diff', 'act:agents', 'act:copy-prompt', 'act:session-info'])
    await press($, 'actions')
    expect(await menuKeys($)).toEqual([])
    await pickAction($, 'diff')
    expect(world.commands).toEqual([{ command: 'diff', args: '' }])
    expect(await menuKeys($)).toEqual([])
    await pickAction($, 'agents')
    expect(world.opened).toEqual(['nth-status'])
    expect(await menuKeys($)).toEqual([])
  })

  test('a folder press shows the whole path with Copy path; only one row is open at a time', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await press($, 'folder')
    let ui = await mountBand($)
    const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
    expect((await ui.findAll({ type: 'Button' })).map(found => found.key)).toContain('path:copy')
    await ui.unmount()
    expect(texts).toContain('/work/acme-web-frontend')
    await press($, 'actions')
    ui = await mountBand($)
    const keys = (await ui.findAll({ type: 'Button' })).map(found => found.key ?? '')
    await ui.unmount()
    expect(keys.includes('path:copy')).toBe(false)
    expect(keys.includes('act:diff')).toBe(true)
    await press($, 'actions')
    await press($, 'folder')
    await press($, 'path:copy')
    expect(world.copies).toEqual(['/work/acme-web-frontend'])
    expect(world.toasts.join()).toContain('Copied path')
  })

  test('Copy prompt takes the last typed prompt, never a command, hidden prompt or notification', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await $.prompt.submit(typed('my real question'))
    await $.prompt.submit(typed('/model opus', { command: { name: 'model', args: 'opus' } }))
    await $.prompt.submit(typed('hidden', { isMeta: true }))
    await $.prompt.submit({ text: 'done', wait: false, origin: { kind: 'task-notification' } } as never)
    await pickAction($, 'copy-prompt')
    expect(world.copies).toEqual(['my real question'])
  })

  test('Copy code copies a lone block at once and offers a chooser for several', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    // Only the final answer's blocks: the progress text before the tool call has one too.
    await personTurn($, world, 'code', 'Progress:\n```sh\nnot this\n```', 'One:\n```js\nconsole.log(1)\n```\nTwo:\n```python\nprint(2)\nprint(3)\n```')
    await pickAction($, 'copy-code')
    expect(world.copies).toEqual([])
    expect(await menuKeys($)).toEqual(['code:0', 'code:1', 'code:cancel'])
    const ui = await mountBand($)
    const labels = (await ui.findAll({ type: 'Button' })).filter(found => /^code:\d/.test(found.key ?? '')).map(found => found.text)
    await ui.press({ key: 'code:1' })
    await ui.unmount()
    expect(labels).toEqual(['1. js · 1 line · console.log(1)', '2. python · 2 lines · print(2)'])
    expect(world.copies).toEqual(['print(2)\nprint(3)'])
    expect(world.toasts.join()).toContain('Copied code block (2 lines)')
    expect(await menuKeys($)).toEqual([])
    await personTurn($, world, 'one', 'Only:', '```sh\nls\n```')
    await pickAction($, 'copy-code')
    expect(world.copies.at(-1)).toBe('ls')
  })

  test('Session info copies a plain-text summary', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await pickAction($, 'session-info')
    const text = world.copies[0] ?? ''
    expect(text.split('\n')[0]).toBe('nth-status · /work/acme-web-frontend · feat/gameplay')
    expect(text).toContain('Session: 2h11m · ~$8.42')
    expect(text).toContain('Context: 42% used')
    expect(text).toContain('Agents: 0 running')
    expect(text).not.toContain('API-equivalent estimate')
  })
})

describe('vscode', () => {
  const vscodeBand = ($: Engine, bodyColumns = 50) =>
    $.ui.mount({ plugin: PLUGIN, surface: 'vscode', component: 'AbovePrompt', props: PROPS(bodyColumns, 12) })
  type TBand = Awaited<ReturnType<typeof vscodeBand>>
  const textNamed = async (ui: TBand, text: string) => (await ui.findAll({ type: 'Text' })).find(found => found.text === text)
  /** Presses a band Button by key. */
  const pressIn = async ($: Engine, key: string) => {
    const ui = await vscodeBand($)
    await ui.press({ key })
    await ui.unmount()
  }
  /** The Model and Effort Buttons' text, in order. */
  const pickers = async ($: Engine) => {
    const ui = await vscodeBand($)
    const found = (await ui.findAll({ type: 'Button' })).filter(button => button.key === 'model' || button.key === 'effort')
    await ui.unmount()
    return found.map(button => button.text)
  }
  /** The keys of the open row's choices, in order. */
  const pickKeys = async ($: Engine) => {
    const ui = await vscodeBand($)
    const found = (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => key.startsWith('pick:'))
    await ui.unmount()
    return found
  }
  /** Everything the band shows: its Texts, then each picture's alt, `|` between. */
  const shownIn = async (ui: TBand) =>
    [...(await ui.findAll({ type: 'Text' })).map(found => found.text), ...(await ui.findAll({ type: 'Svg' })).map(found => String(found.props.alt))].join('|')
  const shown = async ($: Engine, bodyColumns = 50) => {
    const ui = await vscodeBand($, bodyColumns)
    const text = await shownIn(ui)
    await ui.unmount()
    return text
  }
  type TNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const textOf = (node: unknown): string => (typeof node === 'string' ? node : ((node as TNode | null)?.children ?? []).map(textOf).join(''))
  /** A drawn subtree's Texts and pictures in order, a picture shown by its alt. */
  const leaves = (node: unknown): { text: string; props: Record<string, unknown> }[] => {
    const n = node as TNode | null
    if (!n || typeof n !== 'object') return []
    if (n.type === 'Text') return [{ text: textOf(n), props: n.props ?? {} }]
    if (n.type === 'Svg') return [{ text: String(n.props?.alt), props: n.props ?? {} }]
    return (n.children ?? []).flatMap(leaves)
  }
  /** Where each figure sits: its row, and its place in the row's drawn order (from the end when negative). */
  const AT = {
    'context-pct': ['context-use', 0],
    tokens: ['context-use', -1],
    'cache-left': ['context-cache', 1],
    compactions: ['context-cache', -1],
    'last-label': ['last', 0],
    'last-time': ['last', 1],
    'last-cost': ['last', -1],
    prompts: ['session', 1],
    'session-time': ['session', 3],
    'session-cost': ['session', -1],
    'five-label': ['five', 0],
    'five-left': ['five', 1],
    'five-at': ['five', 2],
    'five-pct': ['five', -1],
    'seven-label': ['seven', 0],
    'seven-left': ['seven', 1],
    'seven-at': ['seven', 2],
    'seven-pct': ['seven', -1],
  } as const
  /** One figure: a Text's text or a picture's alt, and its props. */
  const figureIn = async (ui: TBand, key: keyof typeof AT) => {
    const [row, at] = AT[key]
    const found = await ui.find({ key: row })
    return found ? leaves({ children: found.children }).at(at) : undefined
  }
  const figure = async ($: Engine, key: keyof typeof AT) => {
    const ui = await vscodeBand($)
    const found = await figureIn(ui, key)
    await ui.unmount()
    return found?.text
  }
  const GREEN = '#2ea043'
  const AMBER = '#bf8700'
  const ORANGE = '#d9730d'
  const RED = '#e5534b'
  const FILLS = { normal: '#2ea0434d', notice: '#d4a0004d', warning: '#e8730a4d', critical: '#e5484d4d' }

  /** A busy session: 92 % context, a warm cache, 12 prompts sent, an agent at work. */
  function busyWorld(): World {
    const world = fullWorld()
    world.surfaces = ['vscode']
    world.modelSettings = { 'claude-opus-5-5': { effortLevel: 'xhigh' } }
    world.agents = [{ id: 'a1', status: 'running', name: 'explorer', description: 'Find code', type: 'Explore' }]
    world.usage.context = { window: 200_000, percent: 92, tokens: 184_000 }
    world.usage.rateLimits[1]!.percentUsed = 75
    world.statusLine = { type: 'command', command: 'node /cfg/nth-dev-kit-hooks/nth-status-statusline.mjs' }
    world.capture = { session_id: 'S1', prompt_cache: { warm: true, expires_at: (NOW + 17 * MIN) / 1000 } }
    world.turns = 12
    world.store = { 'prompts:S1': { v: 1, n: 12, isExact: true } }
    return world
  }

  test('the dashboard: a one-row header with the two pickers, three blocks of two rows, no other control', async ($, on) => {
    const world = busyWorld()
    const clock = engine(on, world)
    await start($, clock)
    await $.turn.start(turn())
    world.usage.cost = { usd: 9.0 }
    await $.turn.complete(ended(395_000))
    await clock.advance(1000)
    const ui = await vscodeBand($)
    expect((await ui.findAll({ type: 'Button' })).map(found => [found.key, found.text, found.props.dimColor])).toEqual([
      ['model', 'Opus 5.5 ▾', true],
      ['effort', 'Xhigh ▾', true],
    ])
    const text = await shownIn(ui)
    for (const part of ['acme-web-frontend', 'feat/gameplay']) expect(text).toContain(part)
    for (const part of ['agent', 'Copy', '▾', '~$']) expect(text).not.toContain(part)
    const figures: Partial<Record<keyof typeof AT, string | RegExp>> = {
      'context-pct': '92%',
      tokens: '184k/200k',
      'cache-left': '16m',
      compactions: '—',
      'last-label': 'Last',
      'last-time': '6m35s',
      'last-cost': '$0.58',
      prompts: '12',
      'session-time': '2h11m',
      'session-cost': '$9.00',
      'five-label': '5h',
      'five-left': '2h29m',
      'five-at': /^\d\d:\d\d$/,
      'five-pct': '68%',
      'seven-label': '7d',
      'seven-left': '2d23h',
      'seven-at': /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/,
      'seven-pct': '75%',
    }
    for (const [key, want] of Object.entries(figures) as [keyof typeof AT, string | RegExp][]) {
      const found = (await figureIn(ui, key))?.text
      if (typeof want === 'string') expect(found).toBe(want)
      else expect(found).toMatch(want)
    }
    // Two rows a block; the cache warm, the prompts marked.
    for (const key of ['context-use', 'context-cache', 'last', 'session', 'five', 'seven']) expect(await ui.find({ key })).toBeDefined()
    const alts = (await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)
    expect(alts).toEqual(expect.arrayContaining(['🛢️', '🔥', '💬']))
    // The large figures: 15 px semibold pictures. Levels alone are colored, per metric: context 92 %
    // Critical, 5h 68 % Notice, 7d 75 % Warning.
    for (const [key, color] of [['context-pct', RED], ['five-pct', AMBER], ['seven-pct', ORANGE], ['five-label', 'currentColor']] as const) {
      const source = String((await figureIn(ui, key))?.props.source)
      expect(source).toContain('font-size="15" font-weight="600"')
      expect(source).toContain(`fill="${color}"`)
    }
    // Each meter row's fill takes the same level as its percentage, softer than it.
    const boxes = await ui.findAll({ type: 'Box' })
    for (const [width, fill] of [['92%', FILLS.critical], ['68%', FILLS.notice], ['75%', FILLS.warning]] as const) {
      expect(boxes.find(found => found.props.width === width)?.props.backgroundColor).toBe(fill)
    }
    // Costs, durations and countdowns keep the panel's text color; labels and tokens its secondary one.
    for (const key of ['last-cost', 'session-cost', 'session-time', 'five-left'] as const) expect((await figureIn(ui, key))?.props.color).toBeUndefined()
    for (const key of ['tokens', 'last-label', 'five-at'] as const) expect((await figureIn(ui, key))?.props.color).toBe('inactive')
    // Each block its own fixed tint and border, rounded.
    const blocks = await Promise.all(['context', 'meta', 'quota'].map(async key => (await ui.find({ key }))?.props))
    expect(blocks.map(props => props?.borderStyle)).toEqual(['round', 'round', 'round'])
    expect(new Set(blocks.map(props => props?.backgroundColor)).size).toBe(3)
    expect(new Set(blocks.map(props => props?.borderColor)).size).toBe(3)
    await ui.unmount()
    expect(world.commands).toEqual([])
    expect(world.configSets).toEqual([])
  })

  test('three blocks in a row, each as wide as its figures plus its share; low rows when stacked narrow', async ($, on) => {
    const world = busyWorld()
    const clock = engine(on, world)
    await start($, clock)
    for (const [columns, height] of [[70, 1.3], [50, 1.3], [48, 1.3], [33, 1.3], [32, 1.15]] as const) {
      const ui = await vscodeBand($, columns)
      // No width of their own: they wrap only when the figures do not fit side by side.
      const blocks = await Promise.all(['context', 'meta', 'quota'].map(async key => (await ui.find({ key }))?.props))
      expect(blocks.map(props => props?.flexGrow)).toEqual([40, 23, 37])
      expect(blocks.map(props => props?.width)).toEqual([undefined, undefined, undefined])
      expect(blocks.map(props => props?.minWidth)).toEqual([undefined, undefined, 23])
      expect((await ui.findAll({ type: 'Box' })).some(found => found.props.flexWrap === 'wrap' && found.props.rowGap === 0.2)).toBe(true)
      for (const key of ['context-use', 'context-cache', 'last', 'session', 'five', 'seven']) expect((await ui.find({ key }))?.props.height).toBe(height)
      await ui.unmount()
    }
  })

  test('a meter row: its figures inside the fill, widened back to the whole row in whole percentages', async ($, on) => {
    const world = busyWorld()
    world.usage.rateLimits = [
      { kind: 'five_hour', percentUsed: 3, resetsAt: new Date(NOW + 150 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 0, resetsAt: new Date(NOW + 3 * 1440 * MIN).toISOString() },
    ]
    const clock = engine(on, world)
    await start($, clock)
    const ui = await vscodeBand($)
    const widths = (await ui.findAll({ type: 'Box' })).map(found => found.props.width).filter(width => typeof width === 'string')
    // 92 %: 109 % of the fill. 3 %: 999 % then 334 %. Nothing at 0 %, whose row is the track alone.
    expect(widths).toEqual(['92%', '109%', '3%', '999%', '334%'])
    for (const width of widths) expect(width).toMatch(/^\d{1,3}%$/)
    expect(await figureIn(ui, 'seven-pct')).toMatchObject({ text: '0%' })
    await ui.unmount()
  })

  test('no quota reading: both rows keep their place, the track alone and a neutral dash', async ($, on) => {
    const world = busyWorld()
    // A session reopened in a new engine process: context and time from its transcript, no window yet.
    world.usage.rateLimits = []
    const clock = engine(on, world)
    await start($, clock)
    const ui = await vscodeBand($)
    expect((await ui.find({ key: 'quota' }))?.props.minWidth).toBe(23)
    for (const key of ['five-pct', 'seven-pct'] as const) expect(await figureIn(ui, key)).toMatchObject({ text: '—', props: { color: 'inactive' } })
    for (const key of ['five-label', 'seven-label'] as const) expect((await figureIn(ui, key))?.text).toBe(key === 'five-label' ? '5h' : '7d')
    expect(await shownIn(ui)).not.toMatch(/\b(68|35)%|\d\d:\d\d/)
    const widths = (await ui.findAll({ type: 'Box' })).map(found => found.props.width).filter(width => typeof width === 'string')
    expect(widths).toEqual(['92%', '109%'])
    await ui.unmount()
    // The first response brings both windows (session.measure), drawn at once.
    world.usage.rateLimits = fullWorld().usage.rateLimits
    await $.session.measure({ context: world.usage.context, rateLimits: world.usage.rateLimits, changed: ['rateLimits'] } as never)
    expect(await figure($, 'five-pct')).toBe('68%')
  })

  test('a window past its reset shows no reading until the next response, not the old figure', async ($, on) => {
    const world = busyWorld()
    world.usage.rateLimits = [
      { kind: 'five_hour', percentUsed: 68, resetsAt: new Date(NOW + 2 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 75, resetsAt: new Date(NOW + 3 * 1440 * MIN).toISOString() },
    ]
    const clock = engine(on, world)
    await start($, clock)
    expect(await figure($, 'five-pct')).toBe('68%')
    await clock.advance(3 * MIN)
    expect(await shown($)).not.toContain('68%')
    expect(await figure($, 'five-pct')).toBe('—')
    expect(await figure($, 'seven-pct')).toBe('75%')
  })

  test('compactions: a confirmed zero only for a session that began empty; earlier ones otherwise unknown', async ($, on) => {
    const messages = [{ role: 'user', text: 'summary', toolUses: [] }]
    // Began empty: a confirmed 0, then each compaction of the main conversation that stood.
    const world = busyWorld()
    world.turns = 0
    const clock = engine(on, world)
    await start($, clock)
    expect(await figure($, 'compactions')).toBe('0')
    world.turns = 3
    world.apiMessages = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    await $.session.compact({ trigger: 'manual', messages } as never)
    await $.session.compact({ trigger: 'precompute', messages } as never)
    await $.session.compact({ trigger: 'auto', agentId: 'a1', messages } as never)
    expect(await figure($, 'compactions')).toBe('1')
    // A plugin reload keeps the count: the session's state survives it.
    await $.session.start({ cwd: '/work/acme-web-frontend', surface: 'terminal', isInteractive: true })
    await clock.settle()
    expect(await figure($, 'compactions')).toBe('1')
    // Another session that began with a conversation (resumed): earlier compactions are unknown.
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    world.sessionId = 'S2'
    await start($, clock)
    const unknown = await vscodeBand($)
    expect(await figureIn(unknown, 'compactions')).toMatchObject({ text: '—', props: { color: 'inactive' } })
    await unknown.unmount()
    await $.session.compact({ trigger: 'auto', messages } as never)
    expect(await figure($, 'compactions')).toBe('≥1')
  })

  test('the cache goes cold; without a capture it is unknown', async ($, on) => {
    const world = busyWorld()
    const clock = engine(on, world)
    await start($, clock)
    world.capture = { session_id: 'S1', prompt_cache: { warm: false, expires_at: (NOW - MIN) / 1000 } }
    await clock.advance(15_000)
    let ui = await vscodeBand($)
    expect((await textNamed(ui, 'Cold'))?.props.color).toBe(AMBER)
    let alts = (await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)
    expect(alts).toContain('⌛')
    expect(alts).not.toContain('🔥')
    await ui.unmount()
    // VS Code runs no status line: the item stays, unknown.
    world.capture = undefined
    await clock.advance(15_000)
    ui = await vscodeBand($)
    expect(await figureIn(ui, 'cache-left')).toMatchObject({ text: '—', props: { color: 'inactive' } })
    alts = (await ui.findAll({ type: 'Svg' })).map(found => found.props.alt)
    expect(alts).toContain('🛢️')
    expect(alts).not.toContain('⌛')
    await ui.unmount()
  })

  /** One request as the engine runs it: its usage reported, its stream read to the end. */
  async function step($: Engine, clock: ReturnType<typeof mock.clock>, world: World, usage: object | null, agentId?: string) {
    world.stepUsage = usage
    const stream = $.turn.step({ turnId: 't', index: 0, model: world.model, messageCount: 1, ...(agentId ? { agentId } : {}) } as never)
    for await (const _ of stream) void _
    await stream.result
    await clock.settle()
  }
  const cacheRow = async ($: Engine) => {
    const ui = await vscodeBand($)
    const found = await ui.find({ key: 'context-cache' })
    await ui.unmount()
    return leaves({ children: found?.children }).map(leaf => leaf.text).slice(0, -2).join(' ')
  }
  const USED = { input_tokens: 40, output_tokens: 300, cache_read_input_tokens: 92_000, cache_creation_input_tokens: 1_500, model: 'claude-opus-5-5' }

  test('the cache without a capture turns cold an hour after its last use, and warm again with the next', { timeoutMs: 60_000 }, async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    const clock = engine(on, world)
    await start($, clock)
    await step($, clock, world, USED)
    expect(await cacheRow($)).toBe('🛢️ ~5m 🔥')
    // Unknown while the TTL could still be the hour; then no TTL keeps it: Cold, not unknown.
    await clock.advance(60 * MIN - 1000)
    expect(await cacheRow($)).toBe('🛢️ —')
    await clock.advance(1000)
    expect(await cacheRow($)).toBe('🛢️ Cold ⌛')
    // The next main-thread use: warm again. A subagent's request since (it may share the prefix)
    // holds Cold off for an hour after it, without vouching for warm.
    await step($, clock, world, USED)
    expect(await cacheRow($)).toBe('🛢️ ~5m 🔥')
    await clock.advance(50 * MIN)
    await step($, clock, world, USED, 'a1')
    await clock.advance(10 * MIN)
    expect(await cacheRow($)).toBe('🛢️ —')
    await clock.advance(50 * MIN)
    expect(await cacheRow($)).toBe('🛢️ Cold ⌛')
    // A compaction drops what was seen: unknown, not Cold.
    await step($, clock, world, USED)
    expect(await cacheRow($)).toBe('🛢️ ~5m 🔥')
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
    expect(await cacheRow($)).toBe('🛢️ —')
    // The terminal without a capture shows the same Cold in its dashboard.
    await step($, clock, world, USED)
    await clock.advance(60 * MIN)
    expect(await cacheRow($)).toBe('🛢️ Cold ⌛')
    // The terminal's dashboard (room for it: 10 rows) without a capture shows the same Cold.
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: PROPS(100, 10) })
    expect(await ui.find({ key: 'zones' })).toBeTruthy()
    const painted = (await ui.findAll({ type: 'Text' })).map(found => found.text).join('')
    await ui.unmount()
    expect(painted).toContain('Cold')
  })

  test('the cache without a capture: warm from the main thread’s cache use, unknown past what is vouched for', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    const clock = engine(on, world)
    await start($, clock)
    // Nothing reported yet, a subagent's request, or one without a response: unknown.
    expect(await cacheRow($)).toBe('🛢️ —')
    await step($, clock, world, USED, 'a1')
    await step($, clock, world, null)
    expect(await cacheRow($)).toBe('🛢️ —')
    // A main-thread request read the cache: warm, its time left an estimate (5 minutes from the
    // request, the TTL unknown; a prefix change no event reports could end its use sooner).
    await step($, clock, world, USED)
    expect(await cacheRow($)).toBe('🛢️ ~5m 🔥')
    await step($, clock, world, null)
    expect(await cacheRow($)).toBe('🛢️ ~5m 🔥')
    // Past what it vouches for: unknown while the TTL could still be the hour (Cold: the next test).
    await clock.advance(4.5 * MIN)
    expect(await cacheRow($)).toBe('🛢️ —')
    // Another model (VS Code's selector): nothing seen of its cache; back to the first, its entry stands.
    await step($, clock, world, USED)
    world.model = 'claude-sonnet-5-5'
    await clock.advance(1000)
    expect(await cacheRow($)).toBe('🛢️ —')
    world.model = 'claude-opus-5-5'
    await clock.advance(1000)
    expect(await cacheRow($)).toBe('🛢️ ~4m 🔥')
    // A compaction replaces the conversation, a plugin reload may change the tools or prompt the
    // prefix holds: what was seen no longer counts.
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
    expect(await cacheRow($)).toBe('🛢️ —')
    await step($, clock, world, USED)
    await $.session.start({ cwd: '/work/acme-web-frontend', surface: 'terminal', isInteractive: true })
    await clock.settle()
    expect(await cacheRow($)).toBe('🛢️ —')
    // A usage without cache tokens (caching off or not reported): unknown.
    await step($, clock, world, { ...USED, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    expect(await cacheRow($)).toBe('🛢️ —')
    // The promptCacheTtl setting's hour: an estimate too, nothing the engine reports confirms it.
    world.cacheTtl = '1h'
    await step($, clock, world, USED)
    await clock.advance(1000)
    expect(await cacheRow($)).toBe('🛢️ ~59m 🔥')
    await clock.advance(58 * MIN)
    expect(await cacheRow($)).toBe('🛢️ ~1m 🔥')
    await clock.advance(MIN)
    expect(await cacheRow($)).toBe('🛢️ —')
    world.cacheTtl = '5m'
    await step($, clock, world, USED)
    expect(await cacheRow($)).toBe('🛢️ ~5m 🔥')
    // `/clear` begins a new conversation: unknown again.
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    world.sessionId = 'S2'
    await start($, clock)
    expect(await cacheRow($)).toBe('🛢️ —')
    // Nothing was sent to measure it, and the terminal band keeps the capture alone.
    expect(world.commands).toEqual([])
    expect(await band($, 'terminal')).not.toContain('Cache')
  })

  test('a turn’s end keeps the cache evidence: timed from its latest request, unknown once that runs out', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    const clock = engine(on, world)
    await start($, clock)
    // A short task whose last request read the cache: still warm after the turn ends.
    await $.turn.start(turn())
    await step($, clock, world, USED)
    await clock.advance(20_000)
    await step($, clock, world, USED)
    await clock.advance(5_000)
    await $.turn.complete(ended(25_000))
    await clock.advance(30_000)
    expect(await cacheRow($)).toBe('🛢️ ~4m 🔥')
    // A long task whose only cache use came at its start (a long tool run after it, one request
    // with no response): unknown by its end.
    await $.turn.start(turn())
    await step($, clock, world, USED)
    await clock.advance(6 * MIN)
    await step($, clock, world, null)
    await $.turn.complete(ended(6 * MIN))
    expect(await cacheRow($)).toBe('🛢️ —')
    // A long task renewed near its end: warm afterwards, timed from that request.
    await $.turn.start(turn())
    await step($, clock, world, USED)
    await clock.advance(9 * MIN)
    await step($, clock, world, USED)
    await clock.advance(20_000)
    await $.turn.complete(ended(9 * MIN + 20_000))
    expect(await cacheRow($)).toBe('🛢️ ~4m 🔥')
    // A task whose requests report no cache use: no warm.
    await $.turn.start(turn())
    await step($, clock, world, { ...USED, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    await $.turn.complete(ended(5_000))
    expect(await cacheRow($)).toBe('🛢️ —')
  })

  test('the time left counts from when the request went out, not from its answer', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    const clock = engine(on, world)
    await start($, clock)
    let release!: () => void
    let reached!: () => void
    const isSent = new Promise<void>(resolve => (reached = resolve))
    world.stepGate = new Promise<void>(resolve => (release = resolve))
    world.onStepStart = reached
    world.stepUsage = USED
    const stream = $.turn.step({ turnId: 't', index: 0, model: world.model, messageCount: 1 } as never)
    const drained = (async () => {
      for await (const _ of stream) void _
      return stream.result
    })()
    await isSent
    // A long answer: its usage arrives three minutes after the cache was read.
    await clock.advance(3 * MIN)
    release()
    await drained
    await clock.settle()
    expect(await cacheRow($)).toBe('🛢️ ~2m 🔥')
    // A resume, whatever the engine guesses of its cache: nothing seen in this process, unknown.
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    world.sessionId = 'S2'
    world.stepGate = undefined
    await start($, clock)
    await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 9000, prompt_cache_likely_expired: true } as never)
    expect(await cacheRow($)).toBe('🛢️ —')
  })

  test('the prompt count: only the person’s prompts, exact from an empty start, through reload, resume and compaction', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    world.turns = 0
    const clock = engine(on, world)
    await start($, clock)
    expect(await figure($, 'prompts')).toBe('0')
    // Counted: typed at the terminal, through Remote Control, in VS Code's composer (an SDK host).
    for (const kind of ['composer', 'bridge', 'sdk']) await $.prompt.submit(typed(`from ${kind}`, { origin: { kind } }))
    // Not counted: a slash command, a meta prompt, a task notification, a peer, a blank, a refusal.
    await $.prompt.submit(typed('/compact now', { command: { name: 'compact', args: 'now' } }))
    await $.prompt.submit(typed('reminder', { isMeta: true }))
    await $.prompt.submit(typed('<task-notification>', { origin: { kind: 'task-notification' } }))
    await $.prompt.submit(typed('hi from a peer', { origin: { kind: 'peer' } }))
    await $.prompt.submit(typed('   '))
    world.dropPrompt = 'blocked'
    await $.prompt.submit(typed('refused'))
    world.dropPrompt = undefined
    world.turns = 9
    expect(await figure($, 'prompts')).toBe('3')
    expect(world.store?.['prompts:S1']).toEqual({ v: 1, n: 3, isExact: true })
    // A plugin reload and a compaction leave it as it is.
    await $.session.start({ cwd: '/work/acme-web-frontend', surface: 'terminal', isInteractive: true })
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
    await clock.settle()
    expect(await figure($, 'prompts')).toBe('3')
    // The same session resumed in a new process: its record carries the exact count on.
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    world.apiMessages = [{ role: 'user', content: [{ type: 'text', text: 'from composer' }] }]
    world.turns = 4
    await start($, clock)
    expect(await figure($, 'prompts')).toBe('3')
    await $.prompt.submit(typed('one more', { origin: { kind: 'sdk' } }))
    expect(await figure($, 'prompts')).toBe('4')
  })

  test('a session that began with history and no record counts at least what it saw', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    world.turns = 5
    world.apiMessages = [{ role: 'user', content: [{ type: 'text', text: 'earlier' }] }]
    const clock = engine(on, world)
    await start($, clock)
    const ui = await vscodeBand($)
    expect(await figureIn(ui, 'prompts')).toMatchObject({ text: '—', props: { color: 'inactive' } })
    await ui.unmount()
    await $.prompt.submit(typed('new', { origin: { kind: 'sdk' } }))
    expect(await figure($, 'prompts')).toBe('≥1')
    // Resumed again later: still a floor, never an exact total.
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    await start($, clock)
    expect(await figure($, 'prompts')).toBe('≥1')
  })

  test('a prompt right after /clear counts exactly, before any tick', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    world.turns = 3
    world.apiMessages = [{ role: 'user', content: [{ type: 'text', text: 'old' }] }]
    const clock = engine(on, world)
    await start($, clock)
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    world.sessionId = 'S2'
    world.turns = 0
    world.apiMessages = []
    await $.prompt.submit(typed('first', { origin: { kind: 'sdk' } }))
    expect(world.store?.['prompts:S2']).toEqual({ v: 1, n: 1, isExact: true })
  })

  test('the store keeps the 200 most recently used prompt records; a damaged or newer one is ignored', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    world.turns = 0
    world.store = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`prompts:old${i}`, { v: 1, n: i, isExact: true }]))
    world.store['prompts:S1'] = { v: 2, n: 50, isExact: true }
    const clock = engine(on, world)
    await start($, clock)
    await $.prompt.submit(typed('hello'))
    const keys = Object.keys(world.store).filter(key => key.startsWith('prompts:'))
    expect(keys.length).toBe(200)
    expect(keys).not.toContain('prompts:old0')
    expect(keys).toContain('prompts:old1')
    expect(keys.at(-1)).toBe('prompts:S1')
    expect(world.store['prompts:S1']).toEqual({ v: 1, n: 1, isExact: true })
  })

  test('before the first response: the last reading this home recorded, faded and marked cached with its age', async ($, on) => {
    const world = busyWorld()
    world.usage.rateLimits = []
    world.store = {
      quota: {
        v: 1,
        five: { pct: 40, resetsAt: NOW + 60 * MIN, observedAt: NOW - 12 * MIN },
        seven: { pct: 20, resetsAt: NOW + 3 * 1440 * MIN, observedAt: NOW - 12 * MIN },
      },
    }
    const clock = engine(on, world)
    await start($, clock)
    const ui = await vscodeBand($)
    // The fill at half strength, the figure the same color faded, its age in place of the reset clock.
    const boxes = await ui.findAll({ type: 'Box' })
    expect(boxes.find(found => found.props.width === '40%')?.props.backgroundColor).toBe('#2ea04326')
    const pct = await figureIn(ui, 'five-pct')
    expect(pct?.text).toBe('40%')
    expect(String(pct?.props.source)).toContain(`fill="${GREEN}"`)
    expect(String(pct?.props.source)).toContain('fill-opacity="0.55"')
    expect(await figureIn(ui, 'five-at')).toMatchObject({ text: 'cached 12m', props: { color: 'inactive' } })
    expect(await figureIn(ui, 'seven-at')).toMatchObject({ text: 'cached 12m', props: { color: 'inactive' } })
    expect(await shownIn(ui)).not.toMatch(/\d\d:\d\d/)
    expect(String((await figureIn(ui, 'seven-pct'))?.props.source)).toContain('fill-opacity="0.55"')
    await ui.unmount()
    // The terminal band shows the same reading, as its newest one.
    expect(await band($, 'terminal')).toContain('40%')
  })

  test('a live reading replaces the cached one and is recorded, at most once a minute when unchanged', async ($, on) => {
    const world = busyWorld()
    world.usage.rateLimits = []
    world.store = { quota: { v: 1, five: { pct: 40, resetsAt: NOW + 60 * MIN, observedAt: NOW - 12 * MIN } } }
    const clock = engine(on, world)
    await start($, clock)
    const live = fullWorld().usage.rateLimits
    const measure = (changed: string[]) =>
      $.session.measure({ context: world.usage.context, rateLimits: live, changed } as never)
    await measure(['rateLimits', 'cost'])
    const ui = await vscodeBand($)
    expect(await shownIn(ui)).not.toContain('cached')
    const pct = await figureIn(ui, 'five-pct')
    expect(pct?.text).toBe('68%')
    expect(String(pct?.props.source)).not.toContain('fill-opacity')
    expect((await ui.findAll({ type: 'Box' })).find(found => found.props.width === '68%')?.props.backgroundColor).toBe(FILLS.notice)
    await ui.unmount()
    const quota = world.store?.quota as { five: { pct: number; observedAt: number }; seven: { pct: number } }
    expect([quota.five.pct, quota.seven.pct]).toEqual([68, 35])
    expect(world.storeSets?.quota).toBe(1)
    await measure(['cost'])
    expect(world.storeSets?.quota).toBe(1)
    // No response behind it (a context change alone): nothing recorded.
    await clock.advance(61_000)
    await measure(['context'])
    expect(world.storeSets?.quota).toBe(1)
    await measure(['context', 'cost'])
    expect(world.storeSets?.quota).toBe(2)
  })

  test('a reading recorded in one session shows as cached in the next; past its reset it goes', async ($, on) => {
    const world = busyWorld()
    world.usage.rateLimits = [
      { kind: 'five_hour', percentUsed: 68, resetsAt: new Date(NOW + 5 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 75, resetsAt: new Date(NOW + 3 * 1440 * MIN).toISOString() },
    ]
    const clock = engine(on, world)
    await start($, clock)
    await $.session.measure({ context: world.usage.context, rateLimits: world.usage.rateLimits, changed: ['rateLimits'] } as never)
    // A new session (a new chat in the same config home), before its first response.
    await $.session.end({ reason: 'clear', sessionId: 'S1' } as never)
    world.sessionId = 'S2'
    world.usage.rateLimits = []
    await start($, clock)
    await clock.advance(2 * MIN)
    let text = await shown($)
    expect(text).toContain('68%')
    expect(text).toContain('cached 2m')
    // The 5h window resets: its cached figure goes; the 7d one stays.
    await clock.advance(4 * MIN)
    text = await shown($)
    expect(text).not.toContain('68%')
    expect(await figure($, 'five-pct')).toBe('—')
    expect(await figure($, 'seven-pct')).toBe('75%')
    expect(await figure($, 'seven-at')).toBe('cached 6m')
  })

  test('the band follows the model and effort the editor own selectors set', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    world.modelSettings = { 'claude-opus-5-5': { effortLevel: 'xhigh' }, 'claude-sonnet-5-5': { effortLevel: 'high' } }
    // A background agent at work does not hold the band back.
    world.agents = [{ id: 'a1', status: 'running', name: 'explorer', description: 'Find code', type: 'Explore' }]
    const clock = engine(on, world)
    await start($, clock)
    expect(await pickers($)).toEqual(['Opus 5.5 ▾', 'Xhigh ▾'])
    // VS Code's model selector: the inline settings layer and the session model change, no event.
    world.model = 'claude-sonnet-5-5'
    await clock.advance(1000)
    expect(await pickers($)).toEqual(['Sonnet 5.5 ▾', 'High ▾'])
    // Its effort selector writes the inline layer, which outranks the model's saved level.
    world.flagEffort = 'low'
    await clock.advance(1000)
    expect(await pickers($)).toEqual(['Sonnet 5.5 ▾', 'Low ▾'])
    // A typed /effort (this session only) is not undone by the next read of unchanged settings.
    await $.command.run({ command: 'effort', args: 'medium' } as never)
    await clock.advance(3000)
    expect(await pickers($)).toEqual(['Sonnet 5.5 ▾', 'Medium ▾'])
  })

  /** A session in VS Code at Opus 5.5, xhigh by its saved setting. */
  function pickerWorld(): World {
    const world = fullWorld()
    world.surfaces = ['vscode']
    world.modelSettings = { 'claude-opus-5-5': { effortLevel: 'xhigh' }, 'claude-sonnet-5-5': { effortLevel: 'high' } }
    return world
  }

  test('a picker opens its choices under the header; a second press, the other picker or Cancel moves on', async ($, on) => {
    const world = pickerWorld()
    const clock = engine(on, world)
    await start($, clock)
    expect(await pickKeys($)).toEqual([])
    await pressIn($, 'model')
    expect(await pickKeys($)).toEqual(['pick:default', 'pick:sonnet', 'pick:opus', 'pick:haiku', 'pick:cancel'])
    expect(await pickers($)).toEqual(['Opus 5.5 ▴', 'Xhigh ▾'])
    await pressIn($, 'model')
    expect(await pickKeys($)).toEqual([])
    await pressIn($, 'model')
    await pressIn($, 'effort')
    expect(await pickKeys($)).toEqual(['pick:low', 'pick:medium', 'pick:high', 'pick:xhigh', 'pick:max', 'pick:cancel'])
    expect(await pickers($)).toEqual(['Opus 5.5 ▾', 'Xhigh ▴'])
    await pressIn($, 'pick:cancel')
    expect(await pickKeys($)).toEqual([])
    expect(world.commands).toEqual([])
    expect(world.configSets).toEqual([])
  })

  test('the current choice is the filled, marked Button; the others and Cancel are outlined', async ($, on) => {
    const clock = engine(on, pickerWorld())
    await start($, clock)
    await pressIn($, 'effort')
    const ui = await vscodeBand($)
    const choices = (await ui.findAll({ type: 'Button' })).filter(found => found.key?.startsWith('pick:'))
    await ui.unmount()
    expect(choices.map(found => [found.text, found.props.dimColor])).toEqual([
      ['Low', true],
      ['Medium', true],
      ['High', true],
      ['● Xhigh', false],
      ['Max', true],
      ['Cancel', true],
    ])
    await pressIn($, 'pick:cancel')
  })

  test('a Model pick runs /model, which VS Code’s session takes, then saves it; the row closes', async ($, on) => {
    const world = pickerWorld()
    const clock = engine(on, world)
    await start($, clock)
    await pressIn($, 'model')
    await pressIn($, 'pick:sonnet')
    expect(world.commands).toEqual([{ command: 'model', args: 'sonnet' }])
    expect(world.configSets).toEqual([{ key: 'model', value: 'sonnet' }])
    expect(await pickKeys($)).toEqual([])
    // No `/effort` ran: the new model's own saved level.
    expect(await pickers($)).toEqual(['Sonnet 5.5 ▾', 'High ▾'])
  })

  test('a Model pick the last /model named first names what is in force; a pick of what is in force runs nothing', async ($, on) => {
    const world = pickerWorld()
    const clock = engine(on, world)
    await start($, clock)
    await pressIn($, 'model')
    await pressIn($, 'pick:sonnet')
    // The extension's selector moves the session, unseen by `/model`.
    world.model = 'claude-haiku-5-5'
    world.modelRow!.value = 'haiku'
    world.commands.length = 0
    await pressIn($, 'model')
    await pressIn($, 'pick:sonnet')
    expect(world.commands).toEqual([
      { command: 'model', args: 'haiku' },
      { command: 'model', args: 'sonnet' },
    ])
    expect(await pickers($)).toEqual(['Sonnet 5.5 ▾', 'High ▾'])
    world.commands.length = 0
    await pressIn($, 'model')
    await pressIn($, 'pick:sonnet')
    expect(world.commands).toEqual([])
  })

  test('a Model the row’s value cannot name again falls back on the default to change /model’s last value', async ($, on) => {
    const world = pickerWorld()
    const clock = engine(on, world)
    await start($, clock)
    await $.command.run({ command: 'model', args: 'haiku' } as never)
    world.modelRow!.value = 'Default (recommended)'
    world.commands.length = 0
    await pressIn($, 'model')
    await pressIn($, 'pick:haiku')
    expect(world.commands).toEqual([
      { command: 'model', args: 'default' },
      { command: 'model', args: 'haiku' },
    ])
  })

  test('an Effort pick runs /effort and the level holds: through the ticks, over the selector’s layer, through a model switch', async ($, on) => {
    const world = pickerWorld()
    world.flagEffort = 'high'
    const clock = engine(on, world)
    await start($, clock)
    expect(await pickers($)).toEqual(['Opus 5.5 ▾', 'High ▾'])
    await pressIn($, 'effort')
    await pressIn($, 'pick:low')
    expect(world.commands).toEqual([{ command: 'effort', args: 'low' }])
    expect(await pickKeys($)).toEqual([])
    expect(await pickers($)).toEqual(['Opus 5.5 ▾', 'Low ▾'])
    await clock.advance(3000)
    expect(await pickers($)).toEqual(['Opus 5.5 ▾', 'Low ▾'])
    // `/effort` outlives a model switch here, so the band does not fall back on the model's level.
    await pressIn($, 'model')
    await pressIn($, 'pick:sonnet')
    await clock.advance(3000)
    expect(await pickers($)).toEqual(['Sonnet 5.5 ▾', 'Low ▾'])
    // The same when the extension's selector switches the model.
    world.model = 'claude-opus-5-5'
    await clock.advance(1000)
    expect(await pickers($)).toEqual(['Opus 5.5 ▾', 'Low ▾'])
    world.model = 'claude-sonnet-5-5'
    await clock.advance(1000)
    // The selector writes another level: that one takes over.
    world.flagEffort = 'medium'
    await clock.advance(1000)
    expect(await pickers($)).toEqual(['Sonnet 5.5 ▾', 'Medium ▾'])
    // A level over the model's cap shows what it was set to.
    world.effortText = "Effort 'max' exceeds the cap; set to 'high' instead (this session only): …"
    await pressIn($, 'effort')
    await pressIn($, 'pick:max')
    expect(await pickers($)).toEqual(['Sonnet 5.5 ▾', 'High ▾'])
  })

  test('a refused change says so and keeps the value shown', async ($, on) => {
    const world = pickerWorld()
    const clock = engine(on, world)
    await start($, clock)
    // `/model` refused: nothing is saved.
    world.modelRefusal = "Model 'fable' is not currently available for your account"
    await pressIn($, 'model')
    await pressIn($, 'pick:sonnet')
    expect(world.toasts.at(-1)).toBe("Model not changed: Model 'fable' is not currently available for your account")
    expect(world.configSets).toEqual([])
    expect(await pickers($)).toEqual(['Opus 5.5 ▾', 'Xhigh ▾'])
    world.modelRefusal = undefined
    // Taken for the session but not saved.
    world.configDenies = 'a policy keeps it'
    await pressIn($, 'model')
    await pressIn($, 'pick:sonnet')
    expect(world.toasts.at(-1)).toBe('Model not saved: a policy keeps it')
    world.configDenies = undefined
    // `/effort` refused.
    world.effortText = 'Invalid effort level'
    await pressIn($, 'effort')
    await pressIn($, 'pick:low')
    expect(world.toasts.at(-1)).toBe('Effort not changed: Invalid effort level')
    expect((await pickers($))[1]).toBe('High ▾')
  })

  test('a picker that cannot change anything is plain text: a locked or missing Model row, no effort setting', async ($, on) => {
    const world = pickerWorld()
    world.modelRow = { value: 'opus', options: ['opus'], isLocked: true }
    const clock = engine(on, world)
    await start($, clock)
    let ui = await vscodeBand($)
    expect(await ui.find({ key: 'model' })).toBeUndefined()
    expect(await textNamed(ui, 'Opus 5.5')).toBeDefined()
    expect((await ui.find({ key: 'effort' }))?.type).toBe('Button')
    await ui.unmount()
    world.modelRow = null
    await clock.advance(15_000)
    ui = await vscodeBand($)
    expect(await ui.find({ key: 'model' })).toBeUndefined()
    expect(await textNamed(ui, 'Opus 5.5')).toBeDefined()
    await ui.unmount()
    // A request went out without effort: the model takes none, so no picker.
    const stream = $.turn.step({ turnId: 't', index: 0, model: world.model, messageCount: 1 } as never)
    for await (const _ of stream) void _
    await clock.settle()
    ui = await vscodeBand($)
    expect(await ui.find({ key: 'effort' })).toBeUndefined()
    await ui.unmount()
  })

  test('the next prompt closes a row left open', async ($, on) => {
    const clock = engine(on, pickerWorld())
    await start($, clock)
    await pressIn($, 'model')
    expect(await pickKeys($)).not.toEqual([])
    await $.turn.start(turn())
    expect(await pickKeys($)).toEqual([])
  })

  test('the detail pane uses the secondary text and readable colors', async ($, on) => {
    const world = fullWorld()
    world.surfaces = ['vscode']
    const clock = engine(on, world)
    await start($, clock)
    const pane = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'vscode',
      component: 'Pane',
      requestId: 'nth-status',
      props: { title: 'nth-status', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    } as never)
    const texts = await pane.findAll({ type: 'Text' })
    await pane.unmount()
    expect(texts.filter(found => found.props.dimColor === true)).toEqual([])
    expect(texts.find(found => found.text.startsWith('Session'))?.props.color).toBe('inactive')
    expect(texts.find(found => found.text.startsWith('~$ is the API-equivalent'))?.props.color).toBe('inactive')
    expect(texts.find(found => found.text.startsWith('68% used'))?.props.color).toBe(AMBER)
  })
})

describe('runtime', () => {
  test('only running agents count; the pane lists name, model, state and elapsed', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    await $.agent.spawn({ prompt: 'look', description: 'Find code', subagentType: 'Explore' } as never)
    world.agents = [
      { id: 'a1', status: 'running', name: 'finder', description: 'Find code', type: 'Explore' },
      { id: 'a2', status: 'completed', description: 'Done one', type: 'general-purpose' },
      { id: 'a3', status: 'idle', name: 'mate', description: 'Teammate', type: 'teammate' },
    ]
    await clock.advance(65_000)
    expect(await band($)).toContain('1 agent')
    await $.command.run({ command: 'nth-status', args: '' } as never)
    expect(world.opened).toEqual(['nth-status'])
    const pane = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'Pane',
      requestId: 'nth-status',
      props: { title: 'nth-status', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    } as never)
    const text = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    await pane.unmount()
    expect(text).toContain('Running agents (1)')
    expect(text).toMatch(/finder\s+Haiku 5\.5\s+running\s+1m05s/)
    expect(text).toContain('resets')
    expect(text).not.toContain('Done one')
  })

  test('Remote Control shows only with a remote client attached', async ($, on) => {
    const world = fullWorld()
    const clock = engine(on, world)
    await start($, clock)
    expect(await band($)).not.toContain('RC On')
    world.surfaces = ['terminal', 'mobile']
    await $.session.attach({ surface: 'mobile', clientId: 'phone' } as never)
    await clock.settle()
    expect(await band($)).toContain('RC On')
  })

  test('the cache countdown comes from the status line capture of this session only', async ($, on) => {
    const world = fullWorld()
    world.statusLine = { type: 'command', command: 'sh "/cfg/nth-dev-kit-hooks/nth-status-statusline.sh"' }
    world.capture = { session_id: 'S1', prompt_cache: { warm: true, ttl: '1h', expires_at: (NOW + 17 * MIN) / 1000, hit_ratio: 0.9 } }
    const clock = engine(on, world)
    await start($, clock)
    expect(await band($)).toContain('17m')
    expect(await band($)).toContain('Warm')
    world.capture = { session_id: 'OTHER', prompt_cache: { warm: true, expires_at: (NOW + 17 * MIN) / 1000 } }
    await clock.advance(15_000)
    expect(await band($)).not.toContain('Cache')
  })

  test('a confirmed expiry shows Cache Cold; an unconfirmed reading shows nothing', async ($, on) => {
    const world = fullWorld()
    world.statusLine = { type: 'command', command: 'sh "/cfg/nth-dev-kit-hooks/nth-status-statusline.sh"' }
    world.capture = { session_id: 'S1', prompt_cache: { warm: true, caching_observed: true, expires_at: (NOW - MIN) / 1000 } }
    const clock = engine(on, world)
    await start($, clock)
    expect(await band($)).toMatch(/Cache\s*Cold/)
    world.capture = { session_id: 'S1', prompt_cache: { warm: false, caching_observed: false, expires_at: null } }
    await clock.advance(15_000)
    expect(await band($)).not.toContain('Cache')
  })

  test('the capture is read beside the script the status line names: the marketplace clone, or Install’s folder', async ($, on) => {
    const world = fullWorld()
    world.capture = { session_id: 'S1', prompt_cache: { warm: true, expires_at: (NOW + 17 * MIN) / 1000 } }
    const LEGACY = '/cfg/nth-dev-kit-hooks/nth-status/statusline-S1.json'
    const CLONE = '/cfg/plugins/marketplaces/namth0712-nth-status/scripts/nth-status/statusline-S1.json'
    // The marketplace clone's script, however the path is written: its captures are beside it.
    world.statusLine = { type: 'command', command: 'sh ~/.claude/plugins/marketplaces/namth0712-nth-status/scripts/nth-status-statusline.sh' }
    world.capturePath = CLONE
    const clock = engine(on, world)
    await start($, clock)
    expect(await band($)).toContain('17m')
    world.statusLine = { type: 'command', command: 'sh "C:\\path\\to\\plugins\\marketplaces\\namth0712-nth-status\\scripts\\nth-status-statusline.sh"' }
    await clock.advance(15_000)
    expect(await band($)).toMatch(/Cache\s*\d+m\s*Warm/)
    // A capture Install's script would write, while the clone's script is named: not this one.
    world.capturePath = LEGACY
    await clock.advance(15_000)
    expect(await band($)).not.toContain('Cache')
    // Install's script (a legacy or nth-dev-kit installation): its folder, as before.
    world.statusLine = { type: 'command', command: 'sh "/cfg/nth-dev-kit-hooks/nth-status-statusline.sh"' }
    await clock.advance(15_000)
    expect(await band($)).toMatch(/Cache\s*\d+m\s*Warm/)
  })

  test('without the capture status line the cache item stays hidden', async ($, on) => {
    const world = fullWorld()
    world.capture = { session_id: 'S1', prompt_cache: { warm: true, expires_at: (NOW + 17 * MIN) / 1000 } }
    const clock = engine(on, world)
    await start($, clock)
    expect(await band($)).not.toContain('Cache')
  })
})
