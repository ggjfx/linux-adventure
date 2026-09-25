// 判题引擎冒烟测试：node tests/judge.test.mjs
import assert from "node:assert/strict";
import {
  createAttempt, evaluateLine, normalizeLine, computeStars,
  allTasksDone, markTaskDone, verifyFileTask, verifyOutputTask,
  calcRewards, buildOutputPattern,
} from "../js/judge.js";
import { LEVELS } from "../js/levels.js";

const byId = (id) => LEVELS.find((l) => l.id === id);

// ---- 所有关卡的正则必须可编译 ----
for (const lv of LEVELS) {
  for (const t of lv.tasks) {
    const j = t.judge;
    if (j.pattern) assert.doesNotThrow(() => new RegExp(j.pattern, "m"), lv.id + "/" + t.id + " pattern");
    if (j.alsoCommand) assert.doesNotThrow(() => new RegExp(j.alsoCommand), lv.id + "/" + t.id + " alsoCommand");
  }
  for (const ep of lv.errorPatterns) {
    assert.doesNotThrow(() => new RegExp(ep.pattern), lv.id + " errorPattern");
  }
}

// ---- normalizeLine ----
assert.equal(normalizeLine("  ls -l  "), "ls -l");
assert.equal(normalizeLine("echo hi\r"), "echo hi");
assert.equal(normalizeLine(""), "");

// ---- buildOutputPattern：动态输出核对 ----
{
  const lv = byId("1-1");
  const t1 = lv.tasks.find((t) => t.id === "t1");
  assert.equal(buildOutputPattern(t1, "echo hello"), "hello");
  assert.equal(buildOutputPattern(t1, "echo 你好，世界"), "你好，世界");
  assert.equal(buildOutputPattern(t1, 'echo "hi there"'), "hi there");
  const t2 = lv.tasks.find((t) => t.id === "t2");
  assert.equal(buildOutputPattern(t2, "date"), t2.judge.pattern, "静态任务返回自身 pattern");
}

// ---- 1-1：三个任务都需要核对终端输出；裸 echo 不允许通过 ----
{
  const lv = byId("1-1");
  const a = createAttempt(lv);
  evaluateLine(a, lv, "echo hello");
  evaluateLine(a, lv, "date");
  evaluateLine(a, lv, "clear");
  assert.equal(allTasksDone(a), false, "输出类任务需核对终端输出后才能完成");

  const t1 = lv.tasks.find((t) => t.id === "t1");
  const pat1 = buildOutputPattern(t1, "echo hello");
  assert.equal(new RegExp(pat1, "m").test("echo hello\nhello\n% "), true, "输出应包含输入的话");
  assert.equal(new RegExp(pat1, "m").test("echo x\n% "), false, "输出没有输入内容则失败");
  markTaskDone(a, "t1");

  const t2 = lv.tasks.find((t) => t.id === "t2");
  assert.equal(verifyOutputTask(t2, "date\nFri Sep 25 06:22:58 UTC 2026\n% "), true, "date 输出应为时间格式");
  assert.equal(verifyOutputTask(t2, "date\n% "), false, "date 没有输出则失败");
  markTaskDone(a, "t2");

  const t3 = lv.tasks.find((t) => t.id === "t3");
  assert.equal(verifyOutputTask(t3, "clear\n\u001b[H\u001b[J% "), true, "clear 应发出清屏序列");
  assert.equal(verifyOutputTask(t3, "clear\n% "), false, "没有清屏序列则失败");
  markTaskDone(a, "t3");

  assert.equal(allTasksDone(a), true);
  assert.equal(computeStars(a, lv), 3, "3 步 + 无提示应 3 星");
  const r = calcRewards(lv, 3);
  assert.equal(r.xp, 80);
  assert.equal(r.coins, 35);
}

// ---- 1-1：裸 echo 触发教学反馈 ----
{
  const lv = byId("1-1");
  const a = createAttempt(lv);
  const r = evaluateLine(a, lv, "echo");
  assert.equal(r.events[0].type, "mistake", "裸 echo 不允许通过");
  assert.equal(a.mistakes, 1);
}

// ---- 1-1 步数过多，2 星 ----
{
  const lv = byId("1-1");
  const a = createAttempt(lv);
  for (const cmd of ["echo a", "echo b", "date", "date", "clear", "clear", "echo c"]) evaluateLine(a, lv, cmd);
  for (const t of a.tasks) markTaskDone(a, t.id);
  assert.equal(computeStars(a, lv), 2, "7 步应 2 星");
}

// ---- 1-1 使用提示后最多 2 星 ----
{
  const lv = byId("1-1");
  const a = createAttempt(lv);
  for (const cmd of ["echo hello", "date", "clear"]) evaluateLine(a, lv, cmd);
  for (const t of a.tasks) markTaskDone(a, t.id);
  a.hintsUsed = 1;
  assert.equal(computeStars(a, lv), 2, "用提示后不能 3 星");
}

// ---- 错误模式：sl 触发教学反馈 ----
{
  const lv = byId("1-1");
  const a = createAttempt(lv);
  const r = evaluateLine(a, lv, "sl");
  assert.equal(r.events[0].type, "mistake");
  assert.equal(a.mistakes, 1);
}

// ---- 中文整行输入触发公共错误 ----
{
  const lv = byId("1-2");
  const a = createAttempt(lv);
  const r = evaluateLine(a, lv, "我是谁");
  assert.equal(r.events[0].type, "mistake");
}

// ---- 1-2 output 类任务：whoami → 需输出确认 ----
{
  const lv = byId("1-2");
  const a = createAttempt(lv);
  const r = evaluateLine(a, lv, "whoami");
  assert.ok(r.events.some((e) => e.type === "needOutputCheck"));
  const task = lv.tasks.find((t) => t.id === "t1");
  assert.equal(verifyOutputTask(task, "whoami\nroot"), true, "输出含 root 应通过");
  assert.equal(verifyOutputTask(task, "whoami\n"), false, "whoami 没有输出则失败");
  markTaskDone(a, "t1");
  assert.equal(a.tasks.find((t) => t.id === "t1").done, true);
}

// ---- pwd 输出按行匹配 ----
{
  const lv = byId("1-2");
  const task = lv.tasks.find((t) => t.id === "t2");
  assert.equal(verifyOutputTask(task, "pwd\n/"), true, "^/ 应匹配输出行");
  assert.equal(verifyOutputTask(task, "pwd\nx/"), false, "行首不是 / 应失败");
}

// ---- 1-3 四个任务：全部核对终端输出 ----
{
  const lv = byId("1-3");
  const a = createAttempt(lv);
  evaluateLine(a, lv, "ls");
  evaluateLine(a, lv, "ls -l");
  evaluateLine(a, lv, "ls -a");
  const r = evaluateLine(a, lv, "cat .treasure");
  assert.ok(r.events.some((e) => e.type === "needOutputCheck"));
  assert.equal(allTasksDone(a), false, "未核对输出前不算完成");

  const t1 = lv.tasks.find((t) => t.id === "t1");
  assert.equal(verifyOutputTask(t1, "ls\napple.txt  bread.txt  milk.txt\n"), true);
  markTaskDone(a, "t1");
  const t2 = lv.tasks.find((t) => t.id === "t2");
  assert.equal(verifyOutputTask(t2, "ls -l\ntotal 2\n-rw-r--r--    1 root     root             0 Sep 25 05:49 apple.txt\n"), true);
  markTaskDone(a, "t2");
  const t3 = lv.tasks.find((t) => t.id === "t3");
  assert.equal(verifyOutputTask(t3, "ls -a\n.  ..  .treasure  apple.txt\n"), true);
  markTaskDone(a, "t3");
  const t4 = lv.tasks.find((t) => t.id === "t4");
  assert.equal(verifyOutputTask(t4, "cat .treasure\nTREASURE! You found the hidden treasure.\n"), true);
  markTaskDone(a, "t4");
  assert.equal(allTasksDone(a), true);
  assert.equal(computeStars(a, lv), 3);
}

// ---- 1-4 --help 与 history：核对真实输出 ----
{
  const lv = byId("1-4");
  const a = createAttempt(lv);
  evaluateLine(a, lv, "ls --help");
  evaluateLine(a, lv, "date --help");
  evaluateLine(a, lv, "history");
  const t1 = lv.tasks.find((t) => t.id === "t1");
  assert.equal(verifyOutputTask(t1, "ls --help\nBusyBox v1.31.1 multi-call binary.\n\nUsage: ls [-1AaCxdLHRFplinshrSXvctu]"), true);
  markTaskDone(a, "t1");
  const t2 = lv.tasks.find((t) => t.id === "t2");
  assert.equal(verifyOutputTask(t2, "date --help\nBusyBox v1.31.1 multi-call binary.\n\nUsage: date [OPTIONS]"), true);
  markTaskDone(a, "t2");
  const t3 = lv.tasks.find((t) => t.id === "t3");
  assert.equal(verifyOutputTask(t3, "history\n   1 ls --help\n   2 date --help\n"), true, "history 应列出编号历史");
  assert.equal(verifyOutputTask(t3, "history\n"), false, "没有历史列表则失败");
  markTaskDone(a, "t3");
  assert.equal(allTasksDone(a), true);
  // man 触发错误提示
  const b = createAttempt(lv);
  const rb = evaluateLine(b, lv, "man ls");
  assert.equal(rb.events[0].type, "mistake");
}

// ---- 1-5 Boss：文件核对 + 非空宣言 + 输出核对 ----
{
  const lv = byId("1-5");
  const a = createAttempt(lv);
  const evs = [];
  for (const cmd of ["mkdir camp", "touch camp/flag.txt", "echo go > camp/flag.txt", "cat camp/flag.txt", "ls -l camp"]) {
    evs.push(...evaluateLine(a, lv, cmd).events);
  }
  assert.ok(evs.some((e) => e.type === "needFileCheck" && e.taskId === "t2"), "touch 需要文件核对");
  assert.ok(evs.some((e) => e.type === "needFileCheck" && e.taskId === "t3"), "写宣言需要文件核对");

  const task2 = lv.tasks.find((t) => t.id === "t2");
  assert.equal(verifyFileTask(task2, new Uint8Array(0)), true, "touch 创建空文件即通过");
  markTaskDone(a, "t2");

  const task3 = lv.tasks.find((t) => t.id === "t3");
  assert.equal(verifyFileTask(task3, "go\n"), true);
  assert.equal(verifyFileTask(task3, ""), false, "空宣言不算数");
  assert.equal(verifyFileTask(task3, new Uint8Array(0)), false, "0 字节不算宣言");
  assert.equal(verifyFileTask(task3, null), false, "读不到文件应失败");
  markTaskDone(a, "t3");

  const t4 = lv.tasks.find((t) => t.id === "t4");
  assert.equal(verifyOutputTask(t4, "cat camp/flag.txt\ngo go\n"), true, "cat 应打印文件内容");
  assert.equal(verifyOutputTask(t4, "cat camp/flag.txt\n"), false, "cat 没有内容则失败");
  markTaskDone(a, "t4");

  const t5 = lv.tasks.find((t) => t.id === "t5");
  assert.equal(verifyOutputTask(t5, "ls -l camp\ntotal 1\n-rw-r--r--    1 root     root             6 Sep 25 05:49 flag.txt\n"), true);
  markTaskDone(a, "t5");

  assert.equal(allTasksDone(a), true, "Boss 应全部完成");
  assert.equal(computeStars(a, lv), 3, "5 步 + 无提示应 3 星");

  // 裸 echo 在 Boss 关也触发提示
  const c = createAttempt(lv);
  const rc = evaluateLine(c, lv, "echo");
  assert.equal(rc.events[0].type, "mistake");
}

// ---- 重复输入已完成任务 → alreadyDone 提示 ----
{
  const lv = byId("1-5");
  const a = createAttempt(lv);
  evaluateLine(a, lv, "mkdir camp");
  assert.equal(a.tasks.find((t) => t.id === "t1").done, true);
  const r = evaluateLine(a, lv, "mkdir camp");
  assert.equal(r.events[0].type, "alreadyDone", "重复输入应提示已完成");
  assert.equal(a.mistakes, 0, "重复输入不算失误");
}

// ---- touch 常见错误触发教学反馈 ----
{
  const lv = byId("1-5");
  const a = createAttempt(lv);
  const r1 = evaluateLine(a, lv, "touch flag.txt");
  assert.equal(r1.events[0].type, "mistake", "漏写 camp/ 应触发提示");
  const r2 = evaluateLine(a, lv, "touch camp");
  assert.equal(r2.events[0].type, "mistake", "touch 缺文件名应触发提示");
}

// ---- 未匹配输入 → unmatched 事件（前端显示提示） ----
{
  const lv = byId("1-1");
  const a = createAttempt(lv);
  const r = evaluateLine(a, lv, "totally-wrong-cmd");
  assert.equal(r.events[0].type, "unmatched");
}

// ---- 输入净化：ESC/CSI 序列过滤 ----
{
  const { filterControlBytes } = await import("../js/terminal.js");
  const te = new TextEncoder();
  const td = new TextDecoder();
  const eq = (input, expect) => assert.equal(td.decode(filterControlBytes(te.encode(input)).bytes), expect);
  eq("echo hello", "echo hello");
  eq("a\u001b[Bb", "ab");
  eq("a\u001b[200~paste\u001b[201~b", "apasteb");
  eq("中文\u001bOA测试", "中文测试");
  eq("touch camp/flag.txt", "touch camp/flag.txt");
  const s1 = filterControlBytes(te.encode("a\u001b["));
  assert.equal(td.decode(s1.bytes), "a");
  assert.equal(s1.state.s, 2);
  const s2 = filterControlBytes(te.encode("Ab"), s1.state);
  assert.equal(td.decode(s2.bytes), "b");
  assert.equal(s2.state.s, 0);
  assert.equal(td.decode(s1.bytes) + td.decode(s2.bytes), "ab");
}

console.log("✅ judge 引擎全部测试通过");
