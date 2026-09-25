// ============================================================
// 判题引擎（纯逻辑：无 DOM、无网络依赖，可在 Node 中单测）
// ============================================================

/** 创建一次闯关尝试的状态 */
export function createAttempt(level) {
  return {
    levelId: level.id,
    tasks: level.tasks.map((t) => ({ id: t.id, done: false, hintLevel: 0 })),
    steps: 0,
    mistakes: 0,
    hintsUsed: 0,
    startedAt: Date.now(),
    finishedAt: null,
    starLevel: 0,
    completed: false,
    events: [],
  };
}

/** 规范化用户输入的一行命令（去掉回车/多余空白） */
export function normalizeLine(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/\r/g, "");
  const i = s.indexOf("\n");
  if (i >= 0) s = s.slice(0, i);
  return s.replace(/^\s+/, "").replace(/\s+$/, "");
}

function testPattern(pattern, text) {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

/**
 * 评估一行用户命令，返回本次产生的事件。
 * 事件类型：
 *   taskDone        —— 某任务完成
 *   needFileCheck   —— 命令对了，还需沙箱文件状态确认（file 类任务）
 *   needOutputCheck —— 命令对了，还需终端输出确认（output 类任务）
 *   mistake         —— 命中已知错误模式，附教学反馈
 *   unmatched       —— 未匹配任何任务与错误模式
 */
export function evaluateLine(attempt, level, rawLine) {
  const line = normalizeLine(rawLine);
  const events = [];
  if (!line) return { line, empty: true, events };

  attempt.steps += 1;
  let matched = false;
  let alreadyDone = false;

  for (const at of attempt.tasks) {
    const task = level.tasks.find((x) => x.id === at.id);
    const j = task.judge;
    const cmdPattern = j.type === "command" ? j.pattern : j.alsoCommand;
    if (!cmdPattern || !testPattern(cmdPattern, line)) continue;
    if (at.done) {
      alreadyDone = true; // 这条命令对应的任务已完成，继续看别的任务
      continue;
    }
    if (j.type === "command") {
      at.done = true;
      matched = true;
      events.push({ type: "taskDone", taskId: at.id, desc: task.desc });
    } else if (j.type === "file") {
      matched = true;
      events.push({ type: "needFileCheck", taskId: at.id, task });
    } else if (j.type === "output") {
      matched = true;
      events.push({ type: "needOutputCheck", taskId: at.id, task });
    }
  }

  if (!matched && alreadyDone) {
    events.push({ type: "alreadyDone", line });
  } else if (!matched) {
    for (const ep of level.errorPatterns || []) {
      if (testPattern(ep.pattern, line)) {
        attempt.mistakes += 1;
        events.push({ type: "mistake", message: ep.message, line });
        break;
      }
    }
    if (!events.length) {
      events.push({ type: "unmatched", line });
    }
  }

  attempt.events = events;
  return { line, events };
}

/** 全部任务完成？ */
export function allTasksDone(attempt) {
  return attempt.tasks.every((t) => t.done);
}

/** 手动标记任务完成（file/output 类任务的二次确认） */
export function markTaskDone(attempt, taskId) {
  const t = attempt.tasks.find((x) => x.id === taskId);
  if (t) t.done = true;
}

/** 文件判定：content 为 null 表示读不到；contains 校验内容；nonEmpty 要求非空 */
export function verifyFileTask(task, content) {
  const j = task.judge;
  if (j.type !== "file") return false;
  if (content == null) return false;
  if (j.contains != null) {
    let s = content;
    if (typeof TextDecoder !== "undefined" && content instanceof Uint8Array) {
      s = new TextDecoder().decode(content);
    }
    return String(s).includes(j.contains);
  }
  if (j.nonEmpty) {
    const len = content instanceof Uint8Array ? content.length : String(content).length;
    if (len === 0) return false;
  }
  return true;
}

/**
 * 为动态输出判定生成正则（echo 类任务）：
 * 提取命令参数作为期望输出，验证终端真的打印了用户输入的内容。
 * 静态任务直接返回 judge.pattern。
 */
export function buildOutputPattern(task, line) {
  const j = task.judge;
  if (j.dynamicOutput) {
    let args = normalizeLine(line).replace(/^echo\s+/, "").trim();
    if (args.length >= 2 && ((args.startsWith('"') && args.endsWith('"')) || (args.startsWith("'") && args.endsWith("'")))) {
      args = args.slice(1, -1);
    }
    return args.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return j.pattern;
}

/** 输出判定（多行模式：pattern 中的 ^ 匹配每一行的行首） */
export function verifyOutputTask(task, text) {
  const j = task.judge;
  if (j.type !== "output") return false;
  try {
    return new RegExp(j.pattern, "m").test(text);
  } catch {
    return false;
  }
}

/** 星级：1=完成任务 2=步数达标 3=步数达标且未用提示 */
export function computeStars(attempt, level) {
  if (attempt.tasks.some((t) => !t.done)) return 0;
  let stars = 1;
  const rules = level.starRules || {};
  if (rules.two && attempt.steps <= rules.two.maxSteps) stars = 2;
  if (rules.three && attempt.steps <= rules.three.maxSteps && attempt.hintsUsed === 0) stars = 3;
  return stars;
}

/** 通关奖励：XP 与金币（游戏内虚拟货币） */
export function calcRewards(level, stars) {
  return {
    xp: (level.xp || 50) + stars * 10,
    coins: (level.coins || 20) + stars * 5,
  };
}
