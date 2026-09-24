# dsh-plugin-token-cost

[English](./README.md) · **简体中文**

按 **峰时 / 闲时费率** 估算 DeepSeek Harness 的会话花费：每一次尝试都用它发生当时生效
的那套费率计价，而不是用你查看总额时的费率。

## 它贡献了什么

| 贡献 | 类型 | 出现的界面 |
| --- | --- | --- |
| `tokenCostEstimate` | 宿主的会话投影（客户端可见） | 胶囊通过 `useProjection` 读取 |
| `token-cost` | 宿主该行的 config（`.volatile()` 的 `rates` / `schedule` / `currency`） | profile 的 `cordis.patch.yml`，由卡片写入 |
| 输入框胶囊 | 浏览器 `conversation.composer.dock` 条目 | 输入框下方，与自带的统计胶囊并排 |
| `费率与计费时段` 卡片 | 浏览器 `plugins.row.config` 条目，键为 `dsh-plugin-token-cost#token-cost` | 插件页 → 本 bundle → 它的 `token-cost` 行 |

胶囊显示 `≈$0.0123`；声明了别的显示货币之后就是 `≈¥0.0873`。点击它展开面板，里面有
四个计价分项（token 数、占已计价总额的比例、显示货币下的金额，以及一条构成条）、按所配置
时段给出的峰时/闲时拆分，以及每个路由一行。没有声明费率的路由显示为 `未定价`，并且不计入
总额——未定价永远不会被当成免费。

在 插件页 里打开本 bundle、再打开它的 `token-cost` 行，就能看到这张卡片——它是该行页面上
的一个折叠行：标题与描述就地展开，有改动暂存时标题上出现标记，底部一次保存把显示货币、费率表
与时段规则以一次带版本号约束的写入一起提交。保存成功后卡片重新折叠。这张卡片就是该行的全部
配置界面：本条目上由 schema 自动生成的页面被关掉了，所以只有一处可改。

## 实际界面

![输入框下方的胶囊，展开后的计价明细](docs/pill.png)

![费率与计费时段 卡片，出厂即带官方费率表](docs/rates-card.png)

## 安装

从 git 仓库安装：

```sh
dsh plugin --profile web add github:GG-Features/dsh-plugin-token-cost
```

从已有的本地检出，或从打包好的 tarball（例如挂在 release 上的那个）安装：

```sh
dsh plugin --profile web add /path/to/dsh-plugin-token-cost
pnpm pack
dsh plugin --profile web add ./dsh-plugin-token-cost-0.2.0.tgz
```

包发布到 registry 之后，最短的写法是：

```sh
dsh plugin --profile web add dsh-plugin-token-cost
```

然后重启该 profile。bundle 层会插入 `token-cost` 这一行，宿主部分注册投影并声明该行的
volatile 配置，浏览器部分则由客户端模块注册表提供：它以包名搭上 shell 合并的
`/plugins/??<pkg>/client.js,…` 请求，所以直接 GET `/plugins/dsh-plugin-token-cost/client.js`
会得到 404。

本包直接发布普通 JavaScript——一个 ESM 宿主入口，加一个手写的 module-factory 浏览器
产物——所以以上任何安装方式 **都不需要构建步骤**。git 安装拉取的是源码而不是构建产物，
而 pnpm ≥10 通常会让用户确认是否允许依赖执行构建脚本；本包没有声明 `prepare` 或
`postinstall`，因此没有任何需要放行的脚本。

## 快速开始

插件把**官方 DeepSeek 费率表**作为 `token-cost` 这一行的基线一起发出，所以全新安装就能给
官方路由定价：峰值以美元 / 百万 token 计，空闲为峰值的一半，峰时按 DeepSeek 自己的规则。
费率表没点名的路由——另一个 provider，或一套自己的 id 与价格的代理——显示为 `unpriced`，
胶囊保持 `≈$—`，直到它被声明。费率可以声明在两处之一，或两处都声明：

1. **组合配置基线** —— `token-cost` 这一行的 `config`，出厂即带这份官方费率表，也是希望纳入
   版本管理的部署值该待的地方：

   ```yaml
   - insert:
       - id: token-cost
         name: dsh-plugin-token-cost
         config:
           schedule:
             utcOffsetMinutes: 480        # 北京
             peakDays: [1, 2, 3, 4, 5]    # ISO 星期：1 = 周一 … 7 = 周日
             peakWindows:
               - { startMinutes: 540, endMinutes: 720 }     # 当地 09:00–12:00
               - { startMinutes: 840, endMinutes: 1080 }    # 当地 14:00–18:00
             offPeakMultiplier: 0.5
           rates:
             - provider: deepseek-official
               model: deepseek-v4.1-flash
               input: 0.3
               output: 1.2
               cacheRead: 0.006
               cacheWrite: 0
           # 可选：金额按人民币显示，见「显示货币」。
           currency: { code: CNY, symbol: ¥, rate: 7.1 }
   ```

2. **用户层** —— 设置卡片，存在 profile 的 `cordis.patch.yml` 里该 `token-cost` 行的
   `config` 下。它逐字段覆盖基线，在卡片里清空某个字段即可恢复基线值。由于 Cordis 的
   config 补丁是整块替换该行的 `config`，一次保存会把组合出来的值连同全部 volatile 字段
   一起写入，因此出厂费率表后续的变化不会再影响到这个 profile，除非删掉该行的 config 覆盖。

出厂的那份费率表就是本包根目录的 `cordis.patch.yml`——插入这一行的 bundle 层，价格取自
<https://api-docs.deepseek.com/quick_start/pricing/>（美元 / 百万 token；中文页是元）。
它填的是 `deepseek-official` 路由在模型目录里的模型 id，所以只给官方端点定价；价格变的是
provider 那一侧，在意确切数字的部署在自己的补丁层里覆盖这份 config。

## 声明费率

三个来源，按此顺序解析：

1. 用户层（卡片）。
2. 组合配置基线（该行的 `config`）。
3. 适配器自己的声明——当部署的 provider 适配器声明了费率时，读取
   `llm.modelCost(provider, model)`。这里只读，并且只用于费率表未覆盖的路由。

一条费率就是一个路由及其四个峰时费率：

```yaml
- id: token-cost
  config:
    rates:
      - provider: deepseek-official
        model: deepseek-v4.1-flash
        input: 0.3
        output: 1.2
        cacheRead: 0.006
        cacheWrite: 0
```

四项都必填，单位是美元 / 百万 token，对应 provider 上报用量里四个互不重叠的分项；显示货币
改变的是金额读起来是什么，从来不是费率本身的含义。schema 会拒绝小于零的费率，卡片在写入
离开浏览器之前也会在浏览器里提出同样的要求。费率条目上的未知键是惰性的、不会被拒绝：
schema 会让它通过，而宿主与浏览器两侧都只读声明的这六个字段。

### 计费时段

```yaml
- id: token-cost
  config:
    schedule:
      utcOffsetMinutes: 480        # 读取时段所用的当地偏移
      peakDays: [1, 2, 3, 4, 5]    # ISO 星期；1 = 周一 … 7 = 周日
      peakWindows:
        - { startMinutes: 540, endMinutes: 720 }     # 当地 09:00–12:00
        - { startMinutes: 840, endMinutes: 1080 }    # 当地 14:00–18:00
      offPeakMultiplier: 0.5
```

当一次尝试的当地星期在 `peakDays` 中，*并且*它的当地时间落在某个 `peakWindows` 内
（起始含、结束不含，各为 0..1440），它就是 **峰时**。其余每一次尝试——其他时段、其他
日期、周末——都是 **闲时**，按峰时费率乘以 `offPeakMultiplier` 计价。省略 `schedule`
时所有用量都按峰时费率计价。schema 要求至少一个峰时日、每天至少一个时段、偏移在 ±1440
分钟之内、倍率在 0 到 1 之间；而一个连一个时段都没有的时段配置，卡片根本不会写下去，
所以「永远不可能标出峰时」的时段配置不会被存下来。

折扣刻意只用一个倍率：四个平坦费率加一个系数，不会偏离「闲时优惠必须是 1:2 关系」这一
点，而按分项各配一套闲时费率则意味着有第二份需要同步维护的表。

## 显示货币

金额一律按美元计价，显示时换算。`currency` 决定浏览器部分在金额前面打印什么，以及 1 美元
值多少：

```yaml
- id: token-cost
  config:
    currency:
      code: CNY     # 币种切换标记为当前项所用的名字
      symbol: ¥     # 金额前面的符号
      rate: 7.1     # 1 美元等于多少显示货币
```

这个字段只管显示。投影、它的持久化检查点以及每一个计价总额都仍是美元，所以换一种货币不会
重新计价、不会让已存的估算失效、也不会改变任何一条路由的价格——变的只是一个数字最终变成的
文本。`rate: 1` 就是把每个金额按美元读，这也是没有声明 `currency` 时的默认值。

这里什么都不联网抓取。`rate` 和你自己维护的费率表一样，是你自己填的数字：预设给出的起点是
`1 美元 = 7.10 CNY`、`0.92 EUR`、`0.79 GBP`、`7.80 HKD`、`155 JPY`，填旧了就显示旧的金额。
请填你实际被计费的那个值。

卡片里有一块 **显示货币**：每种内置货币一个预设按钮，点一下就把代码、符号和汇率一起暂存，
另外还有代码、符号、汇率三个输入框用于其他货币。胶囊的明细面板里有同一组预设做成一键切换的
按钮，只想看看人民币的读者不必进设置就能切换，写的是同一个字段。

## 估算如何计算

- 宿主把 `assistant/message` 的用量按路由汇总进 **UTC 星期**的 48 个半小时（共 336 个
  时隙）的直方图，键是该事件持久的 `time`。两条规则与自带的 token 计量保持一致：同一
  轮次/步骤的重复结算会在它自己的时隙里替换更早的样本，而 `llm/retry-started` 会关闭
  该作用域，使重试算作另一次尝试。路由取自这次尝试自己组装出的消息，回退到最新的
  `request/header`；无法确定路由的尝试不会被记录。
- 时段在生成视图时作用到这些时隙上：偏移会改变某个时隙的 UTC 星期，从而可能把它挪进
  相邻的当地星期，之后才评估峰时日与时段。发生在闲时的那次尝试无论何时读取估算都仍是
  闲时；跨过边界的会话，每一次尝试都用它自己的费率计价。
- 费率和时段都不会被折叠进状态：修改其中任何一个，都会在下一次读取时对完整的持久化日志
  重新计价，不需要状态版本号变更，也不需要让检查点失效。
- 浏览器会在每次读取时，用发布的直方图与实时 config 表单——费率和时段——重新计价，前提是
  费率表覆盖了所有有用量的路由，并且视图带有本 bundle 能理解的直方图基准。费率表不完整，
  或宿主部分发布了另一种基准时，浏览器不会改动宿主视图：宿主还会给浏览器看不到的、由
  适配器声明的费率计价。

## 兼容性

- 针对 **dsh 0.1.7-rc.1** 编写。
- 0.2.0 是 0.1.7 的移植版：配置的归属变成了这一行自己的 Cordis `Config`（三个
  `.volatile()` 字段，通过各引用自己的 `get()` 读取），卡片从已被移除的
  `settings.plugin.item` 插槽搬到了本行的 `plugins.row.config` 页面，浏览器部分也改为
  通过 `ctx.configForms.get('token-cost')` 读写那份共享表单，而不再用已被移除的
  `ctx.settingsScope.bind`。在 0.1.6 及更早的版本上这个版本用不了：浏览器部分的
  `configForms` 注入永远不解析，Web UI 会拒绝完成启动。那边请用 0.1.0。
- 它只构建在公开（但仍属 pre-stable）的扩展点上：`ctx.sessionProjections.register`、
  带 `.volatile()` 字段的插件 `Config`、可选 `ctx.inject` 背后的
  `ctx.settings.configure({ auto: false })`、`ctx.configForms.get(<行 id>)` 及其
  `getSnapshot` / `subscribe` / `mutate`、`plugins.row.config` 与
  `conversation.composer.dock` 插槽、`SessionEvent.time`、`assistant/message` 用量，以及
  `llm/retry-started`。任何一个扩展点发生变化的版本，都可能需要本插件配套发一个版本。
- 投影键是 `tokenCostEstimate`，刻意不叫 `tokenCost`：`@deepseek-ai/dsh-token-meter`
  占用了那个键，而重复注册一个已有键会退让给先注册者而不是报错——那看起来就像插件挂载
  了却什么都没做。
- `view.slotBasis` 指明如何读取直方图，因此浏览器部分若比宿主模块先更新，会拒绝这种
  不匹配并改为显示宿主自己的数字，而不是用错误的规则计价。

## 已知限制

- **半小时粒度。** 不是 30 分钟整数倍的时段边界会向下取整到包含它的那个时隙，而一次
  尝试会被归到它消息提交时所在的时隙。
- **费率不从任何地方拉取。** 这里的一切都是你自己声明的：provider 调价意味着改表，而不是
  自动更新。（有些其他成本插件会按计划同步官方价格。）
- **显示汇率同样不拉取。** `currency.rate`（包括每个预设自带的那个）都是你自己维护的数字：
  这里不读汇率，卡片也分辨不出它是不是过期了。
- **改动宿主部分需要重启 profile。** profile 的热重载只应用配置，因此在 profile 运行期间
  修改 `index.js` 只会改这一行的配置，而不会改已加载的模块。`client.js` 不同：客户端模块
  注册表会重新快照它，浏览器会热替换。
- **估算就是估算。** 重试的请求会被再次计费，provider 侧的四舍五入、超出单组峰/闲费率的
  阶梯定价，以及促销折扣，都不是「一组费率加一个倍率」能表达的。
- **浏览器部分是手写的。** 没有构建步骤：`client.js` 直接按客户端模块注册表消费的
  module-factory 格式编写，并用 `document.createElement('style')` 注入样式表，而不是
  CSS Modules。
- **文案在 `client.js` 里**，是注册到客户端 locale 服务的两个字典（英文与中文）。

## 开发

```sh
pnpm install
pnpm test
```

- `test/host.test.mjs` —— 汇总、时段、计价、volatile 改动后下一次读取即重算、显示货币的
  默认值与各种拒绝，以及 schema 的各种拒绝。用 `node --test` 运行，无测试专用依赖。
- `test/client.test.mjs` —— 卡片的折叠行为（折叠、展开、暂存改动、底部单次保存、放弃、
  自动折叠、拒绝无时段的时段配置）、它的单行摘要视图、它的货币切换，以及胶囊的计价与
  格式化，在 jsdom 中用 React Testing Library 挂载。

### 面板布局

胶囊展开的明细是**面板自己拥有的一个 CSS grid**：每一行都是一个
`display: contents` 的盒子，由各单元格自行声明所在列，因此 token 列、占比列与美元列共用
同一套几何，无论数字多宽都能对齐——逐行各自成 grid 时，`auto` 轨道由该行自身内容决定，
行与行之间必然漂移。路由行横跨标签各列，把最后一列留给美元金额：那一列就是面板的右边缘，
标题总额也在同一列。单元格按列号升序输出，这是稀疏自动放置把一行的单元格留在同一个
grid row 上所必需的；`test/client.test.mjs` 把这两半契约都钉住了。

本目录下的 `link:` 安装会从这个目录自己的 `node_modules` 解析
`@deepseek-ai/schemastery`，因为被 link 的包是从它的真实路径而不是 profile 解析导入的。
registry 或 tarball 安装会按声明正常解析依赖。

## 许可证

MIT
