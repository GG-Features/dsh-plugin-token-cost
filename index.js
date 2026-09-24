/**
 * Host half of `dsh-plugin-token-cost`.
 *
 * One session projection — `tokenCostEstimate` — folds provider-reported usage
 * per model route, and one Cordis Config — the row's own `rates`, `schedule` and
 * `currency` — declares the rates and the schedule that price it.
 *
 * Three properties drive the design:
 *
 * - **Configuration resolves at view time.** Rates, the peak schedule, and the
 *   off-peak multiplier are deployment configuration, not session state, so
 *   editing any of them reprices the complete durable log at the next read
 *   without a state version bump and without invalidating a persisted
 *   checkpoint. The three fields are declared `.volatile()`, so a settings write
 *   commits the new value into the running reference and the next read sees it
 *   with no remount.
 * - **Time is folded, not resolved.** Each sample lands in the slot its request
 *   was committed in — one of the 48 half-hours of a UTC weekday — so an
 *   attempt stays priced by the period it happened in no matter when the
 *   estimate is read. Weekdays are folded too, because a peak schedule that
 *   names days cannot be evaluated from a time of day alone.
 * - **Off-peak is a multiplier, not a second table.** One rate set per route
 *   plus `offPeakMultiplier` cannot drift out of the 1:2 relationship a flat
 *   off-peak discount requires.
 *
 * The projection key is plugin-owned on purpose: `@deepseek-ai/dsh-token-meter`
 * claims `tokenCost`, and a second registration of an existing key defers to
 * the first registration instead of failing.
 *
 * Every priced amount is USD: the declared rates and the adapter's `modelCost`
 * are USD per million tokens, and the view publishes USD. `currency` is display
 * configuration the browser half applies while formatting a number, so choosing
 * another shown currency reprices nothing and moves no persisted state.
 *
 * @module dsh-plugin-token-cost
 */

import z from '@deepseek-ai/schemastery'

/** Half-hour slots per UTC day. */
const SLOTS_PER_DAY = 48
/** Weekdays a slot histogram can address, Monday first. */
const DAYS_PER_WEEK = 7
/** Every slot index the histogram can carry. */
const SLOT_COUNT = SLOTS_PER_DAY * DAYS_PER_WEEK
/** Names the histogram basis the wire view carries, so a reloaded browser half can refuse a mismatch. */
const SLOT_BASIS = 'weekday-half-hour'

/** One route's rates, in USD per million tokens. */
const RateEntry = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  input: z.number().min(0).required(),
  output: z.number().min(0).required(),
  cacheRead: z.number().min(0).required(),
  cacheWrite: z.number().min(0).required(),
})

/** One peak window, in local minutes of day: inclusive start, exclusive end. */
const PeakWindow = z.object({
  startMinutes: z.number().min(0).max(1440).required(),
  endMinutes: z.number().min(0).max(1440).required(),
})

/**
 * When the peak rates apply.
 *
 * Usage outside these windows is off-peak and priced at the peak rates scaled
 * by `offPeakMultiplier`. `peakDays` uses ISO weekday numbers (1 = Monday …
 * 7 = Sunday), so a weekday-only schedule leaves weekends entirely off-peak.
 */
const Schedule = z.object({
  utcOffsetMinutes: z.number().min(-1440).max(1440).required(),
  peakDays: z.array(z.number().min(1).max(7)).min(1).required(),
  peakWindows: z.array(PeakWindow).min(1).required(),
  offPeakMultiplier: z.number().min(0).max(1).required(),
})

/**
 * How the browser half labels a priced amount, and what one USD is worth in it.
 *
 * The field is display-only: rates stay USD per million tokens, the view stays
 * USD, and `rate` (display units per 1 USD, 1 for USD itself) is applied where
 * the number becomes text. No field here can move a priced amount.
 */
const Currency = z.object({
  code: z.string().min(1).required(),
  symbol: z.string().min(1).required(),
  rate: z.number().min(0).required(),
})

/**
 * The plugin's whole configuration: the schedule, the rate table, and the
 * display currency that also back the `token-cost` settings namespace. The
 * composition entry is therefore the namespace's base layer, and a user edit
 * overrides it field by field.
 *
 * `schedule` is optional: without it every attempt is priced at the peak rates.
 * `currency` defaults to plain USD.
 */
export const Config = z.object({
  schedule: z.union([Schedule]).volatile(),
  rates: z.array(RateEntry).default([]).volatile(),
  currency: Currency.default({ code: 'USD', symbol: '$', rate: 1 }).volatile(),
})

/** Loader plugin name. */
export const name = 'dsh-plugin-token-cost'

/**
 * The projection registry this plugin folds into. `settings` is not a hard
 * dependency: the plugin reaches it through an optional child injection in
 * `apply`, so it runs without Settings and only the form-page policy needs it.
 */
export const inject = ['sessionProjections']

/**
 * Every refusal this plugin can state in the schema lives in the schema above:
 * `min(1)` on the peak-day list and on the currency code and symbol, `min(0)` on
 * every rate and on the offset, window and multiplier ranges. dsh 0.1.7 validates
 * a settings write against the plugin's own Config (its `settings` service
 * projects the Loader's resolved config into forms), so the hand-written section
 * guard that the removed `ctx.settings.register(..., { validate })` hook needed
 * has no owner left.
 *
 * Two of that guard's refusals have no schema form and are therefore stated
 * where they can be: an unknown key is no longer refused at the write
 * (schemastery passes it through, and both halves read the declared fields only,
 * so it stays inert), and an empty `peakWindows` list is refused by the rates
 * card rather than by the schema — schemastery skips a collection's `min` check
 * when the element schema carries a default, which every object schema does, so
 * `z.array(PeakWindow).min(1)` would silently accept `[]`.
 */

/** Reject a persisted or restored value whose shape this unit never wrote. */
function requireCount(value, where) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`dsh-plugin-token-cost: ${where} must be a non-negative integer`)
  }
}

/** Validate one four-bucket token group in place. */
function checkBuckets(value, where) {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`dsh-plugin-token-cost: ${where} must be an object`)
  }
  requireCount(value.uncachedInputTokens, `${where}.uncachedInputTokens`)
  requireCount(value.outputTokens, `${where}.outputTokens`)
  requireCount(value.cacheReadTokens, `${where}.cacheReadTokens`)
  requireCount(value.cacheWriteTokens, `${where}.cacheWriteTokens`)
}

/** Validate one route's weekday/half-hour histogram. */
function checkSlots(value, where) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`dsh-plugin-token-cost: ${where} must be an object`)
  }
  for (const key of Object.keys(value)) {
    const index = Number(key)
    if (!Number.isSafeInteger(index) || index < 0 || index >= SLOT_COUNT) {
      throw new Error(`dsh-plugin-token-cost: ${where} key ${JSON.stringify(key)} must be a slot index 0..${SLOT_COUNT - 1}`)
    }
    checkBuckets(value[key], `${where}[${key}]`)
  }
}

/**
 * State schema for the persisted checkpoint. The projection registry takes a
 * Zod-shaped object and only ever calls `parse`, so this hand-written validator
 * keeps the plugin free of a second validation dependency.
 */
const stateSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) {
      throw new Error('dsh-plugin-token-cost: state must be an object')
    }
    if (!Array.isArray(value.routes)) {
      throw new Error('dsh-plugin-token-cost: state.routes must be an array')
    }
    value.routes.forEach((entry, index) => {
      const where = `state.routes[${index}]`
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`dsh-plugin-token-cost: ${where} must be an object`)
      }
      if (typeof entry.provider !== 'string' || entry.provider.length === 0) {
        throw new Error(`dsh-plugin-token-cost: ${where}.provider must be a non-empty string`)
      }
      if (typeof entry.model !== 'string' || entry.model.length === 0) {
        throw new Error(`dsh-plugin-token-cost: ${where}.model must be a non-empty string`)
      }
      checkSlots(entry.slots, `${where}.slots`)
    })
    if (value.current !== null) {
      if (typeof value.current !== 'object') {
        throw new Error('dsh-plugin-token-cost: state.current must be an object or null')
      }
      if (typeof value.current.provider !== 'string' || typeof value.current.model !== 'string') {
        throw new Error('dsh-plugin-token-cost: state.current must name a provider and model')
      }
    }
    if (value.last !== null) {
      if (typeof value.last !== 'object') {
        throw new Error('dsh-plugin-token-cost: state.last must be an object or null')
      }
      requireCount(value.last.turn, 'state.last.turn')
      requireCount(value.last.step, 'state.last.step')
      requireCount(value.last.route, 'state.last.route')
      requireCount(value.last.slot, 'state.last.slot')
      checkBuckets(value.last.buckets, 'state.last.buckets')
    }
    return value
  },
}

/** Validate every value the wire carries for this unit before it leaves the host. */
const viewSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) {
      throw new Error('dsh-plugin-token-cost: view must be an object')
    }
    // The histogram basis travels with the view: a browser bundle reloaded
    // ahead of the host module must not read older slots under newer rules.
    if (value.slotBasis !== SLOT_BASIS) {
      throw new Error(`dsh-plugin-token-cost: view.slotBasis must be ${JSON.stringify(SLOT_BASIS)}`)
    }
    for (const key of ['totalUsd', 'peakUsd', 'offPeakUsd']) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) {
        throw new Error(`dsh-plugin-token-cost: view.${key} must be a non-negative number`)
      }
    }
    const buckets = value.buckets
    if (typeof buckets !== 'object' || buckets === null) {
      throw new Error('dsh-plugin-token-cost: view.buckets must be an object')
    }
    for (const key of ['uncachedInputUsd', 'cacheReadUsd', 'cacheWriteUsd', 'outputUsd']) {
      if (typeof buckets[key] !== 'number' || !Number.isFinite(buckets[key]) || buckets[key] < 0) {
        throw new Error(`dsh-plugin-token-cost: view.buckets.${key} must be a non-negative number`)
      }
    }
    if (!Array.isArray(value.routes)) {
      throw new Error('dsh-plugin-token-cost: view.routes must be an array')
    }
    value.routes.forEach((entry, index) => {
      const where = `view.routes[${index}]`
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`dsh-plugin-token-cost: ${where} must be an object`)
      }
      if (typeof entry.provider !== 'string' || typeof entry.model !== 'string') {
        throw new Error(`dsh-plugin-token-cost: ${where} must name a provider and model`)
      }
      requireCount(entry.uncachedInputTokens, `${where}.uncachedInputTokens`)
      requireCount(entry.outputTokens, `${where}.outputTokens`)
      requireCount(entry.cacheReadTokens, `${where}.cacheReadTokens`)
      requireCount(entry.cacheWriteTokens, `${where}.cacheWriteTokens`)
      checkSlots(entry.slots, `${where}.slots`)
      for (const key of ['usd', 'peakUsd', 'offPeakUsd']) {
        const amount = entry[key]
        if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) {
          throw new Error(`dsh-plugin-token-cost: ${where}.${key} must be a non-negative number when present`)
        }
      }
    })
    return value
  },
}

/** Empty bucket group. */
function zeroBuckets() {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

/** Whether two bucket groups report the same counts. */
function sameBuckets(left, right) {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

/** Whether two slot maps report the same counts. */
function sameSlots(left, right) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => right[key] !== undefined && sameBuckets(left[key], right[key]))
}

/** Whether two routes name the same provider/model pair and carry the same histogram. */
function sameRoute(left, right) {
  return left.provider === right.provider && left.model === right.model && sameSlots(left.slots, right.slots)
}

/** Whether a candidate state carries anything the previous one did not. */
function sameState(left, right) {
  if (left.current === null || right.current === null) {
    if (left.current !== right.current) return false
  } else if (left.current.provider !== right.current.provider || left.current.model !== right.current.model) {
    return false
  }
  if (left.last === null || right.last === null) {
    if (left.last !== right.last) return false
  } else if (left.last.turn !== right.last.turn
    || left.last.step !== right.last.step
    || left.last.route !== right.last.route
    || left.last.slot !== right.last.slot
    || !sameBuckets(left.last.buckets, right.last.buckets)) {
    return false
  }
  if (left.routes.length !== right.routes.length) return false
  for (let index = 0; index < left.routes.length; index += 1) {
    if (!sameRoute(left.routes[index], right.routes[index])) return false
  }
  return true
}

/** One attempt's reported usage as disjoint buckets. */
function bucketsFrom(usage) {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens === undefined ? 0 : usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens === undefined ? 0 : usage.cacheWriteTokens,
  }
}

/** Add one delta to a bucket group; a negated delta subtracts. */
function shifted(base, delta) {
  return {
    uncachedInputTokens: base.uncachedInputTokens + delta.uncachedInputTokens,
    outputTokens: base.outputTokens + delta.outputTokens,
    cacheReadTokens: base.cacheReadTokens + delta.cacheReadTokens,
    cacheWriteTokens: base.cacheWriteTokens + delta.cacheWriteTokens,
  }
}

/** Invert buckets, so one sample can be removed again. */
function negated(buckets) {
  return {
    uncachedInputTokens: -buckets.uncachedInputTokens,
    outputTokens: -buckets.outputTokens,
    cacheReadTokens: -buckets.cacheReadTokens,
    cacheWriteTokens: -buckets.cacheWriteTokens,
  }
}

/**
 * The slot one epoch-millisecond instant belongs to: its UTC ISO weekday
 * (Monday first) times 48 plus its UTC half-hour of day. Folding UTC keeps the
 * histogram independent of the configured offset; the shift happens when the
 * schedule is applied.
 */
function slotOf(time) {
  const isoWeekday = ((new Date(time).getUTCDay() + 6) % 7) + 1
  const minuteOfDay = (((Math.floor(time / 60000) % 1440) + 1440) % 1440)
  return (isoWeekday - 1) * SLOTS_PER_DAY + Math.floor(minuteOfDay / 30)
}

/** One slot's group with a delta applied. */
function shiftedSlot(slots, slot, delta) {
  const base = slots[slot] === undefined ? zeroBuckets() : slots[slot]
  const next = Object.assign({}, slots)
  const total = shifted(base, delta)
  if (sameBuckets(total, zeroBuckets())) delete next[slot]
  else next[slot] = total
  return next
}

/** Replace one route entry, preserving every other entry's identity. */
function withRouteAt(routes, index, entry) {
  const next = routes.slice()
  next[index] = entry
  return next
}

/** Index of one route entry, or -1 while it has no usage yet. */
function routeIndexOf(routes, provider, model) {
  for (let at = 0; at < routes.length; at += 1) {
    if (routes[at].provider === provider && routes[at].model === model) return at
  }
  return -1
}

/** Add one sample to its route's histogram, appending the route on first sight. */
function addSample(routes, provider, model, slot, buckets) {
  const at = routeIndexOf(routes, provider, model)
  if (at === -1) {
    return {
      routes: routes.concat([{ provider, model, slots: { [slot]: buckets } }]),
      index: routes.length,
    }
  }
  const entry = routes[at]
  return {
    routes: withRouteAt(routes, at, {
      provider: entry.provider,
      model: entry.model,
      slots: shiftedSlot(entry.slots, slot, buckets),
    }),
    index: at,
  }
}

/** The route one attempt names itself, when its assembled message carries one. */
function routeOf(event, current) {
  if (event.type === 'assistant/message') {
    const source = event.data.message.source
    if (source !== undefined && source !== null
      && typeof source.provider === 'string' && source.provider.length > 0
      && typeof source.model === 'string' && source.model.length > 0) {
      return { provider: source.provider, model: source.model }
    }
  }
  return current
}

/**
 * Whether one slot's local time is inside the peak schedule.
 *
 * The UTC slot is shifted by the configured offset, which can move it into the
 * neighbouring local weekday. An absent schedule prices everything as peak.
 */
function isPeak(slot, schedule) {
  if (schedule === undefined || schedule === null) return true
  const localTotal = Math.floor(slot / SLOTS_PER_DAY) * 1440
    + (slot % SLOTS_PER_DAY) * 30
    + schedule.utcOffsetMinutes
  const isoWeekday = (((Math.floor(localTotal / 1440) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK) + 1
  if (!schedule.peakDays.includes(isoWeekday)) return false
  const minute = ((localTotal % 1440) + 1440) % 1440
  for (let index = 0; index < schedule.peakWindows.length; index += 1) {
    const window = schedule.peakWindows[index]
    if (minute >= window.startMinutes && minute < window.endMinutes) return true
  }
  return false
}

/** Sum one route's histogram into its peak and off-peak groups. */
function splitBySchedule(slots, schedule) {
  const peak = zeroBuckets()
  const offPeak = zeroBuckets()
  for (const key of Object.keys(slots)) {
    const tokens = slots[key]
    const target = isPeak(Number(key), schedule) ? peak : offPeak
    target.uncachedInputTokens += tokens.uncachedInputTokens
    target.outputTokens += tokens.outputTokens
    target.cacheReadTokens += tokens.cacheReadTokens
    target.cacheWriteTokens += tokens.cacheWriteTokens
  }
  return { peak, offPeak }
}

/** USD for one token group under one rate set, split by bucket. */
function price(tokens, rates) {
  return {
    uncachedInputUsd: tokens.uncachedInputTokens * rates.input / 1_000_000,
    cacheReadUsd: tokens.cacheReadTokens * rates.cacheRead / 1_000_000,
    cacheWriteUsd: tokens.cacheWriteTokens * rates.cacheWrite / 1_000_000,
    outputUsd: tokens.outputTokens * rates.output / 1_000_000,
  }
}

/** The peak rate set scaled into the off-peak rate set. */
function discounted(rates, multiplier) {
  return {
    input: rates.input * multiplier,
    output: rates.output * multiplier,
    cacheRead: rates.cacheRead * multiplier,
    cacheWrite: rates.cacheWrite * multiplier,
  }
}

/**
 * Mount the cost projection over the deployment's declared rates and schedule.
 *
 * The row's own Config is the configuration's only owner: `rates`, `schedule`
 * and `currency` are volatile fields, so a settings write commits new values
 * into these references without remounting the plugin, and every operation
 * reads the reference it needs instead of a copy taken at mount.
 *
 * @param ctx - host plugin context carrying `sessionProjections`.
 * @param config - the row's Config as the Loader parsed it; a direct caller may
 *   pass plain data through `Config(raw)`, which returns the same references.
 */
export function apply(ctx, config = Config({ rates: [] })) {
  // This plugin ships its own rates card, so the settings service must not also
  // build a page for this entry from the schema.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'dsh-plugin-token-cost: settings presentation')
  })

  const llm = ctx.get('llm')

  /**
   * The current value of a volatile config reference, or a plain value a direct
   * caller passed. Captured for one operation and never retained.
   */
  const current = (reference) => (
    reference !== undefined && typeof reference.get === 'function' ? reference.get() : reference
  )

  /** Resolve one exact route's peak rates: the settings table first, then the adapter. */
  const resolveRates = (provider, model) => {
    const entries = current(config.rates) ?? []
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      if (entry.provider === provider && entry.model === model) {
        return { input: entry.input, output: entry.output, cacheRead: entry.cacheRead, cacheWrite: entry.cacheWrite }
      }
    }
    if (llm !== undefined && typeof llm.modelCost === 'function') {
      const adapter = llm.modelCost(provider, model)
      if (adapter !== undefined) {
        return { input: adapter.input, output: adapter.output, cacheRead: adapter.cacheRead, cacheWrite: adapter.cacheWrite }
      }
    }
    return undefined
  }

  const applyEvent = (state, event) => {
    if (event.type === 'llm/retry-started') {
      if (state.last !== null && state.last.turn === event.data.turn && state.last.step === event.data.step) {
        return { routes: state.routes, current: state.current, last: null }
      }
      return state
    }

    let current = state.current
    if (event.type === 'request/header') {
      const next = event.data.header.config
      if (current === null || current.provider !== next.provider || current.model !== next.model) {
        current = { provider: next.provider, model: next.model }
      }
    }

    if (event.type !== 'assistant/message') {
      if (current === state.current
        || (current !== null && state.current !== null
          && current.provider === state.current.provider && current.model === state.current.model)) {
        return state
      }
      return { routes: state.routes, current, last: state.last }
    }

    const usage = event.data.usage
    if (usage === undefined
      || typeof usage.inputTokens !== 'number' || !Number.isFinite(usage.inputTokens)
      || typeof usage.outputTokens !== 'number' || !Number.isFinite(usage.outputTokens)) {
      return current === state.current ? state : { routes: state.routes, current, last: state.last }
    }

    const route = routeOf(event, current)
    if (route === null) {
      return current === state.current ? state : { routes: state.routes, current, last: state.last }
    }

    const { turn, step } = event.data
    const slot = slotOf(event.time)
    let routes = state.routes
    // A repeated settlement of one turn/step replaces its earlier sample; a
    // retry ends that scope above, so another attempt is added instead.
    if (state.last !== null && state.last.turn === turn && state.last.step === step) {
      const previous = state.last
      const entry = routes[previous.route]
      if (entry !== undefined) {
        routes = withRouteAt(routes, previous.route, {
          provider: entry.provider,
          model: entry.model,
          slots: shiftedSlot(entry.slots, previous.slot, negated(previous.buckets)),
        })
      }
    }

    const buckets = bucketsFrom(usage)
    const applied = addSample(routes, route.provider, route.model, slot, buckets)
    const candidate = {
      routes: applied.routes,
      current,
      last: { turn, step, route: applied.index, slot, buckets },
    }
    return sameState(candidate, state) ? state : candidate
  }

  const viewOf = (state) => {
    const buckets = { uncachedInputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0, outputUsd: 0 }
    let peakUsd = 0
    let offPeakUsd = 0
    const schedule = current(config.schedule)
    const multiplier = schedule === undefined || schedule === null ? 1 : schedule.offPeakMultiplier

    const routes = state.routes.map((entry) => {
      const { peak, offPeak } = splitBySchedule(entry.slots, schedule)
      const total = shifted(peak, offPeak)
      const tokens = {
        provider: entry.provider,
        model: entry.model,
        uncachedInputTokens: total.uncachedInputTokens,
        outputTokens: total.outputTokens,
        cacheReadTokens: total.cacheReadTokens,
        cacheWriteTokens: total.cacheWriteTokens,
        slots: entry.slots,
      }

      const rates = resolveRates(entry.provider, entry.model)
      if (rates === undefined) return tokens

      const peakPrice = price(peak, rates)
      const offPeakPrice = price(offPeak, discounted(rates, multiplier))
      for (const key of ['uncachedInputUsd', 'cacheReadUsd', 'cacheWriteUsd', 'outputUsd']) {
        buckets[key] += peakPrice[key] + offPeakPrice[key]
      }
      const routePeakUsd = peakPrice.uncachedInputUsd + peakPrice.cacheReadUsd + peakPrice.cacheWriteUsd + peakPrice.outputUsd
      const routeOffPeakUsd = offPeakPrice.uncachedInputUsd + offPeakPrice.cacheReadUsd + offPeakPrice.cacheWriteUsd + offPeakPrice.outputUsd
      peakUsd += routePeakUsd
      offPeakUsd += routeOffPeakUsd
      return Object.assign({}, tokens, {
        usd: routePeakUsd + routeOffPeakUsd,
        peakUsd: routePeakUsd,
        offPeakUsd: routeOffPeakUsd,
      })
    })

    return {
      slotBasis: SLOT_BASIS,
      totalUsd: buckets.uncachedInputUsd + buckets.cacheReadUsd + buckets.cacheWriteUsd + buckets.outputUsd,
      buckets,
      peakUsd,
      offPeakUsd,
      routes,
    }
  }

  ctx.effect(() => ctx.sessionProjections.register({
    key: 'tokenCostEstimate',
    stateVersion: 3,
    stateSchema,
    init: () => ({ routes: [], current: null, last: null }),
    apply: applyEvent,
    wire: { viewSchema, view: viewOf },
  }), 'dsh-plugin-token-cost: tokenCostEstimate')
}
