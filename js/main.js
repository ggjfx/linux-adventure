// ============================================================
// Linux 大冒险 · 主程序（地图 / 关卡 / 教学 / 判题 / 结算）
// ============================================================

import { CHAPTERS, LEVELS } from "./levels.js";
import { Sandbox } from "./terminal.js";
import {
  createAttempt, evaluateLine, normalizeLine, computeStars, allTasksDone,
  calcRewards, markTaskDone, verifyFileTask, buildOutputPattern,
} from "./judge.js";
import * as storage from "./storage.js";

const S = {
  save: storage.load(),
  term: null,
  fit: null,
  sandbox: null,
  level: null,
  attempt: null,
  lineBuf: "",
  lineStart: null,
  outWindow: "",
  winStart: 0,
  pendingOutput: [],
  bossTimer: null,
  bossLeft: 0,
  bubbleTimer: null,
  tipsTimer: null,
  setupDone: false,
  finished: false,
  teaching: false,
  taught: {},
  destroyed: false,
};

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function showToast(msg, ms = 2600) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), ms);
}

function showBubble(msg, ms = 8000) {
  const b = $("#bubble");
  if (!b) return;
  b.innerHTML = msg;
  b.classList.add("show");
  clearTimeout(S.bubbleTimer);
  S.bubbleTimer = setTimeout(() => b.classList.remove("show"), ms);
}

// ---------------- 顶栏 ----------------
function renderStats() {
  $("#stat-xp").textContent = "⚡ " + S.save.xp + " XP";
  $("#stat-coins").textContent = "🪙 " + S.save.coins;
}

// ---------------- 路由 ----------------
window.addEventListener("hashchange", route);
function route() {
  const m = /^#\/level\/([\d-]+)/.exec(location.hash || "");
  if (m) showLevel(m[1]);
  else showMap();
}

function teardownLevel() {
  S.destroyed = true;
  if (S.bossTimer) { clearInterval(S.bossTimer); S.bossTimer = null; }
  if (S.bubbleTimer) clearTimeout(S.bubbleTimer);
  if (S.tipsTimer) clearInterval(S.tipsTimer);
  if (S.sandbox) { S.sandbox.destroy(); S.sandbox = null; }
  if (S.fit) { window.removeEventListener("resize", onResize); S.fit = null; }
  if (S.term) { try { S.term.dispose(); } catch {} S.term = null; }
  S.level = null;
  S.attempt = null;
  S.pendingOutput = [];
  S.lineStart = null;
  S.finished = false;
  S.setupDone = false;
  S.teaching = false;
  S.taught = {};
  S.skipAllTeach = false;
  S.destroyed = false;
}

// ---------------- 地图 ----------------
function showMap() {
  teardownLevel();
  const main = $("#main");
  main.innerHTML = "";

  for (const ch of CHAPTERS) {
    const chLevels = LEVELS.filter((l) => l.chapter === ch.id);
    if (!chLevels.length) continue;
    const chUnlocked = storage.isUnlocked(S.save, chLevels[0].id, LEVELS);

    const banner = el("section", "chapter-banner" + (chUnlocked ? "" : " locked"));
    banner.innerHTML = `
      <div class="chapter-emoji">${chUnlocked ? ch.emoji : "🔒"}</div>
      <div>
        <h1>${ch.id} · ${ch.name}</h1>
        <p class="chapter-sub">${ch.subtitle}</p>
        <p class="chapter-blurb">${chUnlocked ? ch.blurb : "完成上一章全部关卡后解锁"}</p>
      </div>`;
    main.appendChild(banner);

    const list = el("div", "level-list");
    for (const lv of chLevels) {
      const unlocked = storage.isUnlocked(S.save, lv.id, LEVELS);
      const stars = storage.starsOf(S.save, lv.id);
      const best = S.save.progress[lv.id] && S.save.progress[lv.id].bestSteps;
      const node = el("button", "level-node" + (unlocked ? "" : " locked") + (lv.timeLimit ? " boss" : ""));
      node.innerHTML = `
        <div class="node-icon">${unlocked ? lv.icon : "🔒"}</div>
        <div class="node-info">
          <div class="node-title">${lv.id} · ${lv.title}${lv.timeLimit ? " ⚔️" : ""}</div>
          <div class="node-sub">${unlocked ? lv.subtitle : "完成上一关解锁"}</div>
        </div>
        <div class="node-stars">${"★".repeat(stars)}<span class="star-off">${"★".repeat(3 - stars)}</span></div>
        <div class="node-best">${best != null ? "最佳 " + best + " 步" : ""}</div>`;
      if (unlocked) node.onclick = () => { location.hash = "#/level/" + lv.id; };
      list.appendChild(node);
    }
    main.appendChild(list);
  }

  const tip = el("p", "map-tip");
  tip.innerHTML = "💡 每一关都是<b>先教学、后实战</b>：教学卡片教你怎么用命令，然后你再亲手敲出来。加油，冒险者！";
  main.appendChild(tip);
}

// ---------------- 关卡 ----------------
function showLevel(id) {
  const lv = LEVELS.find((l) => l.id === id);
  if (!lv) { location.hash = ""; return; }
  if (!storage.isUnlocked(S.save, id, LEVELS)) { showMap(); return; }
  teardownLevel();

  S.level = lv;
  S.attempt = createAttempt(lv);
  S.lineBuf = "";
  S.lineStart = null;
  S.outWindow = "";
  S.winStart = 0;
  S.pendingOutput = [];
  S.finished = false;
  S.setupDone = false;
  S.teaching = false;
  S.taught = {};
  S.skipAllTeach = false;
  S.isReplay = !!(S.save.progress[id] && S.save.progress[id].done);

  const main = $("#main");
  main.innerHTML = `
    <div class="level-head">
      <button class="btn ghost" id="btn-back">← 地图</button>
      <div class="level-title">${lv.icon} ${lv.id} · ${lv.title}</div>
      <div class="level-meta">
        <span id="level-steps">步数 0</span>
        <span id="level-timer" ${lv.timeLimit ? "" : "style='display:none'"}>⏱ 05:00</span>
      </div>
    </div>
    <div class="level-body">
      <div class="left-col">
        <div class="panel story-panel">
          <div class="panel-title">📜 剧情</div>
          <div id="story-text"></div>
        </div>
        <div class="panel terminal-panel">
          <div class="panel-title">🖥 终端 · 真实 Linux 沙箱</div>
          <div class="terminal-wrap">
            <div id="terminal"></div>
            <div id="boot-overlay">
              <div class="boot-spinner"></div>
              <div id="boot-status">正在准备沙箱…</div>
              <div id="boot-tip" class="boot-tip"></div>
            </div>
          </div>
          <div id="bubble" class="bubble"></div>
          <div class="term-actions">
            <button class="btn ghost" id="btn-teach">📖 教学</button>
            <button class="btn" id="btn-hint">💡 提示卡</button>
            <button class="btn ghost" id="btn-restart">🔄 重新开始</button>
          </div>
        </div>
      </div>
      <div class="right-col">
        <div class="panel tasks-panel">
          <div class="panel-title">🎯 任务清单</div>
          <ul id="task-list"></ul>
        </div>
        <div class="panel reward-panel">
          <div class="panel-title">🏆 通关奖励</div>
          <p>⚡ ${lv.xp}~${lv.xp + 30} XP · 🪙 ${lv.coins}~${lv.coins + 15} 金币</p>
          <p class="reward-note">星星越多奖励越高；首次通关发放奖励</p>
        </div>
      </div>
    </div>
    <div id="teach-overlay" class="overlay hidden">
      <div class="teach-card">
        <div class="teach-tag">📖 教学 · 学会了再动手</div>
        <div class="teach-cmd"><span id="teach-cmd"></span> <span id="teach-cmdzh" class="teach-cmdzh"></span></div>
        <div class="teach-what" id="teach-what"></div>
        <div class="teach-block">
          <div class="teach-label">语法</div>
          <div class="code" id="teach-syntax"></div>
        </div>
        <div class="teach-block">
          <div class="teach-label">示例</div>
          <div class="code" id="teach-example"></div>
          <div class="code out" id="teach-out"></div>
        </div>
        <div class="teach-tip" id="teach-tip"></div>
        <div class="teach-btns">
          <button class="btn" id="btn-teach-start">💪 我学会了，开始挑战</button>
          <button class="btn ghost" id="btn-teach-skip">⏭ 跳过教学</button>
        </div>
      </div>
    </div>
    <div id="result-overlay" class="overlay hidden">
      <div class="result-card">
        <div id="result-emoji" class="result-emoji"></div>
        <h2 id="result-title"></h2>
        <div id="result-stars" class="result-stars"></div>
        <p id="result-detail"></p>
        <div class="result-btns">
          <button class="btn" id="btn-next">▶ 下一关</button>
          <button class="btn ghost" id="btn-replay">🔄 再玩一次</button>
          <button class="btn ghost" id="btn-back-map">🗺 返回地图</button>
        </div>
      </div>
    </div>`;

  $("#btn-back").onclick = () => { location.hash = ""; };
  $("#btn-restart").onclick = () => showLevel(lv.id);
  $("#btn-hint").onclick = giveHint;
  $("#btn-teach").onclick = () => showTeachForCurrent(true);
  $("#btn-teach-start").onclick = hideTeach;
  $("#btn-teach-skip").onclick = () => { S.skipAllTeach = true; hideTeach(); };
  $("#btn-back-map").onclick = () => { location.hash = ""; };
  $("#btn-replay").onclick = () => showLevel(lv.id);
  $("#btn-next").onclick = () => {
    const n = nextLevelId(lv.id);
    if (n) location.hash = "#/level/" + n;
  };

  const storyEl = $("#story-text");
  lv.story.forEach((line, i) => {
    const p = el("p", "story-line");
    storyEl.appendChild(p);
    setTimeout(() => {
      p.textContent = line;
      p.classList.add("shown");
    }, 400 + i * 1100);
  });

  renderTasks();
  renderSteps();
  bootTerminal();
}

function nextLevelId(id) {
  const m = /^(\d+)-(\d+)$/.exec(id);
  if (!m) return null;
  const n = LEVELS.find((l) => l.id === m[1] + "-" + (Number(m[2]) + 1));
  return n ? n.id : null;
}

function renderTasks() {
  const ul = $("#task-list");
  if (!ul) return;
  ul.innerHTML = "";
  for (const at of S.attempt.tasks) {
    const task = S.level.tasks.find((x) => x.id === at.id);
    const li = el("li", "task" + (at.done ? " done" : ""));
    li.innerHTML = `
      <span class="task-check">${at.done ? "✅" : "⬜"}</span>
      <span class="task-desc">${task.desc}</span>
      <span class="task-hint-note">${at.done ? "" : "💡×" + task.hints.length}</span>`;
    ul.appendChild(li);
  }
}

function renderSteps() {
  const elx = $("#level-steps");
  if (!elx || !S.attempt) return;
  let txt = "步数 " + S.attempt.steps;
  if (S.attempt.mistakes > 0) txt += " · 失误 " + S.attempt.mistakes;
  if (S.attempt.hintsUsed > 0) txt += " · 提示 " + S.attempt.hintsUsed;
  elx.textContent = txt;
}

// ---------------- 教学卡片（先教后练） ----------------
function currentTask() {
  if (!S.attempt) return null;
  const at = S.attempt.tasks.find((t) => !t.done);
  if (!at) return null;
  return S.level.tasks.find((x) => x.id === at.id);
}

function showTeachForCurrent(force = false) {
  if (!S.attempt || S.finished) return;
  const task = currentTask();
  if (!task) return;
  if (!force && S.skipAllTeach) return;
  if (!force && S.taught[task.id]) return;
  S.taught[task.id] = true;
  S.teaching = true;
  // Boss 计时在教学期间暂停
  if (S.level.timeLimit && S.bossTimer) {
    clearInterval(S.bossTimer);
    S.bossTimer = null;
  }
  const t = task.teach || {};
  $("#teach-cmd").textContent = t.cmd || "";
  $("#teach-cmdzh").textContent = t.cmdZh ? "· " + t.cmdZh : "";
  $("#teach-what").textContent = t.what || "";
  $("#teach-syntax").textContent = t.syntax || "";
  $("#teach-example").textContent = t.example || "";
  $("#teach-out").textContent = t.exampleOut || "";
  $("#teach-out").style.display = t.exampleOut ? "" : "none";
  $("#teach-tip").textContent = "💡 " + (t.tip || "");
  $("#btn-teach-skip").style.display = S.isReplay ? "" : "none";
  $("#teach-overlay").classList.remove("hidden");
  $("#btn-teach-start").focus();
}

function hideTeach() {
  S.teaching = false;
  $("#teach-overlay").classList.add("hidden");
  // Boss 计时从剩余时间继续
  if (S.level.timeLimit && !S.finished && !S.bossTimer) {
    startBossTimer(S.bossLeft);
  }
  if (S.term) {
    try { S.term.scrollToBottom(); } catch {}
    try {
      S.term.focus({ preventScroll: true }); // 聚焦但不让浏览器跳动页面
    } catch {
      S.term.focus();
    }
  }
  // 若终端不在可视区内，最小幅度滚动到可见
  const tel = $("#terminal");
  if (tel && tel.scrollIntoView) {
    try { tel.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch {}
  }
}

// ---------------- 终端与沙箱 ----------------
function bootTerminal() {
  S.term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontSize: 14,
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    scrollback: 3000,
    theme: {
      background: "#0b0f14",
      foreground: "#3ddc6a",
      cursor: "#3ddc6a",
      selectionBackground: "#1e3a2a",
    },
  });
  S.fit = new FitAddon.FitAddon();
  S.term.loadAddon(S.fit);
  S.term.open($("#terminal"));
  try { S.fit.fit(); } catch {}
  window.addEventListener("resize", onResize);

  S.term.onData((d) => {
    if (!S.setupDone || S.finished || S.teaching) return;
    try { S.term.scrollToBottom(); } catch {} // 用户开始打字时，强制把输入行拉回视野
    S.sandbox.sendUtf8(d);
    trackInput(d);
  });

  S.sandbox = new Sandbox({
    onStatus: (s) => {
      const elx = $("#boot-status");
      if (elx) elx.textContent = s;
    },
    onOutput: onGuestOutput,
    onBooted: async () => {
      const st = $("#boot-status");
      if (st) st.textContent = "正在布置关卡场景…";
      S.sandbox.prepareShell();
      await S.sandbox.detectFileApi();
      await runSetup();
      hideBootOverlay();
      S.setupDone = true;
      if (S.level.timeLimit) startBossTimer(); // Boss 计时从沙箱就绪才开始
      showTeachForCurrent(); // 所有关卡（含 Boss）都先教后练；教学期间 Boss 计时暂停
    },
    onBootError: (msg) => {
      const ov = $("#boot-overlay");
      if (ov) ov.innerHTML = '<div class="boot-error">😵 ' + msg + '</div><div class="boot-error-sub">请刷新页面（F5）重试</div>';
    },
  });
  S.sandbox.boot();
  startBootTips();
}

function onResize() {
  if (S.fit && S.term) {
    try { S.fit.fit(); } catch {}
  }
}

function hideBootOverlay() {
  const ov = $("#boot-overlay");
  if (!ov) return;
  ov.classList.add("gone");
  setTimeout(() => ov.remove(), 600);
}

async function runSetup() {
  for (const cmd of S.level.setupCmds || []) {
    S.sandbox.runShell(cmd);
    await sleep(300);
  }
  S.sandbox.runShell("");
}

const BOOT_TIPS = [
  "🐧 小知识：Linux 的吉祥物企鹅叫 Tux",
  "⌨️ 输入命令后按回车（Enter）执行",
  "📖 每关都有教学卡片：先学命令，再亲手敲一遍",
  "🧭 卡住了？点击「💡 提示卡」",
  "💾 终端里的内容就是真实的 Linux，随便探索",
  "⭐ 步数越少、不用提示，星级越高",
];

function startBootTips() {
  let i = 0;
  const elx = $("#boot-tip");
  if (elx) elx.textContent = BOOT_TIPS[0];
  S.tipsTimer = setInterval(() => {
    i = (i + 1) % BOOT_TIPS.length;
    if (elx) elx.textContent = BOOT_TIPS[i];
  }, 4000);
}

function onGuestOutput(text) {
  S.outWindow = (S.outWindow + text);
  if (S.outWindow.length > 6000) {
    const cut = S.outWindow.length - 6000;
    S.outWindow = S.outWindow.slice(-6000);
    S.winStart += cut;
  }
  if (S.term) S.term.write(text);

  for (const p of S.pendingOutput.slice()) {
    const start = Math.max(0, p.from - S.winStart);
    const slice = S.outWindow.slice(start);
    let ok = false;
    try { ok = new RegExp(p.pattern, "m").test(slice); } catch {}
    if (ok) {
      S.pendingOutput = S.pendingOutput.filter((x) => x !== p);
      completeTask(p.taskId, p.task.desc);
    } else if (Date.now() > p.deadline) {
      S.pendingOutput = S.pendingOutput.filter((x) => x !== p);
      showBubble(p.task.judge.dynamicOutput
        ? "💬 没在终端输出里看到你说的话，试试：<code>" + (p.task.teach ? p.task.teach.example : "echo 你好") + "</code>"
        : "💬 还没检测到预期输出，检查命令是否拼对（可点「💡 提示卡」）");
    }
  }
}

// ---------------- 输入捕获与判题 ----------------
function trackInput(d) {
  for (const ch of d) {
    const code = ch.charCodeAt(0);
    if (ch === "\r" || ch === "\n") {
      submitLine();
    } else if (code === 127) {
      S.lineBuf = S.lineBuf.slice(0, -1);
      if (!S.lineBuf) S.lineStart = null;
    } else if (code === 3) {
      S.lineBuf = "";
      S.lineStart = null;
    } else if (code >= 32 || code === 9) {
      if (!S.lineBuf) S.lineStart = S.outWindow.length + S.winStart; // 记录整行回显的起点
      S.lineBuf += ch; // 忽略 ESC 等控制字符，避免污染命令判定
    }
  }
}

function submitLine() {
  const line = normalizeLine(S.lineBuf);
  S.lineBuf = "";
  // 判题窗口从「这行开始输入」起算：命令回显（history、cat 等）出现在回车之前
  const absSubmit = S.lineStart != null ? S.lineStart : S.outWindow.length + S.winStart;
  S.lineStart = null;
  if (!line || S.finished) return;
  const r = evaluateLine(S.attempt, S.level, line);
  renderSteps();
  for (const ev of r.events) {
    if (ev.type === "taskDone") {
      completeTask(ev.taskId, ev.desc);
    } else if (ev.type === "needOutputCheck") {
      S.pendingOutput.push({
        taskId: ev.taskId,
        task: ev.task,
        from: absSubmit,
        deadline: Date.now() + 4000,
        pattern: buildOutputPattern(ev.task, line),
      });
    } else if (ev.type === "needFileCheck") {
      pushFileCheck(ev);
    } else if (ev.type === "mistake") {
      showBubble("💬 " + ev.message);
      renderSteps();
    } else if (ev.type === "alreadyDone") {
      showBubble("✅ 这个任务已经完成了，继续下一个任务吧");
    } else if (ev.type === "unmatched") {
      showToast("💭 没匹配到任务目标：检查命令拼写，或点「💡 提示卡」", 2800);
    }
  }
  maybeFinish();
}

async function pushFileCheck(ev) {
  const task = ev.task;
  const j = task.judge;
  if (!S.sandbox.fileApiAvailable) {
    completeTask(ev.taskId, task.desc);
    return;
  }
  // 存在性检查（touch 空文件 / 已删除）：查 9p 目录树（空文件也可靠，read_file 对空文件会 reject）
  const onlyExists = j.contains == null && !j.nonEmpty;
  let useTree = onlyExists || j.absent;
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline && !S.finished) {
    await sleep(200);
    if (useTree) {
      const ex = S.sandbox.fileExists(j.path);
      if (j.absent ? ex === false : ex === true) {
        completeTask(ev.taskId, task.desc);
        return;
      }
      if (ex === null) useTree = false; // 目录树不可用 → 退回内容读取
    } else if (j.absent) {
      // 降级：读不到内容即视为已删除
      const content = await S.sandbox.readFile(j.path);
      if (content == null) {
        completeTask(ev.taskId, task.desc);
        return;
      }
    } else {
      const content = await S.sandbox.readFile(j.path);
      if (verifyFileTask(task, content)) {
        completeTask(ev.taskId, task.desc);
        return;
      }
    }
  }
  failFileCheck(task);
}

/** 文件核对失败：根据终端最近的报错给出针对性提示 */
function failFileCheck(task) {
  const tail = S.outWindow.slice(-800);
  if (/No such file or directory/.test(tail)) {
    showBubble("⚠️ 终端报错：目录或文件不存在。确认你在营地目录（cd /mnt/adv）且已创建 camp，再执行：<code>" + (task.teach ? task.teach.example : "") + "</code>");
  } else if (/Permission denied/.test(tail)) {
    showBubble("⚠️ 终端报错：权限不足。重试：<code>" + (task.teach ? task.teach.example : "") + "</code>");
  } else {
    showBubble("💬 文件核对没通过：确认命令在营地目录下执行了。试试：<code>" + (task.teach ? task.teach.example : "") + "</code>");
  }
}

function completeTask(taskId, desc) {
  markTaskDone(S.attempt, taskId);
  renderTasks();
  showToast("✅ 任务完成：" + desc, 2200);
  maybeFinish();
  if (!S.finished) showTeachForCurrent(); // 完成一个任务后，先教下一个
}

function maybeFinish() {
  if (S.finished) return;
  if (allTasksDone(S.attempt)) finishLevel();
}

// ---------------- 结算 ----------------
function finishLevel() {
  S.finished = true;
  S.teaching = false;
  $("#teach-overlay").classList.add("hidden");
  if (S.bossTimer) { clearInterval(S.bossTimer); S.bossTimer = null; }
  S.attempt.finishedAt = Date.now();
  const stars = computeStars(S.attempt, S.level);
  const r = calcRewards(S.level, stars);
  const first = storage.recordLevel(S.save, S.level.id, stars, S.attempt.steps);
  if (first) {
    S.save.xp += r.xp;
    S.save.coins += r.coins;
    storage.save(S.save);
  }
  renderStats();

  $("#result-stars").innerHTML = "★".repeat(stars) + '<span class="star-off">' + "★".repeat(3 - stars) + "</span>";
  $("#result-emoji").textContent = stars === 3 ? "🏆" : stars === 2 ? "🎉" : "✅";
  $("#result-title").textContent = S.level.timeLimit ? "Boss 击败！" : "关卡通过！";
  $("#result-detail").innerHTML =
    "步数 <b>" + S.attempt.steps + "</b> · 失误 <b>" + S.attempt.mistakes + "</b>" +
    (first ? "<br>获得 ⚡" + r.xp + " XP · 🪙" + r.coins + " 金币" : "<br>重玩通关：奖励已在首次通关时领取");
  const n = nextLevelId(S.level.id);
  $("#btn-next").style.display = n ? "" : "none";
  $("#result-overlay").classList.remove("hidden");
}

function failLevel(msg) {
  S.finished = true;
  if (S.bossTimer) { clearInterval(S.bossTimer); S.bossTimer = null; }
  $("#result-emoji").textContent = "💀";
  $("#result-title").textContent = "挑战失败";
  $("#result-stars").innerHTML = "";
  $("#result-detail").textContent = msg;
  $("#btn-next").style.display = "none";
  $("#result-overlay").classList.remove("hidden");
}

// ---------------- Boss 计时 ----------------
function startBossTimer(seconds) {
  if (!S.level.timeLimit) return;
  S.bossLeft = seconds != null ? seconds : S.level.timeLimit;
  updateTimer();
  S.bossTimer = setInterval(() => {
    if (S.finished) return;
    S.bossLeft -= 1;
    updateTimer();
    if (S.bossLeft <= 0) {
      clearInterval(S.bossTimer);
      S.bossTimer = null;
      failLevel("⏱ 时间到！Boss 逃走了，点击「再玩一次」重新挑战");
    }
  }, 1000);
}

function updateTimer() {
  const elx = $("#level-timer");
  if (!elx) return;
  const mm = String(Math.floor(S.bossLeft / 60)).padStart(2, "0");
  const ss = String(S.bossLeft % 60).padStart(2, "0");
  elx.textContent = "⏱ " + mm + ":" + ss;
  if (S.bossLeft <= 30) elx.classList.add("danger");
}

// ---------------- 提示 ----------------
function giveHint() {
  if (!S.attempt || S.finished) return;
  const at = S.attempt.tasks.find((t) => !t.done);
  if (!at) return;
  const task = S.level.tasks.find((x) => x.id === at.id);
  if (at.hintLevel >= task.hints.length) {
    showBubble("💡 最后一档提示就是标准答案啦：<code>" + task.hints[task.hints.length - 1] + "</code>");
    return;
  }
  const h = task.hints[at.hintLevel];
  at.hintLevel += 1;
  S.attempt.hintsUsed += 1;
  const tier = at.hintLevel === task.hints.length ? "（最终答案）" : "（第 " + at.hintLevel + " / " + task.hints.length + " 档）";
  showBubble("💡 提示" + tier + "：" + h);
  renderSteps();
}

// ---------------- 启动 ----------------
renderStats();
route();
