// ============================================================
// 存档：localStorage 本地进度（MVP）
// 预留接口：setCloudSync —— 未来接入 GitHub/邮箱登录后替换为云端同步
// ============================================================

const KEY = "linux-adventure-save-v1";

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { xp: 0, coins: 0, progress: {} };
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

/** 记录一次通关；返回是否首次通关（决定是否发放 XP/金币） */
export function recordLevel(saveData, levelId, stars, steps) {
  const prev = saveData.progress[levelId];
  const firstClear = !prev || !prev.done;
  saveData.progress[levelId] = {
    done: true,
    stars: Math.max(prev ? prev.stars : 0, stars),
    bestSteps: Math.min(prev && prev.bestSteps != null ? prev.bestSteps : Infinity, steps),
    attempts: (prev ? prev.attempts : 0) + 1,
  };
  save(saveData);
  return firstClear;
}

/** 解锁规则：按 LEVELS 顺序，第 1 关默认解锁，其余需上一关通关（含跨章节） */
export function isUnlocked(saveData, levelId, levels) {
  const i = levels.findIndex((l) => l.id === levelId);
  if (i < 0) return false;
  if (i === 0) return true;
  const prev = levels[i - 1];
  return !!(saveData.progress[prev.id] && saveData.progress[prev.id].done);
}

export function starsOf(saveData, levelId) {
  const p = saveData.progress[levelId];
  return p && p.done ? p.stars : 0;
}

let cloudSync = null;

/** 未来接入云端登录后调用（例如 Supabase 的 sync 函数） */
export function setCloudSync(fn) {
  cloudSync = fn;
}
