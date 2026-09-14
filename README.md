# dsh-plugin-token-cost

**English** · [简体中文](./README.zh-CN.md)

Estimated session spend for DeepSeek Harness, priced by **peak and off-peak
rates**: every attempt is charged at the rate set that was in force when it
happened, not at whatever the rate happens to be when you read the total.

## What it contributes

| Contribution | Kind | Where it shows |
| --- | --- | --- |
| `tokenCostEstimate` | host session projection (client-visible) | read by the pill through `useProjection` |
| `token-cost` | host settings namespace | written to `settings.yaml` by the card |
| composer pill | browser `conversation.composer.dock` entry | under the composer, beside the shipped stats pills |
| `Token rates` card | browser `settings.plugin.item` entry keyed `token-cost` | Settings → Plugins → Plugin configuration |

The pill shows `≈$0.0123`. Clicking it expands a panel with the four priced
usage buckets (tokens, share of the priced total, USD, and a composition strip),
the peak/off-peak split for the configured schedule, and one row per route. A
route with no declared rates renders as `unpriced` and contributes nothing to
the total — unpriced is never reported as free.

In Settings → Plugins → Plugin configuration the card joins the shipped cards as
one more collapsed row: a title and description that open in place, a header
mark while edits are staged, and one footer save that writes the rate table and
the schedule together in a single revision-fenced mutation. A confirmed save
collapses the card again.

## Install

From the git repository:

```sh
dsh plugin --profile web add github:GG-Features/dsh-plugin-token-cost
```

From a checkout you already have, or from a packed tarball (for example one
attached to a release):

```sh
dsh plugin --profile web add /path/to/dsh-plugin-token-cost
pnpm pack
dsh plugin --profile web add ./dsh-plugin-token-cost-0.1.0.tgz
```

Once the package is on the registry, the shortest form is:

```sh
dsh plugin --profile web add dsh-plugin-token-cost
```

Then restart the profile. The bundle layer inserts the `token-cost` row, the host
half registers the projection and the settings namespace, and the browser half is
served from `/plugins/dsh-plugin-token-cost/client.js`.

The package ships plain JavaScript — an ESM host entry and a hand-written
module-factory browser bundle — so **no build step runs** in any of those forms. A
git install fetches sources rather than artifacts, and pnpm ≥10 normally asks the
user to allow a dependency's build scripts; this package declares no `prepare` or
`postinstall` script, so there is nothing to allow.

## Quick start

The plugin ships **no rates**, so a fresh install prices nothing: the pill shows
`≈$—` until at least one route is declared. Declare rates in either of two
places, or in both:

1. **The composition base** — the `config` of the `token-cost` row, which is the
   right home for values a deployment wants under version control:

   ```yaml
   - insert:
       - id: token-cost
         name: dsh-plugin-token-cost
         config:
           schedule:
             utcOffsetMinutes: 480        # Beijing
             peakDays: [1, 2, 3, 4, 5]    # ISO weekdays: 1 = Monday … 7 = Sunday
             peakWindows:
               - { startMinutes: 540, endMinutes: 720 }     # 09:00–12:00 local
               - { startMinutes: 840, endMinutes: 1080 }    # 14:00–18:00 local
             offPeakMultiplier: 0.5
           rates:
             - provider: deepseek-official
               model: deepseek-v4.1-flash
               input: 0.3
               output: 1.2
               cacheRead: 0.006
               cacheWrite: 0
   ```

2. **The user layer** — the Settings card, stored under the `token-cost` key of
   `settings.yaml`. It wins field by field over the base, and clearing a field in
   the card restores the base value.

## Declaring rates

Three sources, resolved in this order:

1. The user layer (the card).
2. The composition base (the row's `config`).
3. The adapter's own declaration — `llm.modelCost(provider, model)` when the
   deployment's provider adapter declares one. Read-only here, and only for
   routes the table does not cover.

A rate entry is one route with its four peak rates:

```yaml
token-cost:
  rates:
    - provider: deepseek-official
      model: deepseek-v4.1-flash
      input: 0.3
      output: 1.2
      cacheRead: 0.006
      cacheWrite: 0
```

All four are required and are USD per million tokens, matching the four disjoint
buckets of the provider's reported usage. An unknown field on a rate entry is
refused loudly at load rather than ignored, so a value the schema cannot honor is
never silently dropped.

### The pricing schedule

```yaml
token-cost:
  schedule:
    utcOffsetMinutes: 480        # local offset the windows are read in
    peakDays: [1, 2, 3, 4, 5]    # ISO weekdays; 1 = Monday … 7 = Sunday
    peakWindows:
      - { startMinutes: 540, endMinutes: 720 }     # 09:00–12:00 local
      - { startMinutes: 840, endMinutes: 1080 }    # 14:00–18:00 local
    offPeakMultiplier: 0.5
```

An attempt is **peak** when its local weekday is in `peakDays` *and* its local
time of day falls inside one of `peakWindows` (start inclusive, end exclusive,
each 0..1440). Every other attempt — other hours, other days, weekends — is
**off-peak** and priced at the peak rate scaled by `offPeakMultiplier`. Omitting
`schedule` prices everything at the peak rates. `peakDays` and `peakWindows` must
each list at least one entry; a schedule with neither is refused at load.

The discount is one multiplier on purpose: four flat rates plus a factor cannot
drift out of the 1:2 relationship a flat off-peak discount requires, and a
per-bucket off-peak table would be a second thing to keep in sync.

## How the estimate is computed

- The host folds `assistant/message` usage per route into a histogram of the 48
  half-hours of a **UTC weekday** (336 slots), keyed by the event's durable
  `time`. Two rules match the shipped token meter: a repeated settlement of one
  turn/step replaces its earlier sample (in its own slot), and
  `llm/retry-started` closes that scope so a retry contributes another attempt.
  The route comes from the attempt's own assembled message, falling back to the
  newest `request/header`; an attempt with no known route stays unrecorded.
- The schedule is applied to those slots when the view is produced: the offset
  shifts a slot's UTC weekday, which can move it into the neighbouring local
  weekday, and only then are the peak days and windows evaluated. An attempt that
  happened in an off-peak hour stays off-peak no matter when the estimate is
  read, and a session spanning the boundary prices each attempt with its own rate.
- Neither the rates nor the schedule are folded into the state: editing either
  one reprices the complete durable log at the next read with no state version
  bump and no checkpoint invalidation.
- The browser re-prices from the published histograms and the live settings scope
  — rates *and* schedule — whenever the table covers every route with usage and
  the view carries the histogram basis this bundle understands. A partial table,
  or a host half publishing another basis, leaves the host view untouched: the
  host also prices adapter-declared rates the browser cannot see.

## Compatibility

- Written against **dsh 0.1.5-rc.2**.
- It builds only on public — but pre-stable — extension points:
  `ctx.sessionProjections.register`, `ctx.settings.register` (including its
  `validate` option), `ctx.settingsScope.bind`, the `settings.plugin.item` and
  `conversation.composer.dock` slots, `SessionEvent.time`, `assistant/message`
  usage, and `llm/retry-started`. A release that changes any of them may need a
  matching plugin release.
- The projection key is `tokenCostEstimate`, deliberately not `tokenCost`:
  `@deepseek-ai/dsh-token-meter` owns that key, and a second registration of an
  existing key defers to the first instead of failing, which would look like a
  plugin that mounted and did nothing.
- `view.slotBasis` names how to read the histograms, so a browser half reloaded
  ahead of the host module refuses the mismatch and shows the host's own numbers
  instead of mispricing them.

## Known limitations

- **Half-hour granularity.** A window boundary that is not a multiple of 30
  minutes rounds down to the slot containing it, and an attempt is attributed to
  the slot its message was committed in.
- **Rates are not fetched from anywhere.** Everything here is what you declared:
  a provider price change is a table edit, not an automatic update. (Some other
  cost plugins sync official prices on a schedule.)
- **A host-half change needs a profile restart.** A profile's live reload applies
  configuration only, so editing `index.js` while the profile runs changes the
  row's config but not the loaded module. `client.js` is different: the client
  module registry re-snapshots it and the browser hot-swaps it.
- **The estimate is an estimate.** Retried requests are billed again, and
  provider-side rounding, tiered rates beyond one peak/off-peak pair, and
  promotional discounts are outside what one rate set plus one multiplier express.
- **The browser half is hand-written.** There is no build step: `client.js` is
  written directly in the module-factory format the client module registry
  consumes, and it injects its stylesheet with `document.createElement('style')`
  rather than CSS Modules.
- **Copy lives in `client.js`**, as two dictionaries registered on the client
  locale service (English and Chinese).

## Development

```sh
pnpm install
pnpm test
```

- `test/host.test.mjs` — the fold, the schedule, the pricing, and the schema
  refusals. Runs on `node --test` with no dependencies.
- `test/client.test.mjs` — the card's disclosure behaviour (collapsed, open,
  staged edits, one footer save, discard, auto-collapse) and the pill's pricing,
  mounted in jsdom with React Testing Library.

### Panel layout

The pill's breakdown is **one CSS grid owned by the panel**: each row is a
`display: contents` box whose cells declare their own column, so the token,
share and USD columns share a single geometry and every figure lines up whatever
its width. A grid per row cannot do that — an `auto` track is sized by the row's
own content, so the money column drifted by up to 54px between the buckets, the
peak/off-peak split and the routes. A route row spans the label columns and
leaves the money column to the USD, which is the panel's right edge and therefore
where the header total already sits. Cells are emitted in ascending column order,
which is what sparse auto-placement needs to keep a row's cells on one grid row;
`test/client.test.mjs` pins both halves of that contract.

A local `link:` install resolves `@deepseek-ai/schemastery` from this directory's
own `node_modules`, because a linked package resolves its imports from its real
path rather than from the profile. A registry or tarball install resolves the
declared dependency normally.

## License

MIT
