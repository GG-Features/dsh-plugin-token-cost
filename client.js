/**
 * Browser half of `dsh-plugin-token-cost`.
 *
 * Two contributions: the cost pill (with its breakdown panel) in the composer
 * dock, and the `Token rates` card in Settings → Plugins → Plugin configuration.
 *
 * The pill re-prices in the browser from the projection's weekday/half-hour
 * histograms and the live `token-cost` settings scope — rates *and* the peak
 * schedule with its off-peak multiplier — so editing either one shows
 * immediately instead of waiting for the next projection state change: the host
 * view only republishes when the folded state moves, and configuration edits do
 * not move it.
 *
 * This bundle is hand-written in the module factory format the client module
 * system consumes, so the package needs no build step: React arrives through
 * the seeded module table, everything else lives in this factory.
 *
 * The peak-schedule predicate is duplicated from the host half on purpose: the
 * two halves share no module, and it is twenty lines.
 *
 * Layout note: the settings content column is roughly 600px wide on a laptop,
 * so both surfaces lay out with wrapping flex rows and no fixed column count.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-token-cost',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Settings namespace this plugin's host half registers. */
    const NS = 'token-cost'
    /** Client-visible projection key this plugin's host half registers. */
    const PROJECTION = 'tokenCostEstimate'
    /** ISO weekday numbers in display order, Monday first. */
    const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
    /** Histogram basis this bundle understands; a host publishing another one is priced by the host. */
    const SLOT_BASIS = 'weekday-half-hour'

    const BUCKETS = [
      { key: 'uncachedInput', tokens: 'uncachedInputTokens', usd: 'uncachedInputUsd', cls: 'is-input' },
      { key: 'cacheRead', tokens: 'cacheReadTokens', usd: 'cacheReadUsd', cls: 'is-cache-read' },
      { key: 'cacheWrite', tokens: 'cacheWriteTokens', usd: 'cacheWriteUsd', cls: 'is-cache-write' },
      { key: 'output', tokens: 'outputTokens', usd: 'outputUsd', cls: 'is-output' },
    ]

    const EN = {
      'pill.title': 'Estimated session cost from provider-reported usage and declared rates',
      'pill.unpriced': 'unpriced',
      'panel.title': 'Estimated cost',
      'panel.routes': 'Routes',
      'panel.peak': 'Peak',
      'panel.offPeak': 'Off-peak',
      'bucket.uncachedInput': 'Uncached input',
      'bucket.cacheRead': 'Cache read',
      'bucket.cacheWrite': 'Cache write',
      'bucket.output': 'Output',
      'card.title': 'Token rates',
      'card.description': 'Declared token rates and the peak schedule that prices each session.',
      'card.unsaved': 'unsaved',
      'card.discard': 'Discard',
      'card.expand': 'Expand',
      'card.collapse': 'Collapse',
      'card.caption': 'USD per 1M tokens, per route. Attempts inside the peak schedule below use these rates; every other attempt uses them scaled by the off-peak multiplier.',
      'card.rates': 'Declared rates',
      'card.schedule': 'Peak schedule',
      'card.offset': 'UTC offset (min)',
      'card.peakDays': 'Peak days',
      'card.peakWindows': 'Peak windows',
      'card.start': 'Start',
      'card.end': 'End',
      'card.addWindow': 'Add window',
      'card.multiplier': 'Off-peak multiplier',
      'card.scheduleHint': 'Local time, inclusive start and exclusive end, matched at half-hour granularity. Anything outside the windows — including every day not listed — is off-peak.',
      'card.save': 'Save',
      'card.remove': 'Remove',
      'card.add': 'Add route',
      'card.addTitle': 'Add a route',
      'card.provider': 'Provider',
      'card.model': 'Model',
      'card.input': 'Input',
      'card.output': 'Output',
      'card.cacheRead': 'Cache read',
      'card.cacheWrite': 'Cache write',
      'card.empty': 'No route is priced yet. Add one below to price its usage.',
      'card.loading': 'Reading declared rates…',
      'card.readonly': 'This browser cannot write the settings document; rates are read-only here.',
      'card.invalid': 'Rates must be numbers >= 0, and the route needs a provider and a model.',
      'card.scheduleInvalid': 'The schedule needs a UTC offset in minutes, at least one peak day, at least one HH:MM window, and an off-peak multiplier between 0 and 1.',
      'card.failed': 'The host refused the write.',
      'day.1': 'Mon', 'day.2': 'Tue', 'day.3': 'Wed', 'day.4': 'Thu', 'day.5': 'Fri', 'day.6': 'Sat', 'day.7': 'Sun',
    }

    const ZH = {
      'pill.title': '按 provider 上报的用量与声明的费率估算的会话花费',
      'pill.unpriced': '未定价',
      'panel.title': '预估花费',
      'panel.routes': '路由',
      'panel.peak': '峰时',
      'panel.offPeak': '闲时',
      'bucket.uncachedInput': '未命中输入',
      'bucket.cacheRead': '缓存读取',
      'bucket.cacheWrite': '缓存写入',
      'bucket.output': '输出',
      'card.title': '费率与计费时段',
      'card.description': '声明各路由的 token 费率，以及决定峰/闲时段的计费规则。',
      'card.unsaved': '未保存',
      'card.discard': '放弃',
      'card.expand': '展开',
      'card.collapse': '收起',
      'card.caption': '单位 USD / 百万 token，按路由配置。落在下面的高峰时段内的请求用这些费率，其余按费率 × 闲时倍率计算。',
      'card.rates': '已声明的费率',
      'card.schedule': '计费时段',
      'card.offset': 'UTC 偏移（分钟）',
      'card.peakDays': '高峰日',
      'card.peakWindows': '高峰时段',
      'card.start': '开始',
      'card.end': '结束',
      'card.addWindow': '添加时段',
      'card.multiplier': '闲时倍率',
      'card.scheduleHint': '本地时间，起始含、结束不含，按半小时对齐。时段之外——以及不在高峰日列表里的每一天——都按闲时计价。',
      'card.save': '保存',
      'card.remove': '删除',
      'card.add': '添加',
      'card.addTitle': '添加路由',
      'card.provider': 'Provider',
      'card.model': '模型',
      'card.input': '输入',
      'card.output': '输出',
      'card.cacheRead': '缓存读取',
      'card.cacheWrite': '缓存写入',
      'card.empty': '还没有任何路由定价，在下面添加一条即可开始计价。',
      'card.loading': '正在读取已声明的费率…',
      'card.readonly': '当前浏览器无法写入设置文档，费率在此只读。',
      'card.invalid': '费率必须是不小于 0 的数字，并且需要填写 provider 与模型。',
      'card.scheduleInvalid': '时段需要：UTC 偏移（分钟）、至少一个高峰日、至少一个 HH:MM 时段，以及 0~1 之间的闲时倍率。',
      'card.failed': '宿主拒绝了这次写入。',
      'day.1': '一', 'day.2': '二', 'day.3': '三', 'day.4': '四', 'day.5': '五', 'day.6': '六', 'day.7': '日',
    }

    const CSS = [
      /* composer pill */
      '.dsh-plugin-token-cost { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px;',
      '  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1);',
      '  color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 11px; line-height: 1;',
      '  font-variant-numeric: tabular-nums; cursor: pointer; user-select: none; }',
      '.dsh-plugin-token-cost:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dsh-plugin-token-cost.is-open { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }',
      '.dsh-plugin-token-cost.is-unpriced { opacity: 0.65; cursor: default; }',
      '.dsh-plugin-token-cost__mark { color: var(--dsw-alias-state-success-primary); }',
      '.dsh-plugin-token-cost__wrap { display: flex; flex-direction: column; align-items: center; gap: 6px;',
      '  width: 100%; max-width: var(--dsh-composer-card-max-width, 720px); margin-top: 4px; }',
      // One grid for the whole breakdown, not one per row: rows are transparent
      // boxes and their cells are placed into the panel's own columns, so the
      // token, share and USD columns share one geometry and every figure lines
      // up whatever its width. A per-row grid cannot do that — an `auto` track
      // is sized by the row's own content, which drifts from row to row.
      '.dsh-plugin-token-cost__panel { box-sizing: border-box; width: 100%; padding: 10px 12px; text-align: left;',
      '  display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto auto; column-gap: 8px; align-items: center;',
      '  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1);',
      '  color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 18px; }',
      '.dsh-plugin-token-cost__head, .dsh-plugin-token-cost__row { display: contents; }',
      // Cells are declared in ascending column order so sparse auto-placement
      // keeps each row's cells on one grid row.
      '.dsh-plugin-token-cost__title { grid-column: 1 / 4; color: var(--dsw-alias-label-primary); font-size: 12px; }',
      '.dsh-plugin-token-cost__total { grid-column: 5; color: var(--dsw-alias-label-primary); font-size: 12px;',
      '  text-align: right; font-variant-numeric: tabular-nums; }',
      '.dsh-plugin-token-cost__strip { grid-column: 1 / -1; display: flex; height: 4px; margin: 8px 0 10px; border-radius: 2px;',
      '  overflow: hidden; background: var(--dsw-alias-bg-layer-2); }',
      '.dsh-plugin-token-cost__seg { display: block; min-width: 1px; }',
      '.dsh-plugin-token-cost__dot { grid-column: 1; width: 8px; height: 8px; border-radius: 2px; }',
      '.dsh-plugin-token-cost__dot.is-peak { background: var(--dsw-alias-brand-primary); }',
      '.dsh-plugin-token-cost__dot.is-off-peak { background: var(--dsw-alias-state-success-primary); }',
      '.dsh-plugin-token-cost__label { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      // A route row has no dot, so its label starts at the panel edge — level
      // with the section caption — and still leaves the USD in the shared column.
      '.dsh-plugin-token-cost__row.is-route > .dsh-plugin-token-cost__label { grid-column: 1 / 5; }',
      '.dsh-plugin-token-cost__num { text-align: right; font-variant-numeric: tabular-nums; }',
      '.dsh-plugin-token-cost__num.is-tokens { grid-column: 3; }',
      '.dsh-plugin-token-cost__num.is-share { grid-column: 4; }',
      '.dsh-plugin-token-cost__num.is-usd { grid-column: 5; }',
      '.dsh-plugin-token-cost__caption { grid-column: 1 / -1; margin: 10px 0 4px; padding-top: 8px;',
      '  border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }',
      '.dsh-plugin-token-cost__dot.is-input, .dsh-plugin-token-cost__seg.is-input { background: var(--dsw-alias-brand-primary); }',
      '.dsh-plugin-token-cost__dot.is-cache-read, .dsh-plugin-token-cost__seg.is-cache-read { background: var(--dsw-alias-state-success-primary); }',
      '.dsh-plugin-token-cost__dot.is-cache-write, .dsh-plugin-token-cost__seg.is-cache-write { background: var(--dsw-alias-state-warn-primary); }',
      '.dsh-plugin-token-cost__dot.is-output, .dsh-plugin-token-cost__seg.is-output { background: var(--dsw-alias-label-secondary); }',
      /* settings card: the same disclosure chrome the shipped plugin cards use */
      '.dsh-plugin-token-cost-card { list-style: none; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 16px;',
      '  background: var(--dsw-alias-bg-layer-3); transition: border-color .16s, background .16s; }',
      '.dsh-plugin-token-cost-card:hover { border-color: var(--dsw-alias-label-dimmed); }',
      '.dsh-plugin-token-cost-card.is-open { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }',
      '.dsh-plugin-token-cost-card__header { box-sizing: border-box; width: 100%; appearance: none; border: 0; background: none;',
      '  font: inherit; color: inherit; text-align: left; cursor: pointer; display: flex; align-items: center;',
      '  gap: 12px; padding: 14px 16px; border-radius: 12px; }',
      '.dsh-plugin-token-cost-card__header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }',
      '.dsh-plugin-token-cost-card__headText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }',
      '.dsh-plugin-token-cost-card__name { font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }',
      '.dsh-plugin-token-cost-card__description { font-size: 13px; line-height: 1.4; color: var(--dsw-alias-label-secondary); }',
      '.dsh-plugin-token-cost-card__tag { flex: 0 0 auto; padding: 1px 8px; border-radius: 999px;',
      '  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }',
      '.dsh-plugin-token-cost-card__chevron { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); transition: transform .16s; }',
      '.dsh-plugin-token-cost-card.is-open .dsh-plugin-token-cost-card__chevron { transform: rotate(180deg); }',
      '.dsh-plugin-token-cost-card__body { display: flex; flex-direction: column; gap: 10px; padding: 0 16px 14px;',
      '  color: var(--dsw-alias-label-secondary); font-size: 12px; }',
      '.dsh-plugin-token-cost-card__caption { line-height: 18px; }',
      '.dsh-plugin-token-cost-card__heading { color: var(--dsw-alias-label-primary); font-size: 12px; }',
      '.dsh-plugin-token-cost-card__block { box-sizing: border-box; padding: 10px 12px;',
      '  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }',
      '.dsh-plugin-token-cost-card__block.is-add { border-style: dashed; background: transparent; }',
      '.dsh-plugin-token-cost-card__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }',
      '.dsh-plugin-token-cost-card__model { flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis;',
      '  white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 500; }',
      '.dsh-plugin-token-cost-card__provider { color: var(--dsw-alias-label-secondary); font-weight: 400; }',
      '.dsh-plugin-token-cost-card__group { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 8px 14px; }',
      '.dsh-plugin-token-cost-card__group + .dsh-plugin-token-cost-card__group { margin-top: 8px; }',
      '.dsh-plugin-token-cost-card__groupLabel { flex: 0 0 60px; padding-bottom: 6px; }',
      '.dsh-plugin-token-cost-card__days { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 1px; }',
      '.dsh-plugin-token-cost-card__day { width: 34px; height: 26px; padding: 0; }',
      '.dsh-plugin-token-cost-card__day.is-on { border-color: var(--dsw-alias-brand-primary);',
      '  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }',
      '.dsh-plugin-token-cost-card__window { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 8px 14px; }',
      '.dsh-plugin-token-cost-card__window + .dsh-plugin-token-cost-card__window { margin-top: 6px; }',
      '.dsh-plugin-token-cost-card__field { display: flex; flex-direction: column; gap: 3px; }',
      '.dsh-plugin-token-cost-card__fieldLabel { font-size: 11px; }',
      '.dsh-plugin-token-cost-card__actions { display: flex; gap: 6px; flex: 0 0 auto; }',
      '.dsh-plugin-token-cost-card__hint { margin-top: 8px; font-size: 11px; line-height: 16px; }',
      '.dsh-plugin-token-cost-card input { box-sizing: border-box; height: 26px; padding: 0 8px;',
      '  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base);',
      '  color: var(--dsw-alias-label-primary); font: inherit; font-variant-numeric: tabular-nums; }',
      '.dsh-plugin-token-cost-card input[type="number"] { width: 92px; }',
      '.dsh-plugin-token-cost-card input[type="text"] { width: 178px; }',
      '.dsh-plugin-token-cost-card input.is-clock { width: 74px; }',
      '.dsh-plugin-token-cost-card__body button { height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1);',
      '  border-radius: 6px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);',
      '  font: inherit; cursor: pointer; white-space: nowrap; }',
      '.dsh-plugin-token-cost-card__body button:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dsh-plugin-token-cost-card__body button:disabled { opacity: 0.5; cursor: default; }',
      '.dsh-plugin-token-cost-card__error { color: var(--dsw-alias-state-error-primary); }',
      '.dsh-plugin-token-cost-card__empty { padding: 4px 0 8px; }',
      '.dsh-plugin-token-cost-card__footer { display: flex; justify-content: flex-end; gap: 8px; }',
      '.dsh-plugin-token-cost-card__save { border-color: var(--dsw-alias-brand-primary);',
      '  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }',
    ].join('\n')

    /** USD text that keeps a small estimate readable without meaningless digits. */
    function formatUsd(amount) {
      if (!Number.isFinite(amount) || amount <= 0) return '0'
      if (amount < 0.0001) return '<0.0001'
      if (amount < 0.01) return amount.toFixed(4)
      if (amount < 1) return amount.toFixed(3)
      return amount.toFixed(2)
    }

    /** Compact token count. */
    function formatTokens(count) {
      if (count >= 1000000000) return (count / 1000000000).toFixed(2) + 'B'
      if (count >= 1000000) return (count / 1000000).toFixed(2) + 'M'
      if (count >= 1000) return (count / 1000).toFixed(1) + 'k'
      return String(count)
    }

    /** One priced part's share of the priced total, as display text. */
    function shareOf(part, total) {
      return total <= 0 ? '0.0' : (part / total * 100).toFixed(1)
    }

    /** Readable text from a rejected promise or thrown value. */
    function messageOf(failure) {
      if (failure !== null && failure !== undefined && typeof failure.message === 'string') return failure.message
      return String(failure)
    }

    /** One rate table key. */
    function rateKey(provider, model) {
      return provider + '\u0000' + model
    }

    /** Whether one slot's local time is inside the peak schedule. Mirrors the host half. */
    function isPeak(slot, schedule) {
      if (schedule === null || schedule === undefined) return true
      const localTotal = Math.floor(slot / 48) * 1440 + (slot % 48) * 30 + schedule.utcOffsetMinutes
      const isoWeekday = (((Math.floor(localTotal / 1440) % 7) + 7) % 7) + 1
      if (!schedule.peakDays.includes(isoWeekday)) return false
      const minute = ((localTotal % 1440) + 1440) % 1440
      return schedule.peakWindows.some((window) => minute >= window.startMinutes && minute < window.endMinutes)
    }

    /** Sum one four-bucket token group into a scalar. */
    function sumTokens(group) {
      return group.uncachedInputTokens + group.outputTokens + group.cacheReadTokens + group.cacheWriteTokens
    }

    /** USD per bucket for one token group under one rate set. */
    function priceGroup(tokens, rates) {
      return {
        uncachedInputUsd: tokens.uncachedInputTokens * rates.input / 1000000,
        cacheReadUsd: tokens.cacheReadTokens * rates.cacheRead / 1000000,
        cacheWriteUsd: tokens.cacheWriteTokens * rates.cacheWrite / 1000000,
        outputUsd: tokens.outputTokens * rates.output / 1000000,
      }
    }

    /** Split one route's histogram and price both halves from the live table. */
    function priceRoute(route, entry, schedule) {
      const peak = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      const offPeak = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      for (const key of Object.keys(route.slots)) {
        const tokens = route.slots[key]
        const target = isPeak(Number(key), schedule) ? peak : offPeak
        target.uncachedInputTokens += tokens.uncachedInputTokens
        target.outputTokens += tokens.outputTokens
        target.cacheReadTokens += tokens.cacheReadTokens
        target.cacheWriteTokens += tokens.cacheWriteTokens
      }
      const multiplier = schedule === null || schedule === undefined ? 1 : schedule.offPeakMultiplier
      const peakRates = { input: entry.input, output: entry.output, cacheRead: entry.cacheRead, cacheWrite: entry.cacheWrite }
      const offRates = {
        input: peakRates.input * multiplier,
        output: peakRates.output * multiplier,
        cacheRead: peakRates.cacheRead * multiplier,
        cacheWrite: peakRates.cacheWrite * multiplier,
      }
      return { peak, offPeak, peakPrice: priceGroup(peak, peakRates), offPrice: priceGroup(offPeak, offRates) }
    }

    /**
     * Re-price a host view from the live settings table and schedule.
     *
     * A table that does not cover every route with usage leaves the host view
     * untouched: the host also prices adapter-declared rates the browser cannot
     * see, and mixing the two would silently omit part of the total. A host half
     * that publishes no histograms — older code, or an older slot basis — lands
     * in the same branch rather than reading its slots under the wrong rules.
     */
    function priceView(value, settings) {
      const table = {}
      settings.rates.forEach((entry) => { table[rateKey(entry.provider, entry.model)] = entry })
      const covered = value.slotBasis === SLOT_BASIS
        && value.routes.every((route) => table[rateKey(route.provider, route.model)] !== undefined
          && typeof route.slots === 'object' && route.slots !== null)
      if (!covered) {
        return {
          totalUsd: value.totalUsd,
          buckets: value.buckets,
          peakUsd: value.peakUsd === undefined ? 0 : value.peakUsd,
          offPeakUsd: value.offPeakUsd === undefined ? 0 : value.offPeakUsd,
          routes: value.routes,
        }
      }

      const buckets = { uncachedInputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0, outputUsd: 0 }
      let peakUsd = 0
      let offPeakUsd = 0
      const routes = value.routes.map((route) => {
        const priced = priceRoute(route, table[rateKey(route.provider, route.model)], settings.schedule)
        for (const key of ['uncachedInputUsd', 'cacheReadUsd', 'cacheWriteUsd', 'outputUsd']) {
          buckets[key] += priced.peakPrice[key] + priced.offPrice[key]
        }
        const routePeakUsd = priced.peakPrice.uncachedInputUsd + priced.peakPrice.cacheReadUsd
          + priced.peakPrice.cacheWriteUsd + priced.peakPrice.outputUsd
        const routeOffPeakUsd = priced.offPrice.uncachedInputUsd + priced.offPrice.cacheReadUsd
          + priced.offPrice.cacheWriteUsd + priced.offPrice.outputUsd
        peakUsd += routePeakUsd
        offPeakUsd += routeOffPeakUsd
        return Object.assign({}, route, {
          usd: routePeakUsd + routeOffPeakUsd,
          peakUsd: routePeakUsd,
          offPeakUsd: routeOffPeakUsd,
          peakTokens: sumTokens(priced.peak),
          offPeakTokens: sumTokens(priced.offPeak),
        })
      })

      return {
        totalUsd: buckets.uncachedInputUsd + buckets.cacheReadUsd + buckets.cacheWriteUsd + buckets.outputUsd,
        buckets,
        peakUsd,
        offPeakUsd,
        routes,
      }
    }

    /** Subscribe one component to a settings scope snapshot. */
    function useScopeSnapshot(scope) {
      const state = React.useState(scope.getSnapshot())
      React.useEffect(() => {
        return scope.subscribe(() => { state[1](scope.getSnapshot()) })
      }, [])
      return state[0]
    }

    /** Re-render a component when the active locale changes. */
    function useLocaleTick(locale) {
      const state = React.useState(0)
      React.useEffect(() => {
        return locale.subscribe(() => { state[1]((tick) => tick + 1) })
      }, [])
      return state[0]
    }

    /** Inject this package's stylesheet, removed with the plugin fiber. */
    function insertStyles(css) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-plugin-token-cost'
      tag.textContent = css
      document.head.append(tag)
      return () => { tag.remove() }
    }

    /** The rates and schedule a settings snapshot carries, defensively. */
    function settingsOf(snapshot) {
      const value = snapshot.value
      if (value === undefined || value === null) return { rates: [], schedule: null }
      return {
        rates: Array.isArray(value.rates) ? value.rates : [],
        schedule: value.schedule === undefined || value.schedule === null ? null : value.schedule,
      }
    }

    /** `HH:MM` text as minutes of day, or undefined when the text is not a clock. */
    function parseClock(text) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim())
      if (match === null) return undefined
      const hours = Number(match[1])
      const minutes = Number(match[2])
      if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined
      if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return undefined
      return hours * 60 + minutes
    }

    /** Minutes of day as `HH:MM`. */
    function formatClock(minutes) {
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return String(hours).padStart(2, '0') + ':' + String(rest).padStart(2, '0')
    }

    /** The composer pill plus its expandable breakdown. */
    function CostPill(props) {
      const value = props.runtime.useProjection(PROJECTION)
      const snapshot = useScopeSnapshot(props.scope)
      const state = React.useState(false)
      const open = state[0]
      const setOpen = state[1]
      useLocaleTick(props.locale)
      const t = props.t

      if (value === undefined || value.routes.length === 0) return null
      const settings = settingsOf(snapshot)
      const view = priceView(value, settings)
      const routes = view.routes
      const buckets = view.buckets
      const total = view.totalUsd

      const priced = routes.filter((route) => typeof route.usd === 'number')
      if (priced.length === 0) {
        const names = routes.map((route) => route.provider + '/' + route.model).join(', ')
        return React.createElement('div', {
          className: 'dsh-plugin-token-cost is-unpriced',
          title: t('pill.unpriced') + ': ' + names,
        }, '≈$—')
      }

      const tokenTotals = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
      routes.forEach((route) => {
        tokenTotals.uncachedInputTokens += route.uncachedInputTokens
        tokenTotals.cacheReadTokens += route.cacheReadTokens
        tokenTotals.cacheWriteTokens += route.cacheWriteTokens
        tokenTotals.outputTokens += route.outputTokens
      })

      const head = React.createElement('button', {
        type: 'button',
        className: 'dsh-plugin-token-cost' + (open ? ' is-open' : ''),
        'aria-expanded': open,
        title: t('pill.title'),
        onClick: () => { setOpen((previous) => !previous) },
      },
        React.createElement('span', { className: 'dsh-plugin-token-cost__mark' }, '≈$'),
        React.createElement('span', null, formatUsd(total)),
      )

      if (!open) return React.createElement('div', { className: 'dsh-plugin-token-cost__wrap' }, head)

      const strip = total > 0
        ? React.createElement('div', { className: 'dsh-plugin-token-cost__strip' },
          BUCKETS.map((bucket) => {
            const usd = buckets[bucket.usd]
            if (!(usd > 0)) return null
            return React.createElement('span', {
              key: bucket.usd,
              className: 'dsh-plugin-token-cost__seg ' + bucket.cls,
              style: { flexGrow: usd },
              title: t('bucket.' + bucket.key) + '  $' + formatUsd(usd),
            })
          }),
        )
        : null

      // Cells are emitted in column order (dot, label, tokens, share, USD) so the
      // panel's sparse auto-placement keeps a row's cells on one grid row. The
      // shares sit before the money so the money column is the panel's right edge,
      // which is where the header total already is.
      const bucketRows = BUCKETS.map((bucket) => React.createElement('div', {
        className: 'dsh-plugin-token-cost__row',
        key: bucket.usd,
      },
        React.createElement('span', { className: 'dsh-plugin-token-cost__dot ' + bucket.cls }),
        React.createElement('span', { className: 'dsh-plugin-token-cost__label' }, t('bucket.' + bucket.key)),
        React.createElement('span', { className: 'dsh-plugin-token-cost__num is-tokens' }, formatTokens(tokenTotals[bucket.tokens])),
        React.createElement('span', { className: 'dsh-plugin-token-cost__num is-share' }, shareOf(buckets[bucket.usd], total) + '%'),
        React.createElement('span', { className: 'dsh-plugin-token-cost__num is-usd' }, '$' + formatUsd(buckets[bucket.usd])),
      ))

      // The peak/off-peak split only means anything once a schedule is configured.
      const windowRows = settings.schedule === null
        ? []
        : ['peak', 'offPeak'].map((kind) => {
          const usd = kind === 'peak' ? view.peakUsd : view.offPeakUsd
          return React.createElement('div', {
            className: 'dsh-plugin-token-cost__row is-window',
            key: kind,
          },
            React.createElement('span', { className: 'dsh-plugin-token-cost__dot ' + (kind === 'peak' ? 'is-peak' : 'is-off-peak') }),
            React.createElement('span', { className: 'dsh-plugin-token-cost__label' }, t('panel.' + kind)),
            React.createElement('span', { className: 'dsh-plugin-token-cost__num is-share' }, shareOf(usd, total) + '%'),
            React.createElement('span', { className: 'dsh-plugin-token-cost__num is-usd' }, '$' + formatUsd(usd)),
          )
        })

      const routeRows = priced.map((route, index) => {
        // The row is a `display: contents` box and has no hover area of its own,
        // so the per-route detail rides both of its cells instead.
        const detail = t('panel.peak') + ' $' + formatUsd(route.peakUsd === undefined ? route.usd : route.peakUsd)
          + ' · ' + t('panel.offPeak') + ' $' + formatUsd(route.offPeakUsd === undefined ? 0 : route.offPeakUsd)
          + '\n' + 'in ' + formatTokens(route.uncachedInputTokens)
          + ' · cache read ' + formatTokens(route.cacheReadTokens)
          + ' · cache write ' + formatTokens(route.cacheWriteTokens)
          + ' · out ' + formatTokens(route.outputTokens)
        return React.createElement('div', {
          className: 'dsh-plugin-token-cost__row is-route',
          key: route.provider + '/' + route.model + ':' + index,
        },
          React.createElement('span', { className: 'dsh-plugin-token-cost__label', title: detail }, route.provider + '/' + route.model),
          React.createElement('span', { className: 'dsh-plugin-token-cost__num is-usd', title: detail }, '$' + formatUsd(route.usd)),
        )
      })

      const unpricedRows = routes
        .filter((route) => typeof route.usd !== 'number')
        .map((route, index) => React.createElement('div', {
          className: 'dsh-plugin-token-cost__row is-route',
          key: 'unpriced:' + route.provider + '/' + route.model + ':' + index,
        },
          React.createElement('span', { className: 'dsh-plugin-token-cost__label' }, route.provider + '/' + route.model),
          React.createElement('span', { className: 'dsh-plugin-token-cost__num is-usd' }, t('pill.unpriced')),
        ))

      const panel = React.createElement('div', { className: 'dsh-plugin-token-cost__panel' },
        React.createElement('div', { className: 'dsh-plugin-token-cost__head' },
          React.createElement('span', { className: 'dsh-plugin-token-cost__title' }, t('panel.title')),
          React.createElement('span', { className: 'dsh-plugin-token-cost__num is-usd dsh-plugin-token-cost__total' }, '≈$' + formatUsd(total)),
        ),
        strip,
        bucketRows,
        windowRows,
        React.createElement('div', { className: 'dsh-plugin-token-cost__caption' }, t('panel.routes')),
        routeRows,
        unpricedRows,
      )

      return React.createElement('div', { className: 'dsh-plugin-token-cost__wrap' }, head, panel)
    }

    /** The disclosure chevron the shipped plugin cards use. */
    function Chevron() {
      return React.createElement('svg', {
        className: 'dsh-plugin-token-cost-card__chevron',
        width: 14,
        height: 14,
        viewBox: '0 0 14 14',
        'aria-hidden': 'true',
      }, React.createElement('path', {
        d: 'M3.5 5.5 7 9l3.5-3.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /**
     * The Token rates card. It wears the same disclosure chrome as the shipped
     * plugin cards — a title row that opens in place, a header mark while edits
     * are staged, and one footer save — over the peak schedule and one rate row
     * per route.
     */
    function TokenRatesCard(props) {
      const snapshot = useScopeSnapshot(props.scope)
      const settings = settingsOf(snapshot)
      const rateState = React.useState(() => settings.rates.map(toDraft))
      const rateDrafts = rateState[0]
      const setRateDrafts = rateState[1]
      const scheduleState = React.useState(() => toScheduleDraft(settings.schedule))
      const scheduleDraft = scheduleState[0]
      const setScheduleDraft = scheduleState[1]
      const addState = React.useState(emptyRateDraft())
      const draftAdd = addState[0]
      const setAdd = addState[1]
      const openState = React.useState(false)
      const open = openState[0]
      const setOpen = openState[1]
      const dirtyState = React.useState(false)
      const dirty = dirtyState[0]
      const setDirty = dirtyState[1]
      const scheduleEditedState = React.useState(false)
      const scheduleEdited = scheduleEditedState[0]
      const setScheduleEdited = scheduleEditedState[1]
      const errorState = React.useState(null)
      const error = errorState[0]
      const setError = errorState[1]
      useLocaleTick(props.locale)
      const t = props.t

      // The namespace is the source of truth: a document commit re-seeds the form.
      React.useEffect(() => {
        const next = settingsOf(snapshot)
        setRateDrafts(next.rates.map(toDraft))
        setScheduleDraft(toScheduleDraft(next.schedule))
        setDirty(false)
        setScheduleEdited(false)
      }, [snapshot.value])

      const writable = snapshot.writable === true
      const title = t('card.title')

      /** One draft row from one stored rate entry. */
      function toDraft(entry) {
        return {
          provider: entry.provider,
          model: entry.model,
          input: String(entry.input),
          output: String(entry.output),
          cacheRead: String(entry.cacheRead),
          cacheWrite: String(entry.cacheWrite),
        }
      }

      /** One blank rate draft. */
      function emptyRateDraft() {
        return { provider: '', model: '', input: '0', output: '0', cacheRead: '0', cacheWrite: '0' }
      }

      /** One schedule draft, defaulting to the deployment's Beijing weekday rule. */
      function toScheduleDraft(schedule) {
        if (schedule === null || schedule === undefined) {
          return {
            offset: '480',
            days: [1, 2, 3, 4, 5],
            windows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
            multiplier: '0.5',
          }
        }
        return {
          offset: String(schedule.utcOffsetMinutes),
          days: schedule.peakDays.slice(),
          windows: schedule.peakWindows.map((window) => ({
            start: formatClock(window.startMinutes),
            end: formatClock(window.endMinutes),
          })),
          multiplier: String(schedule.offPeakMultiplier),
        }
      }

      /** Every rate draft as stored rows, or `ok: false` when one is not a rate. */
      function readRates(drafts) {
        const rate = (text) => {
          const raw = String(text).trim()
          const value = Number(raw)
          return raw.length > 0 && Number.isFinite(value) && value >= 0 ? value : undefined
        }
        const rows = []
        for (let index = 0; index < drafts.length; index += 1) {
          const draft = drafts[index]
          if (typeof draft.provider !== 'string' || draft.provider.length === 0) return { ok: false }
          if (typeof draft.model !== 'string' || draft.model.length === 0) return { ok: false }
          const input = rate(draft.input)
          const output = rate(draft.output)
          const cacheRead = rate(draft.cacheRead)
          const cacheWrite = rate(draft.cacheWrite)
          if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
            return { ok: false }
          }
          rows.push({ provider: draft.provider, model: draft.model, input, output, cacheRead, cacheWrite })
        }
        return { ok: true, rows }
      }

      /** The schedule draft as a stored schedule, or `ok: false` when a field is not one. */
      function readSchedule(draft) {
        const offset = Number(String(draft.offset).trim())
        const multiplier = Number(String(draft.multiplier).trim())
        const windows = draft.windows.map((window) => ({
          startMinutes: parseClock(window.start),
          endMinutes: parseClock(window.end),
        }))
        const ok = Number.isFinite(offset)
          && Number.isFinite(multiplier) && multiplier >= 0 && multiplier <= 1
          && draft.days.length > 0
          && windows.length > 0
          && windows.every((window) => window.startMinutes !== undefined && window.endMinutes !== undefined)
        if (!ok) return { ok: false }
        return {
          ok: true,
          value: {
            utcOffsetMinutes: offset,
            peakDays: draft.days.slice().sort((left, right) => left - right),
            peakWindows: windows,
            offPeakMultiplier: multiplier,
          },
        }
      }

      /** Drop every staged edit and return to what the document holds. */
      function discard() {
        const next = settingsOf(snapshot)
        setRateDrafts(next.rates.map(toDraft))
        setScheduleDraft(toScheduleDraft(next.schedule))
        setDirty(false)
        setScheduleEdited(false)
        setError(null)
      }

      /** Write every staged edit in one revision-fenced mutation. */
      function save() {
        const rates = readRates(rateDrafts)
        if (!rates.ok) {
          setError(t('card.invalid'))
          return
        }
        const ops = [{ op: 'set', path: ['rates'], value: rates.rows }]
        if (scheduleEdited) {
          const schedule = readSchedule(scheduleDraft)
          if (!schedule.ok) {
            setError(t('card.scheduleInvalid'))
            return
          }
          ops.push({ op: 'set', path: ['schedule'], value: schedule.value })
        }
        setError(null)
        props.scope.mutate(ops).then(() => { setOpen(false) }).catch((failure) => { setError(messageOf(failure)) })
      }

      function editDraft(index, field, text) {
        setDirty(true)
        setRateDrafts((previous) => previous.map((draft, at) => {
          if (at !== index) return draft
          const next = Object.assign({}, draft)
          next[field] = text
          return next
        }))
      }

      function removeRow(index) {
        setDirty(true)
        setRateDrafts((previous) => previous.filter((_draft, at) => at !== index))
      }

      function addRow() {
        const candidate = readRates([draftAdd])
        if (!candidate.ok) {
          setError(t('card.invalid'))
          return
        }
        setError(null)
        setDirty(true)
        setRateDrafts((previous) => previous.concat([draftAdd]))
        setAdd(emptyRateDraft())
      }

      function editSchedule(patch) {
        setDirty(true)
        setScheduleEdited(true)
        setScheduleDraft((previous) => Object.assign({}, previous, patch))
      }

      function toggleDay(day) {
        const days = scheduleDraft.days.includes(day)
          ? scheduleDraft.days.filter((value) => value !== day)
          : scheduleDraft.days.concat([day])
        editSchedule({ days })
      }

      function editWindow(index, field, text) {
        editSchedule({
          windows: scheduleDraft.windows.map((window, at) => {
            if (at !== index) return window
            const next = Object.assign({}, window)
            next[field] = text
            return next
          }),
        })
      }

      function addWindow() {
        editSchedule({ windows: scheduleDraft.windows.concat([{ start: '09:00', end: '12:00' }]) })
      }

      function removeWindow(index) {
        editSchedule({ windows: scheduleDraft.windows.filter((_window, at) => at !== index) })
      }

      /** One labelled control. */
      function field(id, label, value, onChange, variant) {
        const type = variant === 'text' || variant === 'clock' ? 'text' : 'number'
        return React.createElement('label', { className: 'dsh-plugin-token-cost-card__field', key: id },
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__fieldLabel' }, label),
          React.createElement('input', {
            type,
            className: variant === 'clock' ? 'is-clock' : undefined,
            step: type === 'text' ? undefined : '0.05',
            min: type === 'text' ? undefined : '0',
            max: variant === 'multiplier' ? '1' : undefined,
            value,
            disabled: !writable,
            onChange: (event) => { onChange(event.target.value) },
          }),
        )
      }

      /** The four rates of one draft row. */
      function rateFields(draft, onEdit) {
        return [
          field('input', t('card.input'), draft.input, (text) => { onEdit('input', text) }),
          field('output', t('card.output'), draft.output, (text) => { onEdit('output', text) }),
          field('cacheRead', t('card.cacheRead'), draft.cacheRead, (text) => { onEdit('cacheRead', text) }),
          field('cacheWrite', t('card.cacheWrite'), draft.cacheWrite, (text) => { onEdit('cacheWrite', text) }),
        ]
      }

      const header = React.createElement('button', {
        type: 'button',
        className: 'dsh-plugin-token-cost-card__header',
        'aria-expanded': open,
        'aria-label': t(open ? 'card.collapse' : 'card.expand') + ': ' + title,
        onClick: () => { setOpen(!open) },
      },
        React.createElement('span', { className: 'dsh-plugin-token-cost-card__headText' },
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__name' }, title),
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__description' }, t('card.description')),
        ),
        dirty ? React.createElement('span', { className: 'dsh-plugin-token-cost-card__tag' }, t('card.unsaved')) : null,
        React.createElement(Chevron),
      )

      if (!open) return React.createElement('li', { className: 'dsh-plugin-token-cost-card' }, header)

      if (snapshot.status === 'loading' && snapshot.value === undefined) {
        return React.createElement('li', { className: 'dsh-plugin-token-cost-card is-open' }, header,
          React.createElement('div', { className: 'dsh-plugin-token-cost-card__body' },
            React.createElement('div', { className: 'dsh-plugin-token-cost-card__caption' }, t('card.loading')),
          ),
        )
      }

      const windowRows = scheduleDraft.windows.map((window, index) => React.createElement('div', {
        className: 'dsh-plugin-token-cost-card__window',
        key: 'window:' + index,
      },
        field('start' + index, t('card.start'), window.start, (text) => { editWindow(index, 'start', text) }, 'clock'),
        field('end' + index, t('card.end'), window.end, (text) => { editWindow(index, 'end', text) }, 'clock'),
        React.createElement('button', {
          type: 'button',
          disabled: !writable,
          onClick: () => { removeWindow(index) },
        }, t('card.remove')),
      ))

      const scheduleBlock = React.createElement('div', { className: 'dsh-plugin-token-cost-card__block' },
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__head' },
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__model' }, t('card.schedule')),
        ),
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__group' },
          field('offset', t('card.offset'), scheduleDraft.offset, (text) => { editSchedule({ offset: text }) }),
          field('multiplier', t('card.multiplier'), scheduleDraft.multiplier, (text) => { editSchedule({ multiplier: text }) }, 'multiplier'),
        ),
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__group' },
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__groupLabel' }, t('card.peakDays')),
          React.createElement('div', { className: 'dsh-plugin-token-cost-card__days' },
            WEEKDAYS.map((day) => React.createElement('button', {
              type: 'button',
              key: 'day:' + day,
              className: 'dsh-plugin-token-cost-card__day' + (scheduleDraft.days.includes(day) ? ' is-on' : ''),
              disabled: !writable,
              onClick: () => { toggleDay(day) },
            }, t('day.' + day))),
          ),
        ),
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__group' },
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__groupLabel' }, t('card.peakWindows')),
          React.createElement('div', null,
            windowRows,
            React.createElement('button', {
              type: 'button',
              disabled: !writable,
              onClick: addWindow,
            }, t('card.addWindow')),
          ),
        ),
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__hint' }, t('card.scheduleHint')),
      )

      const blocks = rateDrafts.map((draft, index) => React.createElement('div', {
        className: 'dsh-plugin-token-cost-card__block',
        key: draft.provider + '/' + draft.model + ':' + index,
      },
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__head' },
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__model', title: draft.provider + '/' + draft.model },
            draft.model,
            React.createElement('span', { className: 'dsh-plugin-token-cost-card__provider' }, ' · ' + draft.provider),
          ),
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__actions' },
            React.createElement('button', { type: 'button', disabled: !writable, onClick: () => { removeRow(index) } }, t('card.remove')),
          ),
        ),
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__group' },
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__groupLabel' }, t('panel.peak')),
          rateFields(draft, (name, text) => { editDraft(index, name, text) }),
        ),
      ))

      const addBlock = React.createElement('div', { className: 'dsh-plugin-token-cost-card__block is-add' },
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__head' },
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__model' }, t('card.addTitle')),
          React.createElement('span', { className: 'dsh-plugin-token-cost-card__actions' },
            React.createElement('button', { type: 'button', disabled: !writable, onClick: addRow }, t('card.add')),
          ),
        ),
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__group' },
          [
            field('provider', t('card.provider'), draftAdd.provider, (text) => { setAdd(Object.assign({}, draftAdd, { provider: text })) }, 'text'),
            field('model', t('card.model'), draftAdd.model, (text) => { setAdd(Object.assign({}, draftAdd, { model: text })) }, 'text'),
            ...rateFields(draftAdd, (name, text) => { setAdd(Object.assign({}, draftAdd, { [name]: text })) }),
          ],
        ),
      )

      const body = React.createElement('div', { className: 'dsh-plugin-token-cost-card__body' },
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__caption' }, t('card.caption')),
        writable ? null : React.createElement('div', { className: 'dsh-plugin-token-cost-card__caption' }, t('card.readonly')),
        scheduleBlock,
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__heading' }, t('card.rates')),
        rateDrafts.length === 0
          ? React.createElement('div', { className: 'dsh-plugin-token-cost-card__empty' }, t('card.empty'))
          : null,
        blocks,
        addBlock,
        error === null ? null : React.createElement('div', { className: 'dsh-plugin-token-cost-card__error' }, error),
        React.createElement('div', { className: 'dsh-plugin-token-cost-card__footer' },
          React.createElement('button', { type: 'button', disabled: !dirty, onClick: discard }, t('card.discard')),
          React.createElement('button', {
            type: 'button',
            className: 'dsh-plugin-token-cost-card__save',
            disabled: !dirty || !writable,
            onClick: save,
          }, t('card.save')),
        ),
      )

      return React.createElement('li', { className: 'dsh-plugin-token-cost-card is-open' }, header, body)
    }

    /**
     * Mount the composer pill and the settings card.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const slots = ctx.get('slots')
      const binder = ctx.get('settingsScope')
      const locale = ctx.get('locale')
      if (slots === undefined || binder === undefined || locale === undefined) return

      ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), 'dsh-plugin-token-cost: dictionaries')
      const t = locale.bind(NS)
      ctx.effect(() => insertStyles(CSS), 'dsh-plugin-token-cost: styles')

      const scope = binder.bind({ namespace: NS })

      slots.inject('conversation.composer.dock', () => slots.register(
        { name: 'conversation.composer.dock', id: 'token-cost', order: 5 },
        (runtime) => React.createElement(CostPill, { runtime, t, locale, scope }),
      ))

      slots.inject('settings.plugin.item', () => slots.register(
        { name: 'settings.plugin.item', key: NS },
        () => React.createElement(TokenRatesCard, { t, locale, scope }),
      ))
    }

    exports.inject = ['slots', 'settingsScope', 'locale']
    exports.apply = apply
    return module.exports
  },
})
