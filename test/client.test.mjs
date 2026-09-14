/**
 * Browser-half checks: the settings card's disclosure behaviour and the pill's
 * pricing, mounted in jsdom.
 *
 * The bundle is loaded through a fake module loader exactly as the client module
 * registry loads it, so the test exercises the shipped factory rather than a
 * re-implementation of it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { render, fireEvent, cleanup } = await import('@testing-library/react')
// Simulate is still the only way to drive a React input's onChange from jsdom.
const { Simulate } = await import('react-dom/test-utils')

let captured
dom.window.__ModuleLoader__ = { load(registration) { captured = registration } }
await import('../client.js')
const bundle = captured.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected module request: ${id}`)
})

const RATES = [
  { provider: 'deepseek-official', model: 'deepseek-v4.1-flash', input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
]
const SCHEDULE = {
  utcOffsetMinutes: 480,
  peakDays: [1, 2, 3, 4, 5],
  peakWindows: [{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 840, endMinutes: 1080 }],
  offPeakMultiplier: 0.5,
}

/** The stored namespace document, the writes against it, and the bound scope. */
const store = { value: { schedule: SCHEDULE, rates: RATES }, mutations: [] }
const scope = {
  getSnapshot: () => ({ status: 'ready', value: store.value, revision: 0, writable: true, mode: 'host' }),
  subscribe: () => () => {},
  set: () => Promise.resolve(),
  mutate: (ops) => {
    store.mutations.push(ops)
    for (const op of ops) {
      if (op.op === 'set') store.value = { ...store.value, [op.path[0]]: op.value }
    }
    return Promise.resolve()
  },
}

const registrations = []
bundle.apply({
  get(name) {
    if (name === 'slots') {
      return {
        inject(_key, callback) { callback(); return () => {} },
        register(options, component) { registrations.push({ options, component }); return () => {} },
      }
    }
    if (name === 'settingsScope') return { bind: () => scope }
    if (name === 'locale') return { register: () => () => {}, subscribe: () => () => {}, bind: () => (key) => key }
    return undefined
  },
  effect(callback) {
    const dispose = callback()
    return () => { if (typeof dispose === 'function') dispose() }
  },
})

const card = registrations.find((entry) => entry.options.name === 'settings.plugin.item')
const dock = registrations.find((entry) => entry.options.name === 'conversation.composer.dock')
assert.ok(card, 'the settings card must be registered')
assert.ok(dock, 'the composer pill must be registered')

/** Render the card against a pristine document and return its container. */
function openCard() {
  store.value = { schedule: SCHEDULE, rates: RATES }
  store.mutations = []
  const view = render(React.createElement(card.component, {}))
  const buttonWithText = (text) => [...view.container.querySelectorAll('button')].find((button) => button.textContent === text)
  return { container: view.container, buttonWithText }
}

test('the card starts collapsed and opens on its header', () => {
  const { container } = openCard()
  assert.ok(container.innerHTML.includes('dsh-plugin-token-cost-card__header'))
  assert.ok(!container.innerHTML.includes('__body'), 'collapsed by default')
  assert.ok(container.innerHTML.includes('dsh-plugin-token-cost-card__chevron'))
  assert.ok(!container.innerHTML.includes('dsh-plugin-token-cost-card__tag'), 'no unsaved mark before edits')
  fireEvent.click(container.querySelector('.dsh-plugin-token-cost-card__header'))
  assert.ok(container.innerHTML.includes('__body'), 'open after the header click')
  assert.ok(container.innerHTML.includes('__footer'), 'the save row lives in the footer')
  cleanup()
})

test('the schedule block edits the peak days and windows', () => {
  const { container, buttonWithText } = openCard()
  fireEvent.click(container.querySelector('.dsh-plugin-token-cost-card__header'))
  assert.equal(container.querySelectorAll('.dsh-plugin-token-cost-card__day').length, 7)
  assert.equal(container.querySelectorAll('.dsh-plugin-token-cost-card__day.is-on').length, 5)
  assert.equal(container.querySelectorAll('.dsh-plugin-token-cost-card__window').length, 2)
  fireEvent.click(buttonWithText('card.addWindow'))
  assert.equal(container.querySelectorAll('.dsh-plugin-token-cost-card__window').length, 3, 'a window can be added')
  cleanup()
})

test('a staged edit is marked, saved once, and collapses the card', async () => {
  const { container, buttonWithText } = openCard()
  fireEvent.click(container.querySelector('.dsh-plugin-token-cost-card__header'))
  assert.ok(buttonWithText('card.save').disabled, 'save is disabled with nothing staged')

  const routeBlock = [...container.querySelectorAll('.dsh-plugin-token-cost-card__block')]
    .find((block) => block.querySelector('.dsh-plugin-token-cost-card__provider') !== null)
  const rateInput = routeBlock.querySelector('input[type="number"]')
  await React.act(async () => { Simulate.change(rateInput, { target: { value: '0.5' } }) })
  assert.ok(container.innerHTML.includes('dsh-plugin-token-cost-card__tag'), 'the header marks the edit')
  assert.ok(!buttonWithText('card.save').disabled, 'save enables once an edit is staged')

  fireEvent.click(buttonWithText('card.save'))
  await React.act(async () => {})
  assert.equal(store.mutations.length, 1, 'one footer save writes once')
  assert.equal(store.mutations[0].length, 1, 'a rates-only edit does not rewrite the schedule')
  assert.equal(store.mutations[0][0].path[0], 'rates')
  assert.equal(store.mutations[0][0].value[0].input, 0.5, 'the staged rate reached the write')
  assert.ok(!container.innerHTML.includes('__body'), 'a confirmed save collapses the card')
  cleanup()
})

test('a schedule edit writes the schedule', async () => {
  const { container, buttonWithText } = openCard()
  fireEvent.click(container.querySelector('.dsh-plugin-token-cost-card__header'))
  fireEvent.click([...container.querySelectorAll('.dsh-plugin-token-cost-card__day')][5])
  assert.equal(container.querySelectorAll('.dsh-plugin-token-cost-card__day.is-on').length, 6, 'the day is staged')
  fireEvent.click(buttonWithText('card.save'))
  await React.act(async () => {})
  const ops = store.mutations[store.mutations.length - 1]
  const schedule = ops.find((op) => op.path[0] === 'schedule')
  assert.ok(schedule, 'the schedule op is present')
  assert.ok(schedule.value.peakDays.includes(6), 'the staged day reached the write')
  cleanup()
})

test('discard drops the staged edits without writing', () => {
  const { container, buttonWithText } = openCard()
  fireEvent.click(container.querySelector('.dsh-plugin-token-cost-card__header'))
  fireEvent.click([...container.querySelectorAll('.dsh-plugin-token-cost-card__day')][0])
  assert.ok(container.innerHTML.includes('dsh-plugin-token-cost-card__tag'))
  fireEvent.click(buttonWithText('card.discard'))
  assert.ok(!container.innerHTML.includes('dsh-plugin-token-cost-card__tag'), 'the mark clears')
  assert.equal(container.querySelectorAll('.dsh-plugin-token-cost-card__day.is-on').length, 5, 'the days are restored')
  assert.equal(store.mutations.length, 0, 'discard writes nothing')
  cleanup()
})

test('an incomplete new route is refused rather than added', () => {
  const { container, buttonWithText } = openCard()
  fireEvent.click(container.querySelector('.dsh-plugin-token-cost-card__header'))
  fireEvent.click(buttonWithText('card.add'))
  assert.ok(container.innerHTML.includes('dsh-plugin-token-cost-card__error'), 'the refusal is reported')
  assert.equal(container.querySelectorAll('.dsh-plugin-token-cost-card__block:not(.is-add)').length, 2, 'schedule + one route')
  cleanup()
})

const projection = (overrides = {}) => ({
  slotBasis: 'weekday-half-hour',
  totalUsd: 0.483,
  peakUsd: 0.4,
  offPeakUsd: 0.083,
  buckets: { uncachedInputUsd: 0.135, cacheReadUsd: 0.157, cacheWriteUsd: 0, outputUsd: 0.191 },
  routes: [{
    provider: 'deepseek-official',
    model: 'deepseek-v4.1-flash',
    usd: 0.483,
    uncachedInputTokens: 450700,
    outputTokens: 159100,
    cacheReadTokens: 26160000,
    cacheWriteTokens: 0,
    slots: {
      // Slot 4: Monday 02:00 UTC = 10:00 Beijing, inside a peak window.
      4: { uncachedInputTokens: 300000, outputTokens: 100000, cacheReadTokens: 20000000, cacheWriteTokens: 0 },
      // Slot 24: Monday 12:00 UTC = 20:00 Beijing, off-peak.
      24: { uncachedInputTokens: 150700, outputTokens: 59100, cacheReadTokens: 6160000, cacheWriteTokens: 0 },
    },
    ...overrides,
  }],
})

test('the pill re-prices from the histograms and the schedule', () => {
  store.value = { schedule: SCHEDULE, rates: RATES }
  const view = render(React.createElement(dock.component, { useProjection: () => projection() }))
  assert.ok(view.container.innerHTML.includes('0.407'), `expected the client-priced total, got ${view.container.innerHTML}`)
  cleanup()
})

test('a host view without a matching basis keeps the host numbers', () => {
  store.value = { schedule: SCHEDULE, rates: RATES }
  const stale = projection()
  delete stale.slotBasis
  const view = render(React.createElement(dock.component, { useProjection: () => stale }))
  assert.ok(view.container.innerHTML.includes('0.483'), 'the host total stands')
  cleanup()
})
