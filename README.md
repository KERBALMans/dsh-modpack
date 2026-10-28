# dsh-modpack

**插件整合包管理器 / Plugin Modpack Builder for DeepSeek Harness**

像《我的世界》整合包一样管理你的 DSH 插件：把已安装的插件勾选打包成一个 `.dshmodpack.json` 整合包文件，发给别人，别人导入即可一键还原整套插件环境。

A Minecraft-modpack-style bundler for DeepSeek Harness plugins: tick the plugins you want, export them as a single `.dshmodpack.json` file, share it, and anyone can import it to rebuild the same plugin setup.

---

## 功能 / Features

| 功能             | 说明                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 📦 **插件清单**    | 自动读取当前 profile 的 `package.json` 与 `cordis.patch.yml`，列出全部已安装插件（名称、版本、来源、启用状态、类型）                                                   |
| 🔍 **筛选 / 搜索** | 按名称、模块名、描述实时搜索；按「已启用 / 已禁用 / 本地链接 / 官方 / 可移除」筛选                                                                                    |
| 🌲 **分类树**     | 自己命名的可嵌套分类树，把插件归类整理；点分类即按其子树过滤列表，可整类勾选、批量归类；分类随整合包一起导出。两种看法可切换：编辑用的文件夹列表，与一眼看全层的树状图 |
| ✨ **自动分类**    | 一键按 31 条有序规则把全部插件归入分类：作者声明的 `keywords` 最优先，其次插件自己注册的简介、包里的 README，最后才是名字。先预览再应用，每行标注来源（按关键词 / 按简介 / 按 README / 按名字推测 / 按安装方式 / 联网查到 / AI 判断 / 无法判断）；预览顶部给出各者的数量拆分；默认保留你手工归的类，重跑不会重复建类 |
| 🧭 **一键选条件**   | 点一次罗盘即展开四档可选证据（联网查阅 / AI 综合判断 / 附带源码 / 作用关系推理），各配一句说明，再由你点「开始」——而不是四个按钮让你自己猜顺序和代价 |
| 🧠 **AI 综合判断**  | 可选让模型读插件的名字、作者描述、关键词与之前的判断结果（再勾一项还可读入口代码），在**你已有的分类里**挑一个。默认关闭，是本插件唯一花钱的功能，因此预览会写明是哪个模型答的、进出 token 数、走的是你配置的默认模型还是自动发现。模型只能改写判断，不能凭空造分类 |
| 🔎 **作用关系推理** | 可选再加一档：先把「这个插件装进宿主之后到底接在哪儿」查清楚（宿主半边/客户端半边、是否给已有功能打补丁、挂在哪个界面槽位、摸到哪些能力），把这份关系一并交给模型，并要求它**先按名字猜、再用关系检验**、把推理过程写进理由。没有查到关系就不写这一行，也不会谎称推理过 |
| 🌐 **联网补全**    | 本地判断不了的插件可选去 npm / GitHub 查它的简介和话题；默认关闭、只查不确定的、证据分强弱并写明出处、查到就缓存、查不到不缓存 |
| ☑️ **勾选打包**    | 全选 / 反选 / 仅选已启用 / 仅选可分享；勾选后导出为 `.dshmodpack.json`                                                                                  |
| 🏷️ **整合包元信息** | 可填写整合包名称、作者、版本、描述，随包一起分发                                                                                                           |
| 📥 **导入安装**    | 选择 `.dshmodpack.json` 文件 → 预览将要安装的插件 → 一键安装                                                                                        |
| 📤 **分享引导**    | 导出后直接告诉你「怎么发给别人」，并给出一段可一键复制、发给接收方智能体的话；文件本身也带 `howToUse` 说明                                                                        |
| 📌 **可选锁定版本**  | 默认按整合包记录的版本范围安装（更耐版本下架）；勾选「锁定版本安装」后改为装作者当时用的精确版本（更可复现）                                                                             |
| 🛡️ **向后兼容**    | 不比对版本号，改为探测 `pluginManager` 上的方法；某个版本少一个方法只失去那一项功能，其余照常工作（见[兼容性](#面向未来版本--forward-compatibility)）                                |
| ⚙️ **保留配置**    | 导出时可携带每个插件的启用/禁用状态与 `cordis.patch.yml` 中的配置片段                                                                                      |
| 🌐 **中英双语**    | 跟随客户端语言自动切换                                                                                                                        |
| 🤖 **智能体工具**   | 提供 `modpack_list` / `modpack_export` / `modpack_apply` 三个工具，让智能体自己也能清点、打包、安装整合包（`modpack_apply` 默认只做预演，要显式传 `dryRun: false` 才真的安装） |

## 界面 / UI

插件在 **设置** 左侧导航里新增一个「插件整合包」分区（`settings.section`，排在「插件」下面）。

> 为什么不用 `settings.plugins.tab`？那个插槽是存在的，注册也会被接受（在实时插槽树里 `active: true`），但**内置插件页并不渲染标签栏** —— 贡献被收下了却永远画不出来。`settings.section` 才是真正会显示的座位，已装的 `billion-context` 就挂在同一个插槽上。两个插槽现在都注册，哪个被渲染就用哪个。

The plugin adds a **Plugin Modpacks** section to the Settings navigation (`settings.section`, placed right after Plugins).

> Why not `settings.plugins.tab`? That slot exists and a registration there is accepted (`active: true` in the live slot tree), but **the shipped Plugins page renders no tab strip** — the contribution is accepted and then never drawn. `settings.section` is the seat that actually appears; the installed `billion-context` plugin occupies the same one. Both slots are registered now, so whichever this build draws is the one you get.

## 分类树 / Category tree

插件列表左边就是分类树。「制作整合包」这件事本身就是「从一堆插件里挑一组」，所以分类和勾选放在同一屏，而不是各自一个标签页。

树有两种看法，右上角一键切换：**列表**（默认，用来改名、拖层级、逐条归类）和**树状图**（每个分类一个方框，方框套方框，一眼看完整棵树的形状和各分类的数量）。用嵌套方框而不是画节点连线，是因为画图需要实测宽度、每次改名和窗口变化都要重算，而这里要回答的问题——「什么在哪个分类里」——并不需要几何。

```
分类树                   插件列表
├ 全部插件 (12)          [x] billion-context   归入 ▾ 语言模型 / 国内
├ 未分类 (5)             [ ] dsh-session-manager 归入 ▾ 开发工具
├ 语言模型 (3)       ← 点一下，右侧只剩这个子树
│  ├ 国内 (2)
│  └ 国外 (1)
└ 开发工具 (4)
   ＋ 新建分类
```

- **建 / 改名 / 删**：节点悬停出现 `＋`（建子分类）、`✎`（就地改名）、`✕`（删除）。删除一个分类时，它的**子分类上移**到祖父节点，里面的插件回到「未分类」—— 不会连带删掉任何东西。
- **归类**：每行插件下面有「归入」，下拉里按缩进显示整棵树；勾选多行后用底部的批量下拉一次归类。
- **过滤**：点分类节点即按其**整棵子树**过滤（父分类算上所有子分类），可以和搜索、筛选标签叠加使用。
- **整类勾选**：树底部「选中本分类」把该子树里的插件一次勾上，方便按类别打包。
- **随包导出**：导出时每个插件会带上完整分类路径（如 `语言模型 / 国内`），文档里也会列出用到的分类，别人拿到包能看懂你的组织方式。安装时**完全忽略**它 —— 它只是说明，不是安装指令。

### 自动分类 / Auto-categorise

树顶上有一个 **✨ 自动分类** 按钮。点一下，它按 31 条有序规则给插件归类。规则命中的线索可以来自四个地方，按可信度从高到低排：作者在 `package.json` 里写的 `keywords`、插件自己注册的简介、包内的 README、以及包名本身。

| 规则 | 归入 |
| --- | --- |
| `mcp` | MCP 与外部工具 |
| `session` | 会话与工作区 |
| `model` | 模型接入 |
| `context` | 上下文与记忆 |
| `skill` | 技能与提示词 |
| `plugin-mgmt` | 插件管理 |
| `automation` | 桌面与自动化 |
| `ui` | 界面与主题 |
| `local` | 本地开发（按安装方式判定，不是关键词） |
| `terminal` | 终端与 Shell |
| `worktree` | Git 与工作树 |
| `subagent` | 子智能体 |
| `titles` | 会话标题 |
| `translation` | 翻译 |
| `runtime` | 运行时核心 |
| `web` | 网页访问 |
| `permissions` | 沙箱与权限 |
| `storage` | 数据存储 |
| `files` | 文件与工作区 |
| `commands` | 命令与快捷入口 |
| `tools` | 工具与调用 |
| `settings` | 设置与配置 |
| `telemetry` | 遥测与上报 |
| `tasks` | 后台任务与调度 |
| `dialogs` | 宿主集成与对话框 |
| `profiles` | 应用档与入口 |
| `client` | 客户端与接口 |
| `agent` | 智能体循环 |
| `infra` | 基础服务 |
| `experimental` | 实验特性 |
| `other` | 其他（兜底，不算一次判断） |

**顺序就是优先级。** 一条插件同时像"会话"又像"界面"时，靠前的规则赢 —— 越靠前的桶越窄、越具体的信号越容易被更靠后的泛词淹没。`other` 必须留在最后。

三条设计上的取舍：

1. **先预览，再应用。** 点按钮只出提案，不写盘；你确认后点「应用」才走原来的 `/categories/save`。关掉面板，磁盘上的树一个字节都没变。
2. **诚实标注来源。** 每行后面标着「按关键词」「按简介」「按 README」「按名字推测」「按安装方式」「联网查到」「AI 判断」还是「无法判断」。作者写的 `keywords` 是他对自己插件的声明；插件注册的简介和包里的 README 是它自己写的说明；从名字匹配出来的是我们猜的；`link:`/`file:` 装的是事实，但和关键词无关；联网查到的是外部证据，会连证据层级和来源链接一起标出；AI 判断会把推理依据一起写出来；`其他` 是兜底，压根不算一次判断。几种可信度差很多，混成一句就是骗你。预览顶部还会给出各者的数量拆分 —— 只报「16 个插件归入 9 个分类」会显得很权威，但其实里面 6 个是按名字猜的。
3. **默认不覆盖手工归类。** 已经归好类的插件保持不动，只补未分类的。想彻底重排，勾上「覆盖我已有的归类」。分类 id 由规则名派生（`auto-<rule>`），所以**重复点不会堆出一堆重复分类**。

**Loader 里的插件也算。** 插件管理器列出的每一个条目都会参与分类，包括同一个包被拆成多条的子路径条目 —— 分类器先把它还原成包名（`@deepseek-ai/dsh-plugin-manager/tools` → `@deepseek-ai/dsh-plugin-manager`）再去读那个包的 `package.json`。真实桌面环境里 215 个这样的条目，只有 1 个最后落在「其他」，是 Loader 自己的伪模块 `cordis:include`，它没有包、没有简介、没有 README，也确实无从判断。

**联网和 AI 两档同样收 Loader 条目。** 这两档以前只看 bundle，理由早就站不住了：真正落在「其他」里的全是 Loader 条目，而它们恰恰是这两档唯一还帮得上的行。现在候选条件问的是「这一行有没有可发出去的包名」，而不是「它是不是 bundle」。

> 官方 `@deepseek-ai/*` 包在客户端的 asar 里。从 0.8.2 起分类器会直接去 `resources/app.asar/dsh/node_modules` 和 `resources/app.asar/node_modules` 下找它们的 `package.json`，所以大多数官方插件现在凭本地证据就能归类，不必联网。真读不到时，打开「联网查询」会让它去 npm / GitHub 查简介和话题来补全。

> **profile 目录来自启动参数，不是环境变量。** 桌面客户端把 profile 目录当成命令行参数交给宿主，`DSH_PROFILE` / `DSH_PROFILE_DIR` 在宿主进程里根本没设。0.8.4 起插件在 `apply` 里先记下 `profileContext.dir`，所有路径都以它为准 —— 之前退回 `<home>/profiles/default` 这个不存在的目录，结果就是「我自己装的插件全是无法判断」，而 asar 里的官方包照样能读，看起来像分类坏了，其实是路径错了。读清单和读代码现在也走同一份根目录列表，不会再出现「按简介归了类，却说没读到源码」。

### 联网补全 / Online lookup

本地线索不足时，可以勾上 **🌐 联网查询未知插件**，让它在 npm registry 和 GitHub 上查一下这个插件到底是什么。这是整个插件里**唯一会把你机器上的东西发出去**的功能，所以默认关闭、每次请求单独决定。

**只查本地判断不了的插件。** 作者已经用 `keywords` 说清楚了的，一个字都不会发出去 —— 联网的成本（隐私）应该和插件"话少"的程度成正比，而不是和你装了 16 个还是 60 个成正比。

**证据分强弱，且每一条都写清楚出处。** 仓库 `topics` > registry `keywords` > `description` > `README`。一条网络结论不会只说"归入 X"，而是说"在 github.com/owner/repo 的 topics 里查到：……"，你可以自己点进去核对。分类器不允许在更强的证据还没取回来时先用弱证据作答 —— 所以它宁可多花一个请求去问 GitHub，也不会因为 registry 先返回就抢先下结论。

**查到就记住，查不到不记。** 完整答案缓存 7 天，只拿到一半（registry 答了、GitHub 没答）缓存 6 小时。**请求失败的结果根本不写缓存** —— 否则一个被限流的下午就会把这些插件冻成"查不到"一整个星期，而这正是最像"这功能坏了"的故障。

**monorepo：读包自己的目录，而不是仓库首页。** 所有官方 `@deepseek-ai/*` 包都指向 `github.com/deepseek-ai/deepseek-harness`，那个仓库的 topics 和根 README 描述的是**整个产品**，不是某一个包 —— 拿它来分类，会因为"这个产品是个 MCP 宿主"而把 `dsh-base` 归进 MCP。但这些包自己声明了 `repository.directory`（例如 `packages/experimental/terminal-bundle`），所以查询会**精确到包所在的那个子目录**去读它自己的 README，出处也写成 `deepseek-ai/deepseek-harness/packages/experimental/terminal-bundle` 让你能直接核对。含 `..` 的 `directory` 会被拒绝，不做拼接。真机上这就是「8 个插件查不到」和「一个都不剩」的差别。

**只有 README 的开头能投票。** 匹配整篇 README 会把插件归错类，而且都是真实例子：`@deepseek-ai/dsh-subagent-codex` 正文写着 "the complete terminal result"（意思是**最终**结果），被归进了终端；`dsh-windows-mcp` 写着 "Install it with DSH's own plugin manager"，被归进了插件管理；`dsh-aliyun-coupon` 说它的宿主半边要在插件管理器里关掉再打开，同一个坑。这些话讲的是**怎么装、怎么开发**这个插件，不是它**做什么**。所以现在只有第一个 `## ` 标题以上的部分（包的自我描述）算证据；标题以下讲的是用法、注意事项和变更历史。

**本地就有的 README 也算证据，而且不要钱。** 用 `link:` 或 `@local/` 装的插件既没有 registry 条目也没有仓库，本来只能靠名字猜 —— 可作者自己写的说明就躺在它的 `package.json` 旁边，读它不需要任何网络请求。同样只读开头部分。只有关键词和名字都没能给出答案的插件才会走到这一步。

**registry 不认识的名字，去 GitHub 搜。** 有些插件只发布在 GitHub 上、从不发 npm。npm 查不到时会改用包名在 GitHub 上搜索。

### AI 综合判断 / AI judgement

关键词表和 README 认得的是作者**碰巧用了哪些词**，认不出这个插件**到底做什么**。所以还有第四档证据：让模型自己读一遍再判断。

点一次罗盘，会展开四档可以单独勾选的证据 —— **联网查阅**、**AI 综合判断**、**附带源码**、**作用关系推理** —— 每档一句说明，然后你自己点「开始」。不是四个按钮让你猜它们的前后关系和代价。

**它会看到什么。** 插件的名字、作者写的描述、`keywords`、前面的判断结果，以及（只有你再勾上「附带源码」时）包的入口代码。然后它从**你已有的分类**里挑一个 —— 它没有机会发明新分类，因为提示词里给的就是候选集合本身。

**默认关闭，而且这是本插件唯一花钱的功能。** 所以预览必须回答"谁答的、花了多少"：哪个 provider 和模型、进出 token 数，以及这次调用走的是**你配置的默认模型**还是退回自动发现。只把本地判断不了的插件发出去 —— 作者已经说清楚的插件一个字都不会离开你的机器。

**模型可以改写判断，不能凭空造分类。** 回复只在下面这些条件下被采纳：分类 id 必须**逐字等于**提示词里给过的某一个，且这一行确实被发出去了。除此之外一律逐行回退到离线答案，并把原因留给你看：分类不存在、空回复、把 JSON 包在废话里、直接拒绝回答、流抛异常、completion 以错误结束。失败是每一行的事，不是整次预览的事。

**代码是证据，不是规则。** 读入口文件是本地、免费、离线的动作，但它会被**交给模型**，而不是拿去匹配我们自己写的一张表 —— 自己再写一张表，只是把同样脆弱的猜测换了身衣服。所以 AI 没开时这个选项在界面上是禁用的：不看模型却要看源码，什么也不会发生。

**名字之外，还有它接在哪儿。** 最后一档叫「作用关系推理」。勾上之后，宿主会先读插件的 `package.json` 和入口代码，回答一个比"它用了哪些词"具体得多的问题：这个包**有没有宿主半边、有没有客户端半边**（`dsh.client` 或 `./client` 导出）、**是不是给已有功能打补丁**（`dsh.bundle.patch`）、**注册进了哪个界面槽位**（`slots.register('settings.section', ...)`）、**摸到了哪些能力**（文件、HTTP、进程、LLM、终端、界面）。这份关系被写成一行 `relationship: halves=client+host; patch=yes; slot=settings.section; touches=ui,http,files` 交给模型，并明确要求它**先按名字猜一个，再用这一行去检验**，最后把这段推理写进理由 —— 而不是让它凭感觉挑一个词。界面上的理由会注明"按名字与作用关系推理"，预览里也会写"其中 N 个附了作用关系"。

**查不到就不写。** 如果一个包的清单和代码什么都没透露（比如入口文件不存在、或者整个包都不在本地），这一行**不会**出现 —— 而不是写成 `touches=-`。前者读作"不知道"，后者读作"它什么都不碰"，那是两件不同的事，后者是一句没人验证过的断言。同理，如果这一轮一个包都没能附上关系，预览就不会说"推理过"，因为那是在描述从未发出的字节。这一档依赖源码档（关系是从入口文件推出来的），所以勾上它会自动带上源码；反过来 AI 一关，两者一起清掉。


分类存在 `<DSH_HOME>/storages/dsh-modpack/categories.json`，格式是扁平的 `nodes[]` + `parentId`。这是一个你随时可以手改、同步、合并的普通 JSON 文件，所以宿主在**读和写两侧都会做修复**：id 去重、名称限长、指向不存在或自己的父节点被摘掉、成环的树会断开成环的那条边（子树其余部分留在原地）、指向已删分类的归属被丢弃。修不了的（空名、重复 id、非对象）会在**写盘之前**拒绝，所以被拒绝的保存不会破坏你原来的树。

A category tree sits to the left of the plugin list — filing plugins and picking them for a pack are the same activity. Nodes are nested, renamable in place, and deleting one lifts its children to the grandparent and returns its plugins to *Uncategorized* rather than removing anything. Clicking a node scopes the list to its whole subtree; *Select this category* ticks it in one go. Export stamps each plugin with its full category path so the pack stays readable to whoever receives it, and installation ignores the grouping entirely. The tree is stored at `<DSH_HOME>/storages/dsh-modpack/categories.json`; the host repairs hostile hand-edited files (cycles, dangling parents, dead assignments) on both read and write, and refuses what it cannot honestly repair *before* touching the file on disk.

## 发给别人 / Sending a pack to somebody else

**接收方要不要先装本插件？** 想要「导入 → 预览 → 一键安装」这个体验，要。但**不是必须的** —— 真正干活的是 DSH 自带的 `pluginManager` 服务，本插件只是给它套了个界面。

所以有三条路，导出后界面里会直接列出来：

1. **对方已装本插件** —— 把 `.dshmodpack.json` 发给他，他在「导入」里选中、预览、一键安装。
2. **对方没装** —— 把文件和界面里那段话一起发给他，让他交给自己的智能体。每个 DSH 都自带 `plugin_manager` 工具，智能体照着 `plugins[]` 就能装完，**全程不需要本插件**。
3. **手动** —— 照着文件里 `plugins[]` 的 `name` / `spec` 在插件管理里逐个装。

这里有个先有鸡还是先有蛋的问题：**整合包没法安装「用来打开整合包的那个插件」**。所以第 2 条才是真正通用的路子 —— 它不依赖任何前置安装。

为了让这个文件自己会说话，导出的文档里带一段 `howToUse`：

```jsonc
"howToUse": [
  "This file is a DeepSeek Harness modpack (dsh-modpack). 这是一个 DeepSeek Harness 整合包。",
  "A: Install the dsh-modpack plugin, then use Settings → Plugin Modpacks → Import. …",
  "B: Without the plugin, hand this file to any DeepSeek Harness agent and ask it to install the plugins listed in plugins[] with the plugin_manager tool. …",
  "C: Or install each entry in plugins[] by hand from its name and spec. …"
]
```

写进文件而不是只写进本 README，因为**真正流转的是文件** —— 对方可能直接把文件丢给自己的智能体，那智能体该看到的就是完整说明。

**Does the recipient need this plugin?** For the one-click import path, yes — but it is never *required*. The work is done by DSH's own `pluginManager` service; this plugin is a UI over it. So a pack can always be installed by handing the file to the recipient's agent, since every Harness ships the `plugin_manager` tool. A pack cannot install the plugin you would need in order to open it, which is exactly why that route is the general one.

## 整合包格式 / Modpack format

`.dshmodpack.json` 是一个 UTF-8 JSON 文件：

```jsonc
{
  "format": "dsh-modpack",
  "formatVersion": 1,
  "name": "我的整合包",
  "author": "someone",
  "packVersion": "1.0.0",
  "description": "说明文字",
  "createdAt": "2026-10-26T00:00:00.000Z",
  "generator": { "plugin": "dsh-modpack", "pluginVersion": "1.0.0", "dshVersion": "0.2.1-rc.3" },
  "sourceProfile": "desktop",
  "plugins": [
    {
      "name": "@scope/pkg",        // 安装用的包名
      "moduleName": "@scope/pkg",  // cordis 行里的 moduleName
      "version": "1.2.3",
      "spec": "link:E:/path/to/pkg", // 安装 spec（registry 版或本地 link:）
      "kind": "registry",          // registry | link | bundled
      "official": false,
      "enabled": true,
      "removable": true,
      "description": "……",
      "config": [ /* 该插件在 cordis.patch.yml 里的行，可选 */ ]
    }
  ]
}
```

## 安装 / Installation

### 方式一：作为本地插件挂载（开发/自用）

```bash
# 在 profile 目录下
cd ~/.dsh/profiles/desktop
pnpm add link:/path/to/dsh-modpack
```

然后在 `~/.dsh/profiles/desktop/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: dsh-modpack
      name: 'dsh-modpack'
```

重启 DSH 客户端即可。

### 方式二：用 DSH 自带的插件管理器

在 **设置 → 插件 → 安装** 里填入本地路径或 npm 包名 `dsh-modpack`。

### 方式三：导入别人分享的整合包

直接用本插件打包出来的 `.dshmodpack.json` 在本插件的「导入」页里安装。

### 版本策略：范围 vs 锁定

整合包里每个插件都同时记录「作者当时的依赖写法」和「作者当时实际运行的精确版本」。导入时：

- **默认**按记录的范围安装（例如 `billion-context@^0.1.208`），对方能拿到该范围内的较新版本，更耐版本下架。
- 勾选 **锁定版本安装** 则改为装精确版本（例如 `billion-context@0.1.208`），完全复现作者当时的环境 —— 这也是「整合包」的本意，代价是作者那个版本一旦下架就会失败。
- `link:` / 本机路径的插件**永远不会**被锁定，因为它们本来就无法在别人电脑上解析。

无论哪种模式，写进 DSH 的 spec 都是 npm 能解析的形式（`名称@范围`），而不是裸的版本范围。

## 权限与安全 / Permissions & Safety

- **Host 半边**只注册一个 HTTP 前缀路由 `/api/dsh-modpack`（含 `GET /pack`、`GET /categories`、`POST /categories/save` 等子路径），并且每个请求都先经过 `connection.admit()` 校验，只有本机回环连接可用。
- 分类树只写自己目录下的 `storages/dsh-modpack/categories.json`，**不会**碰任何插件文件。
- 导出：只读 profile 的 `package.json` / `cordis.patch.yml`，**不会**打包插件的源码或任何凭据。
- 导入：全部走 `pluginManager` 官方接口（`installBundle` / `setBundleEnabled` / `setPluginEnabled`），本插件**不会**自己改写 `package.json`、`cordis.patch.yml` 或 `node_modules`，因此 DSH 自己的启用/禁用与配置逻辑始终是唯一事实来源。
- 导入前**一定**先给出预览计划（哪些要装、哪些要开关、哪些装不了），确认后才会真正执行。
- **出网只有一个入口，且默认关闭。** 只有你勾选「联网查询未知插件」时，本插件才会向 `registry.npmjs.org` 和 `api.github.com` 请求**公开的包元数据**（包名、简介、关键词、仓库话题）。发出的是插件名本身，不发任何本地路径、凭据、会话内容或插件清单之外的任何东西。本地线索足够的插件**不会**被发出。查询结果缓存在 `storages/dsh-modpack/remote-cache.json`，可随时用「忘记缓存」清空。
- 除上述联网查询外，**不含任何出网请求、不含遥测**。

> ⚠️ 整合包本质上是「安装指令清单」。请只导入你信任的人给你的整合包 —— 它会指导 DSH 安装其中列出的 npm 包。

## 兼容性 / Compatibility

- DSH `>= 0.2.0-rc.1`（开发验证于 `0.2.1-rc.3`）
- Node `>= 20`
- 平台：Windows / macOS / Linux
- 客户端表面：Web（`dsh.client.platform = "web"`）

### 面向未来版本 / Forward compatibility

本插件**不比对版本号**，而是探测 `pluginManager` 上每个方法是否存在（`capabilities()`），因此某个版本拿掉某个方法时，只失去那一项功能，其余照常：

| 探测的方法 | 缺失时的表现 |
| --- | --- |
| `listBundles` | 退回直接读 profile 文件清点，仍可导出 |
| `installBundle` | 界面禁用「开始安装」并说明原因；导出、预览、分类树不受影响 |
| `setBundleEnabled` / `setPluginEnabled` | 跳过开关步骤，只装不启 |
| `waitForInstall` / `cancelInstall` | 无进度回传，安装仍会完成 |
| `registries` / `inspect` | 不显示源信息，直接按 spec 安装 |
| `listVersionExemptions` | 不显示版本豁免提示 |

探测结果可在 `GET /api/dsh-modpack/diag` 查看。`scripts/check-compat.mjs` 用六套合成运行时（完整 / 旧版 / 最小 / 空壳 / 恶意，外加五套模型服务形状）验证每一套都能加载并优雅降级 —— 把「兼容未来版本」从一句承诺变成一条会失败的测试。

**两个半边之间的握手。** 宿主半边由插件系统读取，客户端半边由浏览器取；升级后浏览器很可能还在用缓存里的旧页面，于是两代代码互相说话。两个文件里各有一个 `API_VERSION`，加载时比一次：不同就提示「按 Ctrl+R 刷新」。只有宿主**明确报出一个不同的数字**才算不匹配 —— 老宿主不报数字、探测失败、返回非数字，一律当作「不知道」，不在一个其实工作正常的老版本上挂红条。同理，`window.__ModuleLoader__` 缺失、插槽键改名、没有 `ctx.inject` 都只降级、不抛错：**一个名字不认识，代价应该是一个标签页，不是整个设置页。**

## 卸载 / Uninstall

在 **设置 → 插件** 里禁用或移除 `dsh-modpack`，或从 `cordis.patch.yml` 中删除对应行。

## 开发 / Development

```bash
npm test                  # 全部检查：两侧语法 + 16 个测试套件
npm run check             # 同上（等价）
node --check index.js     # 仅 Host 半边语法
node --check client.js    # 仅客户端半边语法
```

| 脚本 | 锁住什么 |
| --- | --- |
| `scripts/check-tools.mjs` | 三个智能体工具确实走到 `tools.register`，参数是合法 JSON Schema |
| `scripts/check-categories.mjs` | 分类树路由对环、悬空父、自指、已删归属的处理；被拒绝的保存不改动磁盘 |
| `scripts/check-tree-logic.mjs` | 从 `client.js` 切出真实树函数求值：排序、子树范围、路径标签、环 |
| `scripts/check-drag.mjs` | 拖入整合包时 `dragenter`/`dragover`/`drop` 三阶段都被面板吞掉，不再冒泡到会话 |
| `scripts/check-compat.mjs` | 六套合成运行时 + 五套模型服务形状（`llm` 缺失、`prepareCall` 被改名、`prepareCall` 抛错、stream 不可迭代、completion 以错误结束）下都能加载并给出具体的降级结果；配套 2 个变异全部被捕获（`scripts/mutate-compat.mjs` 可复跑） |
| `scripts/check-ai.mjs` | AI 综合判断：AI 关时不调用模型、无 `llm` 服务时如实报告、只把判不了的插件发出去、联网查到的公开资料（仓库话题/简介/README）会随行喂给模型、模型不能发明分类、回复五花八门时逐行回退到离线答案并留下原因；作用关系档：勾了才发 `relationship:`、没勾一个字都不发、关系行只写查到的字段（查不到整行缺席而不是写 `touches=-`）、提示词带"先按名字猜再用关系检验"、`withRole===0` 时不许声称推理过；Loader 条目也会被送进模型（这一档以前只收 bundle，实机上等于 215 行全瞎）；假 `LlmRuntime` 复刻宿主 `structuredClone` 与 `AbortSignal.any` 两个真实行为；配套 18 个变异全部被捕获（`scripts/mutate-ai.mjs` 可复跑） |
| `scripts/check-autocat.mjs` | 自动分类：预览不写盘、按 tags 归类正确、无 tags 时如实标注、中英双语、basis 与理由文案不矛盾、手工归类默认保留、重跑不重复、畸形树仍可出提案；Loader 条目：清单里每个条目都带它背后的包名、子路径条目被截成包名、伪模块 `cordis:include` 没有包名（这三条读的是清单而不是提案 —— 名字错了描述层照样能工作，只有直接断言清单才抓得住），以及这三条随后确实被归类而不是掉进「其他」 |
| `scripts/check-online-ui.mjs` | 联网开关的界面接线：从 `client.js` 抽出真实组件跑起来，点真按钮，断言请求体里 `online` 默认 `false`、勾选后变 `true`、重跑保持、forget 打自己的路由、以及「AI 开了但没有候选插件」必须出声说明而不是静默；作用关系档：开关存在且 AI 关时禁用、勾它自动带上源码、AI 一关两者一起清空、`reason` 真的进请求体；7 个变异全部被捕获（`scripts/mutate-online-ui.mjs` 可复跑） |
| `scripts/check-remote.mjs` | 联网补全：离线零请求、只查不确定的插件、scoped 包名编码、monorepo 读包自己目录而不读仓库首页（两侧都锁：没有 `directory` 的必须维持本地结论且不许去读根 README，有 `directory` 的必须按 `readme` 层结论）、最强证据胜出且写明出处、缓存命中不再请求、故障不写缓存、forget 清缓存、英文界面说英文；配套 8 个变异全部被预期断言捕获（`scripts/mutate-remote.mjs` 可复跑） |
| `scripts/check-signals.mjs` | 两层证据一致性：① 用官方包**真实发布的 npm 简介原文**验证简介层确实能分类（从 `index.js` 切片取真实规则表，不重写）；② 把宿主 `from*` 计数器与客户端的分档明细对照，凡「分了类却没计数」或「计了数却没标签」都在这里失败 |
| `scripts/check-metasource.mjs` | 官方 `@deepseek-ai/*` 包不在 profile 的 `node_modules` 里，而在运行时归档内。普通 Node 打不开 `app.asar`（那是 Electron 自己补的 `fs` 能力），所以本测试**复刻归档布局**并做 A/B：抽掉归档根，该行必须仍只是猜测；放回归档根，同一行必须按插件自述归类。它锁住的是本插件自己那半边（根有没有被建、被尝试、被消费）；Electron 的归档透明性是宿主的性质，只能在实机客户端里结算 |
| `scripts/check-profileroot.mjs` | profile 目录取自 `profileContext.dir` 而不是环境变量。夹具故意对立：`DSH_PROFILE` 指一个存在但空的目录，`profileContext.dir` 指真正放着包的那个。忽略上下文，包就读不到、该行只能靠猜 —— 正是那个 bug。另一半用**没有** profile 上下文的方式挂载，断言环境变量仍然生效，免得修复变成「硬依赖一个纯 Node 宿主给不出的服务」 |
| `scripts/check-layout.mjs` | 从 `client.js` 切出样式表并解析，禁止**任何**影响排版的属性（`font-weight`/`font-size`/`letter-spacing`/`display`/`padding`/`margin`/`width`/`gap`/`border-width`/`white-space`/`line-height` …）出现在任何状态选择器里（`[data-on]`/`[data-busy]`/`:hover`/`:focus`/`:checked`）；同时断言正面的一半：两个标签确实叠在同一格、预留的空间确实是「可见性」而非「移出文档流」、描边规则确实覆盖全部五个选择器；0.8.6 起还断言包含关系 —— 分类树卡片自己**不**滚动、只有 `.mpk-tree-body` 滚动、自动分类面板在源码顺序上排在 body 之前（JSX 子元素按位置决定从属，源码顺序是唯一判据）、页脚是列而不是换行行、按钮行会换行、`.mpk-stack` 是整行而不是侧栏 |
| `scripts/mutate-layout.mjs` | 23 个变异，全部被捕获：把选中态换成加粗/字距、按钮换标签、标签栈退化成并排、隐藏元素移出文档流、分类树卡片退回整体滚动、面板挪回滚动区里、页脚退回换行行、按钮行不再换行、分类栏退回侧栏，以及 0.8.6 的八条：`overflow` 只剩 `hidden`（仍会建滚动容器）、`clip` 与 `hidden` 声明顺序颠倒、页脚丢掉 `sticky`、页脚钉在 `top` 而不是 `bottom`、对话框守住 800px、宽度规则丢掉 `html.mpk-wide` 作用域、`mpk-wide` 类加了不删、类不看引用计数就删。这一版还改了它自己：子检查的 stderr 改为捕获而不是继承 —— 继承会把每一次**预期内**的失败都打到终端上，看起来像整套跑崩了 |
| `scripts/check-future.mjs` | 两个半边的版本握手与「页面壳换形状」：① 两侧 `API_VERSION` 必须相等，`/diag` 必须报出来；② 只有**明确报出不同数字**才算不匹配 —— 老宿主不报数字、探测失败、返回非数字，一律不匹配（否则老版本上会挂一条红条说「版本不合」而它其实工作正常）；③ 传输失败说清是「连不上宿主半边」、404 说清是「宿主半边太旧没有这个接口」、回的不是 JSON 说清是「不是 JSON」，三种都不许退化成 `Failed to fetch`；④ `window.__ModuleLoader__` 缺失或换了形状不许抛，正常时只调一次；⑤ 一个插槽键被改名只失去那个座位，另一个照常注册，且要出声说明丢了哪个；没有 `slots` 服务时不许从 `apply` 抛出去；⑥ 运行时没有 `ctx.inject` 时 Host 半边要退回直接读服务，`/diag` 仍要能答。读的是**真实源码**（切出函数求值、挂载真插件到合成 ctx），不是复述逻辑 |
| `scripts/mutate-future.mjs` | 9 个变异，全部被捕获：客户端不再比对版本、不报数字也算不匹配、探测失败也算不匹配、传输错误丢掉「连不上后台插件」、404 退化成通用失败、一个座位注册失败就抛出整个 `apply`、两侧 `API_VERSION` 漂移、`/diag` 不再报 `apiVersion`、没有 `ctx.inject` 时当成没有 `webServer` |
| `scripts/check-eol.mjs` | 同一份代码在 LF 与 CRLF 检出下必须表现一致。0.9.0 的 CI 在 Linux 全绿、在 Windows 全红，原因跟插件无关：`core.autocrlf=true`（Git for Windows 默认推荐）把工作树转成 CRLF，而所有检查脚本都用写成 `\n...` 的标记去切源码、所有变异脚本都用 LF 写成的多行字面量去匹配 —— 于是 `/\n[\]}]\n/` 永远匹配不到，`check-signals.mjs` 报出「`const AUTO_RULES = [` 在第 0 列没有闭合括号」，而那个括号明明在。两层各自独立：① `.gitattributes` 钉住 `eol=lf`（缺失或不是 `*` 通配都失败）；② 脚本读源码时自己归一化（`scripts/source-text.mjs`）—— 后者覆盖 ZIP 导出、Windows 上解包的 tarball、编辑器重写行尾这些 `.gitattributes` 管不到的情况。第二条不是文本搜索：它真的把整个插件复制一份、把所有源码转成 CRLF、把全部检查与变异脚本跑一遍，跑不绿就失败。配套 2 个变异全部被捕获（`scripts/mutate-eol.mjs` 可复跑），其中一个就是把归一化改成空操作 —— 那种情况 `.gitattributes` 还在，只有真跑才能抓住 |
| `scripts/mutate-eol.mjs` | 2 个变异，全部被捕获：把 `.gitattributes` 改名挪走（模拟有人删掉根目录这个不认识的文件）、把 `normalizeEol` 改成直接返回原文（`check-signals.mjs` 会立刻报出与线上 CI 一字不差的失败） |
| `scripts/check-tarball.mjs` | 打出来的 tgz 里必须真的有入口文件。这条原来是一行 shell：`tar -tzf "$TGZ" \| grep -q 'package/index.js'`，结果在 CI 上以 exit 2 失败，而它检查的每一条其实都通过了 —— GitHub 的 `shell: bash` 带 `-o pipefail`，`grep -q` 一匹配就退出，管道读端关闭，`tar` 死于 `EPIPE` 并报 2。同一个写法还有第二个更安静的问题：`TGZ=$(ls dist/*.tgz 2>/dev/null \|\| ls *.tgz)` 在两个 glob 都不匹配时得到空串，`tar -tzf ""` 同样报 2，于是「tarball 不存在」和「管道断了」在日志里长得一模一样。现在用 Node 写，`execFileSync` 把整个清单读进内存，没有管道可断，顺带让同一个检查在矩阵的每个平台都跑。它断言三个入口文件 + `package.json#files` 里每一条字面条目 + 隐式的 `package.json`，并且验证过会红：拿掉 `client.js` 的诱饵 tarball 会输出 `FAIL: missing from the tarball: package/client.js` 并 exit 1 |

变异工具（`scripts/mutate-*.mjs`，共 8 个、84 个变异，全部可复跑）：`mutate-remote.mjs`（8 个变异）、`mutate-compat.mjs`（2 个）、`mutate-online-ui.mjs`（7 个）、`mutate-ai.mjs`（18 个）、`mutate-metasource.mjs`（15 个）、`mutate-layout.mjs`（23 个）、`mutate-future.mjs`（9 个）、`mutate-eol.mjs`（2 个）。每个变异都先把源码改坏、跑对应测试、再按字节还原，只有测试真的失败才算「被捕获」。

### 行尾 / Line endings

仓库用 `.gitattributes` 钉住 `eol=lf`。这不只是风格问题：检查脚本会按 `\n` 切源码，变异脚本按 LF 写多行模式，而 Git for Windows 的 `core.autocrlf=true` 会把工作树转成 CRLF，让这些匹配全部落空 —— 表现成「代码有 bug」，实际是检出环境不同。脚本读源码一律走 `scripts/source-text.mjs`，它在读入时归一化，所以 ZIP 导出、Windows 解包的 tarball 也一样能跑。`scripts/check-eol.mjs` 把这件事锁住。

无构建步骤 —— `index.js` 与 `client.js` 都是手写的原生 ESM / 浏览器模块，直接可加载。

Host 半边可以使用完整 Node API（`node:fs`、`node:child_process` 等）；客户端半边通过 `window.__ModuleLoader__.load` 注册，使用 `require('react')` 而不是 import。

`scripts/check-tools.mjs` 用一个只暴露 `tools` 服务的假 Cordis 上下文挂载 Host 半边，断言三个智能体工具确实走到 `tools.register`、且参数已经是合法的 JSON Schema。

这一步是有原因的：工具最初用 `@deepseek-ai/dsh-tools` 的 `defineTool` 构造，而那个包对 profile 里安装的插件来说**不是可解析的模块说明符**——动态 import 抛错、被 `catch` 吞掉，插件照样加载、界面照样能用，于是工具一直不存在却看不出任何异常。宿主 `tools.register` 只校验 `output.render` 是函数、`output.schema` 是受支持的 JSON Schema，并把 `parameters` **原样**投影给模型，所以手写原始 JSON Schema 就是全部契约，不需要任何额外依赖。

改动 Host 半边（`index.js`）后需要重启 DSH 才会生效；改动客户端半边（`client.js`）后刷新页面即可。

## 发布到 GitHub / Publishing

> 📖 **完全没上传过代码？** 看 [UPLOAD-GUIDE.md](UPLOAD-GUIDE.md) —— 全程点鼠标、不敲一行命令：每一步写清楚了点哪里、看到什么算成功，含「三个文件夹拖不上去」的三种解法（挖洞法 / GitHub Desktop / 直接跳过）和 11 个常见问题。
>
> ✍️ **懒得想介绍怎么写？** 看 [GITHUB-COPY.md](GITHUB-COPY.md) —— 仓库简介、话题标签、Release 说明（长版/短版）、发帖文案，全部写好放在框里，直接复制粘贴。

```bash
git init && git add -A && git commit -m "dsh-modpack 0.9.0"
git remote add origin https://github.com/<你>/dsh-modpack.git
git push -u origin main
```

给仓库加上 `dsh-plugin` topic，其他 DSH 用户就能在 GitHub 上搜到它。

> ⚠️ **不想装 git、打算在网页上拖？** 网页上传对**文件**很稳，对**文件夹**不可靠：Firefox 常常完全没反应，一次拖多个往往只吃第一个，而空仓库连能接收拖拽的虚线框都没有。[UPLOAD-GUIDE.md](UPLOAD-GUIDE.md) 第 3.3 节给了纯鼠标的替代办法——先拖 13 个根文件，再用 *Add file → Create new file* 在文件名里打 `/` 把目录挖出来、把剩下的文件拖进各目录页面；第 3.4 节是 GitHub Desktop，一次传完全部 44 个文件。三个文件夹传不上去也不影响别人搜索和安装（Release 里的 tgz 什么都不缺），但 `.github` 与 `scripts` 要么都传、要么都不传，否则 CI 会红。

如果这台机器上没有装 git，仓库里附带了一个不需要 git 的发布脚本，它直接调用 GitHub API 建立**一个干净的首个提交**：

```bash
GITHUB_TOKEN=<你的 Personal Access Token> node scripts/publish-github.mjs
```

Token 只从环境变量读取，不会被写进磁盘、日志或任何上传内容里。classic token 勾 `repo` 即可；fine-grained token 需要 `Administration: Read and write`（建仓库）与 `Contents: Read and write`（推文件）。

### 打包 / Packaging

```bash
node scripts/pack.mjs
```

产物有两个：`dist/dsh-modpack-<版本>.tgz`（npm 布局，只有 `files[]` 里列出的文件外加 npm 必带的 `package.json`）与 `dist/dsh-modpack-v<版本>.zip`（仓库布局，整份仓库，含 CI 与模板）。两者都由 `scripts/repo-manifest.mjs` 推导，不手写清单 —— 0.6.1 那次把一份临时诊断脚本打进包里，就是因为清单是手抄的。接收方可以直接：

```bash
dsh plugin --profile desktop add ./dist/dsh-modpack-0.9.1.tgz
```

## License

MIT
