# 上传到 GitHub —— 全程点鼠标，不敲一行命令

> 这份教程**不需要打开命令行、不需要输入任何代码**。所有操作都在浏览器里点鼠标完成。
> 传 12 个主文件大约 10 分钟（`.gitignore` 单独新建，见 3.2.1）；把三个文件夹也补齐再加二十来分钟（用 GitHub Desktop 则几分钟）。
>
> 你只需要：一个 GitHub 账号（免费）、这台电脑、一个浏览器（推荐 **Edge 或 Chrome**）。

---

## 开始之前：先看清楚要传哪些东西

要上传的是桌面上 **`要上传到GitHub`** 这个文件夹里的东西
（`E:\Administrator\桌面\dsh-modpack-v0.9.1\要上传到GitHub\`）。

打开它，你会看到 16 项（13 个文件 + 3 个文件夹）：

| 名字 | 是什么 | 必须传吗 |
| --- | --- | --- |
| `index.js` | 插件后台（Node 侧） | ✅ 必须 |
| `client.js` | 插件界面（浏览器侧） | ✅ 必须 |
| `package.json` | 插件的身份证 | ✅ 必须 |
| `cordis.patch.yml` | 告诉客户端怎么挂载 | ✅ 必须 |
| `icon.svg` | 图标 | ✅ 必须 |
| `LICENSE` | 授权协议 | ✅ 必须 |
| `README.md` | 别人打开仓库看到的第一页 | ✅ 必须 |
| `.gitignore` | 防止以后误传垃圾文件（**点开头，不能拖，见 3.2.1**） | ✅ 必须 |
| `CHANGELOG.md` | 每个版本改了什么 | 建议 |
| `UPLOAD-GUIDE.md` | 就是这份教程 | 建议 |
| `GITHUB-COPY.md` | 现成的介绍文案 | 建议 |
| `CONTRIBUTING.md` | 别人想改代码时看的规矩 | 建议 |
| `SECURITY.md` | 安全说明 | 建议 |
| `locale`（文件夹，2 个文件） | 界面标题的中英文案 | 建议 |
| `scripts`（文件夹，24 个文件） | 自动测试脚本 | 可选 |
| `.github`（文件夹，5 个文件） | 自动检查（CI）+ 提问模板 | 可选 |

> **那三个文件夹传不上去也不影响发布。** 别人安装用的是 Release 里的 `dsh-modpack-0.9.1.tgz`，
> 那个包里 `locale`、`scripts` 一个不少。文件夹只影响「仓库好不好看」和「自动测试跑不跑」。
> 具体怎么把文件夹补上去，看第 3.3 节。

> ⚠️ **只传这个文件夹里的东西。** 不要传 `dist`（打包产物放 Release）、
> 不要传 `node_modules`、更不要传整个 DeepSeek Harness 目录或你的 `.dsh` 配置目录。

> 💡 **看不到 `.gitignore` 和 `.github`？** 它们名字以点开头，Windows 默认藏起来。
> 在文件夹窗口顶部点 **「查看」** 选项卡 → 勾上 **「隐藏的项目」**，就出来了。

---

## 第 1 步：登录 GitHub

1. 打开浏览器，访问 **https://github.com**
2. 右上角点 **Sign in** 登录
3. 没有账号就点 **Sign up**，用邮箱注册（免费）

**成功的标志**：右上角是你的头像，不是 "Sign in / Sign up" 两个按钮。

---

## 第 2 步：新建一个仓库

1. 在浏览器地址栏输入 **https://github.com/new** 回车
   （或者点右上角 **+** → **New repository**）

2. 按下面这张表填：

   | 页面上的框 | 填什么 |
   | --- | --- |
   | **Repository name** | `dsh-modpack` |
   | **Description** | 去 `GITHUB-COPY.md` 复制第 ② 块（有中英两版，**建议用英文那版**） |
   | **Public / Private** | 选 **Public** |

   > **为什么必须 Public？** 私有仓库别人看不见、也搜不到、也装不了。

3. 页面往下滚，三个勾选框这样处理：

   - ☑ **Add a README file** ← **勾上它**
   - ☐ Add .gitignore ← 不勾（你自己有）
   - ☐ Choose a license ← 不勾（你自己有）

   > **为什么反过来要勾 README？** 一个勾都不勾 = 仓库是空的 = 页面上**没有 `Add file` 按钮**，
   > 也没有能接收拖拽的虚线框，东西根本拖不上去。先让 GitHub 建一个 README 占位，
   > 仓库就有了正常的文件页面；一会儿你把自己的 `README.md` 拖上去，它会直接盖掉这个占位的，不冲突。

4. 点页面最下面的绿色按钮 **Create repository**

**成功的标志**：跳到一个新页面，标题是 `你的用户名/dsh-modpack`，
页面上方能看到 **Add file** 按钮，下面显示着一个 `README.md`。

> 💡 **如果你之前建仓库时三个勾都没勾**，现在页面中间是一大段带命令行的灰框
> （写着 `…or create a new repository on the command line` 之类）。
> 那段灰字里有个蓝色链接 **uploading an existing file**，点它同样能进到带虚线框的上传页。
>
> 🚫 **灰框里的命令一个字都不用抄。** 我们走鼠标路线。

---

## 第 3 步：把文件传上去（这一步是全部的重点）

> ⚠️ **先说一个已知坑：三个文件夹（`locale`、`scripts`、`.github`）经常拖不动。**
> GitHub 网页上传**普通文件**很稳，但**拖文件夹**要看浏览器脸色：
> Firefox 常常完全没反应；一次同时拖多个文件夹，往往只吃第一个；
> 仓库还是空的时候，页面上压根没有能接收拖拽的虚线框。
>
> 所以这一步改成**两段做**：先用「新建文件」把 `.gitignore` 单独建出来，
> 再拖 12 个普通文件（一定能成），最后用「新建文件挖洞 + 进洞拖文件」的办法补三个文件夹。

### 3.1 打开上传页面

在你刚建好的仓库页面里：

1. 找到页面上方的 **Add file** 按钮（在文件列表右上方）
2. 点它 → 在下拉菜单里选 **Upload files**

**成功的标志**：页面中间出现一个虚线大方框，里面写着
"Drag files here to add them to your repository" 和 "choose your files"。

> 🚫 **页面上没有 Add file 按钮？** 说明仓库是空的（第 2 步三个勾都没勾）。
> 页面中间那段灰字里有个蓝色链接 **uploading an existing file**，点它就能进到带虚线框的上传页。

### 3.2 先建 `.gitignore`，再拖 12 个普通文件

#### 3.2.1 `.gitignore` 单独建（点开头的文件拖不上去）

`.gitignore` 名字以点开头，浏览器拖拽时经常被过滤掉，或者开头的点被吃掉变成 `gitignore`（规则就失效了）。所以它不拖，直接新建：

1. 仓库首页 → **Add file** → **Create new file**
2. 名字框里原样打 `.gitignore`（9 个字符，不要加 `.txt`）
3. 大框里粘贴内容（资源管理器 → `要上传到GitHub` → `.gitignore` → 右键 **打开方式** → **记事本** → `Ctrl+A` → `Ctrl+C` → 回浏览器 `Ctrl+V`）
4. 点 **Commit changes** → 弹窗再点一次 **Commit changes**

> 如果列表里出现的是 `gitignore`（没有点），点开它 → 右上角垃圾桶 → **Commit changes** 删掉，重做这一步。

#### 3.2.2 再拖剩下 12 个普通文件

1. 打开另一个窗口（按 `Win + E` 打开资源管理器），进到 `要上传到GitHub` 文件夹
2. **只选那 12 个文件**（跳过 `.gitignore` 和三个文件夹；按住 `Ctrl` 一个个点，或者按名称排序后用 `Shift` 连选）
3. 拖到虚线方框里，松手
4. 滚到页面最下面，**Commit changes** 那一栏里两个框都不用改，直接点绿色 **Commit changes**

**成功的标志**：页面跳回仓库首页，文件列表里出现 `index.js`、`client.js`、`package.json`、
`README.md`……并且 README 的内容显示在列表下方。

> 💡 **拖拽不灵？** 点方框里的 **choose your files**，在弹窗里按住 `Ctrl` 点选也一样。
> 注意这个弹窗**只能选文件、选不了文件夹**——文件夹用下面 3.3 的办法。

### 3.3 三个文件夹：先「挖洞」，再往里拖文件

文件夹拖不动，但**文件**拖得动。所以分两下：

1. 在 GitHub 上新建文件时，**名字里打斜杠 `/`**，斜杠前面的部分会自动变成文件夹（等于把洞挖出来）；
2. 然后进到那个文件夹的页面，把剩下的**普通文件**拖进去。

一共 **5 次粘贴 + 3 次拖拽**，二十来分钟能做完。

#### 第一部分：挖 5 个洞

每一次的动作都一模一样：

1. 仓库首页 → **Add file** → **Create new file**
2. 在 **Name your file…** 那个框里，照着下表**连斜杠一起**打出文件名
   （打到 `/` 的时候，你会看到它自己变成了目录路径）
3. 在下面的大框里粘贴文件内容。内容这么拿：
   在资源管理器里找到下表最后一列那个本地文件 → 右键 → **打开方式** → **记事本** →
   `Ctrl + A` 全选 → `Ctrl + C` 复制 → 回浏览器 `Ctrl + V` 粘贴
4. 右上角点 **Commit changes**（弹出来的小框里再点一次 **Commit changes**）

| # | 在 GitHub 上打的文件名 | 内容从这个本地文件复制 | 多大 |
| --- | --- | --- | --- |
| 1 | `locale/zh.json` | `要上传到GitHub\locale\zh.json` | 240 B |
| 2 | `.github/PULL_REQUEST_TEMPLATE.md` | `要上传到GitHub\.github\PULL_REQUEST_TEMPLATE.md` | 730 B |
| 3 | `.github/ISSUE_TEMPLATE/config.yml` | `要上传到GitHub\.github\ISSUE_TEMPLATE\config.yml` | 396 B |
| 4 | `.github/workflows/ci.yml` | `要上传到GitHub\.github\workflows\ci.yml` | 3.3 KB |
| 5 | `scripts/mutate-compat.mjs` | `要上传到GitHub\scripts\mutate-compat.mjs` | 3.4 KB |

**这 5 个洞挖完，仓库里就有了 `locale`、`.github`（里面还有 `ISSUE_TEMPLATE`、`workflows`）、`scripts` 这几个文件夹。**

> 每粘完一个，在 GitHub 上点开看一眼：中文没乱码、缩进还在，就对了。

#### 第二部分：把剩下的文件拖进这些文件夹

进到某个文件夹的页面，它右上方同样有 **Add file** → **Upload files**；
在那里拖进去的文件就会落在**这个文件夹**里。
（不想打网址也行：在仓库首页点那个文件夹名进去，效果一样。）

| # | 先在浏览器打开这个地址 | 然后把这些本地文件拖进去 | 几个 |
| --- | --- | --- | --- |
| 6 | `https://github.com/你的用户名/dsh-modpack/tree/main/locale` | `要上传到GitHub\locale\en.json` | 1 |
| 7 | `https://github.com/你的用户名/dsh-modpack/tree/main/.github/ISSUE_TEMPLATE` | `bug_report.yml`、`feature_request.yml` | 2 |
| 8 | `https://github.com/你的用户名/dsh-modpack/tree/main/scripts` | `要上传到GitHub\scripts` 里剩下的 `.mjs`（进去 `Ctrl + A` 全选，然后按住 `Ctrl` 点一下把已经传过的 `mutate-compat.mjs` 取消选中，再一起拖） | 23 |

每次拖完，都要点页面最下面的绿色 **Commit changes**。

> GitHub 官方限制：**一次最多上传 100 个文件**、单个文件不超过 25 MB。23 个小文件远远够用。

#### 嫌 23 个太多？只补 `locale`，跳过 `scripts` 和 `.github`

`scripts` 和 `.github` **只关系到自动测试（CI）和提问模板，跟「别人能不能搜到、能不能装上」一点关系都没有**
——安装包 `dsh-modpack-0.9.1.tgz` 里这两样都齐了。

所以最省事的完整做法是：**只做第 1 个洞（`locale/zh.json`）+ 第 6 项（拖 `en.json`）**，
`scripts` 和 `.github` 全跳过。仓库少两个文件夹，功能一点不少。

> ⚠️ 但**别只传 `.github` 不传 `scripts`**：CI 工作流要跑 `scripts` 里的测试，
> 缺了它，仓库首页会挂一个红叉（Actions 失败）。**要么两个都传，要么两个都不传。**

### 3.4 网页死活不让传？用 GitHub Desktop（也是纯点鼠标，一次传完 44 个文件）

GitHub 官方的桌面客户端**自带 Git**（不用另外装），对文件夹毫无压力。
这条路**替掉第 2 步和第 3 步**（它自己会建仓库），第 4/5/6/7 步照旧。

#### 第 0 小步：先把文件夹名字改成英文（很关键）

GitHub Desktop 会拿**文件夹名**当仓库名的默认值。`要上传到GitHub` 是中文，
直接用的话后面还得手动改，而且容易留个中文仓库名。所以先改名：

- 右键那个文件夹 → **重命名** → 改成 `dsh-modpack` → 回车

（改名只是改外壳，里面 44 个文件一个都不动。）

#### 第 1 小步：装客户端

1. 浏览器打开 **https://desktop.github.com**
2. 点中间的大按钮 **Download for Windows**
3. 双击下载好的 **`GitHubDesktopSetup.exe`** → 安装过程**没有任何选项要点**，几十秒后自动打开
   - 弹「Windows 已保护你的电脑」→ **更多信息** → **仍要运行**
   - 弹「允许此应用对你的设备进行更改吗？」→ **是**

#### 第 2 小步：登录

1. 欢迎窗口里点 **Sign in to GitHub.com**（不要点 GitHub Enterprise 那个）
2. 弹 **Sign in Using Your Browser** → 点 **Continue With Browser**
   （GitHub 不允许在客户端里直接输密码，必须跳浏览器授权，这是正常的）
3. 浏览器里点绿色 **Authorize desktop** → 切回客户端
4. 弹 **Configure Git** 就填 GitHub 用户名 + 注册邮箱 → **Continue**
5. 弹「要不要做个教程仓库」→ **Skip this step**

**成功标志**：看到 **Let's get started!** 界面。
（没看到欢迎窗口就走菜单 **File** → **Options...** → **Accounts** → **Sign Into GitHub.com**）

#### 第 3 小步：把文件夹交给它

1. 点 **Add an Existing Repository from your Hard Drive...**
   （或菜单 **File** → **Add local repository...**，同一个功能）
2. 点路径框右边的 **Choose...** → 左边选 **桌面** → **单击选中 `dsh-modpack` 文件夹**
   （⚠️ 只点一下选中，**不要双击进去**）→ **选择文件夹**
3. 窗口下方出现一行「这个目录看起来不是一个 Git 仓库」，点里面的蓝字 **create a repository**
4. 弹 **Create a Repository** 窗口，照填：

   | 框 | 填什么 |
   | --- | --- |
   | **Name** | `dsh-modpack`（改名后它会自动填对） |
   | **Description** | 可留空 |
   | **Local Path** | **不要动**（这里显示的是父目录） |
   | **Initialize this repository with a README** | **不勾**（我们自己有 `README.md`，勾了会盖掉） |
   | **Git ignore** | 选 **None**（我们自己有 `.gitignore`） |
   | **License** | 选 **None**（我们自己有 `LICENSE`） |

5. 点 **Create Repository**

**成功标志**：左边 **Changes** 列出 44 个文件，顶部显示 **Current branch: main**。

> 没看到 `create a repository` 那行蓝字？说明它已经把这个文件夹当仓库了，直接看左边有没有 44 个文件。
> 左边是空的就 **Repository** → **Remove**（只从客户端移除，不删文件），
> 再去文件夹里删掉隐藏的 `.git`（资源管理器 **查看** → 勾 **隐藏的项目**），重做第 3 小步。

#### 第 4 小步：核对 + 提交

1. 左边 **Changes** 上方数字应该是 **44**；子目录文件显示成 `locale/zh.json`、`scripts/pack.mjs` 这种带 `/` 的形式
2. **每个文件前面的勾选框都要是勾上的**；点一下 `README.md`，右边中文应该不乱码
3. 左下 **Summary (required)** 框里打 `Add dsh-modpack 0.9.0` → 点蓝色 **Commit to main**
   （**Summary 不填，Commit 按钮就是灰的**）

> ⚠️ 如果列表里出现 `安装说明.md`、`.tgz`、`.zip` 之类，说明选错文件夹了：
> **Repository** → **Remove**，重做第 3 小步。

#### 第 5 小步：发布（这一步才真正上网）

1. 点顶部横条右边的 **Publish repository**（或菜单 **Repository** → **Publish repository**）
2. 对话框里照填：

   | 框 | 填什么 |
   | --- | --- |
   | **Name** | `dsh-modpack`（**必须这个名字**，别人搜的就是它） |
   | **Keep this code private** | 🔴 **一定要取消勾**，勾着 = 私有 = 别人看不见 |
   | **Organization** | 选 **None** |

3. 点 **Publish Repository**，等进度条走完

**成功标志**：顶部按钮变成 **Fetch origin**，右边出现 **View on GitHub**。

> 报 `The repository already exists`：你之前在网页上建过同名仓库。
> 去那个老仓库 **Settings** → **Danger Zone** → **Delete this repository**，回来再点一次 Publish。
>
> 不小心勾着 private 发布了：网页仓库 **Settings** → **Danger Zone** → **Change visibility** → Public。

#### 第 6 小步：验收

点 **View on GitHub**，浏览器里核对：13 个文件 + 3 个文件夹（`.github`/`locale`/`scripts` 是文件夹图标）、
README 正常显示、名字旁边写着 **Public**。

然后接着做第 5 步（打标签）和第 6 步（发 Release）。

#### 以后改了文件怎么更新

改 `dsh-modpack` 文件夹里的文件 → 打开客户端，**Changes** 会自动列出改动 →
**Summary** 写一句 → **Commit to main** → 点顶部 **Push origin**。加新文件也一样，拷进去就会出现。

> 💡 GitHub Desktop 会在 `dsh-modpack` 里建一个隐藏的 `.git` 文件夹，那是它自己的工作记录，
> **正常现象，不用管、也不会上传自己**。删掉它 = 断开与 GitHub 的联系（GitHub 上的仓库不受影响）。
>
> 客户端只有英文界面，官方没有中文版；照着上面的按钮名点就行。

### 3.5 传完对一遍数

仓库首页应该有：

- **13 个文件**：`.gitignore`、`CHANGELOG.md`、`client.js`、`CONTRIBUTING.md`、`cordis.patch.yml`、
  `GITHUB-COPY.md`、`icon.svg`、`index.js`、`LICENSE`、`package.json`、`README.md`、`SECURITY.md`、`UPLOAD-GUIDE.md`
- **3 个文件夹**（前面是文件夹图标，不是文件图标）：`locale`（2 个文件）、`scripts`（24 个）、`.github`（5 个）

少了文件夹不影响发布；少了 13 个文件里的任何一个都要回去补（`.gitignore` 如果显示成 `gitignore`，说明点被吃了，删掉按 3.2.1 重建）。

---

## 第 5 步：打标签 —— 这一步决定别人能不能搜到你

文件传上去了，但别人还搜不到你。要加「话题标签」。

1. 回到仓库首页（点左上角的仓库名 `你的用户名/dsh-modpack`）
2. 页面右侧，**About** 那一块的右上角，点 **⚙️ 齿轮图标**
3. 弹出一个框，找到 **Topics** 这一行
4. 在输入框里打 `dsh-plugin`，按 **回车**
5. 再打 `deepseek-harness`，按 **回车**
6. 再打 `modpack`，按 **回车**
7. 点框外面的 **Save changes**（保存）

**成功的标志**：About 区域下面出现几个**蓝色小标签**，其中一个写着 `dsh-plugin`。

> ⭐ **`dsh-plugin` 是最关键的一个。** DeepSeek Harness 官方约定插件仓库用这个标签，
> 别人就是搜这个词找插件的。少了它，你的仓库等于不存在。

> 💡 完整标签清单在 `GITHUB-COPY.md` 第 ③ 块，还有 `plugin-manager`、`cordis`、`deepseek`
> 三个可选，加了更容易被搜到。

---

## 第 6 步：发一个「版本」（Release），让别人能下载安装包

Release 就是「这个版本的可下载文件」那一栏。别人不用下源码，直接下 `.tgz` 装。

### 6.1 先准备好安装包

安装包是用 `scripts/pack.mjs` 打出来的，产物在 `dist` 文件夹里：

```
dist \ dsh-modpack-0.9.1.tgz
```

**就是这个文件，一会儿要拖到网页上。** 先记住它在哪。

> 如果你拿到的是桌面上那个 `dsh-modpack-v0.9.1` 文件夹，
> tgz 就在它的**根目录**里（`dsh-modpack-0.9.1.tgz`），直接用它。
> 注意别拖错成 `要上传到GitHub` 里的东西——那里面是给仓库看的源码，不是安装包。

### 6.2 创建 Release

1. 打开 **https://github.com/你的用户名/dsh-modpack/releases/new**
   （把 `你的用户名` 换成你自己的）

   > 或者：仓库首页右侧点 **Releases** → 再点 **Create a new release**

2. 按下面这张表填：

   | 页面上的框 | 填什么 |
   | --- | --- |
   | **Choose a tag** | 输入 `v0.9.0`，然后点下面弹出的 **Create new tag: v0.9.0 on publish** |
   | **Target** | 保持默认（一般是 `main`） |
   | **Release title** | `dsh-modpack v0.9.0` |
   | **Describe this release** | 去 `GITHUB-COPY.md` 复制第 ⑤ 块整段粘进来（长版）；嫌长就用第 ⑥ 块（短版） |

   > 两版都写好了，**直接整段复制粘贴**，不用自己写。
   > 长版会正常显示成带标题和列表的排版。

3. 页面往下滚，找到写着
   **"Attach binaries by dropping them here or select them to upload"** 的虚线框

4. 从资源管理器里把 `dsh-modpack-0.9.1.tgz` **拖进这个框**
   （拖不进去就点框里的 **select them to upload**，在弹窗里选中它）

5. 等它上传完——框里会出现一行 `dsh-modpack-0.9.1.tgz`，旁边有个小叉可以删

6. 点页面最下面的绿色按钮 **Publish release**

**成功的标志**：页面标题变成 `dsh-modpack v0.9.0`，
下面有 **Assets** 区域，里面有一行 `dsh-modpack-0.9.1.tgz` 可以点下载。

---

## 第 7 步：自己确认一遍

别急着宣传，先自己点一遍：

1. 用**手机**或者**无痕窗口**（`Ctrl + Shift + N`）打开你的仓库地址
   `https://github.com/你的用户名/dsh-modpack`
   —— 用无痕是为了确认「没登录的人也能看见」。
2. 页面应该显示 README 的内容：标题 `dsh-modpack`、一段中英双语的介绍、功能列表。
3. 点右边的 **Releases**，应该能看到 `dsh-modpack v0.9.0`，点进去能下载 tgz。

**三项都正常 = 发布成功。**

> 如果 README 没显示，只显示文件列表：说明 `README.md` 没传上去，回到第 3 步补传。

---

## 常见问题

### 0. `.gitignore` 拖不上去，或者传上去变成了 `gitignore`

点开头的文件在浏览器拖拽里经常被过滤掉，或者开头的点被吃掉 —— 变成 `gitignore` 就完全不起作用了。

解决：不要拖，用 **Add file → Create new file**，名字框里原样打 `.gitignore`，内容从本地 `要上传到GitHub\.gitignore` 复制粘贴，Commit changes。详见 **3.2.1**。
已经误传成 `gitignore` 的：点开它 → 右上角垃圾桶 → Commit changes 删掉，再按 3.2.1 重建。

### 1. 拖文件的时候浏览器把文件打开了，没有上传

说明你松手的位置不在那个虚线框里。**重新来**：先点 **Add file** → **Upload files**，
等虚线框出现了，再拖进去。

### 2. 三个文件夹（`locale` / `scripts` / `.github`）拖不上去

这是最常见的一个坎，原因通常是这三个之一：1. **仓库还是空的** —— 空仓库页面上没有 `Add file` 按钮，也没有虚线框，拖什么都没反应。
   解决：第 2 步建仓库时勾上 **Add a README file**；已经建空了的，点页面灰字里的
   **uploading an existing file** 链接进上传页。
2. **浏览器不支持拖文件夹** —— GitHub 官方文档写了可以「拖文件或文件夹」，
   但这个功能吃浏览器：Firefox 经常直接没反应，Chrome / Edge 才稳。
   解决：换 **Edge 或 Chrome** 再试。
3. **一次拖了多个文件夹** —— 往往只吃第一个，剩下的静默丢掉。
   解决：**一次只拖一个文件夹**，拖完点 Commit changes，再回来拖下一个。

三条都试了还不行，就用**第 3.3 节的挖洞法**（5 次粘贴 + 3 次拖普通文件，一定能成），
或者**第 3.4 节的 GitHub Desktop**（装一个免费软件，一次传完 44 个文件）。

> 记住：**这三个文件夹传不上去，不影响别人搜到你、也不影响别人安装。**
> 安装包 tgz 里什么都不缺。别卡在这里，先去做第 5、6 步（打标签、发 Release），发布就算完成了。

### 3. 提示 "Yowza, that's a big file!"

单个文件超过 25MB 就会这样。我们这个项目最大的文件才 200 多 KB，不该出现。
如果出现了，说明你拖错东西了（比如拖了 `dist` 里的 zip 或整个 Harness 目录）。

### 4. 传上去的中文变成乱码

网页拖拽偶尔会破坏中文编码。**解决办法**：在 GitHub 上把乱码的那个文件删掉
（点进文件 → 右上角垃圾桶 → Commit changes），然后重新拖一次。

如果反复乱码，说明是浏览器的问题，换一个浏览器（Edge / Chrome）再试。

> 用记事本复制粘贴（第 3.3 节的挖洞法）不会乱码——记事本存的是 UTF-8，
> 粘贴进 GitHub 的编辑框也是 UTF-8。

### 5. 仓库建错了名字，或者想重新来

仓库页面 → **Settings** → 拉到最下面 **Danger Zone** → **Delete this repository**，
输入仓库全名确认删除，然后从第 2 步重新开始。

### 6. 我不想公开了

同样在 **Settings** → 最下面 **Danger Zone** → 先 **Change visibility** 改成 Private，
或者直接删除。

### 7. 传上去以后又改了代码，怎么更新

点进要改的那个文件 → 右上角**铅笔图标** → 改完 → 页面最下面 **Commit changes**。

要传新文件，还是 **Add file** → **Upload files**，重复第 3 步。

### 8. 别人搜不到我的仓库

按顺序查：

1. **是 Public 吗？** Settings → 最下面能改。
2. **`dsh-plugin` 标签加了吗？** 第 5 步。
3. **等一会儿。** GitHub 的搜索索引不是实时的，新仓库通常要几分钟到几小时。
4. **确认搜索方式**：在 GitHub 顶部搜索框搜 `dsh-plugin`，然后在结果页**左侧点 Repositories**。
   或者直接打开 `https://github.com/topics/dsh-plugin` 看列表里有没有你。

### 9. 我传错了东西上去（比如含密码的文件）

**立刻**做两件事：

1. 在 GitHub 上删掉那个文件（进文件 → 右上角垃圾桶 → Commit changes）
2. **如果传的是密码或密钥，立刻去对应网站把它作废/改掉**

> GitHub 会保留历史版本，所以光删文件不够，敏感信息必须**作废**。

### 10. 仓库首页挂了个红叉（Actions 失败）

那是 `.github/workflows/ci.yml` 在跑自动测试，但它找不到 `scripts` 里的脚本。
两个办法二选一：

- 把 `scripts` 文件夹的 24 个文件补上去（第 3.3 节第二部分的第 8 行）
- 或者把 `.github/workflows/ci.yml` 删掉（进文件 → 右上角垃圾桶 → Commit changes），红叉就没了

红叉**不影响任何人安装插件**，纯粹是自动测试没跑起来。

### 11. 以后想发新版本怎么办

1. 在 GitHub 上把改过的文件更新掉（第 7 问的方法）
2. 再走一遍第 6 步，但 tag 换成 `v0.9.1`、标题换成 `dsh-modpack v0.9.1`
3. 新的 tgz 拖进 Assets

---

## 一页速查（打印出来照着点）

| 步 | 在哪 | 点什么 |
| --- | --- | --- |
| 1 | github.com | 登录 |
| 2 | github.com/new | 名字 `dsh-modpack`、Public、**勾 Add a README file**、另两个不勾、Create repository |
| 3a | 仓库首页 | Add file → **Create new file** 建 `.gitignore`（名字就 9 个字符），粘内容 → Commit；再 **Upload files** 拖剩下 **12 个文件**（不选文件夹）→ Commit changes |
| 3b | 仓库首页 | Add file → **Create new file** → 名字打 `locale/zh.json` → 粘贴内容 → Commit changes（共挖 5 个洞，见 3.3 表） |
| 3c | 各文件夹页面 | Add file → Upload files → 把该文件夹剩下的**文件**拖进去 → Commit changes（3 次） |
| **或走 3.4** | GitHub Desktop | 文件夹改名 `dsh-modpack` → 装客户端 → Sign in to GitHub.com → Add local repository → 蓝字 create a repository（README/Git ignore/License 全不勾）→ 核对 44 → Summary → Commit to main → **Publish repository**（取消勾 Keep this code private、Organization 选 None） |
| 5 | 仓库首页 About 旁 ⚙️ | Topics 加 `dsh-plugin` 回车 → Save changes |
| 6 | /releases/new | tag `v0.9.0` → 标题 → 粘贴文案 → 拖入 tgz → Publish release |
| 7 | 无痕窗口打开仓库 | 确认 README 显示、Release 能下载 |

---

## 附录：如果你以后想用一条命令（可选，现在不用看）

仓库里附带了一个脚本，它不需要装 git，直接调 GitHub 接口把文件推上去。
**只在你以后改了很多文件、懒得一个个拖的时候才用得上。**

```powershell
# 1. 进目录（在资源管理器地址栏输入 powershell 打开，就已经在这里了）
cd "你的\dsh-modpack\文件夹路径"

# 2. 找 node（桌面客户端自带了一个，不在 PATH 里）
$node = Get-ChildItem "$env:USERPROFILE\.dsh\dsh-runtimes" -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName

# 3. 设 token（GitHub → Settings → Developer settings → Tokens (classic) → 勾 repo）
$env:GITHUB_TOKEN = "ghp_你的token"

# 4. 上传
& $node scripts\publish-github.mjs

# 5. 清掉 token
Remove-Item Env:\GITHUB_TOKEN
```

**为什么不推荐一开始就用它？** 因为它需要你先去申请 Token、再记住三条命令。
鼠标拖拽虽然笨，但出错时你一眼就能看出错在哪。

---

**祝你发布顺利。** 卡在哪一步就把那一步的截图发我，我告诉你点哪儿。
