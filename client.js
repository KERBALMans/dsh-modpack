/**
 * dsh-modpack — Client half.
 *
 * A "modpack builder" page that lives as a tab inside Settings → Plugins.
 * It shows every installed plugin and bundle, lets you filter and check the
 * ones you want, and exports the selection as one portable file that somebody
 * else can install on their own Harness.
 *
 * Everything is rendered with plain React from `require('react')` and styled
 * with the Harness theme tokens, so the page follows light/dark automatically.
 * All data comes over the plugin's own HTTP route (`/api/dsh-modpack/*`); this
 * half holds no host state and no direct file access.
 */
// The page bootstrap (`window.__ModuleLoader__`) is a Harness implementation
// detail, not a contract this plugin owns. A build that renames it, moves it,
// or loads client halves by another route must not take the whole Settings page
// down with an uncaught TypeError at module scope — so the call is guarded, and
// a missing loader means "this half simply does not attach". The host half is
// independent and keeps serving its routes either way.
const MPK_LOADER = typeof window === 'undefined' ? null : window.__ModuleLoader__

if (MPK_LOADER && typeof MPK_LOADER.load === 'function') MPK_LOADER.load({
  id: 'dsh-modpack',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/api/dsh-modpack'
    const FILE_SUFFIX = '.dshmodpack.json'

    // Must equal `API_VERSION` in index.js. The two halves are loaded from two
    // different places — the host half when the plugin is applied, this one
    // when the browser asks for it — so an upgrade can leave a stale copy of
    // this file in the browser's cache while the new host half is already
    // running. That combination produces request/response mismatches that look
    // like plugin bugs and are not. One number compared at load time turns it
    // into a message that says what to do: reload.
    const API_VERSION = 2

    /* ---------------------------------------------------------------- */
    /* i18n                                                             */
    /* ---------------------------------------------------------------- */

    const DICT = {
      zh: {
        tab: '插件整合包',
        title: '插件整合包',
        subtitle: '像做整合包一样，把你装好的插件挑出来打包，换台电脑一键装回去。',
        tabBuild: '制作整合包',
        tabInstall: '安装整合包',
        tabLibrary: '我的整合包',

        refresh: '刷新',
        search: '搜索插件…',
        filterAll: '全部',
        filterEnabled: '已启用',
        filterDisabled: '已禁用',
        filterThirdParty: '第三方',
        filterOfficial: '官方',
        filterPortable: '可直接分享',
        filterUnportable: '含本机路径',

        selectAll: '全选（当前筛选）',
        selectNone: '清空选择',
        selectInvert: '反选',

        groupBundles: '插件包',
        groupPlugins: '插件条目',
        groupHintBundles: '决定"装什么"。勾上就会写进别人的依赖列表。',
        groupHintPlugins: '决定"开不开"。随整合包一起搬运启用/禁用状态。',

        badgeOfficial: '官方',
        badgeThirdParty: '第三方',
        badgeLocal: '本机路径',
        badgeDisabled: '已禁用',
        badgeMissing: '未安装',
        badgeEmpty: '空壳',

        /* ---- category tree ---- */
        treeTitle: '分类树',
        treeAll: '全部插件',
        treeUnassigned: '未分类',
        treeNew: '新建分类',
        treeNewChild: '新建子分类',
        treeRename: '重命名',
        treeDelete: '删除',
        treeNamePlaceholder: '分类名称',
        treeEmpty: '还没有分类。点右上角「＋」建一个，例如「语言模型」「开发工具」。',
        treeCount: (n) => `${n} 项`,
        treeSelectGroup: '选中本分类',
        treeClearGroup: '取消本分类',
        treeAssign: '归入',
        treeAssignBulk: '批量归入',
        treeSaved: '分类已保存',
        treeSaveFailed: '分类保存失败',
        treeDeleteConfirm: (name) => `删除分类「${name}」？里面的子分类会上移，插件回到「未分类」。`,
        treeFiltering: (name) => `只显示分类：${name}`,
        shareTitle: '怎么发给别人',
        shareStep1: '对方已经装了本插件：把文件发给他，他在「导入」里选中它、预览、一键安装。',
        shareStep2: '对方没装本插件：把文件和下面这段话一起发给他，让他交给自己的智能体 —— 他的 Harness 自带 plugin_manager，不需要本插件也能装。',
        shareStep3: '也可以照着文件里 plugins[] 的 name / spec 手动逐个安装。',
        shareCopy: '复制这段话',
        shareCopied: '已复制',
        shareCopyFail: '复制失败，请手动选中下面的文字',
        sharePromptIntro: (name) => `我收到一个 DeepSeek Harness 整合包「${name}」，需要你帮我装上里面的插件。`,
        sharePromptAsk: '请用 plugin_manager 工具安装下面这些插件（bundle 用 installBundle；装完按末尾标注设置启用状态）：',
        sharePromptOutro: '装完告诉我哪些成功、哪些失败。整合包文件我也一并给你，里面的 plugins[] 就是这份清单。',
        shareKeepDisabled: '保持禁用',
        treeShowAll: '显示全部',

        autoTitle: '自动分类',
        autoBtn: '自动分类',
        autoRerun: '重新分类',
        autoIntro: '按插件自己声明的关键词把它们归入分类。先预览，确认后才写入 —— 你手动归过的分类默认不会被覆盖。',
        autoOverwrite: '覆盖我已有的归类',
        autoPreview: '预览结果',
        autoApply: '应用这个分类',
        autoCancel: '取消',
        autoNothing: '所有插件都已经有分类了，没有需要处理的。',
        autoSummary: (n, c) => `将归入 ${n} 个插件到 ${c} 个分类`,
        autoBasisTags: '按关键词',
        autoBasisDesc: '按插件自述',
        autoBasisReadme: '按自带的说明文档',
        autoBasisName: '按名字推测',
        autoBasisFact: '按安装方式',
        autoBasisNone: '无法判断',
        autoBasisRemote: '联网查到',
        autoFromTags: (n) => `${n} 个按作者关键词`,
        autoFromDesc: (n) => `${n} 个按插件自述`,
        autoFromReadme: (n) => `${n} 个按自带的说明文档`,
        autoFromName: (n) => `${n} 个按名字推测`,
        autoFromFact: (n) => `${n} 个按安装方式`,
        autoFromRemote: (n) => `${n} 个联网查到`,
        autoFromNone: (n) => `${n} 个无法判断`,
        autoKept: (n) => `保留了你已有的 ${n} 个归类`,
        autoOverwrote: (n) => `覆盖了 ${n} 个你原有的归类`,
        autoApplied: '自动分类已应用',
        autoApplyEmpty: '这次没有可应用的新分类 —— 所有插件都已有归类。',
        autoFailed: '自动分类失败',
        autoGroupHint: '这些分类可以重命名、合并或删掉，和手动建的完全一样。',
        autoOnline: '联网查询本地判断不了的插件',
        autoOnlineHint: '默认关闭。只有本地没有线索的插件名会被发往 npm / GitHub 查公开元数据；能判断的不会发出去。',
        autoOnlineRan: (looked, found) => `联网查了 ${looked} 个，查到 ${found} 个`,
        autoOnlineNone: '联网没有查到新线索，结果和离线一致。',
        autoOnlineFail: (n) => `${n} 个请求失败，下次会重试`,
        autoForget: '忘记缓存',
        autoForgetDone: '联网缓存已清空',
        autoForgetHint: '清空后，下次联网查询会重新向 npm / GitHub 询问。',
        autoOpen: '自动分类',
        autoOptionsShort: '重新选条件',
        autoOptionsTitle: '先选调查方式，再开始',
        autoOptionsIntro: '下面每一项都是可选的，勾得越多查得越准，也越慢。不勾任何一项就是纯离线分类，不发任何请求、不花 token。',
        autoOptOffline: '纯离线（不勾下面任何一项）',
        autoOptSource: '读取插件源码作为判断依据',
        autoOptSourceHint: '读取每个插件入口文件的头部注释、它注册了什么、依赖了什么。全部在本机完成，不联网、不花 token。',
        autoOptAi: 'AI 综合判断',
        autoOptAiHint: '把包名、描述、关键词、README 开头（勾了上一项则还有源码摘录）发给你在 DSH 里配置的模型，让它来归类。会消耗 token。',
        autoOptNeedAi: '这一项只有勾了「AI 综合判断」才有意义——源码本身只是一份证据，要交给模型看。',
        autoOptReason: '让 AI 先推理它与客户端的作用关系',
        autoOptReasonHint: '在上面两项的基础上，额外告诉模型这个插件装在客户端里实际接在哪儿：是浏览器里的界面那半还是 Node 里的宿主那半、是不是改写宿主装配的补丁层、往哪个界面插槽挂载、伸手够哪些能力（界面/工具/网络/文件/进程/模型/子智能体/终端）。模型会先用名字猜它做什么，再用这些关系去验证，然后才归类。会多花一点 token。',
        autoOptReasonNeedAi: '这一项要在「AI 综合判断」之上，并且会自动带上源码——作用关系是从入口代码里读出来的。',
        autoReason: '按名字与作用关系推理',
        autoOptOverwrite: '覆盖我已有的手工归类',
        autoStart: '开始分类',
        autoRunning: '正在调查…',
        autoAiUnavailable: '当前客户端没有可用的模型服务，AI 判断已跳过，其余结果照常。',
        autoAiNoModel: '没有找到可用的模型，AI 判断已跳过，其余结果照常。',
        autoAiNothing: '这次没有需要 AI 判断的插件——离线与联网两轮已经把它们都判完了，所以没有消耗 token。',
        autoAiFailed: (why) => `AI 判断失败（${why}），已退回离线结果。`,
        autoAiRan: (asked, found) => `AI 看了 ${asked} 个，判定了 ${found} 个`,
        autoAiTokens: (input, output) => `消耗 ${input} 输入 / ${output} 输出 token`,
        autoAiCode: (n) => `其中 ${n} 个带源码摘录`,
        autoAiRole: (n) => `${n} 个附了作用关系`,
        autoBasisAi: 'AI 判断',
        autoFromAi: (n) => `${n} 个由 AI 判断`,

        treeView: '视图',
        treeViewList: '列表',
        treeViewDiagram: '树状图',
        treeDiagramHint: '每个方块是一个分类，括号里是它直接归入的插件数；点一下可以筛选。',
        treeDiagramEmpty: '还没有分类，先建一个或跑一次自动分类。',

        overrideLabel: '分享地址（可选）',
        overridePlaceholder: '换成 registry 包名或 git 地址，别人才能装',
        overrideHint: '这个插件来自本机路径，换台电脑找不到。填一个公开地址，整合包才可移植。',

        metaName: '整合包名称',
        metaNamePlaceholder: '例如：我的前端开发套件',
        metaDesc: '简介',
        metaDescPlaceholder: '这个整合包是干什么用的',
        metaAuthor: '作者',
        metaAuthorPlaceholder: '你的名字',

        chosenCount: (n) => `已选 ${n} 项`,
        exportFile: '导出为文件',
        saveLocal: '保存到本机',
        clearForm: '重置表单',

        installTitle: '安装一个整合包',
        installHint: '把别人给你的 .dshmodpack.json 拖进来，或者从本机整合包里选一个。',
        dropHere: '拖拽整合包文件到这里',
        chooseFile: '选择文件…',
        fromLibrary: '从「我的整合包」加载',

        preview: '预览',
        previewHint: '先看一眼会发生什么，确认后再真的装。',
        apply: '开始安装',
        applying: '正在安装…',
        cannotInstall: '当前 Harness 版本没有 installBundle，无法在本机安装整合包',
        allowLocal: '同时尝试本机路径插件（仅在同一台电脑上有效）',
        pinVersions: '锁定版本安装（按整合包记录的精确版本，而不是版本范围）',

        colAction: '动作',
        colPlugin: '插件',
        colNote: '说明',
        actInstall: '安装',
        actToggleOn: '启用',
        actToggleOff: '禁用',
        actSkip: '跳过',
        actBlocked: '受阻',
        actInvalid: '无效',
        actFailed: '失败',
        actInstalled: '已安装',
        actToggled: '已调整',

        restartRequired: '有改动需要重启 Harness 才生效。',
        noActions: '没有任何需要改动的地方，这个整合包已经和本机一致。',
        installDone: '安装完成',

        libraryEmpty: '本机还没有保存过整合包。到「制作整合包」页做一个吧。',
        load: '加载',
        download: '下载',
        delete: '删除',
        confirmDelete: '确定删除这个整合包吗？',
        entries: (n) => `${n} 项`,
        savedAt: '保存于',

        degradedTitle: '插件管理服务不可用',
        degradedHint: '当前 Harness 没有暴露 pluginManager 服务，这个页面只能查看，不能安装插件。请升级 Harness，或改用 Host 半侧直接改配置文件。',
        staleTitle: '这个页面是旧版本，需要刷新',
        staleBody: (host, self) => `后台插件已经是新版（接口 v${host}），而浏览器里加载的还是旧版页面（接口 v${self}）。两半对不上话，按钮可能没反应。按 Ctrl+R（Mac 上是 Cmd+R）刷新一下就好；如果刷新后还是这样，说明 Harness 没有重新加载插件，去「插件」页把本插件关掉再打开一次。`,
        errorTitle: '出错了',
        retry: '重试',
        loading: '加载中…',
        notPortableWarn: (names) => `这些插件来自本机路径，别人装了也用不了：${names}`,
      },
      en: {
        tab: 'Plugin Modpacks',
        title: 'Plugin Modpacks',
        subtitle: 'Pick the plugins you have set up, pack them into one file, and install them on another machine.',
        tabBuild: 'Build',
        tabInstall: 'Install',
        tabLibrary: 'My Modpacks',

        refresh: 'Refresh',
        search: 'Search plugins…',
        filterAll: 'All',
        filterEnabled: 'Enabled',
        filterDisabled: 'Disabled',
        filterThirdParty: 'Third-party',
        filterOfficial: 'Official',
        filterPortable: 'Shareable',
        filterUnportable: 'Has local path',

        selectAll: 'Select all (filtered)',
        selectNone: 'Clear',
        selectInvert: 'Invert',

        groupBundles: 'Packages',
        groupPlugins: 'Plugin entries',
        groupHintBundles: 'What gets installed. Checked packages go into the other person\'s dependency list.',
        groupHintPlugins: 'What gets switched on. Enable/disable state travels with the pack.',

        badgeOfficial: 'official',
        badgeThirdParty: 'third-party',
        badgeLocal: 'local path',
        badgeDisabled: 'disabled',
        badgeMissing: 'not installed',
        badgeEmpty: 'empty',

        /* ---- category tree ---- */
        treeTitle: 'Categories',
        treeAll: 'All plugins',
        treeUnassigned: 'Uncategorized',
        treeNew: 'New category',
        treeNewChild: 'New subcategory',
        treeRename: 'Rename',
        treeDelete: 'Delete',
        treeNamePlaceholder: 'Category name',
        treeEmpty: 'No categories yet. Use “＋” above to make one, e.g. “Language models” or “Dev tools”.',
        treeCount: (n) => `${n} item${n === 1 ? '' : 's'}`,
        treeSelectGroup: 'Select this category',
        treeClearGroup: 'Deselect this category',
        treeAssign: 'Move to',
        treeAssignBulk: 'Assign selected',
        treeSaved: 'Categories saved',
        treeSaveFailed: 'Could not save categories',
        treeDeleteConfirm: (name) => `Delete “${name}”? Subcategories move up and its plugins return to Uncategorized.`,
        treeFiltering: (name) => `Filtered by category: ${name}`,
        shareTitle: 'Sending this to somebody else',
        shareStep1: 'If they already have this plugin: send the file, and they pick it under Import, preview, and install in one click.',
        shareStep2: 'If they do not: send the file together with the message below and have them hand it to their own agent — their Harness ships with plugin_manager, so this plugin is not required.',
        shareStep3: 'Or they can install each entry by hand from the name / spec in plugins[].',
        shareCopy: 'Copy this message',
        shareCopied: 'Copied',
        shareCopyFail: 'Copy failed — select the text below manually',
        sharePromptIntro: (name) => `I received a DeepSeek Harness modpack "${name}" and need you to install the plugins in it.`,
        sharePromptAsk: 'Please install these with the plugin_manager tool (use installBundle for bundles; apply the enablement noted at the end of each line):',
        sharePromptOutro: 'Tell me which succeeded and which failed. I am also giving you the modpack file itself; its plugins[] is this list.',
        shareKeepDisabled: 'keep disabled',
        treeShowAll: 'Show all',

        autoTitle: 'Auto-categorise',
        autoBtn: 'Auto-categorise',
        autoRerun: 'Re-run',
        autoIntro: 'Files each plugin under a category using the keywords it declares. Preview first — nothing is written until you apply, and categories you set by hand are kept by default.',
        autoOverwrite: 'Overwrite my existing assignments',
        autoPreview: 'Preview',
        autoApply: 'Apply these categories',
        autoCancel: 'Cancel',
        autoNothing: 'Every plugin already has a category — nothing to do.',
        autoSummary: (n, c) => `${n} plugins into ${c} categories`,
        autoBasisTags: 'from keywords',
        autoBasisDesc: "from the plugin's own description",
        autoBasisReadme: 'from its bundled README',
        autoBasisName: 'guessed from name',
        autoBasisFact: 'from install source',
        autoBasisNone: 'no signal',
        autoBasisRemote: 'looked up online',
        autoFromTags: (n) => `${n} from the author's keywords`,
        autoFromDesc: (n) => `${n} from the plugin's own description`,
        autoFromReadme: (n) => `${n} from a bundled README`,
        autoFromName: (n) => `${n} guessed from the name`,
        autoFromFact: (n) => `${n} from the install source`,
        autoFromRemote: (n) => `${n} looked up online`,
        autoFromNone: (n) => `${n} with no signal`,
        autoKept: (n) => `kept ${n} of your existing assignments`,
        autoOverwrote: (n) => `overwrote ${n} of your existing assignments`,
        autoApplied: 'Categories applied',
        autoApplyEmpty: 'Nothing new to apply — every plugin already has a category.',
        autoFailed: 'Auto-categorise failed',
        autoGroupHint: 'These are ordinary categories — rename, merge or delete them like any other.',
        autoOnline: 'Look up plugins I cannot classify locally',
        autoOnlineHint: 'Off by default. Only plugin names with no local clue are sent to npm / GitHub for public metadata; anything classifiable stays here.',
        autoOnlineRan: (looked, found) => `looked up ${looked}, found ${found}`,
        autoOnlineNone: 'The lookup added nothing new — same result as offline.',
        autoOnlineFail: (n) => `${n} request(s) failed and will be retried next time`,
        autoForget: 'Forget cache',
        autoForgetDone: 'Lookup cache cleared',
        autoForgetHint: 'After clearing, the next online run asks npm / GitHub again.',
        autoOpen: 'Auto-classify',
        autoOptionsShort: 'Change options',
        autoOptionsTitle: 'Pick how to investigate, then start',
        autoOptionsIntro: 'Every option below is optional. The more you tick, the better the answer and the slower the run. Ticking nothing is a purely offline classification: no requests, no tokens.',
        autoOptOffline: 'Offline only (nothing below ticked)',
        autoOptSource: 'Read plugin source as evidence',
        autoOptSourceHint: 'Reads each plugin entry file\'s header comment, what it registers and what it depends on. All local: no network, no tokens.',
        autoOptAi: 'AI judgement',
        autoOptAiHint: 'Sends the package name, description, keywords and README opening (plus the source excerpts above, if ticked) to the model configured in DSH and asks it to file them. Consumes tokens.',
        autoOptNeedAi: 'This one only means something together with "AI judgement" — source is evidence, and evidence needs something to read it.',
        autoOptReason: 'Let the AI reason about how it attaches to the client',
        autoOptReasonHint: 'On top of the two above, tells the model where this plugin actually attaches inside the client: the browser half that draws UI or the Node half that does the work, whether it is a patch layer rewriting the host\'s own composition, which UI slot it mounts into, and which capabilities it reaches for (ui/tools/http/files/process/llm/agent/terminal). The model guesses from the name first, then tests that guess against these relationships, and only then picks a category. Costs a few more tokens.',
        autoOptReasonNeedAi: 'This one sits on top of "AI judgement" and turns the source tick on for you — the relationship is read out of the entry code.',
        autoReason: 'reasoned from name + role',
        autoOptOverwrite: 'Overwrite the categories I set by hand',
        autoStart: 'Start',
        autoRunning: 'Investigating…',
        autoAiUnavailable: 'This client exposes no model service, so AI judgement was skipped and the rest of the result stands.',
        autoAiNoModel: 'No usable model was found, so AI judgement was skipped and the rest of the result stands.',
        autoAiNothing: 'Nothing needed AI judgement this time — the offline and online passes had already filed every plugin, so no tokens were spent.',
        autoAiFailed: (why) => `AI judgement failed (${why}); fell back to the offline result.`,
        autoAiRan: (asked, found) => `AI saw ${asked}, filed ${found}`,
        autoAiTokens: (input, output) => `${input} input / ${output} output tokens`,
        autoAiCode: (n) => `${n} of them included source excerpts`,
        autoAiRole: (n) => `${n} with a role description`,
        autoBasisAi: 'AI judgement',
        autoFromAi: (n) => `${n} by AI`,

        treeView: 'View',
        treeViewList: 'List',
        treeViewDiagram: 'Diagram',
        treeDiagramHint: 'Each box is a category, with the number of plugins filed directly under it. Click one to filter.',
        treeDiagramEmpty: 'No categories yet — create one, or run auto-classify.',

        overrideLabel: 'Shareable address (optional)',
        overridePlaceholder: 'Replace with a registry name or git URL so others can install it',
        overrideHint: 'This plugin comes from a local path that will not exist elsewhere. Give it a public address to make the pack portable.',

        metaName: 'Modpack name',
        metaNamePlaceholder: 'e.g. My frontend toolkit',
        metaDesc: 'Description',
        metaDescPlaceholder: 'What this modpack is for',
        metaAuthor: 'Author',
        metaAuthorPlaceholder: 'Your name',

        chosenCount: (n) => `${n} selected`,
        exportFile: 'Export as file',
        saveLocal: 'Save on this machine',
        clearForm: 'Reset form',

        installTitle: 'Install a modpack',
        installHint: 'Drop a .dshmodpack.json someone gave you, or pick one saved on this machine.',
        dropHere: 'Drop a modpack file here',
        chooseFile: 'Choose file…',
        fromLibrary: 'Load from My Modpacks',

        preview: 'Preview',
        previewHint: 'See what would happen before anything is actually installed.',
        apply: 'Install now',
        applying: 'Installing…',
        cannotInstall: 'This Harness build has no installBundle, so packs cannot be installed here',
        allowLocal: 'Also try local-path plugins (only works on the machine that made the pack)',
        pinVersions: 'Pin versions (install the exact version the pack records, not the recorded range)',

        colAction: 'Action',
        colPlugin: 'Plugin',
        colNote: 'Note',
        actInstall: 'install',
        actToggleOn: 'enable',
        actToggleOff: 'disable',
        actSkip: 'skip',
        actBlocked: 'blocked',
        actInvalid: 'invalid',
        actFailed: 'failed',
        actInstalled: 'installed',
        actToggled: 'changed',

        restartRequired: 'Some changes need a Harness restart to take effect.',
        noActions: 'Nothing to change — this modpack already matches this machine.',
        installDone: 'Install finished',

        libraryEmpty: 'No modpacks saved on this machine yet. Build one on the Build tab.',
        load: 'Load',
        download: 'Download',
        delete: 'Delete',
        confirmDelete: 'Delete this modpack?',
        entries: (n) => `${n} entries`,
        savedAt: 'saved',

        degradedTitle: 'Plugin manager unavailable',
        degradedHint: 'This Harness build does not expose the pluginManager service, so this page can inspect but not install. Upgrade Harness, or edit the profile files from the host half.',
        staleTitle: 'This page is out of date — reload it',
        staleBody: (host, self) => `The host half is already the new version (API v${host}) but the browser loaded the old page (API v${self}). The two halves cannot talk past that, so buttons may do nothing. Press Ctrl+R (Cmd+R on a Mac) to reload. If that does not help, the Harness did not reload the plugin — open the Plugins page and toggle this plugin off and on.`,
        errorTitle: 'Something went wrong',
        retry: 'Retry',
        loading: 'Loading…',
        notPortableWarn: (names) => `These plugins come from local paths and will not work for anyone else: ${names}`,
      },
    }

    function currentLocale() {
      try {
        const attr = document.documentElement.getAttribute('lang') || ''
        if (/^zh/i.test(attr)) return 'zh'
        if (/^en/i.test(attr)) return 'en'
        const nav = (navigator.language || '').toLowerCase()
        if (nav.startsWith('zh')) return 'zh'
        return 'en'
      } catch {
        return 'zh'
      }
    }

    function makeT(locale) {
      const table = DICT[locale] || DICT.zh
      const fallback = DICT.zh
      return (key, ...args) => {
        const value = key in table ? table[key] : fallback[key]
        if (typeof value === 'function') return value(...args)
        if (value === undefined) return key
        return value
      }
    }

    /** Re-render when the shell switches language. */
    function useLocale() {
      const [locale, setLocale] = React.useState(currentLocale)
      React.useEffect(() => {
        const sync = () => setLocale((prev) => {
          const next = currentLocale()
          return next === prev ? prev : next
        })
        const observer = new MutationObserver(sync)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'class', 'data-theme'] })
        return () => observer.disconnect()
      }, [])
      return locale
    }

    /* ---------------------------------------------------------------- */
    /* styles                                                           */
    /* ---------------------------------------------------------------- */

    const CSS = `
.mpk-root{display:flex;flex-direction:column;gap:18px;padding:4px 2px 28px;max-width:1040px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary)}
.mpk-head h2{margin:0;font-size:16px;font-weight:600}
.mpk-head p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.mpk-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:0}
.mpk-tab{appearance:none;border:0;background:none;padding:8px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;border-radius:8px 8px 0 0}
.mpk-tab:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.mpk-tab[data-on="1"]{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.mpk-card{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:14px}
.mpk-card h3{margin:0 0 10px;font-size:13px;font-weight:600}
.mpk-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.mpk-field{display:flex;flex-direction:column;gap:4px;flex:1 1 180px;min-width:0}
.mpk-field > label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.mpk-input,.mpk-textarea,.mpk-select{width:100%;box-sizing:border-box;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:7px 10px;outline:none}
.mpk-textarea{resize:vertical;min-height:56px}
.mpk-input:focus,.mpk-textarea:focus,.mpk-select:focus{border-color:var(--dsw-alias-brand-primary)}
.mpk-btn{appearance:none;font:inherit;font-size:13px;height:32px;padding:0 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.mpk-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--dsw-alias-bg-layer-2))}
.mpk-btn:disabled{opacity:.45;cursor:not-allowed}
.mpk-btn[data-variant="primary"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff;font-weight:600}
.mpk-btn[data-variant="danger"]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent)}
.mpk-btn[data-size="sm"]{height:26px;padding:0 10px;font-size:12px;border-radius:8px}
.mpk-chips{display:flex;gap:6px;flex-wrap:wrap}
.mpk-chip{appearance:none;font:inherit;font-size:12px;height:24px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mpk-chip[data-on="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
.mpk-list{display:flex;flex-direction:column;max-height:620px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base)}
/* The category column gets a row of its own, above the plugin list.
   It used to be a 300px side rail, which was narrower than the five-button
   action row at the bottom of the auto-classify preview: those buttons were
   laid out on one un-wrapping line, overflowed the rail, and were clipped by
   its own scroll container. "应用这个分类" was literally off-screen — you could
   scroll to it, but nothing on screen said so. A full-width row removes the
   cause; the wrapping footer below removes it a second time. */
.mpk-stack{display:flex;flex-direction:column;gap:12px;min-width:0}
/* The tree owns a full-width row of its own, and it is a card with a scrolling
   BODY — not a scrolling card. That distinction is the whole fix.

   It used to be a 300px side rail whose entire content lived in one
   max-height+overflow:auto box. The auto-classify panel sat inside that box,
   so its action row — five buttons at the bottom of a panel that grows after you
   click — was reachable only by scrolling the rail, and the wheel over the
   preview list scrolled the list instead. "应用这个分类" was on screen only in
   the sense that it existed in the DOM.

   Now only the node list scrolls. The header, the panel and the footer are
   outside the scroller, so nothing that appears after a click can be pushed out
   of reach by that click.

   overflow:hidden alone was not enough, and the measurement that proved it is
   worth keeping: hidden still creates a SCROLL CONTAINER. The settings dialog
   itself scrolls (.AnXs9G_options, 746px tall over 1926px of content), and a
   position:sticky footer inside a nested scroll container sticks to the wrong
   box. With plain hidden, at 1440x900, the options panel's action row sat at
   y=977 while the dialog ended at y=850: rendered 127px BELOW the dialog, over
   the backdrop. overflow:clip clips without creating a scroll container, so
   the sticky footer resolves against the dialog's scrollport and stays visible.
   The hidden declaration stays first as the fallback for engines without
   clip; the second declaration wins where it is understood. */
.mpk-tree{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);overflow:hidden;overflow:clip}
.mpk-tree-body{flex:1;min-height:200px;max-height:520px;overflow:auto;padding:2px 0}
.mpk-tree-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.mpk-tree-head b{flex:1;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mpk-seg{display:flex;flex:none;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.mpk-seg button{appearance:none;border:0;background:transparent;font:inherit;font-size:11px;line-height:1;padding:4px 7px;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.mpk-seg button[data-on="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}
.mpk-diag{padding:8px 10px 10px}
.mpk-diag-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);margin-bottom:9px}
.mpk-diag-root{display:flex;flex-direction:column;gap:6px}
.mpk-diag-kids{display:flex;flex-direction:column;gap:5px;margin:5px 0 0 13px;padding-left:11px;border-left:.5px solid var(--dsw-alias-border-l1)}
.mpk-diag-box{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 10px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);cursor:pointer;font-size:12px;color:var(--dsw-alias-label-primary)}
.mpk-diag-box:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mpk-diag-box[data-on="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);color:var(--dsw-alias-brand-primary)}
.mpk-diag-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpk-diag-count{flex:none;font-size:10.5px;opacity:.75;padding:0 5px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover)}
.mpk-diag-loose{margin-top:9px;border-style:dashed}
.mpk-node{display:flex;align-items:center;gap:4px;margin:1px 4px;padding:4px 6px 4px 2px;border-radius:8px;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-primary)}
.mpk-node:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.mpk-node[data-on="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent);color:var(--dsw-alias-brand-primary)}
/* Emphasis that must not move anything.
   Bolding text adds advance width, so every [data-on="1"] rule that used to set
   font-weight:600 made the element wider the instant it was clicked: the tab
   strip re-flowed, the chips after it slid sideways, and a tree node's label
   grew under the cursor. A painted stroke is drawn, not measured, so the
   geometry is byte-identical in both states. The tinted background plus the
   brand colour on the same rules carry the rest of the emphasis. */
.mpk-tab[data-on="1"],.mpk-chip[data-on="1"],.mpk-seg button[data-on="1"],.mpk-diag-box[data-on="1"],.mpk-node[data-on="1"]{text-shadow:0 0 .6px currentColor}
/* Buttons that change what they say while working ("导出文件" -> "制作中…").
   Swapping the text swaps the button's width, so the whole row jumped the moment
   you clicked. Both labels live in one grid cell, so the button is always as wide
   as the wider of the two and nothing moves when the visible one changes. */
.mpk-swap{display:inline-grid;justify-items:center;vertical-align:middle}
.mpk-swap > *{grid-area:1/1;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.mpk-swap > [data-on="0"]{visibility:hidden}
.mpk-node-caret{flex:none;width:14px;text-align:center;font-size:9px;opacity:.7;user-select:none}
.mpk-node-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpk-node-count{flex:none;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
/* The tools stay in the flow and only become visible, so hovering a row does not
   shove the count sideways. Reserving the space is the whole point — with
   display:none the row re-measured itself under the cursor. */
.mpk-node-tools{display:flex;visibility:hidden;flex:none;gap:1px}
.mpk-node:hover .mpk-node-tools{visibility:visible}
.mpk-icon{appearance:none;border:0;background:none;cursor:pointer;font:inherit;font-size:12px;line-height:1;padding:2px 3px;border-radius:6px;color:var(--dsw-alias-label-secondary);opacity:.8}
.mpk-icon:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);opacity:1}
.mpk-icon[data-tone="danger"]:hover{color:var(--dsw-alias-state-error-primary)}
.mpk-tree-edit{display:flex;gap:6px;align-items:center;margin:2px 4px;padding:3px}
.mpk-tree-edit .mpk-input{font-size:12px;padding:5px 8px;border-radius:8px}
.mpk-tree-foot{padding:7px 10px;font-size:11px;color:var(--dsw-alias-label-secondary);border-top:1px solid var(--dsw-alias-border-l1)}
/* The auto-classify panel is a band inside the tree card, between the header and
   the scrolling body. It is NOT inside the scroller — see the .mpk-tree rule —
   because a
   panel whose height changes after a click cannot live in a scroll box: the row
   that just appeared is the row that pushes the action buttons out of reach.

   It is a band rather than a nested card: a bordered box inside a bordered box
   reads as a mistake at this size, and the header rule above plus the footer rule
   below already separate it from its neighbours. */
.mpk-autocat{padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
/* Closed it is nothing but its own button. Drawing a tinted band around one
   button and calling that a panel wastes a row and reads as an empty section. */
.mpk-autocat-closed{padding:8px 12px;background:none}
.mpk-autocat-open{padding:12px 14px 10px}
.mpk-autocat-head{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}
.mpk-autocat-head b{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mpk-autocat-sum{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-left:auto}
.mpk-autocat-breakdown{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary);margin:-2px 0 8px;overflow-wrap:anywhere}
.mpk-autocat-note{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);padding:6px 10px;margin-bottom:8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 12%,transparent)}
/* The options stack. Each rung is a row, never a single squeezed line: the
   hints are full sentences and wrapping them mid-word is what "排版问题"
   looked like. */
.mpk-autocat-opts{display:flex;flex-direction:column;gap:9px;margin-bottom:4px}
.mpk-autocat-opt{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer;min-width:0}
.mpk-autocat-opt input{margin:2px 0 0;cursor:pointer;flex:none;width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary)}
.mpk-autocat-opt[data-off="1"]{opacity:.5;cursor:not-allowed}
.mpk-autocat-opt[data-off="1"] input{cursor:not-allowed}
.mpk-autocat-opt-body{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.mpk-autocat-opt-body b{font-weight:500;color:var(--dsw-alias-label-primary)}
.mpk-autocat-opt-hint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.mpk-spin{flex:none;width:11px;height:11px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l1);border-top-color:var(--dsw-alias-brand-primary);display:inline-block;vertical-align:-1px;margin-right:7px;animation:mpk-spin .7s linear infinite}
@keyframes mpk-spin{to{transform:rotate(360deg)}}
.mpk-autocat-hint{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary);margin:0 0 9px;overflow-wrap:anywhere}
.mpk-autocat-src{flex:none;font-size:11px;text-decoration:none;color:var(--dsw-alias-brand-primary);opacity:.75}
.mpk-autocat-src:hover{opacity:1}
.mpk-autocat-list{max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}
.mpk-autocat-group{padding:4px 0}
.mpk-autocat-group+.mpk-autocat-group{border-top:1px solid var(--dsw-alias-border-l1)}
.mpk-autocat-cat{display:flex;align-items:center;gap:6px;padding:5px 10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mpk-autocat-count{margin-left:auto;font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.mpk-autocat-row{display:flex;align-items:center;gap:8px;padding:4px 10px 4px 20px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}
.mpk-autocat-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpk-autocat-why{flex:none;font-size:11px;opacity:.7;padding:1px 7px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap}
/* The footer is a column, so the sentence and the buttons each own a line.
   flex-wrap on a row was the previous attempt and it still let the sentence
   share a line box with a button, producing the ragged block users saw.

   Sticky, because this footer is the only place the run/apply buttons live and
   the panel grows by ~360px when you click 开始分类 — on a 900px-tall window the
   buttons that appear after that click would otherwise land below the dialog's
   own bottom edge. Sticking to the scrollport keeps them on screen without
   capping the preview list, so the proposal stays fully readable. */
.mpk-autocat-foot{display:flex;flex-direction:column;gap:8px;margin:12px -14px -10px;padding:8px 14px 10px;position:sticky;bottom:0;z-index:3;background:var(--dsw-alias-bg-layer-2);border-top:1px solid var(--dsw-alias-border-l1)}
.mpk-autocat-foot-hint{margin:0;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.mpk-autocat-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.mpk-assign{margin-top:5px;font-size:11.5px;padding:3px 6px;border-radius:8px;max-width:170px}
.mpk-share{margin-top:12px;padding:12px 14px;border-radius:14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.mpk-share-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mpk-share-steps{margin:8px 0 0;padding-left:20px;font-size:12.5px;line-height:1.75;color:var(--dsw-alias-label-secondary)}
.mpk-share-pre{margin:0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mpk-group{padding:8px 12px 4px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);position:sticky;top:0;z-index:1;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mpk-group small{font-weight:400;opacity:.75;margin-left:6px}
.mpk-item{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mpk-item:last-child{border-bottom:0}
.mpk-item:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}
.mpk-item input[type=checkbox]{margin-top:3px;flex:none;accent-color:var(--dsw-alias-brand-primary);width:15px;height:15px}
.mpk-item-main{flex:1;min-width:0}
.mpk-item-title{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.mpk-name{font-weight:600;font-size:13px;word-break:break-all}
.mpk-spec{font-size:11.5px;color:var(--dsw-alias-label-secondary);word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mpk-badges{display:flex;gap:5px;flex-wrap:wrap}
.mpk-badge{font-size:10.5px;line-height:16px;padding:0 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.mpk-badge[data-tone="ok"]{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent)}
.mpk-badge[data-tone="off"]{color:var(--dsw-alias-state-idle-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-idle-primary) 40%,transparent)}
.mpk-badge[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}
.mpk-badge[data-tone="err"]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.mpk-badge[data-tone="brand"]{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
.mpk-override{margin-top:7px;display:flex;flex-direction:column;gap:4px}
.mpk-override label{font-size:11.5px;color:var(--dsw-alias-state-warn-primary)}
.mpk-override .mpk-input{font-size:12px;padding:5px 8px;border-radius:8px}
.mpk-empty{padding:26px 14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.mpk-footer{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between}
.mpk-count{font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mpk-banner{border-radius:12px;padding:11px 13px;font-size:12.5px;border:1px solid}
.mpk-banner[data-tone="err"]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.mpk-banner[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
.mpk-banner[data-tone="ok"]{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent)}
.mpk-banner b{display:block;margin-bottom:2px}
.mpk-drop{border:1.5px dashed var(--dsw-alias-border-l2);border-radius:14px;padding:26px 14px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px;cursor:pointer}
.mpk-drop[data-over="1"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
.mpk-table{width:100%;border-collapse:collapse;font-size:12.5px}
.mpk-table th{text-align:left;font-weight:600;color:var(--dsw-alias-label-secondary);padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11.5px}
.mpk-table td{padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
.mpk-table tr:last-child td{border-bottom:0}
.mpk-table-wrap{max-height:340px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base)}
.mpk-summary{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mpk-summary b{color:var(--dsw-alias-label-primary)}
.mpk-lib-item{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:11px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mpk-lib-item:last-child{border-bottom:0}
.mpk-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mpk-spin{display:inline-block;width:12px;height:12px;border:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:mpk-rot .7s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes mpk-rot{to{transform:rotate(360deg)}}
.mpk-switch{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mpk-switch input{accent-color:var(--dsw-alias-brand-primary)}
/* The settings dialog is a fixed 800px box, so a section inside it is capped at
   ~612px however wide its own content wants to be — the category tree was
   reported as "太小了" because of that cap, not because of anything in the tree.
   Widening the dialog is the only real fix; a wider child cannot escape an
   800px parent.

   It is scoped, deliberately. The rule only applies while this section is
   mounted: the panel puts .mpk-wide on <html> on mount and removes it on
   unmount, so every other settings section keeps the width its designer chose.
   Both the class AND the dialog attributes are required, so a future build that
   renames either one degrades to the old 800px layout instead of matching some
   unrelated modal. */
html.mpk-wide [role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]{width:min(1200px,calc(100vw - 64px))}
`

    function ensureStyles() {
      const id = 'dsh-modpack-styles'
      let tag = document.querySelector(`style[data-plugin="${id}"]`)
      if (!tag) {
        tag = document.createElement('style')
        tag.setAttribute('data-plugin', id)
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
      return () => tag.remove()
    }

    /* ---------------------------------------------------------------- */
    /* helpers                                                          */
    /* ---------------------------------------------------------------- */

    /**
     * Do the two halves disagree about the route shapes?
     *
     * Returns `null` for agreement *and* for every case where the question
     * cannot be answered — a failed probe, or a host half old enough not to
     * report the number at all. Only a host that states a different number is
     * a mismatch, because that is the only case where the user is looking at a
     * page that will silently misbehave. Reporting "cannot tell" as a failure
     * would put a red banner on every old-but-working install.
     */
    function apiMismatchOf(diag, self) {
      if (!diag || diag.ok !== true) return null
      const host = diag.apiVersion
      if (typeof host !== 'number' || !Number.isFinite(host)) return null
      if (host === self) return null
      return { host, self }
    }

    // Transport errors are raised from module scope, where no locale is in
    // scope, so each message carries both languages. They are rare and only
    // ever shown as a banner detail; a bilingual line beats a wrong-language
    // one, and beats "Failed to fetch" in every language.
    async function call(path, body) {
      const init = body === undefined
        ? { method: 'GET' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      let response
      try {
        response = await fetch(`${API}${path}`, init)
      } catch (err) {
        // A rejected fetch is the host half being absent, not a plugin bug —
        // and on a build that renames this plugin's route prefix it is the
        // *expected* outcome. Say which of the two it is instead of surfacing
        // "Failed to fetch", which tells the user nothing they can act on.
        throw new Error(`连不上后台插件 ${API}${path}（宿主可能没有加载它，或换了接口前缀）/ cannot reach the host half (not loaded, or the route prefix changed): ${(err && err.message) || ''}`)
      }
      if (response.status === 404) {
        throw new Error(`后台插件没有这个接口 ${API}${path}（Host 半侧可能是旧版本）/ the host half has no such route (it is probably older): ${path}`)
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}（${API}${path}）`)
      // A route that answered with HTML (a login page, an SPA fallback) is not
      // a plugin response either; `response.json()` would throw a parse error
      // that reads like a bug in this plugin.
      try {
        return await response.json()
      } catch {
        throw new Error(`后台插件返回的不是 JSON ${API}${path}（可能是登录页或路由兜底页）/ the reply was not JSON (a login page or the SPA fallback, most likely)`)
      }
    }

    function downloadText(filename, text) {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    function safeFileName(name) {
      const base = String(name || 'modpack').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80)
      return `${base || 'modpack'}${FILE_SUFFIX}`
    }

    /**
     * The message a recipient can paste straight into their own agent.
     *
     * Their Harness ships with `plugin_manager`, so this route needs nothing
     * installed first — which makes it the only one that works when they do not
     * have this plugin yet. Every line is derived from the document that is
     * travelling with it, so the two can never disagree.
     */
    function sharePrompt(doc, t) {
      const items = (doc.plugins || []).map((entry) => {
        const spec = entry.spec || entry.name
        const kind = entry.kind === 'bundle' ? 'bundle' : 'plugin'
        const off = entry.enabled === false ? `  [${t('shareKeepDisabled')}]` : ''
        return `- [${kind}] ${entry.name}  ->  ${spec}${off}`
      })
      return [
        t('sharePromptIntro', doc.name || ''),
        '',
        t('sharePromptAsk'),
        ...items,
        '',
        t('sharePromptOutro'),
      ].join('\n')
    }

    /** Clipboard, with a fallback: the shell does not always grant clipboard access. */
    async function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        /* fall through to the textarea route */
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return ok
      } catch {
        return false
      }
    }

    const el = (tag, props, ...children) => h(tag, props, ...children)

    function badge(text, tone) {
      return el('span', { className: 'mpk-badge', 'data-tone': tone || 'flat', key: text }, text)
    }

    /* ---------------------------------------------------------------- */
    /* category tree                                                    */
    /* ---------------------------------------------------------------- */

    const CAT_ALL = '__all__'
    const CAT_NONE = '__none__'

    /**
     * A button label that changes while the button works, without changing the
     * button's width. Both labels sit in one grid cell, so the cell — and
     * therefore the button — is always as wide as the wider of the two.
     */
    function busyLabel(busy, idle, working) {
      return el('span', { className: 'mpk-swap' },
        el('span', { 'data-on': busy ? '0' : '1' }, idle),
        el('span', { 'data-on': busy ? '1' : '0' },
          busy ? el('span', { className: 'mpk-spin' }) : null, working),
      )
    }

    /**
     * The tree is stored flat (`nodes[].parentId`) and rendered by walking it.
     * Nesting beats a nested document here because every edit — rename,
     * re-parent, delete — becomes a map over one array, and a corrupt file can
     * never produce a structure the walker cannot terminate on.
     */
    function childrenOf(doc, parentId) {
      return (doc.nodes || [])
        .filter((node) => (node.parentId || null) === (parentId || null))
        .sort((a, b) => (a.order - b.order) || String(a.name).localeCompare(String(b.name)))
    }

    /** Every id in this subtree, the node included. Cycle-safe. */
    function subtreeIds(doc, id) {
      const out = new Set()
      if (!id) return out
      const stack = [id]
      while (stack.length) {
        const current = stack.pop()
        if (!current || out.has(current)) continue
        out.add(current)
        for (const child of childrenOf(doc, current)) stack.push(child.id)
      }
      return out
    }

    function labelOf(doc, id) {
      const nodes = doc.nodes || []
      const byId = new Map(nodes.map((node) => [node.id, node]))
      const parts = []
      let node = byId.get(id)
      let guard = 0
      while (node && guard++ <= nodes.length) {
        parts.unshift(node.name)
        node = node.parentId ? byId.get(node.parentId) : null
      }
      return parts.join(' / ')
    }

    function newCategoryId() {
      return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    }

    /**
     * The auto-categorise panel.
     *
     * Kept as a separate component from `CategoryTree` because the two have
     * different lifetimes: the tree is the stored truth and every click writes
     * immediately, while this is a *proposal* that lives only in memory until
     * the user applies it. Mixing them would mean a half-written tree whenever
     * somebody closes the panel mid-preview.
     */
    function AutoCategorize({ t, locale, onApply, notify }) {
      // closed → options → loading → preview. The extra first step exists
      // because the conditions must be chosen *before* the run: two of them
      // leave this machine, and a checkbox that only shows up after the fact
      // cannot honestly be called a choice.
      const [phase, setPhase] = React.useState('closed')
      const [overwrite, setOverwrite] = React.useState(false)
      // All off by default. Ticking one is the only way anything here leaves
      // the machine or spends money, so none of them may be implied by a click
      // on a button labelled "start".
      const [online, setOnline] = React.useState(false)
      const [source, setSource] = React.useState(false)
      const [ai, setAi] = React.useState(false)
      // Fourth rung. It is not a separate pass: it changes what the AI pass is
      // asked to do, so it can never be on by itself.
      const [reason, setReason] = React.useState(false)
      const [result, setResult] = React.useState(null)

      const run = async () => {
        setPhase('loading')
        try {
          const payload = await call('/categories/suggest', { overwrite, locale, online, source, ai, reason })
          if (!payload.ok) throw new Error(payload.error || t('autoFailed'))
          setResult(payload)
          setPhase('preview')
        } catch (err) {
          setPhase('options')
          notify('err', t('autoFailed'), (err && err.message) || String(err))
        }
      }

      const forget = async () => {
        try {
          const payload = await call('/categories/forget', {})
          if (!payload.ok) throw new Error(payload.error || t('autoFailed'))
          notify('ok', t('autoForgetDone'), t('autoForgetHint'))
        } catch (err) {
          notify('err', t('autoFailed'), (err && err.message) || String(err))
        }
      }

      const apply = () => {
        if (!result) return
        onApply(result.doc)
        notify('ok', t('autoApplied'), t('autoSummary', result.summary.assigned, result.summary.newCategories))
        setPhase('closed')
        setResult(null)
      }

      const close = () => {
        setPhase('closed')
        setResult(null)
      }

      // Source reading is offered but disabled until AI judgement is on. The
      // alternative — letting it appear to work and silently doing nothing —
      // is the exact class of bug this plugin has already been bitten by twice.
      const box = (checked, onChange, label, hint, disabled) =>
        el('label', {
          className: 'mpk-autocat-opt',
          'data-off': disabled ? '1' : '0',
          key: label,
        },
          el('input', {
            type: 'checkbox',
            checked,
            disabled: Boolean(disabled),
            onChange: (event) => onChange(event.target.checked),
          }),
          el('span', { className: 'mpk-autocat-opt-body' },
            el('b', null, label),
            hint ? el('span', { className: 'mpk-autocat-opt-hint' }, hint) : null,
          ),
        )

      if (phase === 'closed') {
        return el('div', { className: 'mpk-autocat mpk-autocat-closed' },
          el('button', {
            className: 'mpk-btn',
            'data-size': 'sm',
            onClick: () => setPhase('options'),
          }, `✨ ${t('autoOpen')}`),
        )
      }

      if (phase === 'options') {
        return el('div', { className: 'mpk-autocat mpk-autocat-open' },
          el('div', { className: 'mpk-autocat-head' },
            el('b', null, t('autoOptionsTitle')),
          ),
          el('div', { className: 'mpk-autocat-hint' }, t('autoOptionsIntro')),
          el('div', { className: 'mpk-autocat-opts' },
            box(overwrite, setOverwrite, t('autoOverwrite'), null, false),
            box(online, setOnline, t('autoOnline'), t('autoOnlineHint'), false),
            box(ai, (value) => {
              setAi(value)
              // Source alone is evidence with nothing to read it; keeping the
              // tick would leave a lie on screen after AI is switched off. The
              // reasoning rung is downstream of both, so it goes too.
              if (!value) {
                setSource(false)
                setReason(false)
              }
            }, t('autoOptAi'), t('autoOptAiHint'), false),
            box(source, setSource, t('autoOptSource'),
              ai ? t('autoOptSourceHint') : t('autoOptNeedAi'), !ai),
            // Nested under the AI rung rather than beside it, because it is not an
            // independent investigation: it is an instruction to the same model
            // call. Ticking it reads the entry file, so source is switched on with
            // it — a role line cannot be built without the code it comes from.
            box(reason, (value) => {
              setReason(value)
              if (value) setSource(true)
            }, t('autoOptReason'),
              ai ? t('autoOptReasonHint') : t('autoOptReasonNeedAi'), !ai),
          ),
          el('div', { className: 'mpk-autocat-foot' },
            // Rendered only when it has something to say: an empty node still
            // costs a gap in a column, so the buttons would float 8px lower for
            // no visible reason once AI is switched on.
            ai ? null : el('p', { className: 'mpk-autocat-foot-hint' }, t('autoOptOffline')),
            el('div', { className: 'mpk-autocat-actions' },
              el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: close }, t('autoCancel')),
              el('button', {
                className: 'mpk-btn',
                'data-size': 'sm',
                'data-variant': 'primary',
                onClick: run,
              }, t('autoStart')),
            ),
          ),
        )
      }

      if (phase === 'loading') {
        return el('div', { className: 'mpk-autocat mpk-autocat-open' },
          el('span', { className: 'mpk-spin' }),
          el('span', { style: { fontSize: '12px', opacity: .8 } }, t('autoRunning')),
        )
      }

      // Preview: group the proposal by category so it reads as a tree, not a
      // wall of rows. The reason travels with each plugin, because "why did
      // this land in 桌面与自动化?" is the first question anybody asks.
      const byCategory = new Map()
      for (const item of result.added) {
        if (!byCategory.has(item.categoryName)) byCategory.set(item.categoryName, [])
        byCategory.get(item.categoryName).push(item)
      }
      // Every tier the host can report needs a case here. The fallback is
      // `autoBasisName` — the weakest claim — which is what makes a missing case
      // dangerous rather than merely incomplete: a row the author's own prose
      // justified gets relabelled as a name guess. `readme` was absent from this
      // chain for several versions, and `desc` would have been too.
      const basisKey = (basis) =>
        basis === 'tags' ? 'autoBasisTags'
          : basis === 'desc' ? 'autoBasisDesc'
            : basis === 'readme' ? 'autoBasisReadme'
              : basis === 'ai' ? 'autoBasisAi'
                : basis === 'remote' ? 'autoBasisRemote'
                  : basis === 'fact' ? 'autoBasisFact'
                    : basis === 'none' ? 'autoBasisNone'
                      : 'autoBasisName'

      // The breakdown matters more than the headline: "16 plugins into 9
      // categories" sounds authoritative, but 6 of those came from a name
      // guess. Saying so up front is the whole point of tracking `basis`.
      const s = result.summary
      const parts = []
      if (s.fromTags) parts.push(t('autoFromTags', s.fromTags))
      if (s.fromDesc) parts.push(t('autoFromDesc', s.fromDesc))
      if (s.fromReadme) parts.push(t('autoFromReadme', s.fromReadme))
      if (s.fromRemote) parts.push(t('autoFromRemote', s.fromRemote))
      if (s.fromAi) parts.push(t('autoFromAi', s.fromAi))
      if (s.fromName) parts.push(t('autoFromName', s.fromName))
      if (s.fromFact) parts.push(t('autoFromFact', s.fromFact))
      if (s.unclassified) parts.push(t('autoFromNone', s.unclassified))

      // What the network actually did, stated in the numbers that came back
      // rather than a reassuring "done". `failed` is shown because a failed
      // request is not evidence and is deliberately not cached.
      const remote = result.remote
      const remoteLine = remote
        ? remote.looked === 0
          ? t('autoOnlineNone')
          : t('autoOnlineRan', remote.looked, remote.found)
            + (remote.failed ? ` · ${t('autoOnlineFail', remote.failed)}` : '')
        : null

      // Same rule for the model: report the model that was actually asked, what
      // it cost, and why it did nothing if it did nothing. A silent skip would
      // be indistinguishable from a model that agreed with the guess.
      const aiInfo = result.ai
      let aiLine = null
      if (aiInfo) {
        if (!aiInfo.available) aiLine = t('autoAiUnavailable')
        else if (aiInfo.reason === 'no-model') aiLine = t('autoAiNoModel')
        else if (aiInfo.failed) aiLine = t('autoAiFailed', aiInfo.reason || 'error')
        else if (aiInfo.asked > 0) {
          aiLine = `${t('autoAiRan', aiInfo.asked, aiInfo.found)} · ${aiInfo.provider}/${aiInfo.model}`
          if (aiInfo.withCode) aiLine += ` · ${t('autoAiCode', aiInfo.withCode)}`
          if (aiInfo.withRole) aiLine += ` · ${t('autoAiRole', aiInfo.withRole)}`
          if (aiInfo.inputTokens || aiInfo.outputTokens) {
            aiLine += ` · ${t('autoAiTokens', aiInfo.inputTokens || 0, aiInfo.outputTokens || 0)}`
          }
        }
        // A ticked box that produces no line at all is indistinguishable from a
        // broken button, and this is the common case on a healthy profile: the
        // offline and online passes have already filed every row, so there is
        // nothing left worth paying a model for.
        else aiLine = t('autoAiNothing')
      }
      const chosen = []
      if (online) chosen.push(t('autoOnline'))
      if (ai) chosen.push(t('autoOptAi'))
      if (ai && reason) chosen.push(t('autoReason'))
      if (ai && source) chosen.push(t('autoOptSource'))
      if (overwrite) chosen.push(t('autoOverwrite'))

      return el('div', { className: 'mpk-autocat mpk-autocat-open' },
        el('div', { className: 'mpk-autocat-head' },
          el('b', null, t('autoTitle')),
          el('span', { className: 'mpk-autocat-sum' },
            t('autoSummary', result.summary.assigned, result.summary.newCategories)),
        ),
        el('div', { className: 'mpk-autocat-breakdown' }, parts.join(' · ')),
        el('div', { style: { fontSize: '12px', opacity: .8, marginBottom: '8px' } }, t('autoIntro')),

        result.summary.kept > 0
          ? el('div', { className: 'mpk-autocat-note' },
              t('autoKept', result.summary.kept),
              overwrite ? ` · ${t('autoOverwrote', result.summary.overwrote || 0)}` : null)
          : null,

        el('label', { className: 'mpk-autocat-opt' },
          el('input', {
            type: 'checkbox',
            checked: overwrite,
            onChange: (event) => setOverwrite(event.target.checked),
          }),
          el('span', null, t('autoOverwrite')),
        ),

        el('div', { className: 'mpk-autocat-hint' },
          chosen.length ? chosen.join(' · ') : t('autoOptOffline')),
        remoteLine ? el('div', { className: 'mpk-autocat-breakdown' }, remoteLine) : null,
        aiLine ? el('div', { className: 'mpk-autocat-breakdown' }, aiLine) : null,

        result.added.length === 0
          ? el('div', { style: { fontSize: '12px', opacity: .75, padding: '8px 0' } }, t('autoNothing'))
          : el('div', { className: 'mpk-autocat-list' },
              [...byCategory.entries()].map(([name, items]) =>
                el('div', { className: 'mpk-autocat-group', key: name },
                  el('div', { className: 'mpk-autocat-cat' },
                    el('span', null, name),
                    el('span', { className: 'mpk-autocat-count' }, items.length),
                  ),
                  items.map((item) =>
                    el('div', { className: 'mpk-autocat-row', key: item.key },
                      el('span', { className: 'mpk-autocat-name' }, item.name),
                      item.source
                        ? el('a', {
                            className: 'mpk-autocat-src',
                            href: item.source,
                            target: '_blank',
                            rel: 'noreferrer noopener',
                            title: item.reason,
                          }, '↗')
                        : null,
                      el('span', { className: 'mpk-autocat-why', title: item.reason },
                        t(basisKey(item.basis))),
                    )),
                )),
            ),

        // The footer is a column: the sentence on its own line, then the buttons
        // on their own line. As a single wrapping flex row the sentence shared a
        // line box with five buttons and broke into a ragged three-line block,
        // which is the "排版问题" this panel was reported for. A column cannot
        // produce that: the sentence gets the full width by construction, and the
        // buttons never have to compete with it for space.
        el('div', { className: 'mpk-autocat-foot' },
          el('p', { className: 'mpk-autocat-foot-hint' }, t('autoGroupHint')),
          el('div', { className: 'mpk-autocat-actions' },
            el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: forget, title: t('autoForgetHint') }, t('autoForget')),
            el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: () => setPhase('options') }, t('autoOptionsShort')),
            el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: close }, t('autoCancel')),
            el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: run, disabled: !result }, t('autoPreview')),
            el('button', {
              className: 'mpk-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              onClick: apply,
              // A disabled button with no explanation is indistinguishable from a
              // broken one. There is exactly one reason it can be disabled, so say
              // it in the tooltip rather than leaving the user to guess.
              disabled: result.added.length === 0,
              title: result.added.length === 0 ? t('autoApplyEmpty') : undefined,
            }, t('autoApply')),
          ),
        ),
      )
    }

    // Nested boxes rather than an SVG tree. An SVG node-link drawing needs a
    // layout pass and a measured width, and it degrades badly the moment a
    // category name is long or the panel is narrow; nesting reflows for free
    // and keeps every box clickable, which is the only interaction it needs.
    function TreeDiagram({ doc, counts, active, onPick, t }) {
      const renderNode = (node, depth) => {
        const kids = childrenOf(doc, node.id)
        const own = counts.get(node.id) || 0
        return el('div', { className: 'mpk-diag-node', key: node.id },
          el('div', {
            className: 'mpk-diag-box',
            'data-on': active === node.id ? '1' : '0',
            'data-depth': String(depth),
            onClick: () => onPick(node.id),
            title: labelOf(doc, node.id),
          },
            el('span', { className: 'mpk-diag-name' }, node.name),
            own ? el('span', { className: 'mpk-diag-count' }, own) : null,
          ),
          kids.length
            ? el('div', { className: 'mpk-diag-kids' }, kids.map((kid) => renderNode(kid, depth + 1)))
            : null,
        )
      }

      const roots = childrenOf(doc, null)

      return el('div', { className: 'mpk-diag' },
        el('div', { className: 'mpk-diag-hint' }, t('treeDiagramHint')),
        roots.length === 0
          ? el('div', { className: 'mpk-tree-foot', style: { borderTop: '0', padding: '2px 0' } }, t('treeDiagramEmpty'))
          : el('div', { className: 'mpk-diag-root' }, roots.map((node) => renderNode(node, 0))),
      )
    }

    function CategoryTree({ doc, counts, unassigned, total, active, status, onPick, onChange, onSelectGroup, t, locale, notify }) {
      const [expanded, setExpanded] = React.useState(() => new Set())
      const [editing, setEditing] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [view, setView] = React.useState('list') // list | diagram

      const nodes = doc.nodes || []
      const assignments = doc.assignments || {}

      const beginNew = (parentId) => {
        setEditing({ id: null, parentId: parentId || null })
        setDraft('')
        if (parentId) setExpanded((prev) => new Set([...prev, parentId]))
      }

      const beginRename = (node) => {
        setEditing({ id: node.id, parentId: node.parentId })
        setDraft(node.name)
      }

      const commit = () => {
        if (!editing) return
        const name = draft.trim()
        if (!name) { setEditing(null); return }
        const next = { nodes: nodes.map((n) => ({ ...n })), assignments: { ...assignments } }
        if (editing.id) {
          const target = next.nodes.find((n) => n.id === editing.id)
          if (target) target.name = name.slice(0, 60)
        } else {
          next.nodes.push({
            id: newCategoryId(),
            name: name.slice(0, 60),
            parentId: editing.parentId,
            order: next.nodes.length,
          })
        }
        setEditing(null)
        onChange(next)
      }

      const remove = (node) => {
        let ok = true
        try {
          ok = window.confirm(t('treeDeleteConfirm', node.name))
        } catch {
          ok = true // a shell that blocks confirm() should not block deletion
        }
        if (!ok) return
        // Children move up to the grandparent rather than vanishing with the
        // node, and every assignment pointing here is dropped, so a plugin
        // never keeps a category that no longer exists.
        const next = { nodes: [], assignments: {} }
        for (const item of nodes) {
          if (item.id === node.id) continue
          next.nodes.push(item.parentId === node.id ? { ...item, parentId: node.parentId } : { ...item })
        }
        for (const [key, value] of Object.entries(assignments)) {
          if (value !== node.id) next.assignments[key] = value
        }
        if (active === node.id) onPick(CAT_ALL)
        onChange(next)
      }

      const renderNode = (node, depth) => {
        const kids = childrenOf(doc, node.id)
        const open = expanded.has(node.id)
        const count = counts.get(node.id) || 0

        const row = editing && editing.id === node.id
          ? el('div', { className: 'mpk-tree-edit', key: `edit-${node.id}` },
              el('input', {
                className: 'mpk-input',
                autoFocus: true,
                value: draft,
                placeholder: t('treeNamePlaceholder'),
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') commit()
                  if (event.key === 'Escape') setEditing(null)
                },
              }),
              el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: commit }, '✓'),
            )
          : el('div', {
              className: 'mpk-node',
              key: node.id,
              'data-on': active === node.id ? '1' : '0',
              style: { paddingLeft: `${2 + depth * 12}px` },
              title: labelOf(doc, node.id),
              onClick: () => onPick(node.id),
            },
              el('span', {
                className: 'mpk-node-caret',
                onClick: (event) => {
                  event.stopPropagation()
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(node.id)) next.delete(node.id)
                    else next.add(node.id)
                    return next
                  })
                },
              }, kids.length ? (open ? '▾' : '▸') : ''),
              el('span', { className: 'mpk-node-name' }, node.name),
              el('span', { className: 'mpk-node-count' }, count || ''),
              el('span', { className: 'mpk-node-tools' },
                el('button', {
                  className: 'mpk-icon',
                  title: t('treeNewChild'),
                  onClick: (event) => { event.stopPropagation(); beginNew(node.id) },
                }, '＋'),
                el('button', {
                  className: 'mpk-icon',
                  title: t('treeRename'),
                  onClick: (event) => { event.stopPropagation(); beginRename(node) },
                }, '✎'),
                el('button', {
                  className: 'mpk-icon',
                  'data-tone': 'danger',
                  title: t('treeDelete'),
                  onClick: (event) => { event.stopPropagation(); remove(node) },
                }, '✕'),
              ),
            )

        return [row, ...(open ? kids.flatMap((kid) => renderNode(kid, depth + 1)) : [])]
      }

      const rows = []
      if (editing && !editing.id) {
        rows.push(el('div', { className: 'mpk-tree-edit', key: 'new-root' },
          el('input', {
            className: 'mpk-input',
            autoFocus: true,
            value: draft,
            placeholder: t('treeNamePlaceholder'),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') setEditing(null)
            },
          }),
          el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: commit }, '✓'),
        ))
      }
      for (const node of childrenOf(doc, null)) rows.push(...renderNode(node, 0))

      // The panel sits inside the tree card but OUTSIDE its scroll container.
      // That is the fix, not a detail: the tree body scrolls, and a panel that
      // grows after a click — five option rows, then a preview list, then a
      // five-button action row — inside that scroller is a panel whose bottom is
      // reachable only by scrolling the same box that the preview list also
      // wants to scroll. The apply button existed and was unclickable.
      //
      // Order is header → panel → scrolling nodes → footer, so the panel's
      // action row and the tree's own footer are both always on screen.
      return el('div', { className: 'mpk-tree', 'data-view': view },
        el('div', { className: 'mpk-tree-head' },
          el('b', null, t('treeTitle')),
          el('div', { className: 'mpk-seg', title: t('treeView') },
            el('button', {
              'data-on': view === 'list' ? '1' : '0',
              onClick: () => setView('list'),
            }, t('treeViewList')),
            el('button', {
              'data-on': view === 'diagram' ? '1' : '0',
              onClick: () => setView('diagram'),
            }, t('treeViewDiagram')),
          ),
          el('button', {
            className: 'mpk-icon',
            title: t('treeNew'),
            onClick: () => beginNew(null),
          }, '＋'),
        ),

        el(AutoCategorize, {
          t,
          locale: locale || 'zh',
          notify,
          onApply: (next) => onChange(next),
        }),

        el('div', { className: 'mpk-tree-body' },
          el('div', {
            className: 'mpk-node',
            'data-on': active === CAT_ALL ? '1' : '0',
            onClick: () => onPick(CAT_ALL),
          },
            el('span', { className: 'mpk-node-caret' }, ''),
            el('span', { className: 'mpk-node-name' }, t('treeAll')),
            el('span', { className: 'mpk-node-count' }, total),
          ),
          el('div', {
            className: 'mpk-node',
            'data-on': active === CAT_NONE ? '1' : '0',
            onClick: () => onPick(CAT_NONE),
          },
            el('span', { className: 'mpk-node-caret' }, ''),
            el('span', { className: 'mpk-node-name' }, t('treeUnassigned')),
            el('span', { className: 'mpk-node-count' }, unassigned),
          ),

          view === 'diagram'
            ? el(TreeDiagram, { doc, counts, active, onPick, t })
            : el('div', { style: { display: 'contents' } },
                nodes.length === 0 && !editing
                  ? el('div', { className: 'mpk-tree-foot', style: { borderTop: '0' } }, t('treeEmpty'))
                  : null,
                rows,
              ),
        ),

        el('div', { className: 'mpk-tree-foot' },
          el('div', { className: 'mpk-row', style: { gap: '6px' } },
            el('button', {
              className: 'mpk-btn',
              'data-size': 'sm',
              disabled: active === CAT_ALL || active === CAT_NONE,
              onClick: () => onSelectGroup(active),
            }, t('treeSelectGroup')),
            status === 'saving' ? el('span', { style: { fontSize: '11px', opacity: .7 } }, '…') : null,
            status === 'saved' ? el('span', { style: { fontSize: '11px', opacity: .7 } }, t('treeSaved')) : null,
            status === 'error' ? el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' } }, t('treeSaveFailed')) : null,
          ),
        ),
      )
    }

    /* ---------------------------------------------------------------- */
    /* build view                                                       */
    /* ---------------------------------------------------------------- */

    function BuildView({ data, cat: catProp, onCatChange, catStatus, t, onSaved, notify, locale }) {
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [chosen, setChosen] = React.useState(() => new Set())
      const [overrides, setOverrides] = React.useState({})
      const [meta, setMeta] = React.useState({ name: '', description: '', author: '' })
      const [busy, setBusy] = React.useState(false)
      const [activeCat, setActiveCat] = React.useState(CAT_ALL)
      const [bulkCat, setBulkCat] = React.useState('')
      // Set right after a successful export, so the "how do I send this" panel
      // appears with the exact document that was just written to disk.
      const [shareDoc, setShareDoc] = React.useState(null)

      const bundles = data.bundles || []
      const plugins = data.plugins || []
      const cat = catProp || { nodes: [], assignments: {} }
      const allRows = React.useMemo(() => [...bundles, ...plugins], [data])

      /** How many plugins sit in each subtree — a parent counts its children. */
      const catCounts = React.useMemo(() => {
        const direct = new Map()
        for (const row of allRows) {
          const id = cat.assignments[row.key]
          if (id) direct.set(id, (direct.get(id) || 0) + 1)
        }
        const totals = new Map()
        for (const node of cat.nodes || []) {
          let sum = 0
          for (const id of subtreeIds(cat, node.id)) sum += direct.get(id) || 0
          totals.set(node.id, sum)
        }
        return totals
      }, [cat, allRows])

      const unassignedCount = allRows.filter((row) => !cat.assignments[row.key]).length

      const flatTree = React.useMemo(() => {
        const out = []
        const walk = (parentId, depth) => {
          for (const node of childrenOf(cat, parentId)) {
            out.push({ node, depth })
            walk(node.id, depth + 1)
          }
        }
        walk(null, 0)
        return out
      }, [cat])

      const activeScope = React.useMemo(
        () => (activeCat === CAT_ALL || activeCat === CAT_NONE ? null : subtreeIds(cat, activeCat)),
        [cat, activeCat],
      )

      /** Re-parent one or more plugins. Empty id means "back to Uncategorized". */
      const assign = (keys, categoryId) => {
        const next = { nodes: (cat.nodes || []).map((n) => ({ ...n })), assignments: { ...cat.assignments } }
        for (const key of keys) {
          if (categoryId) next.assignments[key] = categoryId
          else delete next.assignments[key]
        }
        onCatChange(next)
      }

      const matches = React.useCallback((row) => {
        const needle = query.trim().toLowerCase()
        if (needle) {
          const haystack = [row.name, row.moduleName, row.title, row.description, row.spec]
            .filter((v) => typeof v === 'string')
            .join(' ')
            .toLowerCase()
          if (!haystack.includes(needle)) return false
        }
        if (filter === 'enabled') return row.enabled !== false
        if (filter === 'disabled') return row.enabled === false
        if (filter === 'official') return Boolean(row.official)
        if (filter === 'third') return !row.official
        if (filter === 'portable') return !(row.kind === 'bundle' && row.local)
        if (filter === 'local') return row.kind === 'bundle' && row.local
        // Category is a scope, not a chip: it narrows whatever the other
        // filters already allowed, and "Uncategorized" means "not in any
        // category yet" rather than "in a category called none".
        if (activeCat === CAT_NONE) return !cat.assignments[row.key]
        if (activeScope) return Boolean(cat.assignments[row.key] && activeScope.has(cat.assignments[row.key]))
        return true
      }, [query, filter, activeCat, activeScope, cat])

      const visibleBundles = bundles.filter(matches)
      const visiblePlugins = plugins.filter(matches)
      const visibleKeys = [...visibleBundles, ...visiblePlugins].map((r) => r.key)

      const toggle = (key) => {
        setChosen((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const selectAll = () => setChosen((prev) => new Set([...prev, ...visibleKeys]))
      const selectNone = () => setChosen(new Set())
      const selectInvert = () => setChosen((prev) => {
        const next = new Set(prev)
        for (const key of visibleKeys) {
          if (next.has(key)) next.delete(key)
          else next.add(key)
        }
        return next
      })

      const chosenRows = [...bundles, ...plugins].filter((r) => chosen.has(r.key))

      const buildDocument = async () => {
        const payload = {
          meta: {
            name: meta.name.trim() || t('metaNamePlaceholder'),
            description: meta.description.trim(),
            author: meta.author.trim(),
          },
          keys: [...chosen],
          overrides,
        }
        const result = await call('/pack', payload)
        if (!result.ok) throw new Error(result.error || 'pack failed')
        return result
      }

      const doExport = async () => {
        setBusy(true)
        try {
          const result = await buildDocument()
          downloadText(safeFileName(result.modpack.name), JSON.stringify(result.modpack, null, 2))
          setShareDoc(result.modpack)
          notify('ok', t('exportFile'), result.notPortable.length ? t('notPortableWarn', result.notPortable.join('、')) : '')
        } catch (err) {
          notify('err', t('errorTitle'), (err && err.message) || String(err))
        } finally {
          setBusy(false)
        }
      }

      const doSave = async () => {
        setBusy(true)
        try {
          const result = await buildDocument()
          const saved = await call('/save', { modpack: result.modpack })
          if (!saved.ok) throw new Error(saved.error || 'save failed')
          notify('ok', t('saveLocal'), saved.path)
          onSaved()
        } catch (err) {
          notify('err', t('errorTitle'), (err && err.message) || String(err))
        } finally {
          setBusy(false)
        }
      }

      const renderRow = (row) => {
        const isBundle = row.kind === 'bundle'
        const local = isBundle && row.local
        return el('div', { className: 'mpk-item', key: row.key },
          el('input', {
            type: 'checkbox',
            checked: chosen.has(row.key),
            onChange: () => toggle(row.key),
            'aria-label': row.title || row.name || row.moduleName,
          }),
          el('div', { className: 'mpk-item-main' },
            el('div', { className: 'mpk-item-title' },
              el('span', { className: 'mpk-name' }, row.title || row.name || row.moduleName),
              el('span', { className: 'mpk-badges' },
                row.official ? badge(t('badgeOfficial'), 'brand') : badge(t('badgeThirdParty')),
                row.enabled === false ? badge(t('badgeDisabled'), 'off') : badge(t('filterEnabled'), 'ok'),
                local ? badge(t('badgeLocal'), 'warn') : null,
                isBundle && row.installed === false ? badge(t('badgeMissing'), 'warn') : null,
                isBundle && row.rowCount === 0 ? badge(t('badgeEmpty'), 'off') : null,
                row.version ? badge(row.version) : null,
              ),
            ),
            el('div', { className: 'mpk-spec' }, isBundle ? (row.spec || row.name) : `entry ${row.entryId}`),
            row.description ? el('div', { className: 'mpk-spec', style: { fontFamily: 'inherit' } }, row.description) : null,
            el('select', {
              className: 'mpk-select mpk-assign',
              title: t('treeAssign'),
              value: cat.assignments[row.key] || '',
              onClick: (event) => event.stopPropagation(),
              onChange: (event) => assign([row.key], event.target.value || null),
            },
              el('option', { value: '' }, cat.assignments[row.key] ? t('treeUnassigned') : `— ${t('treeUnassigned')} —`),
              flatTree.map(({ node, depth }) => el('option', { key: node.id, value: node.id }, `${'\u00a0\u00a0'.repeat(depth)}${depth ? '└ ' : ''}${node.name}`)),
            ),
            local
              ? el('div', { className: 'mpk-override' },
                  el('label', null, t('overrideLabel')),
                  el('input', {
                    className: 'mpk-input mpk-mono',
                    placeholder: t('overridePlaceholder'),
                    value: overrides[row.key] || '',
                    onChange: (event) => setOverrides((prev) => ({ ...prev, [row.key]: event.target.value })),
                  }),
                  el('div', { style: { fontSize: '11px', opacity: .8 } }, t('overrideHint')),
                )
              : null,
          ),
        )
      }

      const filters = [
        ['all', t('filterAll')],
        ['enabled', t('filterEnabled')],
        ['disabled', t('filterDisabled')],
        ['third', t('filterThirdParty')],
        ['official', t('filterOfficial')],
        ['portable', t('filterPortable')],
        ['local', t('filterUnportable')],
      ]

      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        el('div', { className: 'mpk-card' },
          el('h3', null, t('title')),
          el('div', { className: 'mpk-row' },
            el('div', { className: 'mpk-field' },
              el('label', null, t('metaName')),
              el('input', {
                className: 'mpk-input',
                placeholder: t('metaNamePlaceholder'),
                value: meta.name,
                onChange: (e) => setMeta({ ...meta, name: e.target.value }),
              }),
            ),
            el('div', { className: 'mpk-field' },
              el('label', null, t('metaAuthor')),
              el('input', {
                className: 'mpk-input',
                placeholder: t('metaAuthorPlaceholder'),
                value: meta.author,
                onChange: (e) => setMeta({ ...meta, author: e.target.value }),
              }),
            ),
          ),
          el('div', { className: 'mpk-field', style: { marginTop: '10px' } },
            el('label', null, t('metaDesc')),
            el('textarea', {
              className: 'mpk-textarea',
              placeholder: t('metaDescPlaceholder'),
              value: meta.description,
              onChange: (e) => setMeta({ ...meta, description: e.target.value }),
            }),
          ),
        ),

        el('div', { className: 'mpk-card' },
          el('div', { className: 'mpk-row', style: { marginBottom: '10px' } },
            el('div', { className: 'mpk-field' },
              el('input', {
                className: 'mpk-input',
                placeholder: t('search'),
                value: query,
                onChange: (e) => setQuery(e.target.value),
              }),
            ),
            el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: selectAll }, t('selectAll')),
            el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: selectInvert }, t('selectInvert')),
            el('button', { className: 'mpk-btn', 'data-size': 'sm', onClick: selectNone }, t('selectNone')),
          ),
          el('div', { className: 'mpk-chips', style: { marginBottom: '10px' } },
            filters.map(([key, label]) => el('button', {
              key,
              className: 'mpk-chip',
              'data-on': filter === key ? '1' : '0',
              onClick: () => setFilter(key),
            }, label)),
          ),

          activeCat !== CAT_ALL
            ? el('div', { className: 'mpk-chips', style: { marginBottom: '10px', alignItems: 'center' } },
                el('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-brand-primary)' } },
                  activeCat === CAT_NONE ? t('treeUnassigned') : t('treeFiltering', labelOf(cat, activeCat)),
                ),
                el('button', { className: 'mpk-chip', onClick: () => setActiveCat(CAT_ALL) }, t('treeShowAll')),
              )
            : null,

          el('div', { className: 'mpk-stack' },
            el(CategoryTree, {
              doc: cat,
              counts: catCounts,
              unassigned: unassignedCount,
              total: allRows.length,
              active: activeCat,
              status: catStatus,
              onPick: setActiveCat,
              onChange: onCatChange,
              // "Select this category" means the whole subtree, because a
              // parent category is normally a heading over its children.
              onSelectGroup: (id) => {
                if (!id || id === CAT_ALL || id === CAT_NONE) return
                const scope = subtreeIds(cat, id)
                const keys = allRows
                  .filter((row) => scope.has(cat.assignments[row.key] || ''))
                  .map((row) => row.key)
                if (keys.length === 0) return
                setChosen((prev) => new Set([...prev, ...keys]))
              },
              t,
              locale,
              notify,
            }),
          el('div', { className: 'mpk-list' },
            visibleBundles.length === 0 && visiblePlugins.length === 0
              ? el('div', { className: 'mpk-empty' }, t('filterAll'))
              : null,
            visibleBundles.length
              ? [
                  el('div', { className: 'mpk-group', key: 'gb' },
                    t('groupBundles'),
                    el('small', null, `(${visibleBundles.length}) ${t('groupHintBundles')}`),
                  ),
                  ...visibleBundles.map(renderRow),
                ]
              : null,
            visiblePlugins.length
              ? [
                  el('div', { className: 'mpk-group', key: 'gp' },
                    t('groupPlugins'),
                    el('small', null, `(${visiblePlugins.length}) ${t('groupHintPlugins')}`),
                  ),
                  ...visiblePlugins.map(renderRow),
                ]
              : null,
          ),
          ),

          el('div', { className: 'mpk-footer', style: { marginTop: '12px' } },
            el('span', { className: 'mpk-count' },
              t('chosenCount', chosenRows.length),
              chosenRows.filter((r) => r.kind === 'bundle' && r.local).length
                ? ` · ${t('notPortableWarn', chosenRows.filter((r) => r.kind === 'bundle' && r.local).map((r) => r.name).join('、'))}`
                : '',
            ),
            el('span', { className: 'mpk-row' },
              el('select', {
                className: 'mpk-select',
                style: { maxWidth: '180px' },
                title: t('treeAssignBulk'),
                value: bulkCat,
                onChange: (event) => setBulkCat(event.target.value),
              },
                el('option', { value: '' }, t('treeAssignBulk')),
                el('option', { value: CAT_NONE }, t('treeUnassigned')),
                flatTree.map(({ node, depth }) => el('option', { key: node.id, value: node.id }, `${'\u00a0\u00a0'.repeat(depth)}${depth ? '└ ' : ''}${node.name}`)),
              ),
              el('button', {
                className: 'mpk-btn',
                'data-size': 'sm',
                disabled: chosen.size === 0 || !bulkCat,
                onClick: () => {
                  assign([...chosen], bulkCat === CAT_NONE ? null : bulkCat)
                  setBulkCat('')
                },
              }, `${t('treeAssignBulk')} (${chosen.size})`),
            ),
            el('span', { className: 'mpk-row' },
              el('button', {
                className: 'mpk-btn',
                'data-size': 'sm',
                onClick: () => { setChosen(new Set()); setOverrides({}); setMeta({ name: '', description: '', author: '' }) },
              }, t('clearForm')),
              el('button', { className: 'mpk-btn', disabled: busy || chosen.size === 0, onClick: doSave }, t('saveLocal')),
              el('button', {
                className: 'mpk-btn',
                'data-variant': 'primary',
                disabled: busy || chosen.size === 0,
                onClick: doExport,
              }, busyLabel(busy, t('exportFile'), t('loading'))),
            ),
          ),

          shareDoc
            ? el('div', { className: 'mpk-share' },
                el('div', { className: 'mpk-share-title' }, t('shareTitle')),
                el('ol', { className: 'mpk-share-steps' },
                  el('li', null, t('shareStep1')),
                  el('li', null, t('shareStep2')),
                  el('li', null, t('shareStep3')),
                ),
                el('div', { className: 'mpk-row', style: { margin: '10px 0 8px' } },
                  el('button', {
                    className: 'mpk-btn',
                    'data-size': 'sm',
                    'data-variant': 'primary',
                    onClick: async () => {
                      const ok = await copyText(sharePrompt(shareDoc, t))
                      notify(ok ? 'ok' : 'err', ok ? t('shareCopied') : t('shareCopyFail'))
                    },
                  }, t('shareCopy')),
                  el('span', { className: 'mpk-count' }, `${shareDoc.name || ''}${shareDoc.name ? ' · ' : ''}${t('entries', shareDoc.plugins.length)}`),
                ),
                el('pre', { className: 'mpk-share-pre' }, sharePrompt(shareDoc, t)),
              )
            : null,
        ),
      )
    }

    /* ---------------------------------------------------------------- */
    /* install view                                                     */
    /* ---------------------------------------------------------------- */

    const ACTION_TONE = {
      install: 'brand', toggle: 'warn', skip: 'off', blocked: 'err', invalid: 'err',
      installed: 'ok', toggled: 'ok', failed: 'err', skipped: 'off',
    }

    function actionLabel(t, action) {
      if (action.type === 'install') return t('actInstall')
      if (action.type === 'toggle') return action.to ? t('actToggleOn') : t('actToggleOff')
      if (action.type === 'skip') return t('actSkip')
      if (action.type === 'blocked') return t('actBlocked')
      if (action.type === 'invalid') return t('actInvalid')
      if (action.outcome === 'installed') return t('actInstalled')
      if (action.outcome === 'toggled') return t('actToggled')
      if (action.outcome === 'failed') return t('actFailed')
      if (action.outcome === 'skipped') return t('actSkip')
      return action.type || '?'
    }

    function InstallView({ t, data, saved, reloadSaved, notify, doc, setDoc, caps }) {
      const fileInput = React.useRef(null)
      // `caps` is null until the probe answers, and also on a build too old to
      // report it. Treat null as "allowed": the host refuses with a clear
      // message, which is better than disabling the button on a build that
      // would have worked.
      const canInstall = !caps || caps.installBundle !== false
      const [plan, setPlan] = React.useState(null)
      const [result, setResult] = React.useState(null)
      const [allowLocal, setAllowLocal] = React.useState(false)
      const [pinVersions, setPinVersions] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [over, setOver] = React.useState(false)

      const loadDocument = React.useCallback((next) => {
        setPlan(null)
        setResult(null)
        setDoc(next)
      }, [setDoc])

      // Auto-preview whenever a document arrives (dropped, picked or pulled
      // from the library), so the user always sees the consequences first.
      React.useEffect(() => {
        if (!doc) return undefined
        let cancelled = false
        const run = async () => {
          try {
            const preview = await call('/plan', { modpack: doc, allowLocal, pinVersions })
            if (!cancelled) setPlan(preview)
          } catch (err) {
            if (!cancelled) notify('err', t('errorTitle'), (err && err.message) || String(err))
          }
        }
        run()
        return () => { cancelled = true }
        // `allowLocal` / `pinVersions` deliberately excluded: toggling either
        // should not refetch, the Preview button re-runs the plan with the
        // new flags.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [doc])

      const readFile = async (file) => {
        try {
          const text = await file.text()
          loadDocument(JSON.parse(text))
        } catch (err) {
          notify('err', t('errorTitle'), `无法读取文件：${(err && err.message) || String(err)}`)
        }
      }

      /**
       * Stop a drag event from reaching the Harness shell.
       *
       * The shell listens for drops on the document to attach files to the
       * chat composer. Drag events bubble, so a file dropped on our panel was
       * handled here *and* uploaded to the conversation behind it. Both
       * `preventDefault` and `stopPropagation` are needed: the first marks the
       * drop as ours, the second keeps it from ever reaching the shell.
       * `stopImmediatePropagation` additionally stops sibling listeners on
       * this same node, which a future shell refactor could plausibly add.
       */
      const swallowDrag = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
      }

      const onDrop = (event) => {
        swallowDrag(event)
        setOver(false)
        const files = event.dataTransfer && event.dataTransfer.files
        const file = files && files[0]
        if (file) readFile(file)
      }

      // `dragenter` is what makes a drop target legal in most browsers, and it
      // is also the event the shell may use to paint its own "drop to attach"
      // affordance. Swallowing it here keeps that affordance from lighting up
      // while the pointer is over our panel.
      const onDragEnter = (event) => {
        swallowDrag(event)
        setOver(true)
      }

      const onDragOver = (event) => {
        swallowDrag(event)
        if (!over) setOver(true)
      }

      // Leaving the panel must not clear the highlight when the pointer only
      // moved between our own children — `dragleave` fires on every child exit.
      const onDragLeave = (event) => {
        swallowDrag(event)
        const next = event.relatedTarget
        if (next && event.currentTarget && event.currentTarget.contains(next)) return
        setOver(false)
      }

      const doPreview = async () => {
        if (!doc) return
        setBusy(true)
        try {
          const preview = await call('/plan', { modpack: doc, allowLocal, pinVersions })
          setPlan(preview)
        } catch (err) {
          notify('err', t('errorTitle'), (err && err.message) || String(err))
        } finally {
          setBusy(false)
        }
      }

      const doApply = async () => {
        if (!doc) return
        setBusy(true)
        setResult(null)
        try {
          const applied = await call('/apply', { modpack: doc, allowLocal, pinVersions })
          setResult(applied)
          if (applied.ok) notify('ok', t('installDone'), applied.restartRequired ? t('restartRequired') : '')
          else notify('err', t('errorTitle'), applied.error || '')
        } catch (err) {
          notify('err', t('errorTitle'), (err && err.message) || String(err))
        } finally {
          setBusy(false)
        }
      }

      const quickPick = data && data.storageDir
        ? el('div', { className: 'mpk-row' },
            el('span', { className: 'mpk-count' }, t('fromLibrary')),
            saved.length === 0
              ? el('span', { className: 'mpk-count' }, '—')
              : saved.slice(0, 6).map((item) => el('button', {
                  key: item.file,
                  className: 'mpk-btn',
                  'data-size': 'sm',
                  onClick: async () => {
                    try {
                      const loaded = await call('/load', { file: item.file })
                      if (!loaded.ok) throw new Error(loaded.error)
                      loadDocument(loaded.modpack)
                    } catch (err) {
                      notify('err', t('errorTitle'), (err && err.message) || String(err))
                    }
                  },
                }, item.name)),
          )
        : null

      const rows = plan && plan.ok ? plan.actions : []

      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        el('div', { className: 'mpk-card' },
          el('h3', null, t('installTitle')),
          el('p', { className: 'mpk-count', style: { margin: '0 0 10px' } }, t('installHint')),
          el('div', {
            className: 'mpk-drop',
            'data-over': over ? '1' : '0',
            onClick: () => { if (fileInput.current) fileInput.current.click() },
            onDragEnter,
            onDragOver,
            onDragLeave,
            onDrop,
          },
            el('div', null, t('dropHere')),
            el('div', { style: { marginTop: '8px' } },
              el('span', { className: 'mpk-btn', 'data-size': 'sm' }, t('chooseFile')),
            ),
            el('input', {
              ref: fileInput,
              type: 'file',
              accept: '.json,application/json',
              style: { display: 'none' },
              onChange: (e) => {
                const file = e.target.files && e.target.files[0]
                if (file) readFile(file)
                e.target.value = ''
              },
            }),
          ),
          el('div', { style: { marginTop: '12px' } }, quickPick),
          doc
            ? el('div', { className: 'mpk-banner', 'data-tone': 'ok', style: { marginTop: '12px' } },
                el('b', null, doc.name || '(unnamed)'),
                doc.description || '',
                el('div', { className: 'mpk-mono', style: { fontSize: '11px', marginTop: '4px', opacity: .8 } },
                  `${doc.format} v${doc.formatVersion} · ${(doc.plugins || []).length} entries${doc.author ? ` · ${doc.author}` : ''}`),
              )
            : null,
          el('div', { className: 'mpk-row', style: { marginTop: '12px' } },
            el('label', { className: 'mpk-switch' },
              el('input', { type: 'checkbox', checked: allowLocal, onChange: (e) => setAllowLocal(e.target.checked) }),
              t('allowLocal'),
            ),
            el('label', { className: 'mpk-switch' },
              el('input', { type: 'checkbox', checked: pinVersions, onChange: (e) => setPinVersions(e.target.checked) }),
              t('pinVersions'),
            ),
          ),
          el('div', { className: 'mpk-row', style: { marginTop: '10px' } },
            el('button', { className: 'mpk-btn', disabled: !doc || busy, onClick: doPreview },
              busyLabel(busy, t('preview'), t('loading'))),
            el('button', {
              className: 'mpk-btn',
              'data-variant': 'primary',
              disabled: !canInstall || !doc || busy || (plan && plan.ok && rows.length > 0 && plan.summary.install === 0 && plan.summary.toggle === 0),
              title: canInstall ? undefined : t('cannotInstall'),
              onClick: doApply,
            }, busyLabel(busy, t('apply'), t('applying'))),
          ),
        ),

        plan && !plan.ok
          ? el('div', { className: 'mpk-banner', 'data-tone': 'err' }, el('b', null, t('errorTitle')), plan.error)
          : null,

        plan && plan.ok
          ? el('div', { className: 'mpk-card' },
              el('h3', null, t('preview')),
              el('div', { className: 'mpk-summary', style: { marginBottom: '10px' } },
                el('span', null, t('actInstall'), ' ', el('b', null, String(plan.summary.install))),
                el('span', null, t('actToggled'), ' ', el('b', null, String(plan.summary.toggle))),
                el('span', null, t('actSkip'), ' ', el('b', null, String(plan.summary.skip))),
                el('span', null, t('actBlocked'), ' ', el('b', null, String(plan.summary.blocked))),
              ),
              rows.length === 0 || (plan.summary.install === 0 && plan.summary.toggle === 0 && plan.summary.blocked === 0)
                ? el('div', { className: 'mpk-empty' }, t('noActions'))
                : el('div', { className: 'mpk-table-wrap' },
                    el('table', { className: 'mpk-table' },
                      el('thead', null, el('tr', null,
                        el('th', { style: { width: '72px' } }, t('colAction')),
                        el('th', null, t('colPlugin')),
                        el('th', null, t('colNote')),
                      )),
                      el('tbody', null, rows.map((row, index) => el('tr', { key: `${row.type}-${row.entryId || row.name || index}` },
                        el('td', null, badge(actionLabel(t, row), ACTION_TONE[row.outcome || row.type] || 'flat')),
                        el('td', null,
                          el('div', { className: 'mpk-name' }, row.label || '?'),
                          row.spec ? el('div', { className: 'mpk-spec' }, row.spec) : null,
                        ),
                        el('td', { style: { color: 'var(--dsw-alias-label-secondary)' } }, row.note || row.error || ''),
                      ))),
                    ),
                  ),
            )
          : null,

        result && result.ok
          ? el('div', { className: 'mpk-card' },
              el('h3', null, `${t('installDone')} — ${result.modpackName || ''}`),
              result.restartRequired
                ? el('div', { className: 'mpk-banner', 'data-tone': 'warn', style: { marginBottom: '10px' } }, t('restartRequired'))
                : null,
              el('div', { className: 'mpk-table-wrap' },
                el('table', { className: 'mpk-table' },
                  el('tbody', null, result.results.map((row, index) => el('tr', { key: index },
                    el('td', { style: { width: '72px' } }, badge(actionLabel(t, row), ACTION_TONE[row.outcome] || 'flat')),
                    el('td', null, el('div', { className: 'mpk-name' }, row.label || '?')),
                    el('td', { style: { color: 'var(--dsw-alias-label-secondary)' } }, row.error || row.note || ''),
                  ))),
                ),
              ),
            )
          : null,
      )
    }

    /* ---------------------------------------------------------------- */
    /* library view                                                     */
    /* ---------------------------------------------------------------- */

    function LibraryView({ t, saved, reloadSaved, notify, onSendToInstall }) {
      const [busy, setBusy] = React.useState(null)

      const doLoad = async (item) => {
        setBusy(item.file)
        try {
          const loaded = await call('/load', { file: item.file })
          if (!loaded.ok) throw new Error(loaded.error)
          onSendToInstall(loaded.modpack)
        } catch (err) {
          notify('err', t('errorTitle'), (err && err.message) || String(err))
        } finally {
          setBusy(null)
        }
      }

      const doDelete = async (item) => {
        if (!window.confirm(t('confirmDelete'))) return
        setBusy(item.file)
        try {
          const removed = await call('/delete', { file: item.file })
          if (!removed.ok) throw new Error(removed.error)
          reloadSaved()
        } catch (err) {
          notify('err', t('errorTitle'), (err && err.message) || String(err))
        } finally {
          setBusy(null)
        }
      }

      const doDownload = async (item) => {
        setBusy(item.file)
        try {
          const loaded = await call('/load', { file: item.file })
          if (!loaded.ok) throw new Error(loaded.error)
          downloadText(item.file, JSON.stringify(loaded.modpack, null, 2))
        } catch (err) {
          notify('err', t('errorTitle'), (err && err.message) || String(err))
        } finally {
          setBusy(null)
        }
      }

      if (saved.length === 0) {
        return el('div', { className: 'mpk-card' }, el('div', { className: 'mpk-empty' }, t('libraryEmpty')))
      }

      return el('div', { className: 'mpk-card', style: { padding: '0' } },
        el('div', { className: 'mpk-list', style: { maxHeight: 'none', border: '0' } },
          saved.map((item) => el('div', { className: 'mpk-lib-item', key: item.file },
            el('div', { className: 'mpk-item-main' },
              el('div', { className: 'mpk-item-title' },
                el('span', { className: 'mpk-name' }, item.name),
                badge(t('entries', item.counts.total || 0)),
                item.dshVersion ? badge(`DSH ${item.dshVersion}`) : null,
              ),
              item.description ? el('div', { className: 'mpk-spec', style: { fontFamily: 'inherit' } }, item.description) : null,
              el('div', { className: 'mpk-spec' }, `${t('savedAt')} ${new Date(item.modifiedAt).toLocaleString()}${item.author ? ` · ${item.author}` : ''}`),
            ),
            el('div', { className: 'mpk-row' },
              el('button', { className: 'mpk-btn', 'data-size': 'sm', disabled: busy === item.file, onClick: () => doDownload(item) }, t('download')),
              el('button', { className: 'mpk-btn', 'data-size': 'sm', disabled: busy === item.file, onClick: () => doLoad(item) }, t('load')),
              el('button', { className: 'mpk-btn', 'data-size': 'sm', 'data-variant': 'danger', disabled: busy === item.file, onClick: () => doDelete(item) }, t('delete')),
            ),
          )),
        ),
      )
    }

    /* ---------------------------------------------------------------- */
    /* root                                                             */
    /* ---------------------------------------------------------------- */

    function ModpackPanel() {
      const locale = useLocale()
      const t = React.useMemo(() => makeT(locale), [locale])

      const [tab, setTab] = React.useState('build')
      const [data, setData] = React.useState(null)
      const [saved, setSaved] = React.useState([])
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [installDoc, setInstallDoc] = React.useState(null)
      const [cat, setCat] = React.useState(null)
      const [catStatus, setCatStatus] = React.useState('idle')
      const saveChain = React.useRef(Promise.resolve())

      // The width rule in CSS is gated on this class, so it applies exactly as
      // long as this section is on screen and disappears with it. Nothing else
      // in Settings is affected. A ref count rather than a boolean because the
      // same component is registered in two slots: if both ever mount at once,
      // whichever unmounts first must not strip the class off the other.
      React.useEffect(() => {
        const root = document.documentElement
        const depth = Number(root.dataset.mpkWide || '0') + 1
        root.dataset.mpkWide = String(depth)
        root.classList.add('mpk-wide')
        return () => {
          const left = Number(root.dataset.mpkWide || '1') - 1
          if (left > 0) {
            root.dataset.mpkWide = String(left)
          } else {
            delete root.dataset.mpkWide
            root.classList.remove('mpk-wide')
          }
        }
      }, [])

      const notify = React.useCallback((tone, title, detail) => {
        setNotice({ tone, title, detail, at: Date.now() })
      }, [])

      const reloadSaved = React.useCallback(async () => {
        try {
          const listed = await call('/saved')
          if (listed.ok) setSaved(listed.modpacks || [])
        } catch {
          /* library is optional */
        }
      }, [])

      const loadInventory = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const inventory = await call('/inventory')
          setData(inventory)
          await reloadSaved()
        } catch (err) {
          setError((err && err.message) || String(err))
        } finally {
          setLoading(false)
        }
      }, [reloadSaved])

      /**
       * Ask the host what this build can do.
       *
       * The host half already degrades feature by feature; without this the UI
       * would keep offering buttons that are guaranteed to fail. A failed
       * probe leaves `caps` null, and every gate below treats null as "assume
       * capable" — the host still refuses properly, so a missing answer costs
       * a clear error, never a broken page.
       */
      const [caps, setCaps] = React.useState(null)
      // `null` while unknown, then `{ host, self }` once the probe answered.
      // Only a *mismatch* is worth a banner: an old host half that does not
      // report the number at all is left alone, because it predates the
      // handshake rather than disagreeing with it.
      const [apiMismatch, setApiMismatch] = React.useState(null)

      const loadCaps = React.useCallback(async () => {
        try {
          const diag = await call('/diag')
          if (diag && diag.ok && diag.capabilities) setCaps(diag.capabilities)
          setApiMismatch(apiMismatchOf(diag, API_VERSION))
        } catch {
          /* keep null: assume capable, let the host refuse */
        }
      }, [])

      const loadCategories = React.useCallback(async () => {
        try {
          const result = await call('/categories')
          if (result.ok) setCat(result.doc)
        } catch {
          /* categories are optional: the builder works without them */
        }
      }, [])

      /**
       * Saves are serialized through one chain. Two quick renames would
       * otherwise race, and whichever response landed last would win — writing
       * back a tree the user had already moved past.
       */
      const saveCategories = React.useCallback((next) => {
        setCat(next) // optimistic: the tree must never lag behind the click
        setCatStatus('saving')
        saveChain.current = saveChain.current
          .then(() => call('/categories/save', { doc: next }))
          .then((result) => {
            if (!result || !result.ok) throw new Error((result && result.error) || 'save failed')
            setCat(result.doc)
            setCatStatus('saved')
          })
          .catch((err) => {
            setCatStatus('error')
            notify('err', t('treeSaveFailed'), (err && err.message) || String(err))
            loadCategories() // resync with whatever is actually on disk
          })
      }, [notify, t, loadCategories])

      React.useEffect(() => { loadInventory() }, [loadInventory])
      React.useEffect(() => { loadCategories() }, [loadCategories])
      React.useEffect(() => { loadCaps() }, [loadCaps])

      React.useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(null), 8000)
        return () => clearTimeout(timer)
      }, [notice])

      const tabs = [
        ['build', t('tabBuild')],
        ['install', t('tabInstall')],
        ['library', t('tabLibrary')],
      ]

      const body = () => {
        if (loading && !data) {
          return el('div', { className: 'mpk-card' }, el('div', { className: 'mpk-empty' }, el('span', { className: 'mpk-spin' }), t('loading')))
        }
        if (error) {
          return el('div', { className: 'mpk-card' },
            el('div', { className: 'mpk-banner', 'data-tone': 'err' }, el('b', null, t('errorTitle')), error),
            el('div', { style: { marginTop: '10px' } },
              el('button', { className: 'mpk-btn', onClick: loadInventory }, t('retry'))),
          )
        }
        if (data && data.ok === false) {
          return el('div', { className: 'mpk-card' },
            el('div', { className: 'mpk-banner', 'data-tone': 'warn' },
              el('b', null, t('degradedTitle')),
              data.reason || '',
              el('div', { style: { marginTop: '6px', opacity: .85 } }, t('degradedHint')),
            ),
            el('div', { className: 'mpk-summary', style: { marginTop: '10px' } },
              el('span', null, 'profile: ', el('b', { className: 'mpk-mono' }, data.profileDir || '?')),
            ),
          )
        }
        if (tab === 'install') {
          return el(InstallView, { t, data, saved, reloadSaved, notify, doc: installDoc, setDoc: setInstallDoc, caps })
        }
        if (tab === 'library') {
          return el(LibraryView, {
            t, saved, reloadSaved, notify,
            onSendToInstall: (doc) => { setInstallDoc(doc); setTab('install') },
          })
        }
        return el(BuildView, {
          data: data || { bundles: [], plugins: [] },
          cat,
          onCatChange: saveCategories,
          catStatus,
          t,
          onSaved: reloadSaved,
          notify,
          locale,
        })
      }

      return el('div', { className: 'mpk-root' },
        el('div', { className: 'mpk-head' },
          el('h2', null, t('title')),
          el('p', null, t('subtitle')),
        ),
        el('div', { className: 'mpk-tabs' },
          tabs.map(([key, label]) => el('button', {
            key,
            className: 'mpk-tab',
            'data-on': tab === key ? '1' : '0',
            onClick: () => setTab(key),
          }, label)),
          el('div', { style: { flex: '1' } }),
          el('button', {
            className: 'mpk-btn',
            'data-size': 'sm',
            style: { alignSelf: 'center' },
            onClick: loadInventory,
            disabled: loading,
          }, loading ? t('loading') : t('refresh')),
        ),

        notice
          ? el('div', { className: 'mpk-banner', 'data-tone': notice.tone },
              el('b', null, notice.title),
              notice.detail || '',
            )
          : null,

        // Drawn above everything, including the degraded page: a stale client
        // half is exactly the situation where every other panel below may be
        // lying, so the explanation has to be the first thing on screen.
        apiMismatch
          ? el('div', { className: 'mpk-banner', 'data-tone': 'err' },
              el('b', null, t('staleTitle')),
              t('staleBody', apiMismatch.host, apiMismatch.self),
            )
          : null,

        data && data.warnings && data.warnings.length
          ? el('div', { className: 'mpk-banner', 'data-tone': 'warn' },
              el('b', null, t('errorTitle')),
              data.warnings.join(' / '),
            )
          : null,

        body(),
      )
    }

    /* ---------------------------------------------------------------- */
    /* plugin                                                           */
    /* ---------------------------------------------------------------- */

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ensureStyles(), 'dsh-modpack: styles')

        // Every seat below is registered through `seat`, which swallows a
        // failure per seat. A build that renames one slot key would otherwise
        // throw out of `apply` and take the *other* seat down with it — one
        // unknown name should cost one missing tab, never the whole plugin.
        const seat = (key, order, label) => {
          try {
            ctx.effect(() => ctx.slots.inject(key, () =>
              ctx.slots.register({ name: key, id: 'modpack', order, label }, ModpackPanel),
            ), `dsh-modpack: ${key}`)
          } catch (err) {
            console.warn(`[dsh-modpack] 无法挂到插槽 ${key}（这个 Harness 版本可能没有它）：`, (err && err.message) || err)
          }
        }

        // Primary seat: a page of its own in the Settings nav.
        //
        // The Plugins page does declare `settings.plugins.tab`, and a
        // registration there is accepted (`active: true` in the live slot
        // tree) — but the shipped build renders no tab strip on that page, so
        // the contribution is silently never drawn. `settings.section` is the
        // seat that actually appears, and it is proven in production by the
        // installed billion-context plugin (`bili`, order 100).
        seat('settings.section', 16, () => makeT(currentLocale())('tab'))

        // Secondary seat: kept for Harness builds that DO draw the Plugins
        // tab strip (the slot exists, so this is cheap insurance). A build
        // that never draws it simply never shows anything.
        seat('settings.plugins.tab', 50, () => makeT(currentLocale())('tab'))
      },
    }
  },
})