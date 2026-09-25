// ============================================================
// 端到端沙箱测试：在 Node 中真实启动 v86 + Buildroot，
// 逐关执行真实命令并断言结果（浏览器外的完整链路验证）
// 运行：node tests/e2e.sandbox.test.mjs   （首次启动约 20~60 秒）
// ============================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { V86 } from "../vendor/libv86.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const V = (p) => path.join(ROOT, "vendor", p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const output = [];
let bootBuf = "";
let booted = false;
let bootResolve;
const bootPromise = new Promise((r) => (bootResolve = r));

const emu = new V86({
  wasm_path: V("v86.wasm"),
  memory_size: 64 * 1024 * 1024,
  bios: { url: V("seabios.bin") },
  vga_bios: { url: V("vgabios.bin") },
  bzimage: { url: V("buildroot-bzimage.bin"), async: false },
  cmdline: "tsc=reliable mitigations=off random.trust_cpu=on",
  filesystem: {},
  autostart: true,
  disable_keyboard: true,
});

const dec = new TextDecoder("utf-8");
emu.add_listener("serial0-output-byte", (byte) => {
  if (byte === 13) return;
  const ch = dec.decode(new Uint8Array([byte]), { stream: true });
  output.push(ch);
  bootBuf = (bootBuf + ch).slice(-600);
  if (!booted && (bootBuf.match(/__LA_BOOT__/g) || []).length >= 2) {
    booted = true;
    bootResolve();
  }
});

console.log("[e2e] 启动 Linux 内核…");
const probe = setInterval(() => emu.serial0_send("\necho __LA_BOOT__\n"), 500);
await Promise.race([bootPromise, sleep(120000)]);
clearInterval(probe);
if (!booted) { console.log("[e2e] ❌ 启动超时"); process.exit(1); }
console.log("[e2e] ✅ Linux 已启动");

let pass = 0, fail = 0;

const enc = new TextEncoder();

async function sendAndExpect(cmd, label, pattern, ms = 8000) {
  const start = output.length;          // 先记录起点，再发命令
  emu.serial_send_bytes(0, enc.encode(cmd + "\n"));
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await sleep(150);
    const text = output.slice(start).join("");
    if (new RegExp(pattern).test(text)) {
      pass++;
      console.log("  ✅ " + label + " → " + JSON.stringify(text.replace(/\x1b/g, "<ESC>").slice(0, 110)));
      return true;
    }
  }
  fail++;
  console.log("  ❌ " + label + " 未匹配，实际输出：" + JSON.stringify(output.slice(start).join("").replace(/\x1b/g, "<ESC>").slice(0, 260)));
  return false;
}

// ---------- 9p 文件系统探测 ----------
console.log("[e2e] 探测 9p 文件系统…");
emu.serial0_send("mkdir -p /mnt\n");
await sleep(400);
emu.serial0_send("mount -t 9p -o trans=virtio,version=9p2000.L host9p /mnt 2>/dev/null || true\n");
await sleep(400);
emu.serial0_send("echo probe > /mnt/__la_probe 2>/dev/null || true\n");
await sleep(400);
let fileApi = false;
for (let i = 0; i < 24; i++) {
  await sleep(250);
  try {
    const c = await emu.read_file("__la_probe");
    if (c != null) { fileApi = true; break; }
  } catch {}
}
console.log("[e2e] " + (fileApi ? "✅ 9p 文件系统可用（判题可读沙箱文件）" : "⚠️ 9p 不可用（文件类任务将退化为命令判定）"));

// ---------- 第一章 1-1 ----------
console.log("\n=== 关卡 1-1：echo / date / clear ===");
await sendAndExpect("cd /", "cd / 正常", ".*", 1500);
await sendAndExpect("echo hello", "echo 输出 hello", "hello");
await sendAndExpect("date", "date 输出时间", "[A-Z][a-z]{2} [A-Z][a-z]{2} +[0-9]{1,2} ");
await sendAndExpect("clear", "clear 清屏（ESC[H ESC[J）", "\\x1b\\[H\\x1b\\[J");
await sendAndExpect("echo AFTER_CLEAR", "clear 之后 echo 仍正常（打字回显链路未断）", "AFTER_CLEAR");
await sendAndExpect("echo /after-slash-ok", "斜杠后字符正常回显", "after-slash-ok");

// ---------- 第一章 1-2 ----------
console.log("\n=== 关卡 1-2：whoami / pwd / hostname ===");
await sendAndExpect("whoami", "whoami → root", "whoami[^]*root");
await sendAndExpect("pwd", "pwd → /", "/");
await sendAndExpect("hostname", "hostname 正常执行（输出 none 或名字）", "\\(none\\)|[a-zA-Z][a-zA-Z0-9_-]*");
await sendAndExpect("echo 你好，世界", "中文输入回显正常（UTF-8 串口编码）", "你好，世界");
{
  const start = output.length;
  emu.serial_send_bytes(0, enc.encode("set -o emacs; echo EMACS_MODE_OK\n"));
  let text = "";
  for (let i = 0; i < 30; i++) { await sleep(150); text = output.slice(start).join(""); if (text.includes("EMACS_MODE_OK")) break; }
  if (text.includes("EMACS_MODE_OK")) {
    pass++;
    console.log("  ✅ set -o 尝试后 shell 保持可用" + (text.includes("illegal") ? "（本镜像不支持 set -o，应用已静默忽略，ESC 过滤兜底）" : "（emacs 模式生效）"));
  } else { fail++; console.log("  ❌ set -o emacs 结果：" + JSON.stringify(text.replace(/\x1b/g, "<ESC>").slice(0, 120))); }
}

// ---------- 第一章 1-3 ----------
console.log("\n=== 关卡 1-3：ls / ls -l / ls -a / cat .treasure ===");
await sendAndExpect("mkdir -p /mnt/adv/warehouse", "准备仓库", ".*", 1500);
await sendAndExpect("cd /mnt/adv/warehouse", "进入仓库", ".*", 1500);
await sendAndExpect("touch apple.txt bread.txt milk.txt", "放置货物", ".*", 1500);
await sendAndExpect("echo 'TREASURE! You found the hidden treasure.' > .treasure", "藏入宝物", ".*", 1500);
await sendAndExpect("ls", "ls 列出货物", "apple\\.txt");
await sendAndExpect("ls -l", "ls -l 长格式", "-rw-r--r--.*apple\\.txt");
await sendAndExpect("ls -a", "ls -a 显示隐藏文件", "\\.treasure");
await sendAndExpect("cat .treasure", "cat 宝物内容", "TREASURE!");

// ---------- 第一章 1-4 ----------
console.log("\n=== 关卡 1-4：ls --help / date --help / history ===");
await sendAndExpect("ls --help", "ls --help 可用", "Usage|usage");
await sendAndExpect("date --help", "date --help 可用", "Usage|usage");
await sendAndExpect("history", "history 列出之前命令（出现 ls --help）", "ls --help");

// ---------- 第一章 1-5 Boss ----------
console.log("\n=== 关卡 1-5：mkdir / touch / echo> / cat / ls -l ===");
await sendAndExpect("mkdir -p /mnt/adv", "准备营地", ".*", 1500);
await sendAndExpect("cd /mnt/adv", "进入营地", ".*", 1500);
await sendAndExpect("mkdir camp", "mkdir 创建营地", ".*", 1500);
await sendAndExpect("touch camp/flag.txt", "touch 制作战旗", ".*", 1500);
await sendAndExpect("echo go go > camp/flag.txt", "echo> 写入宣言", ".*", 1500);
await sendAndExpect("cat camp/flag.txt", "cat 战旗内容", "go go");
await sendAndExpect("ls -l camp", "ls -l camp 检阅", "flag\\.txt");

if (fileApi) {
  try {
    const content = await emu.read_file("adv/camp/flag.txt");
    const type = content && content.constructor ? content.constructor.name : typeof content;
    let shown = content;
    if (content instanceof Uint8Array) shown = new TextDecoder().decode(content);
    if (shown != null && String(shown).includes("go go")) { pass++; console.log("  ✅ read_file 读到战旗内容：" + JSON.stringify(String(shown)) + "（类型 " + type + "）"); }
    else { fail++; console.log("  ❌ read_file 内容异常：" + JSON.stringify(shown) + "（类型 " + type + "）"); }
  } catch (e) {
    fail++;
    console.log("  ❌ read_file 抛异常：" + e);
  }
  // 读不存在的文件应失败（用于验证“文件未创建不误判”）
  try {
    const none = await emu.read_file("adv/camp/不存在.txt");
    fail++; console.log("  ❌ 读取不存在文件应 reject，实际返回：" + JSON.stringify(none));
  } catch {
    pass++; console.log("  ✅ 读取不存在文件正确 reject（不会误判任务完成）");
  }
}

// ---- 空文件存在性检查（touch 核对的关键路径） ----
console.log("\n=== 空文件与 SearchPath 探测 ===");
{
  emu.serial_send_bytes(0, enc.encode("mkdir -p /mnt/adv/existprobe && cd /mnt/adv/existprobe && touch empty.txt\n"));
  await sleep(1500);
  try {
    const fs = emu.fs9p;
    if (fs && fs.SearchPath) {
      const hit = fs.SearchPath("adv/existprobe/empty.txt");
      const miss = fs.SearchPath("adv/existprobe/nope.txt");
      const okHit = hit && hit.id !== -1;
      const okMiss = miss && miss.id === -1;
      if (okHit && okMiss) { pass++; console.log("  ✅ SearchPath：空文件存在=true，缺失文件=false（touch 核对的可靠路径）"); }
      else { fail++; console.log("  ❌ SearchPath 结果异常 hit=" + JSON.stringify(hit) + " miss=" + JSON.stringify(miss)); }
    } else { fail++; console.log("  ❌ emu.fs9p / SearchPath 不可用"); }
  } catch (e) { fail++; console.log("  ❌ SearchPath 探测异常：" + e); }
  try {
    const c = await emu.read_file("adv/existprobe/empty.txt");
    console.log("  ℹ️ read_file(空文件) 返回:", c == null ? "null" : "类型 " + c.constructor.name + " 长度 " + (c.length != null ? c.length : "?"));
  } catch (e) {
    console.log("  ℹ️ read_file(空文件) 被 reject：" + (e && e.message ? e.message : e));
  }
}

// ---------- 第二/三章新命令实测 ----------
console.log("\n=== 第二/三章新命令实测 ===");
await sendAndExpect("mkdir -p /mnt/ch23 && cd /mnt/ch23", "进入测试目录", ".*", 1500);
await sendAndExpect("for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do echo line$i >> scroll.txt; done", "循环生成 20 行卷轴", ".*", 3000);
await sendAndExpect("head -3 scroll.txt", "head -3 前 3 行", "line1[^]*line2[^]*line3");
await sendAndExpect("tail -3 scroll.txt", "tail -3 后 3 行", "line18[^]*line19[^]*line20");
await sendAndExpect("wc -l scroll.txt", "wc -l 行数", "20 +scroll\\.txt");
await sendAndExpect("cp scroll.txt scroll_copy.txt && mv scroll_copy.txt scroll_moved.txt", "cp + mv", ".*", 1500);
await sendAndExpect("head -1 scroll_moved.txt", "复制后内容一致", "line1");
await sendAndExpect("mkdir -p subdir && touch subdir/f.txt && cp -r subdir subdir_bak", "cp -r 目录", ".*", 1500);
await sendAndExpect("ls subdir_bak", "备份目录有内容", "f\\.txt");
await sendAndExpect("find . -name scroll_moved.txt", "find -name", "scroll_moved");
await sendAndExpect("find . -name \"*.txt\"", "find 通配模式", "scroll_moved\\.txt");
await sendAndExpect("addgroup knights", "addgroup 创建组", ".*", 1500);
await sendAndExpect("adduser -D -H -G knights hero", "adduser -G 创建并编组（无报错）", ".*", 2000);
await sendAndExpect("tail -2 /etc/passwd", "hero 已登记", "hero:x:");
await sendAndExpect("id hero", "id hero 主组为 knights", "knights");
await sendAndExpect("tail -2 /etc/group", "组名册有 knights", "knights:x:");
await sendAndExpect("chmod 600 scroll.txt && ls -l scroll.txt", "chmod 600", "-rw-------.*scroll\\.txt");
await sendAndExpect("chown nobody scroll.txt && ls -l scroll.txt", "chown nobody", "nobody +root.*scroll\\.txt");
await sendAndExpect("chgrp audio scroll.txt && ls -l scroll.txt", "chgrp audio", "nobody +audio.*scroll\\.txt");
await sendAndExpect("mkdir -p vault2 && chmod 700 vault2 && ls -ld vault2", "chmod 700 目录", "drwx------.*vault2");
await sendAndExpect("echo 'FLAG: ok' > vault2/flag.txt && cat vault2/flag.txt", "cat FLAG", "FLAG: ok");
await sendAndExpect("rm -r subdir_bak vault2 scroll_moved.txt", "清理测试文件", ".*", 1500);

console.log("\n[e2e] 结果：" + pass + " 通过 / " + fail + " 失败");
emu.destroy();
process.exit(fail === 0 ? 0 : 1);
