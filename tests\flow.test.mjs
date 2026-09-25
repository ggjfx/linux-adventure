// ============================================================
// 全流程模拟测试：按真实沙箱输出逐关模拟完整游戏流程
// （输入 → 判题 → 终端输出核对 → 文件核对 → 通关星级）
// 输出样本与 e2e/探测的实测结果一致
// 运行：node tests/flow.test.mjs
// ============================================================

import assert from "node:assert/strict";
import {
  createAttempt, evaluateLine, allTasksDone, computeStars,
  markTaskDone, verifyFileTask, buildOutputPattern,
} from "../js/judge.js";
import { LEVELS } from "../js/levels.js";

const te = new TextEncoder();

/** 关卡步骤：cmd=用户输入 out=真实终端输出 files=执行后沙箱文件状态（absent 任务不在此列） */
const SCENARIOS = {
  "1-1": {
    files: {},
    steps: [
      { cmd: "echo hello", out: "echo hello\nhello\n% " },
      { cmd: "date", out: "date\nFri Sep 25 05:50:51 UTC 2026\n% " },
      { cmd: "clear", out: "clear\n\u001b[H\u001b[J% " },
    ],
  },
  "1-2": {
    files: {},
    steps: [
      { cmd: "whoami", out: "whoami\nroot\n% " },
      { cmd: "pwd", out: "pwd\n/\n% " },
      { cmd: "hostname", out: "hostname\n(none)\n% " },
    ],
  },
  "1-3": {
    files: {},
    steps: [
      { cmd: "ls", out: "ls\napple.txt  bread.txt  milk.txt\nwarehouse% " },
      { cmd: "ls -l", out: "ls -l\ntotal 2\n-rw-r--r--    1 root     root             0 Sep 25 05:50 apple.txt\nwarehouse% " },
      { cmd: "ls -a", out: "ls -a\n.  ..  .treasure  apple.txt  bread.txt  milk.txt\nwarehouse% " },
      { cmd: "cat .treasure", out: "cat .treasure\nTREASURE! 龙之金币：你找到了隐藏的宝藏。\nwarehouse% " },
    ],
  },
  "1-4": {
    files: {},
    steps: [
      { cmd: "ls --help", out: "ls --help\nBusyBox v1.31.1 multi-call binary.\n\nUsage: ls [-1AaCxdLHRFplinshrSXvctu]\n% " },
      { cmd: "date --help", out: "date --help\nBusyBox v1.31.1 multi-call binary.\n\nUsage: date [OPTIONS] [+FMT] [TIME]\n% " },
      { cmd: "history", out: "history\n   0 ho __LA_BOOT__\n   1 ls --help\n   2 date --help\n% " },
    ],
  },
  "1-5": {
    files: { "adv/camp/flag.txt": te.encode("go go\n") },
    steps: [
      { cmd: "mkdir camp", out: "mkdir camp\nadv% " },
      { cmd: "touch camp/flag.txt", out: "touch camp/flag.txt\nadv% " },
      { cmd: "echo go > camp/flag.txt", out: "echo go > camp/flag.txt\nadv% " },
      { cmd: "cat camp/flag.txt", out: "cat camp/flag.txt\ngo go\nadv% " },
      { cmd: "ls -l camp", out: "ls -l camp\ntotal 1\n-rw-r--r--    1 root     root             6 Sep 25 05:50 flag.txt\nadv% " },
    ],
  },
  "2-1": {
    files: {},
    steps: [
      { cmd: "cd room-a", out: "cd room-a\nmaze% " },
      { cmd: "cd ..", out: "cd ..\nmaze% " },
      { cmd: "cd /mnt/adv/maze/room-b", out: "cd /mnt/adv/maze/room-b\nmaze% " },
      { cmd: "pwd", out: "pwd\n/mnt/adv/maze/room-b\nmaze% " },
    ],
  },
  "2-2": {
    files: { "adv/build/workshop": "", "adv/build/workshop/plan.txt": "" },
    steps: [
      { cmd: "mkdir workshop", out: "mkdir workshop\nbuild% " },
      { cmd: "touch workshop/plan.txt", out: "touch workshop/plan.txt\nbuild% " },
      { cmd: "rmdir old_hut", out: "rmdir old_hut\nbuild% " },
      { cmd: "rm old_plans.txt", out: "rm old_plans.txt\nbuild% " },
    ],
  },
  "2-3": {
    files: {
      "adv/move/map_copy.txt": "X marks the spot\n",
      "adv/move/tools/map_copy.txt": "X marks the spot\n",
      "adv/move/tools_bak/axe.txt": "",
      "adv/move/rock.txt": "",
    },
    steps: [
      { cmd: "cp map.txt map_copy.txt", out: "cp map.txt map_copy.txt\nmove% " },
      { cmd: "mv map_copy.txt tools/", out: "mv map_copy.txt tools/\nmove% " },
      { cmd: "cp -r tools tools_bak", out: "cp -r tools tools_bak\nmove% " },
      { cmd: "mv stone.txt rock.txt", out: "mv stone.txt rock.txt\nmove% " },
    ],
  },
  "2-4": {
    files: {},
    steps: [
      { cmd: "ls *.txt", out: "ls *.txt\nroot1.txt  root2.txt\nfog% " },
      { cmd: "ls north/*.txt", out: "ls north/*.txt\nnorth/gold.txt  north/silver.txt\nfog% " },
      { cmd: "find . -name gold.txt", out: "find . -name gold.txt\n./north/gold.txt\nfog% " },
      { cmd: "cat north/gold.txt", out: "cat north/gold.txt\nGOLD! The treasure is yours.\nfog% " },
    ],
  },
  "2-5": {
    files: {},
    steps: [
      { cmd: "head -3 scroll.txt", out: "head -3 scroll.txt\nline1\nline2\nline3\nscrolls% " },
      { cmd: "tail -3 scroll.txt", out: "tail -3 scroll.txt\nline18\nline19\nline20\nscrolls% " },
      { cmd: "wc -l scroll.txt", out: "wc -l scroll.txt\n 20 scroll.txt\nscrolls% " },
      { cmd: "cat scroll.txt", out: "cat scroll.txt\nline1\nline2\nline20\nscrolls% " },
    ],
  },
  "2-6": {
    files: {
      "adv/boss-maze/exit": "",
      "adv/boss-maze/exit/riddle.txt": "SECRET\n",
      "adv/boss-maze/exit/riddle_copy.txt": "SECRET\n",
    },
    steps: [
      { cmd: "mkdir exit", out: "mkdir exit\nboss-maze% " },
      { cmd: "mv ruins/riddle.txt exit/", out: "mv ruins/riddle.txt exit/\nboss-maze% " },
      { cmd: "cp exit/riddle.txt exit/riddle_copy.txt", out: "cp exit/riddle.txt exit/riddle_copy.txt\nboss-maze% " },
      { cmd: "rm ruins/old.txt", out: "rm ruins/old.txt\nboss-maze% " },
      { cmd: "find exit -name \"*.txt\"", out: "find exit -name \"*.txt\"\nexit/riddle.txt\nexit/riddle_copy.txt\nboss-maze% " },
      { cmd: "wc -l exit/riddle.txt", out: "wc -l exit/riddle.txt\n 1 exit/riddle.txt\nboss-maze% " },
    ],
  },
  "3-1": {
    files: {},
    steps: [
      { cmd: "id", out: "id\nuid=0(root) gid=0(root)\n% " },
      { cmd: "whoami", out: "whoami\nroot\n% " },
      { cmd: "cat /etc/passwd", out: "cat /etc/passwd\nroot:x:0:0:root:/root:/bin/sh\n% " },
    ],
  },
  "3-2": {
    files: {},
    steps: [
      { cmd: "ls -l open.txt", out: "ls -l open.txt\n-rw-r--r--    1 root     root             0 Sep 25 05:50 open.txt\nperms% " },
      { cmd: "chmod 600 open.txt", out: "chmod 600 open.txt\nperms% " },
      { cmd: "ls -l open.txt", out: "ls -l open.txt\n-rw-------    1 root     root             0 Sep 25 05:50 open.txt\nperms% " },
      { cmd: "chmod +x run.sh", out: "chmod +x run.sh\nperms% " },
      { cmd: "./run.sh", out: "./run.sh\nhello\nperms% " },
    ],
  },
  "3-3": {
    files: {},
    steps: [
      { cmd: "ls -l mystery.txt", out: "ls -l mystery.txt\n-rw-r--r--    1 root     root             0 Sep 25 05:50 mystery.txt\nown% " },
      { cmd: "chown nobody mystery.txt", out: "chown nobody mystery.txt\nown% " },
      { cmd: "ls -l mystery.txt", out: "ls -l mystery.txt\n-rw-r--r--    1 nobody   root             0 Sep 25 05:50 mystery.txt\nown% " },
      { cmd: "chgrp audio mystery.txt", out: "chgrp audio mystery.txt\nown% " },
      { cmd: "ls -l mystery.txt", out: "ls -l mystery.txt\n-rw-r--r--    1 nobody   audio             0 Sep 25 05:50 mystery.txt\nown% " },
    ],
  },
  "3-4": {
    files: {},
    steps: [
      { cmd: "addgroup knights", out: "addgroup knights\n% " },
      { cmd: "adduser -D -H -G knights hero", out: "adduser -D -H -G knights hero\n% " },
      { cmd: "cat /etc/passwd", out: "cat /etc/passwd\nhero:x:1000:1000:Linux User,,,:/home/hero:/bin/sh\n% " },
      { cmd: "id hero", out: "id hero\nuid=1000(hero) gid=1000(knights) groups=1000(knights)\n% " },
      { cmd: "cat /etc/group", out: "cat /etc/group\nknights:x:1001:\n% " },
    ],
  },
  "3-5": {
    files: { "adv/fort/vault": "", "adv/fort/vault/banner.txt": "FLAG: 要塞守住了\n" },
    steps: [
      { cmd: "mkdir vault", out: "mkdir vault\nfort% " },
      { cmd: "mv banner.txt vault/", out: "mv banner.txt vault/\nfort% " },
      { cmd: "chmod 700 vault", out: "chmod 700 vault\nfort% " },
      { cmd: "chown nobody vault/banner.txt", out: "chown nobody vault/banner.txt\nfort% " },
      { cmd: "ls -ld vault", out: "ls -ld vault\ndrwx------    2 root     root          4096 Sep 25 05:50 vault\nfort% " },
      { cmd: "cat vault/banner.txt", out: "cat vault/banner.txt\nFLAG: 要塞守住了\nfort% " },
    ],
  },
};

function simulate(levelId) {
  const lv = LEVELS.find((l) => l.id === levelId);
  const sc = SCENARIOS[levelId];
  const a = createAttempt(lv);

  for (const s of sc.steps) {
    const r = evaluateLine(a, lv, s.cmd);
    const handled = [];
    for (const ev of r.events) {
      if (ev.type === "taskDone") {
        handled.push(ev.taskId);
      } else if (ev.type === "needOutputCheck") {
        // 同一命令可能同时触发多个任务（如 chmod 前后两次 ls -l）；
        // 输出匹配才完成，不匹配则留给后续步骤再次触发
        const pat = buildOutputPattern(ev.task, s.cmd);
        if (new RegExp(pat, "m").test(s.out)) {
          markTaskDone(a, ev.taskId);
          handled.push(ev.taskId);
        }
      } else if (ev.type === "needFileCheck") {
        const j = ev.task.judge;
        if (j.absent) {
          assert.ok(!(j.path in sc.files), levelId + "/" + ev.taskId + " 文件应已被删除：" + j.path);
        } else {
          const content = sc.files[j.path];
          assert.ok(verifyFileTask(ev.task, content), levelId + "/" + ev.taskId + " 文件核对失败：" + j.path);
        }
        markTaskDone(a, ev.taskId);
        handled.push(ev.taskId);
      } else if (ev.type === "mistake" || ev.type === "alreadyDone" || ev.type === "unmatched") {
        assert.fail(levelId + " 步骤 " + s.cmd + " 不应触发 " + ev.type);
      }
    }
    assert.ok(handled.length > 0, levelId + " 步骤 " + s.cmd + " 未命中任何任务");
  }

  assert.equal(allTasksDone(a), true, levelId + " 应全部完成");
  const stars = computeStars(a, lv);
  assert.equal(stars, 3, levelId + " 最优解应 3 星（实际 " + stars + "，步数 " + a.steps + "）");
  return a;
}

for (const id of Object.keys(SCENARIOS)) {
  simulate(id);
  console.log("✅ " + id + " 全流程模拟通过");
}

// ---- 负向：裸 echo 在任何关卡都不会过关 ----
{
  const lv = LEVELS.find((l) => l.id === "1-1");
  const a = createAttempt(lv);
  const r = evaluateLine(a, lv, "echo");
  assert.equal(r.events[0].type, "mistake");
  assert.equal(allTasksDone(a), false);
}

console.log("✅ 全流程模拟测试全部通过（16 关）");
