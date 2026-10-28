# 发布时要填的文案（直接复制粘贴）

> 这个文件里每一块都用 `---` 隔开，**每块对应 GitHub 上的一个输入框**。
> 复制时从框里的第一行复制到最后一行，不要把框本身（三个反引号）复制进去。
>
> 顺序：建仓库时填 ①② → 打完标签填 ③ → 发 Release 时填 ④⑤ → 想发帖宣传时用 ⑥⑦。

---

## ① 仓库名（Repository name）

```text
dsh-modpack
```

---

## ② 仓库简介（Description，GitHub 建仓库时那个框，也是仓库首页 About 区那一行）

**中文版：**

```text
像《我的世界》整合包一样管理 DeepSeek Harness 插件：勾选一部分或全部插件，打包成一个 .dshmodpack.json 文件，别人导入即可一键装回整套插件环境。
```

**英文版（想国际化就用这个，字符更短、更适合搜索）：**

```text
Minecraft-modpack-style plugin bundler for DeepSeek Harness — pick any subset of installed plugins, pack them into one portable .dshmodpack.json, and rebuild the same setup on another machine.
```

> 建议用英文版：GitHub 的搜索和推荐更认英文，而中文用户点进来会先看 README，README 是双语的。

---

## ③ 话题标签（Topics，仓库首页 About 区右上角齿轮里加，一行一个）

```text
dsh-plugin
deepseek-harness
deepseek
modpack
plugin-manager
cordis
```

> `dsh-plugin` 是 DeepSeek Harness 官方约定的标签，**必须加**，别人搜这个词才能找到你。
> 后面几个是加分项：搜 `deepseek-harness`、`modpack` 的人也能撞见你。

---

## ④ Release 标题（Release title）

```text
dsh-modpack v0.9.1
```

---

## ⑤ Release 说明（Describe this release）—— 长版，专业 + 大白话

```markdown
## 这是什么

`dsh-modpack` 是 DeepSeek Harness 的**插件整合包管理器**。

打个比方：玩《我的世界》时，别人给你一个整合包（modpack），你导入进去，几十个模组一次性装好、配置好、排好顺序，不用一个个去下。这个插件就是把这件事搬到 DeepSeek Harness 上——把你自己机器上已经调好的那套插件，打包成一个文件发给朋友，他导入就还原成和你一样的插件环境。

**一句话：勾选 → 打包 → 发文件 → 对方一键装回。**

## 这一版（0.9.1）修了什么

一句话：**Windows 上跑测试会失败，但插件本身在 Windows 上一直是好的。** 修的是测试，不是功能。

第一次把仓库推上去，GitHub Actions 给了这么一张成绩单——Linux 两个绿，Windows 两个红：

```
✅ CI / node 20 on ubuntu-latest
✅ CI / node 22 on ubuntu-latest
❌ CI / node 20 on windows-latest
❌ CI / node 22 on windows-latest
```

红的那条日志里只有一句 `Process completed with exit code 1.`，看不到是哪条断言挂的。本地复现之后才看清：`check-signals.mjs` 在抱怨

```
FAIL: const AUTO_RULES = [ has no closing bracket in column 0
```

——可那个方括号明明在，就在第 0 列，好好的。

**真正的原因是行尾。** Git 有个设置叫 `core.autocrlf`，Git for Windows 安装时会推荐你打开它，作用是把仓库里的 LF 换行在检出时转成 Windows 的 CRLF。于是同一个 commit，Linux 上跑出来是 LF，Windows 上跑出来是 CRLF。

而所有检查脚本都是这么干的：在源码里找 `\n` 开头的标记，切出一段，再用 `/\n[\]}]\n/` 找这段的结尾。CRLF 下 `]` 后面跟的是 `\r`，那个正则**永远匹配不上**。开头标记反而全都匹配——因为 `\r\n` 里确实含一个 `\n`。所以只有结尾扫描挂掉，报出来就是「括号没闭合」。

变异脚本（故意改坏源码、看测试会不会红的那些）中的一部分也没能幸免，只不过更安静：它们用多行文本去匹配源码，CRLF 下匹配 0 次，脚本把这种情况记成「模式不存在」，然后当作**变异存活**——等于把 7 个真实的守卫报成没验证过。

### 修法是两层，因为任意一层单独都有洞

1. **`.gitattributes` 钉住 `eol=lf`**：任何人 clone 下来就是 LF。实测：用 `-c core.autocrlf=true` 克隆，`index.js` 的 CRLF 对数量从 3703 变成 **0**。
2. **脚本读源码时自己归一化**（`scripts/source-text.mjs`）：因为第一层只管 git 产出的东西。你从 GitHub 下 ZIP、在 Windows 上解包 tarball、或者编辑器手滑改了行尾，`.gitattributes` 都管不着。变异脚本则保留「磁盘上的原始文本」和「归一化后的文本」两份，还原时写回原始的那份——**跑测试不会顺手改掉你的行尾**。

### 还加了什么

- **`scripts/check-eol.mjs`**：真的把整个插件复制一份、把所有源码转成 CRLF、把检查和变异脚本跑一遍。跑不绿就失败。顺带断言 `.gitattributes` 那条 `*` 规则还在——文件被删时报的是「断言失败」，不是检查器自己的 `ENOENT` 堆栈。
- **`scripts/mutate-eol.mjs`**：2 个变异，都验证过能被抓住。其中「把归一化改成空操作」这个尤其值得留着——那时 `.gitattributes` 还在，只有真跑 CRLF 沙箱才抓得到，而它复现出的报错和线上 CI 一字不差。
- **CI 会先打印这次检出拿到的是什么行尾**：以后 Windows 再红，从日志一眼就能看出是不是同一类问题，不用再找台 Windows 机器复现。

这一版包含 0.9.0 的全部内容，下面继续。

## 0.9.0 做了什么

这是一个**面向未来的适配版本**，核心是三件事：

### 1. 两个半边之间加了版本握手

这个插件由两个文件组成：跑在 Node 里的**宿主半边**（`index.js`）和跑在浏览器里的**客户端半边**（`client.js`）。它们从两个不同的地方加载——宿主半边在插件被应用时读取，客户端半边由浏览器去取。

问题就出在这儿：升级之后，浏览器很可能还在用缓存里的旧页面，而宿主半边已经是新的了。这种组合下，你看到的每一个症状——「点了没反应」「导出的文件是空的」「按钮转圈不动」——看起来都像插件有 bug，其实只是**两代代码在互相说话**。

0.9.0 在两个文件里各写了一个 `API_VERSION`，加载时比一次：

- 宿主通过 `GET /api/dsh-modpack/diag` 报出自己的号；
- 页面拿自己的号去比；
- 不一样就显示一句话，直接告诉你怎么办：**按 Ctrl+R 刷新**；刷新还不行，就去插件页把本插件关掉再打开一次。

这里**故意没有用插件版本号**做这件事。插件版本号会因为改文档、改 CSS 而变，而旧页面只在**接口形状变了**的时候才真的危险。用一个只在这时候才动的数字，才不会动不动就误报。

### 2. 页面壳换了形状也不会把整个设置页带崩

`window.__ModuleLoader__`、`ctx.slots.inject`、插槽键名（`settings.section`）——这些都是 Harness 的实现细节，不是这个插件能规定的契约。

以前的写法是：拿不到就抛错。而这是在模块顶层抛的，等于**整个设置页跟着一起白屏**。

现在：加载器不在就不挂载（宿主半边照常工作），某个插槽键改名就只少一个标签页并在控制台说一句，另一个座位不受影响。**一个名字不认识，代价应该是一个标签页，不应该是整个插件。**

### 3. 宿主没有 `ctx.inject` 时不再静默失效

`whenService` 原来无条件调用 `ctx.inject`。在比它更老的 Harness 上，这个调用会在 `apply` 里抛出去，结果 HTTP 路由和三个智能体工具**一个都没注册**——而插件看起来还是"加载成功"的样子。

现在：没有 `ctx.inject` 就退回直接读服务，不比它替代的行为更差。

## 它到底能干什么

- **插件清单**：自动读当前 profile 的 `package.json` 与 `cordis.patch.yml`，列出全部已安装插件（名称、版本、来源、启用状态、类型）
- **筛选搜索**：按名称、模块名、描述实时搜；按已启用 / 已禁用 / 本地链接 / 官方 / 可移除筛
- **分类树**：自己命名的可嵌套分类，点分类即按其子树过滤，可整类勾选、批量归类；分类跟着整合包一起走
- **自动分类**：一键按 31 条有序规则归类——作者声明的 `keywords` 最优先，其次插件自己注册的简介、包里的 README，最后才是名字。先预览再应用，每行标注来源
- **四档可选证据**：联网查阅 / AI 综合判断 / 附带源码 / 作用关系推理。默认全关，你点哪档它才走哪档
- **勾选打包**：全选 / 反选 / 仅选已启用 / 仅选可分享，导出 `.dshmodpack.json`
- **导入安装**：选文件 → 预览要装什么 → 确认 → 一键装
- **分享引导**：导出后直接给你一段能一键复制、发给对方智能体的话
- **可选锁定版本**：默认按版本范围装（更耐下架），勾上就装精确版本（更可复现）
- **三个智能体工具**：`modpack_list` / `modpack_export` / `modpack_apply`，`modpack_apply` 默认只预演，要显式 `dryRun: false` 才真装

## 兼容性

- DSH `>= 0.2.0-rc.1`（开发验证于 `0.2.1-rc.3`）
- Node `>= 20`
- Windows / macOS / Linux
- 客户端表面：Web

**关于"未来版本"**：这个插件**不比对版本号**，而是探测 `pluginManager` 上每个方法在不在。少了 `installBundle` 就禁用安装按钮并说明原因；少了 `setBundleEnabled` 就只装不启；少了 `waitForInstall` 就没有进度条但照样装完。**某个方法被拿掉，只失去那一项功能。**

## 安全

- 宿主半边只注册一个 HTTP 前缀路由 `/api/dsh-modpack`，每个请求先过 `connection.admit()`，只有本机回环可用
- 分类树只写自己目录下的 `storages/dsh-modpack/categories.json`，不碰任何插件文件
- 导入全部走 `pluginManager` 官方接口，**不会**自己改写 `package.json`、`cordis.patch.yml` 或 `node_modules`
- 出网只有一个入口且默认关闭：勾了「联网查阅」才去 npm / GitHub 请求**公开的包元数据**，发出去的只有插件名
- 除上述之外**没有任何出网请求、没有遥测**

⚠️ 整合包本质上是「安装指令清单」。请只导入你信任的人给你的整合包。

## 安装

```bash
dsh plugin --profile desktop add ./dsh-modpack-0.9.1.tgz
```

装完在 **设置 → 插件整合包** 里。

## 测试

15 个检查套件 + 8 个变异套件（84 个变异），全部通过。CI 在 Node 20/22 × Linux/Windows 上跑全套。

变异测试的意思是：**故意把源码改坏，然后看测试会不会红**。不会红的测试不算测试。

## 更新日志

完整改动见 [CHANGELOG.md](CHANGELOG.md)。
```

---

## ⑥ 短版 Release 说明（懒得贴长版就用这个）

```markdown
## dsh-modpack v0.9.1

DeepSeek Harness 的插件整合包管理器 —— 像《我的世界》整合包一样，把装好的插件勾选打包成一个文件，别人导入就还原成同一套环境。

**0.9.1 修的是测试，不是功能**：GitHub Actions 的 Windows 任务一直红，因为 Git 的 `core.autocrlf` 会把工作树转成 CRLF，而检查脚本按 `\n` 切源码。现在 `.gitattributes` 钉住 LF，脚本读源码时也自己归一化（覆盖 ZIP 导出、Windows 解包 tarball 这些 git 管不到的情况），并加了 `check-eol.mjs` 真跑一遍 CRLF 沙箱防回归。

**这一版还包含 0.9.0 的适配加固：**

- **两半版本握手**：宿主半边与浏览器半边各有一个 `API_VERSION`，加载时比一次。升级后浏览器用了旧缓存页面，会直接告诉你「按 Ctrl+R 刷新」，而不是让你对着一个点了没反应的按钮猜。
- **页面壳换形状不再带崩设置页**：加载器改名、插槽键改名，代价是一个标签页，不是整个设置页白屏。
- **老宿主没有 `ctx.inject` 时不再静默失效**：退回直接读服务，路由和工具照常注册。

兼容 DSH `>= 0.2.0-rc.1` / Node `>= 20` / Win·macOS·Linux。不比对版本号，改为探测 `pluginManager` 的方法，少一个方法只失去那一项功能。

安装：

```bash
dsh plugin --profile desktop add ./dsh-modpack-0.9.1.tgz
```

15 个检查套件 + 84 个变异，全绿。
```

---

## ⑦ 发帖 / 群聊宣传文案

**朋友圈 / 群聊（短，口语）：**

```text
给 DeepSeek Harness 写了个插件：像《我的世界》整合包那样管理插件。

以前换电脑要一个个把插件重新装一遍，现在勾选一下、导出一个文件发给朋友，他导入就还原成我这套环境，连分类都带过去。

还带自动分类：31 条规则按「作者关键词 → 插件自述 → README → 名字」的顺序猜，猜不出来的还能叫 AI 看一眼代码和它在客户端里接在哪儿。

地址：https://github.com/你的用户名/dsh-modpack
```

**论坛 / V2EX / Reddit 风格（中，带技术点）：**

```text
[自荐] dsh-modpack：给 DeepSeek Harness 的插件整合包管理器

DeepSeek Harness 装插件很方便，但「把这套环境搬到另一台机器」一直是个手工活。
dsh-modpack 做的就是这件事：勾选 → 导出 `.dshmodpack.json` → 对方导入一键还原。

技术上几个我自己比较满意的点：

1. 不比对版本号，改为探测 pluginManager 上每个方法在不在。少了 installBundle 就禁用安装按钮并说明原因，少了 waitForInstall 就没有进度条但照样装完。某个方法被拿掉，只失去那一项功能。
2. 自动分类是 31 条有序规则，证据分四层：作者声明的 keywords > 插件自己注册的简介 > 包里的 README > 名字。每行都标注来源，猜就是猜，不假装。
3. 可选的四档证据（联网 / AI / 源码 / 作用关系）默认全关。AI 那档只能改写判断、不能发明分类——模型给出的类名必须精确命中已有规则表，否则整行回退到离线答案并写明原因。
4. 84 个变异测试。每个变异都是「故意把源码改坏，看测试会不会红」。不会红的测试不算测试。

兼容 DSH >= 0.2.0-rc.1 / Node >= 20 / 三平台。
https://github.com/你的用户名/dsh-modpack
```

**英文版（发 Reddit / HN / X）：**

```text
[Show] dsh-modpack — Minecraft-modpack-style plugin bundler for DeepSeek Harness

DeepSeek Harness makes installing plugins easy. Moving a whole tuned plugin setup to another machine is still manual work. dsh-modpack turns that into: tick the plugins → export one `.dshmodpack.json` → import it on the other machine.

A few decisions worth calling out:

- **No version comparison.** It probes which methods `pluginManager` actually has. Missing `installBundle` disables the install button with a reason; missing `waitForInstall` means no progress bar but the install still finishes. One missing method costs one feature, never the whole plugin.
- **Classification is 31 ordered rules over four tiers of evidence**: author-declared keywords > the description the plugin registers for itself > the package README > the name. Every row says which tier decided it. A guess is labelled a guess.
- **Four optional evidence rungs** (online lookup / AI judgement / source digest / role reasoning), all off by default. The AI rung may only *override* a verdict, never invent a category: the model's answer must exactly match an existing rule id, or the whole row falls back to the offline answer and says why.
- **84 mutation tests.** Each one breaks the source on purpose and fails if the tests stay green. A test that cannot go red is not evidence.

DSH >= 0.2.0-rc.1 / Node >= 20 / Windows·macOS·Linux.
https://github.com/your-name/dsh-modpack
```

---

## ⑧ 一句话版本（放在 README 顶部、About、或者聊天里第一句）

```text
像《我的世界》整合包一样管理 DeepSeek Harness 插件：勾选、打包、发文件，对方导入即还原。
```

---

## 复制完之后

1. 上面所有 `你的用户名` / `your-name` 都要换成你自己的 GitHub 用户名。
2. `dsh-modpack-0.9.1.tgz` 要换成你实际打包出来的文件名（版本号对得上就行）。
3. 发帖前先自己点一遍仓库链接，确认能打开——**空仓库也能打开，所以要看 README 有没有显示出来**。
