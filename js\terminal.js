// ============================================================
// 沙箱：浏览器内 WASM 虚拟 Linux（v86 + Buildroot + 串口终端）
//   - 串口输出 → UTF-8 解码 → 上层 UI
//   - 串口输入 ← 用户键入 → guest
//   - 9p 文件系统 → readFile 供判题引擎读取沙箱文件状态
// ============================================================

const ASSETS = {
  wasm: "vendor/v86.wasm",
  bios: "vendor/seabios.bin",
  vgabios: "vendor/vgabios.bin",
  bzimage: "vendor/buildroot-bzimage.bin",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const encoder = new TextEncoder();

/**
 * 过滤 ESC/CSI 控制序列（方向键、F 键、鼠标报告等）。
 * 这些序列会把 busybox 行编辑器切进 vi 命令模式，导致之后输入的字符
 * 被当成 vi 命令吞掉（表现为「打字不显示」）。过滤后 shell 永远停在插入模式。
 * 括号粘贴（ESC[200~ ... ESC[201~）只剥离标记，粘贴内容保留。
 * state 可跨调用持久化（输入事件可能把一个序列拆成两段）。
 * 返回 { bytes, state }。
 */
export function filterControlBytes(bytes, state = { s: 0 }) {
  const out = [];
  for (const b of bytes) {
    if (state.s === 0) {
      if (b === 0x1b) state.s = 1;
      else out.push(b);
    } else if (state.s === 1) {
      state.s = b === 0x5b || b === 0x4f ? 2 : 0; // ESC [ 或 ESC O 进入 CSI，其他直接结束
    } else {
      if (b >= 0x40 && b <= 0x7e) state.s = 0; // CSI 终结字节
    }
  }
  return { bytes: Uint8Array.from(out), state };
}

export class Sandbox {
  constructor(opts) {
    this.onStatus = opts.onStatus || (() => {});
    this.onOutput = opts.onOutput || (() => {});
    this.onBooted = opts.onBooted || (() => {});
    this.onBootError = opts.onBootError || (() => {});
    this.emulator = null;
    this.booted = false;
    this.fileApiAvailable = false;
    this._decoder = new TextDecoder("utf-8");
    this._bootBuf = "";
    this._probeTimer = null;
    this._destroyed = false;
  }

  boot() {
    this.onStatus("正在加载虚拟机（本地资源）");
    try {
      this.emulator = new V86({
        wasm_path: ASSETS.wasm,
        memory_size: 64 * 1024 * 1024,
        bios: { url: ASSETS.bios },
        vga_bios: { url: ASSETS.vgabios },
        bzimage: { url: ASSETS.bzimage, async: false },
        cmdline: "tsc=reliable mitigations=off random.trust_cpu=on",
        filesystem: {},
        autostart: true,
        disable_keyboard: true,
      });
    } catch (e) {
      this.onBootError("无法创建虚拟机：" + (e && e.message ? e.message : e));
      return;
    }
    this.emulator.add_listener("serial0-output-byte", (byte) => this._onByte(byte));
    this._startBootProbe();
  }

  _startBootProbe() {
    this.onStatus("正在启动 Linux 内核");
    let tries = 0;
    this._probeTimer = setInterval(() => {
      if (this._destroyed || this.booted) return;
      tries += 1;
      if (tries > 180) {
        clearInterval(this._probeTimer);
        this.onBootError("Linux 启动超时，请刷新页面重试。");
        return;
      }
      try {
        this.sendRaw("\necho __LA_BOOT__\n");
      } catch {}
    }, 500);
  }

  _onByte(byte) {
    if (this._destroyed) return;
    if (byte === 13) return; // 跳过 \r
    let text;
    try {
      text = this._decoder.decode(new Uint8Array([byte]), { stream: true });
    } catch {
      text = String.fromCharCode(byte);
    }
    this._bootBuf = (this._bootBuf + text).slice(-600);
    this.onOutput(text);
    if (!this.booted) {
      const n = (this._bootBuf.match(/__LA_BOOT__/g) || []).length;
      if (n >= 2) this._onBooted();
    }
  }

  _onBooted() {
    if (this.booted) return;
    this.booted = true;
    if (this._probeTimer) clearInterval(this._probeTimer);
    this.onStatus("Linux 已启动");
    // 保险：若出现登录提示则自动登录 root
    setTimeout(() => {
      if (this._destroyed) return;
      if (this._bootBuf.slice(-200).includes("login:")) this.sendRaw("root\n");
    }, 1200);
    this.onBooted();
  }

  /** 发送用户键入内容（UTF-8 编码，过滤方向键等 ESC 序列） */
  sendUtf8(str) {
    if (!this.emulator || this._destroyed) return;
    this._escState = this._escState || { s: 0 };
    const r = filterControlBytes(encoder.encode(str), this._escState);
    this._escState = r.state;
    if (r.bytes.length) this.emulator.serial_send_bytes(0, r.bytes);
  }

  /** 发送原始字符串（UTF-8 编码；注意 v86 的 serial0_send 是 Latin-1 截断，中文必须走这里） */
  sendRaw(str) {
    if (!this.emulator || this._destroyed) return;
    this.emulator.serial_send_bytes(0, encoder.encode(str));
  }

  /** 在 guest shell 中执行命令 */
  runShell(cmd) {
    this.sendRaw(cmd + "\n");
  }

  /** 文件存在性检查（查 9p 目录树，不读内容——空文件也可靠）。
      返回 true/false；9p 不可用时返回 null。 */
  fileExists(path) {
    if (!this.emulator || this._destroyed) return null;
    try {
      const fs = this.emulator.fs9p;
      if (!fs || typeof fs.SearchPath !== "function") return null;
      const r = fs.SearchPath(String(path));
      return !!(r && r.id !== -1);
    } catch {
      return null;
    }
  }

  /** 读取 9p 文件（相对文件系统根，guest 中对应 /mnt/...）。
      注意：v86 的 read_file 是异步的，必须 await；文件不存在会 reject。 */
  async readFile(path) {
    if (!this.emulator || this._destroyed) return null;
    try {
      return await this.emulator.read_file(path);
    } catch {
      return null;
    }
  }

  /** 把行编辑器固定为 emacs（插入式）模式，避免 vi 命令模式吞字符 */
  prepareShell() {
    this.runShell("set -o emacs 2>/dev/null || true");
  }

  /** 探测 9p 文件系统是否可用：guest 写探针 → host 读回 */
  async detectFileApi() {
    this.runShell("mkdir -p /mnt");
    this.runShell("mount -t 9p -o trans=virtio,version=9p2000.L host9p /mnt 2>/dev/null || true");
    this.runShell("echo probe > /mnt/__la_probe 2>/dev/null || true");
    for (let i = 0; i < 24; i++) {
      if (this._destroyed) return false;
      await sleep(250);
      const c = await this.readFile("__la_probe");
      if (c != null) {
        this.fileApiAvailable = true;
        return true;
      }
    }
    return false;
  }

  destroy() {
    this._destroyed = true;
    if (this._probeTimer) clearInterval(this._probeTimer);
    if (this.emulator) {
      try {
        this.emulator.destroy();
      } catch {}
      this.emulator = null;
    }
  }
}
