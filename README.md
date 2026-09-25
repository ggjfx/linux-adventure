# 🐧 Linux 大冒险（Linux Adventure）

**像打游戏一样学会 Linux 命令行** —— 开源、免费、零成本。

在**真实 Linux 终端**（运行于浏览器内的 WASM 沙箱）中完成剧情任务，闯过一个个关卡，
从 `echo` 一路打到 Boss 战。**不需要安装任何东西，打开网页就能玩。**

---

## ✨ MVP 现状（v0.1）

- ✅ 第一~三章共 16 个关卡（🏕️新手村 / 🌀文件迷宫 / 🏰权限要塞，含 3 场限时 Boss 战）
- ✅ 浏览器内真实 Linux 沙箱（[v86](https://github.com/copy/v86) + Buildroot，全部资源本地化，离线可用）
- ✅ 实时判题引擎：命令判定 / 终端输出判定 / 沙箱文件状态判定（9p）
- ✅ 星级评价（步数 + 提示使用）、XP / 金币、失误反馈（幽默 + 教学）
- ✅ 3 档递进提示卡、错误诊断（打错命令会有专门提示）
- ✅ 本地存档（localStorage），进度 / 最佳步数 / 奖励持久化
- ⏳ 规划中：GitHub/邮箱登录（Supabase）、更多章节、关卡编辑器、移动端优化

## 🚀 快速开始

需要 [Node.js](https://nodejs.org)（任意 18+ 版本）：

```bash
# 1. 进入项目目录
cd linux-adventure

# 2. 启动本地服务器（零依赖）
node server.mjs

# 3. 打开浏览器访问
#    http://localhost:8080
```

> 为什么需要服务器？浏览器对本地文件（file://）限制 Web Worker/WASM 加载，
> 所以用一个 60 行的零依赖静态服务器来提供页面。也可以换成任何静态托管
> （GitHub Pages / Cloudflare Pages / nginx 等）。

## 🧪 测试

```bash
node tests/judge.test.mjs            # 判题引擎单元测试（毫秒级）
node tests/flow.test.mjs             # 全流程模拟：按真实输出逐关模拟完整游戏流程（毫秒级）
node tests/e2e.sandbox.test.mjs      # 端到端测试：真实启动沙箱 Linux 逐关跑命令（约 20~60 秒）
```

判题引擎是纯逻辑模块，全部规则都有单元测试覆盖；
端到端测试会在 Node 里真实启动 v86 + Buildroot，把 5 个关卡的命令全部实测一遍（含 9p 文件判定）。

## 📁 目录结构

```
linux-adventure/
├── index.html              # 页面骨架
├── css/style.css           # 暗色游戏主题样式
├── server.mjs              # 零依赖静态服务器
├── js/
│   ├── main.js             # 主程序：地图/关卡/判题流程/结算
│   ├── levels.js           # 关卡数据（剧情、任务、判定规则、提示、场景初始化）
│   ├── judge.js            # 判题引擎（纯逻辑，可单测）
│   ├── terminal.js         # 沙箱桥接（v86 启动、串口 I/O、9p 文件读取）
│   └── storage.js          # 存档（localStorage + 未来云端同步接口）
├── tests/
│   └── judge.test.mjs      # 判题引擎单元测试
└── vendor/                 # 第三方资源（已本地化，离线可用）
    ├── libv86.js / v86.wasm        # v86 x86 模拟器（BSD-2-Clause）
    ├── seabios.bin / vgabios.bin   # BIOS 固件
    ├── buildroot-bzimage.bin       # Buildroot Linux 内核镜像（来自 v86 项目）
    └── xterm.*                     # 终端模拟器（MIT）
```

## 🎮 怎么玩

1. 点击关卡进入，等待 Linux 沙箱启动（3~8 秒，你会看到真实的内核启动日志）；
2. 阅读剧情，按右侧任务清单在终端里敲命令；
3. 打错命令会有专门提示；卡住就点「💡 提示卡」（3 档递进，用提示不能拿 3 星）；
4. 全部任务完成即通关：步数越少星级越高；Boss 关还有 5 分钟倒计时。

## 🗺 关卡设计

每关 = 剧情 + 任务清单 + 判定规则 + 场景初始化命令，全部写在 [js/levels.js](js/levels.js)。
新增关卡只需在 `LEVELS` 数组里加一个对象（含 `setupCmds` 初始化场景、
`tasks` 判定规则、`hints` 三档提示），无需改其他代码。

判定类型：
- `command` —— 用户输入的命令行匹配正则
- `output` —— 命令匹配 + 终端输出匹配（确认命令真的执行了；`dynamicOutput` 可按输入动态核对 echo 内容）
- `file` —— 命令匹配 + 沙箱内文件状态确认（存在性 / 内容 / 非空 / 应已删除，通过 9p 目录树与内容读取）

## 🌐 部署到 GitHub Pages（零成本上线）

1. 在 GitHub 新建仓库，把本目录内容推上去；
2. Settings → Pages → 选择 `main` 分支根目录 → Save；
3. 打开 `https://<你的用户名>.github.io/<仓库名>/` 即可玩。

所有资源都是相对路径且已本地化，Pages 直接可用，不需要任何付费服务。

## 📜 许可与致谢

- 本项目代码：MIT
- [v86](https://github.com/copy/v86)：BSD-2-Clause（x86 PC 模拟器）
- Buildroot 镜像：来自 v86 项目的演示镜像（GPLv2 内核 + busybox）
- [xterm.js](https://xtermjs.org/)：MIT

## 🗺 路线图

- [ ] GitHub / 邮箱登录（Supabase 免费版）与云端存档
- [ ] 第二章「文件迷宫」~ 第十章「终极远征」（关卡数据 + 预装软件镜像）
- [ ] 金币道具系统（护盾/罗盘）、成就徽章、每日挑战
- [ ] 关卡编辑器与社区共建（Pull Request 贡献关卡）
- [ ] 移动端键盘适配
