// 沙箱能力探测：第二章/第三章所需命令的存在性与输出格式
// 运行：node tests/probe.sandbox.test.mjs
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
const dec = new TextDecoder("utf-8");

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

emu.add_listener("serial0-output-byte", (byte) => {
  if (byte === 13) return;
  const ch = dec.decode(new Uint8Array([byte]), { stream: true });
  output.push(ch);
  bootBuf = (bootBuf + ch).slice(-600);
  if (!booted && (bootBuf.match(/__LA_BOOT__/g) || []).length >= 2) { booted = true; bootResolve(); }
});

console.log("[probe] 启动 Linux…");
const probeTimer = setInterval(() => emu.serial0_send("\necho __LA_BOOT__\n"), 500);
await Promise.race([bootPromise, sleep(120000)]);
clearInterval(probeTimer);
if (!booted) { console.log("启动超时"); process.exit(1); }
console.log("[probe] 已启动");

const enc = new TextEncoder();
async function run(cmd, wait = 1200) {
  const start = output.length;
  emu.serial_send_bytes(0, enc.encode(cmd + "\n"));
  await sleep(wait);
  return output.slice(start).join("").replace(/\x1b\[[0-9;]*m/g, "").slice(0, 220).replace(/\n/g, " ⏎ ");
}

console.log("=== busybox --list（可用命令全表） ===");
const list = await run("busybox --list", 2000);
console.log(list);
const applets = list.split("⏎").map((s) => s.trim()).filter(Boolean);
for (const cmd of ["less","seq","printf","head","tail","wc","find","cp","mv","rm","rmdir","touch","mkdir","pwd","ls","cat","chmod","chown","chgrp","id","su","sudo","useradd","adduser","addgroup","groupadd","passwd","groups","grep","sort","uniq","tr","cut","sed","awk","tar","gzip","which","dirname","basename","readlink","ln","stat","df","du","free","ps","kill","mount","umount","hostname","clear","date","echo","sleep","md5sum","sha1sum","xz","unzip"]) {
  console.log((applets.includes(cmd) ? "✅" : "❌") + " " + cmd);
}

console.log("=== id ==="); console.log(await run("id"));
console.log("=== whoami ==="); console.log(await run("whoami"));
console.log("=== umask ==="); console.log(await run("umask"));
console.log("=== cat /etc/passwd（前 220 字） ==="); console.log(await run("cat /etc/passwd"));
console.log("=== cat /etc/group ==="); console.log(await run("cat /etc/group"));
console.log("=== head -3 /etc/passwd ==="); console.log(await run("head -3 /etc/passwd"));
console.log("=== tail -2 /etc/passwd ==="); console.log(await run("tail -2 /etc/passwd"));
console.log("=== wc -l /etc/passwd ==="); console.log(await run("wc -l /etc/passwd"));
console.log("=== ls -l /etc/passwd ==="); console.log(await run("ls -l /etc/passwd"));
console.log("=== find /etc -name passwd ==="); console.log(await run("find /etc -name passwd"));
console.log("=== chmod +x 脚本执行 ==="); console.log(await run("echo 'echo hello-from-script' > /tmp/run.sh && chmod +x /tmp/run.sh && /tmp/run.sh"));
console.log("=== chown nobody 测试 ==="); console.log(await run("touch /tmp/owned.txt && chown nobody /tmp/owned.txt && ls -l /tmp/owned.txt"));
console.log("=== chgrp nobody 测试 ==="); console.log(await run("chgrp nobody /tmp/owned.txt && ls -l /tmp/owned.txt"));
console.log("=== su nobody -c id ==="); console.log(await run("su nobody -c id"));
console.log("=== adduser --help ==="); console.log(await run("adduser --help 2>&1 | head -5"));
console.log("=== useradd --help ==="); console.log(await run("useradd --help 2>&1 | head -5"));
console.log("=== addgroup --help ==="); console.log(await run("addgroup --help 2>&1 | head -5"));
console.log("=== passwd --help ==="); console.log(await run("passwd --help 2>&1 | head -5"));
console.log("=== sudo ==="); console.log(await run("sudo --help 2>&1 | head -3"));
console.log("=== chmod 数字模式 ==="); console.log(await run("chmod 600 /tmp/owned.txt && ls -l /tmp/owned.txt"));
console.log("=== mkdir 父目录不存在 -p ==="); console.log(await run("mkdir -p /tmp/a/b/c && ls -d /tmp/a/b/c"));
console.log("=== cp -r ==="); console.log(await run("mkdir -p /tmp/src && echo hi > /tmp/src/f.txt && cp -r /tmp/src /tmp/srcbak && cat /tmp/srcbak/f.txt"));
console.log("=== mv ==="); console.log(await run("mv /tmp/srcbak/f.txt /tmp/moved.txt && cat /tmp/moved.txt"));
console.log("=== rm -r ==="); console.log(await run("rm -r /tmp/srcbak && ls /tmp/srcbak 2>&1"));
console.log("=== 通配符 ==="); console.log(await run("cd /tmp && ls *.txt"));
console.log("=== grep 存在性 ==="); console.log(await run("grep --help 2>&1 | head -3"));

emu.destroy();
process.exit(0);
