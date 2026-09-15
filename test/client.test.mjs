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
  assert.equal(container.querySelectorAll('.dsh-plugin-token-cost-card__block:not(.is-add)').length, 3, 'currency + schedule + one route')
  cleanup()
})

test('a currency preset stages the code, the symbol and its rate, and one save writes it', async () => {
  const { container, buttonWithText } = openCard()
  fireEvent.click(container.querySelector('.dsh-plugin-token-cost-card__header'))
  assert.ok(
    container.querySelector('.dsh-plugin-token-cost-card__preset.is-on').textContent.includes('USD'),
    'the stored currency is the one marked',
  )
  const preset = [...container.querySelectorAll('.dsh-plugin-token-cost-card__preset')]
    .find((button) => button.textContent.includes('CNY'))
  fireEvent.click(preset)
  assert.ok(container.innerHTML.includes('dsh-plugin-token-cost-card__tag'), 'the header marks the edit')
  fireEvent.click(buttonWithText('card.save'))
  await React.act(async () => {})
  const ops = store.mutations[store.mutations.length - 1]
  const currency = ops.find((op) => op.path[0] === 'currency')
  assert.ok(currency, 'the currency op is present')
  assert.deepEqual(currency.value, { code: 'CNY', symbol: '¥', rate: 7.1 })
  cleanup()
})

test('the card warns while a non-USD currency still reads at par', () => {
  const { container } = openCard()
  fireEvent.click(container.querySelector('.dsh-plugin-token-cost-card__header'))
  const rate = [...container.querySelectorAll('.dsh-plugin-token-cost-card__field')]
    .find((label) => label.textContent.includes('card.currencyRate'))
    .querySelector('input')
  fireEvent.change(rate, { target: { value: '1' } })
  const code = [...container.querySelectorAll('.dsh-plugin-token-cost-card__field')]
    .find((label) => label.textContent.includes('card.currencyCode'))
    .querySelector('input')
  fireEvent.change(code, { target: { value: 'CNY' } })
  assert.ok(container.innerHTML.includes('card.currencyPar'), 'the par rate is called out')
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

test('the pill converts and labels the declared currency', () => {
  store.value = { schedule: SCHEDULE, rates: RATES, currency: { code: 'CNY', symbol: '¥', rate: 7.1 } }
  const view = render(React.createElement(dock.component, { useProjection: () => projection() }))
  // The client-priced 0.407 USD reads as 2.89 CNY at the declared rate.
  assert.ok(view.container.innerHTML.includes('¥'), `expected the declared symbol, got ${view.container.innerHTML}`)
  assert.ok(view.container.innerHTML.includes('2.89'), `expected the converted total, got ${view.container.innerHTML}`)
  assert.ok(!view.container.innerHTML.includes('0.407'), 'the USD total is not shown beside it')
  cleanup()
})

test('the pill says which currency an unpriced session would be shown in', () => {
  store.value = { schedule: SCHEDULE, rates: [], currency: { code: 'CNY', symbol: '¥', rate: 7.1 } }
  const unpriced = projection()
  delete unpriced.routes[0].usd
  delete unpriced.routes[0].peakUsd
  delete unpriced.routes[0].offPeakUsd
  const view = render(React.createElement(dock.component, { useProjection: () => unpriced }))
  assert.ok(view.container.innerHTML.includes('¥—'), 'the unpriced mark carries the symbol')
  cleanup()
})

test('the panel switch writes the display currency', () => {
  store.value = { schedule: SCHEDULE, rates: RATES }
  store.mutations = []
  const view = render(React.createElement(dock.component, { useProjection: () => projection() }))
  fireEvent.click(view.container.querySelector('.dsh-plugin-token-cost'))
  const chip = [...view.container.querySelectorAll('.dsh-plugin-token-cost__currency')]
    .find((button) => button.textContent.includes('EUR'))
  fireEvent.click(chip)
  assert.deepEqual(store.mutations[store.mutations.length - 1], [
    { op: 'set', path: ['currency'], value: { code: 'EUR', symbol: '€', rate: 0.92 } },
  ])
  cleanup()
})

/**
 * The breakdown is one grid owned by the panel: rows are `display: contents`,
 * so a row's cells are placed by the panel's tracks. Two things make that work
 * and are therefore pinned here — every cell declares its column, and a row's
 * cells are emitted in ascending column order, which is what sparse
 * auto-placement needs to keep them on one grid row.
 */
test('the breakdown declares one shared column order', () => {
  store.value = { schedule: SCHEDULE, rates: RATES }
  const view = render(React.createElement(dock.component, { useProjection: () => projection() }))
  fireEvent.click(view.container.querySelector('.dsh-plugin-token-cost'))

  const panel = view.container.querySelector('.dsh-plugin-token-cost__panel')
  assert.ok(panel, 'the panel is open')
  assert.ok(
    view.container.querySelector('.dsh-plugin-token-cost__num.is-usd.dsh-plugin-token-cost__total'),
    'the header total sits in the money column',
  )

  const columnOf = (cell) => {
    if (cell.classList.contains('dsh-plugin-token-cost__dot')) return 1
    if (cell.classList.contains('dsh-plugin-token-cost__label')) return cell.closest('.is-route') ? 1 : 2
    if (cell.classList.contains('is-tokens')) return 3
    if (cell.classList.contains('is-share')) return 4
    if (cell.classList.contains('is-usd')) return 5
    return 0
  }

  const rows = [...panel.querySelectorAll('.dsh-plugin-token-cost__row')]
  const bucketRows = rows.filter((row) => !row.classList.contains('is-route') && !row.classList.contains('is-window'))
  const windowRows = rows.filter((row) => row.classList.contains('is-window'))
  const routeRows = rows.filter((row) => row.classList.contains('is-route'))
  assert.equal(bucketRows.length, 4, 'one row per priced bucket')
  assert.equal(windowRows.length, 2, 'peak and off-peak')
  assert.equal(routeRows.length, 1, 'one row per priced route')

  for (const row of rows) {
    const columns = [...row.children].map(columnOf)
    assert.ok(columns.every((column) => column > 0), `every cell names a column: ${row.className}`)
    assert.deepEqual(
      columns,
      [...columns].sort((left, right) => left - right),
      `a row's cells are emitted in column order: ${row.className}`,
    )
  }

  for (const row of bucketRows) {
    assert.deepEqual([...row.children].map(columnOf), [1, 2, 3, 4, 5], 'a bucket row fills every column')
  }
  for (const row of windowRows) {
    assert.deepEqual([...row.children].map(columnOf), [1, 2, 4, 5], 'a window row has no token count')
  }
  assert.deepEqual([...routeRows[0].children].map(columnOf), [1, 5], 'a route row spans the label columns')
  cleanup()
})

test('the shipped stylesheet places every cell in that shared grid', () => {
  const styles = [...document.head.querySelectorAll('style[data-plugin="dsh-plugin-token-cost"]')]
    .map((tag) => tag.textContent)
    .join('\n')
  assert.ok(styles.length > 0, 'the bundle injects its stylesheet')
  assert.match(styles, /__panel \{[^}]*display: grid/, 'the panel owns the grid')
  assert.match(styles, /__head, \.dsh-plugin-token-cost__row \{ display: contents; \}/, 'rows are transparent boxes')
  for (const [selector, column] of [['is-tokens', 3], ['is-share', 4], ['is-usd', 5]]) {
    assert.ok(
      styles.includes(`.dsh-plugin-token-cost__num.${selector} { grid-column: ${column}; }`),
      `${selector} is placed in column ${column}`,
    )
  }
})
