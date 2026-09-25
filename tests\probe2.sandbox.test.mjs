// 探测：BusyBox 把用户加入组的正确语法
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

console.log("[probe2] 启动…");
const t = setInterval(() => emu.serial0_send("\necho __LA_BOOT__\n"), 500);
await Promise.race([bootPromise, sleep(120000)]);
clearInterval(t);
if (!booted) { console.log("超时"); process.exit(1); }

const enc = new TextEncoder();
async function run(cmd, wait = 1500) {
  const start = output.length;
  emu.serial_send_bytes(0, enc.encode(cmd + "\n"));
  await sleep(wait);
  return output.slice(start).join("").replace(/\x1b\[[0-9;]*m/g, "").replace(/\n/g, " ⏎ ").slice(0, 200);
}

console.log("=== addgroup 完整帮助 ===");
console.log(await run("addgroup --help 2>&1"));
console.log("=== adduser 完整帮助 ===");
console.log(await run("adduser --help 2>&1"));
console.log("=== 尝试 adduser -G knights heroG ===");
console.log(await run("addgroup knights"));
console.log(await run("adduser -D -H -G knights heroG"));
console.log(await run("id heroG"));
console.log("=== 尝试 adduser heroG2 后 adduser -G 再编组 ===");
console.log(await run("adduser -D -H heroG2"));
console.log(await run("adduser -G knights heroG2"));
console.log(await run("id heroG2"));
console.log("=== 尝试 addgroup knights heroG2 ===");
console.log(await run("addgroup knights heroG2"));
console.log(await run("id heroG2"));

emu.destroy();
process.exit(0);
