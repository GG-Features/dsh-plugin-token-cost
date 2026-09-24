/**
 * Host-half checks: the usage fold, the peak schedule, the pricing, and the
 * schema refusals. Runs on `node --test` with no dependencies.
 *
 * The schedule under test is Beijing time (UTC+8), Monday–Friday 09:00–12:00 and
 * 14:00–18:00 peak, everything else off-peak at half the peak rate.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const plugin = await import('../index.js')

const SCHEDULE = {
  utcOffsetMinutes: 480,
  peakDays: [1, 2, 3, 4, 5],
  peakWindows: [
    { startMinutes: 540, endMinutes: 720 },
    { startMinutes: 840, endMinutes: 1080 },
  ],
  offPeakMultiplier: 0.5,
}
const RATES = [
  { provider: 'p', model: 'm', input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
  { provider: 'q', model: 'n', input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
]

// 2026-01-05 is a Monday and 2026-01-10 a Saturday; Beijing is UTC+8.
const PEAK_MORNING = Date.UTC(2026, 0, 5, 2, 0, 0) // Mon 10:00 Beijing
const PEAK_AFTERNOON = Date.UTC(2026, 0, 5, 7, 0, 0) // Mon 15:00 Beijing
const LUNCH = Date.UTC(2026, 0, 5, 4, 30, 0) // Mon 12:30 Beijing
const EVENING = Date.UTC(2026, 0, 5, 12, 0, 0) // Mon 20:00 Beijing
const WEEKEND = Date.UTC(2026, 0, 10, 2, 0, 0) // Sat 10:00 Beijing

const PEAK_USD = (100 * 1 + 200 * 2 + 1000 * 3) / 1e6
const OFF_USD = (100 * 1 + 200 * 2 + 1000 * 3) * 0.5 / 1e6

/** Mount the plugin against a fake context and expose its projection definition. */
function mount(resolved = { schedule: SCHEDULE, rates: RATES }, config = plugin.Config(resolved)) {
  let captured
  const ctx = {
    logger: { warn() {} },
    effect(callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    get() { return undefined },
    // The optional Settings child: `apply` only states its page policy there.
    inject(_dependencies, callback) {
      callback({ effect: ctx.effect, settings: { configure: () => () => {} } })
    },
    sessionProjections: {
      register(definition) {
        captured = { definition }
        return () => {}
      },
    },
  }
  plugin.apply(ctx, config)
  assert.ok(captured.definition, 'the projection must be registered')
  return {
    definition: captured.definition,
    /** Drive a synthetic event list through the fold and return the wire view. */
    view(events) {
      let state = captured.definition.init({}, 0)
      for (const event of events) state = captured.definition.apply(state, { seq: 0, ...event })
      return captured.definition.wire.viewSchema.parse(captured.definition.wire.view(state))
    },
  }
}

const header = (provider, model) => ({
  type: 'request/header',
  data: { header: { config: { provider, model } }, reason: 'initial' },
})
const message = (turn, step, provider, model, usage, time) => ({
  type: 'assistant/message',
  time,
  data: {
    turn,
    step,
    message: { role: 'assistant', source: { kind: 'model', provider, model } },
    stream: [],
    usage,
  },
})
const retry = (turn, step, time) => ({ type: 'llm/retry-started', time, data: { turn, step, retryId: 'r' } })
const usage = (input, output, cacheRead, cacheWrite) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
})
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`)

test('a peak attempt prices at the peak rates, in either window', () => {
  const host = mount()
  for (const time of [PEAK_MORNING, PEAK_AFTERNOON]) {
    const view = host.view([header('p', 'm'), message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), time)])
    near(view.totalUsd, PEAK_USD, 'peak total')
    near(view.peakUsd, PEAK_USD, 'peak share')
    assert.equal(view.offPeakUsd, 0)
  }
})

test('the lunch break and the evening are off-peak', () => {
  const host = mount()
  for (const time of [LUNCH, EVENING]) {
    const view = host.view([header('p', 'm'), message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), time)])
    near(view.totalUsd, OFF_USD, 'off-peak total')
    assert.equal(view.peakUsd, 0)
    near(view.offPeakUsd, OFF_USD, 'off-peak share')
  }
})

test('a weekend hour that looks like a peak hour is off-peak', () => {
  const host = mount()
  const view = host.view([header('p', 'm'), message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), WEEKEND)])
  near(view.totalUsd, OFF_USD, 'weekend total')
})

test('the local weekday follows the offset', () => {
  // At UTC-8 a UTC Monday 02:00 instant is Sunday 18:00: the UTC weekday is a
  // peak day and the local clock is inside the window, yet the local weekday
  // rules the attempt off-peak.
  const shifted = {
    utcOffsetMinutes: -480,
    peakDays: [1, 2, 3, 4, 5],
    peakWindows: [{ startMinutes: 540, endMinutes: 1200 }],
    offPeakMultiplier: 0.5,
  }
  const host = mount({ schedule: shifted, rates: RATES })
  const view = host.view([header('p', 'm'), message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), Date.UTC(2026, 0, 5, 2, 0, 0))])
  near(view.offPeakUsd, OFF_USD, 'off-peak share')
  assert.equal(view.peakUsd, 0)
})

test('a session spanning both periods prices each attempt with its own rate', () => {
  const host = mount()
  const view = host.view([
    header('p', 'm'),
    message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), PEAK_MORNING),
    message(2, 1, 'p', 'm', usage(100, 200, 1000, 0), EVENING),
  ])
  near(view.totalUsd, PEAK_USD + OFF_USD, 'mixed total')
  near(view.peakUsd, PEAK_USD, 'mixed peak share')
  near(view.offPeakUsd, OFF_USD, 'mixed off-peak share')
  assert.equal(view.routes.length, 1)
})

test('a repeated settlement replaces its earlier sample', () => {
  const host = mount()
  const view = host.view([
    header('p', 'm'),
    message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), PEAK_MORNING),
    message(1, 1, 'p', 'm', usage(10, 20, 100, 0), PEAK_MORNING),
  ])
  near(view.totalUsd, (10 * 1 + 20 * 2 + 100 * 3) / 1e6, 'replaced total')
})

test('a retry bills another attempt, in the period it landed in', () => {
  const host = mount()
  const view = host.view([
    header('p', 'm'),
    message(1, 1, 'p', 'm', usage(10, 0, 0, 0), PEAK_MORNING),
    retry(1, 1, PEAK_MORNING),
    message(1, 1, 'p', 'm', usage(10, 0, 0, 0), EVENING),
  ])
  near(view.totalUsd, 10 / 1e6 + 5 / 1e6, 'retry total')
})

test('a route the table does not cover stays unpriced and out of the total', () => {
  const host = mount()
  const view = host.view([
    header('other', 'nope'),
    message(1, 1, 'other', 'nope', usage(1000, 1000, 0, 0), PEAK_MORNING),
  ])
  assert.equal(view.totalUsd, 0)
  assert.equal(view.routes[0].usd, undefined)
})

test('without a schedule every attempt is peak', () => {
  const host = mount({ rates: RATES }, { rates: RATES })
  const view = host.view([header('p', 'm'), message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), WEEKEND)])
  near(view.totalUsd, PEAK_USD, 'peak total')
  assert.equal(view.offPeakUsd, 0)
})

test('the view carries its histogram basis', () => {
  const host = mount()
  const view = host.view([header('p', 'm'), message(1, 1, 'p', 'm', usage(1, 1, 0, 0), PEAK_MORNING)])
  assert.equal(view.slotBasis, 'weekday-half-hour')
})

test('the state schema accepts what the fold wrote and refuses a foreign histogram', () => {
  const host = mount()
  let state = host.definition.init({}, 0)
  for (const event of [header('p', 'm'), message(1, 1, 'p', 'm', usage(1, 1, 1, 1), PEAK_MORNING)]) {
    state = host.definition.apply(state, { seq: 0, ...event })
  }
  host.definition.stateSchema.parse(state)
  assert.throws(() => host.definition.stateSchema.parse({
    routes: [{
      provider: 'p',
      model: 'm',
      slots: { 336: { uncachedInputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    }],
    current: null,
    last: null,
  }))
})

test('the schema refuses an empty peak-day list and an out-of-range field', () => {
  assert.throws(() => plugin.Config({ rates: RATES, schedule: { ...SCHEDULE, peakDays: [] } }))
  assert.throws(() => plugin.Config({ rates: RATES, schedule: { ...SCHEDULE, offPeakMultiplier: 2 } }))
  assert.throws(() => plugin.Config({ rates: RATES, schedule: { ...SCHEDULE, peakDays: [9] } }))
  plugin.Config({ rates: RATES, schedule: SCHEDULE })
})

test('the config schema defaults the display currency to plain USD', () => {
  assert.deepEqual(plugin.Config({ rates: [] }).currency.get(), { code: 'USD', symbol: '$', rate: 1 })
  assert.deepEqual(
    plugin.Config({ rates: [], currency: { code: 'CNY', symbol: '¥', rate: 7.1 } }).currency.get(),
    { code: 'CNY', symbol: '¥', rate: 7.1 },
  )
  // A half-written currency fails loudly instead of borrowing the USD symbol.
  assert.throws(() => plugin.Config({ rates: [], currency: { code: 'CNY' } }))
})

test('the schema refusals cover the display currency', () => {
  plugin.Config({ rates: RATES, currency: { code: 'CNY', symbol: '¥', rate: 7.1 } })
  assert.throws(() => plugin.Config({ rates: RATES, currency: { code: '', symbol: '¥', rate: 7.1 } }))
  assert.throws(() => plugin.Config({ rates: RATES, currency: { code: 'CNY', symbol: '', rate: 7.1 } }))
  assert.throws(() => plugin.Config({ rates: RATES, currency: { code: 'CNY', symbol: '¥', rate: -1 } }))
})

test('a volatile edit reprices the next read without remounting', () => {
  // The Loader commits a live edit into the same reference, so the projection
  // must read the reference at view time rather than a value captured at mount.
  const rates = { value: RATES }
  const host = mount(undefined, {
    rates: { get: () => rates.value },
    schedule: { get: () => SCHEDULE },
    currency: { get: () => ({ code: 'USD', symbol: '$', rate: 1 }) },
  })
  const events = [header('p', 'm'), message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), PEAK_MORNING)]
  near(host.view(events).totalUsd, PEAK_USD, 'declared rate total')
  rates.value = [{ provider: 'p', model: 'm', input: 2, output: 2, cacheRead: 3, cacheWrite: 4 }]
  near(host.view(events).totalUsd, (100 * 2 + 200 * 2 + 1000 * 3) / 1e6, 'edited rate total')
})

test('a display currency never moves a priced amount', () => {
  const host = mount({ schedule: SCHEDULE, rates: RATES, currency: { code: 'CNY', symbol: '¥', rate: 7.1 } })
  const view = host.view([header('p', 'm'), message(1, 1, 'p', 'm', usage(100, 200, 1000, 0), PEAK_MORNING)])
  near(view.totalUsd, PEAK_USD, 'peak total')
  near(view.routes[0].usd, PEAK_USD, 'route total')
})
