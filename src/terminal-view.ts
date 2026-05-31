import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ITerminalOptions } from "@xterm/xterm";
import { VIEW_TYPE_TERMINAL, THEMES, btLog } from "./constants";
import type { BrainTerminalSettings } from "./constants";

// node-pty and xterm loaded at runtime from plugin dir
type IPty = import("node-pty").IPty;
type Terminal = import("@xterm/xterm").Terminal;
type FitAddon = import("@xterm/addon-fit").FitAddon;

export class TerminalView extends ItemView {
  static instanceCount = 0;

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private pty: IPty | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private scope: any = null; // obsidian Scope
  private windowListener: ((e: KeyboardEvent) => void) | null = null;
  private isUnloaded = false;
  private instanceId: number;

  constructor(
    leaf: WorkspaceLeaf,
    private settings: BrainTerminalSettings,
    private pluginDir: string
  ) {
    super(leaf);
    this.instanceId = ++TerminalView.instanceCount;
  }

  getViewType(): string { return VIEW_TYPE_TERMINAL; }
  getDisplayText(): string { return `Terminal <${this.instanceId}>`; }
  getIcon(): string { return "terminal"; }

  async onOpen(): Promise<void> {
    this.buildDOM();
    await this.spawnTerminal();
  }

  async onClose(): Promise<void> {
    this.forceDispose();
  }

  // ─── DOM ────────────────────────────────────────────────────────────────────

  private buildDOM(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("brain-terminal-container");

    const header = root.createDiv({ cls: "brain-terminal-header" });
    header.createSpan({ text: `Terminal ${this.instanceId}` });

    const actions = header.createDiv();
    const btn = (label: string, cb: () => void) => {
      const b = actions.createEl("button", { text: label });
      b.onclick = cb;
      return b;
    };
    btn("+", () => this.app.workspace.getLeaf(true).setViewState({ type: VIEW_TYPE_TERMINAL }));
    btn("↺", () => this.restartPty());
    btn("⬜", () => this.containerEl.toggleClass("brain-terminal-maximized", !this.containerEl.hasClass("brain-terminal-maximized")));
    btn("✕", () => this.leaf.detach());

    root.createDiv({ cls: "brain-terminal-xterm" });
  }

  private get xtermMount(): HTMLElement {
    return this.containerEl.querySelector(".brain-terminal-xterm") as HTMLElement;
  }

  // ─── xterm ──────────────────────────────────────────────────────────────────

  private async spawnTerminal(): Promise<void> {
    const { Terminal: XTerm } = await import(/* @vite-ignore */ `${this.pluginDir}/node_modules/@xterm/xterm/lib/xterm.js`).catch(() =>
      (window as any).require("@xterm/xterm")
    );
    const { FitAddon: FA } = await import(/* @vite-ignore */ `${this.pluginDir}/node_modules/@xterm/addon-fit/lib/addon-fit.js`).catch(() =>
      (window as any).require("@xterm/addon-fit")
    );

    const opts: ITerminalOptions = {
      fontFamily: this.settings.fontFamily,
      fontSize: this.settings.fontSize,
      scrollback: this.settings.scrollback,
      cursorBlink: this.settings.cursorBlink,
      theme: THEMES[this.settings.theme],
      allowProposedApi: true,
    };

    this.terminal = new XTerm(opts) as Terminal;
    this.fitAddon = new FA() as FitAddon;
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.xtermMount);

    // Debounced resize
    this.resizeObserver = new ResizeObserver(() => {
      setTimeout(() => {
        if (this.isUnloaded || !this.fitAddon) return;
        this.fitAddon.fit();
        if (this.pty) {
          const { cols, rows } = this.terminal!;
          this.pty.resize(cols, rows);
        }
      }, 100);
    });
    this.resizeObserver.observe(this.xtermMount);

    setTimeout(() => {
      this.fitAddon?.fit();
      this.spawnPty();
    }, 50);

    this.registerKeyForwarding();
  }

  // ─── Shell / PTY ────────────────────────────────────────────────────────────

  private resolveShell(): { shell: string; args: string[] } {
    if (this.settings.shellPath) {
      return { shell: this.settings.shellPath, args: this.settings.shellArgs };
    }

    if (process.platform === "win32") {
      const candidates = [
        process.env["ProgramFiles"] + "\\PowerShell\\7\\pwsh.exe",
        process.env["ProgramFiles(x86)"] + "\\PowerShell\\7\\pwsh.exe",
        process.env["LOCALAPPDATA"] + "\\Microsoft\\WindowsApps\\pwsh.exe",
      ];
      for (const c of candidates) {
        try {
          if (require("fs").existsSync(c)) return { shell: c, args: [] };
        } catch { /* skip */ }
      }
      return { shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", args: [] };
    }

    return { shell: process.env["SHELL"] ?? "/bin/bash", args: [] };
  }

  private async spawnPty(): Promise<void> {
    if (this.isUnloaded) return;

    const nodePty = require(require("path").join(this.pluginDir, "node_modules", "node-pty"));
    const { shell, args } = this.resolveShell();
    const { cols, rows } = this.terminal ?? { cols: 80, rows: 24 };

    btLog("spawning PTY", shell, args);

    this.pty = nodePty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: (this.app.vault.adapter as any).basePath ?? process.env["HOME"] ?? "/",
      env: {
        ...process.env,
        TERM_PROGRAM: "obsidian-terminal",
        COLORTERM: "truecolor",
        OBSIDIAN_VAULT: (this.app.vault.adapter as any).basePath ?? "",
        OBSIDIAN_CONTEXT_FILE: "",
        OBSIDIAN_OPEN_FILE: "",
      },
      useConpty: true,
    }) as IPty;

    this.pty.onData(data => this.terminal?.write(data));
    this.terminal?.onData(data => this.pty?.write(data));

    this.pty.onExit(({ exitCode }) => {
      if (this.isUnloaded) return;
      this.terminal?.writeln(`\r\n[Process exited with code ${exitCode}] — Press Enter to restart`);
      const onData = this.terminal?.onData(k => {
        if (k === "\r") { onData?.dispose(); this.restartPty(); }
      });
    });

    if (this.settings.startupCommand) {
      setTimeout(() => this.pty?.write(this.settings.startupCommand + "\r"), 500);
    }
  }

  private async restartPty(): Promise<void> {
    this.killPty();
    await this.spawnPty();
  }

  // ─── Keyboard forwarding ────────────────────────────────────────────────────

  private registerKeyForwarding(): void {
    // 1. Obsidian Scope for Ctrl+A-Z and Alt+A-Z
    this.scope = new (this.app as any).keymap.Scope();
    for (let c = 65; c <= 90; c++) {
      const key = String.fromCharCode(c);
      this.scope.register(["Ctrl"], key, (e: KeyboardEvent) => {
        this.forwardCtrlKeyToPty(key, e.shiftKey);
        return false;
      });
      this.scope.register(["Alt"], key, (e: KeyboardEvent) => {
        this.terminal?.attachCustomKeyEventHandler && this.terminal.write(`\x1b${key.toLowerCase()}`);
        return false;
      });
    }
    (this.app as any).keymap.pushScope(this.scope);

    // 2. Window capture-phase listener (belt-and-suspenders)
    this.windowListener = (e: KeyboardEvent) => {
      if (!this.xtermMount.contains(e.target as Node) && e.target !== this.xtermMount) return;
      if (!e.ctrlKey && !e.altKey && !e.metaKey) return;
      if (e.ctrlKey && !e.altKey) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.forwardCtrlKeyToPty(e.key, e.shiftKey);
      }
    };
    window.addEventListener("keydown", this.windowListener, { capture: true });

    // 3. xterm custom key handler (final safety net)
    this.terminal?.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if ((e.ctrlKey && (e.key === "c" || e.key === "v"))) return true;
      return true;
    });
  }

  private forwardCtrlKeyToPty(key: string, shift: boolean): void {
    const k = key.toUpperCase();
    const code = k.charCodeAt(0);

    if (k === "C" && !shift) {
      // Ctrl+C — copy if selection, else SIGINT
      const sel = this.terminal?.getSelection();
      if (sel) { navigator.clipboard.writeText(sel); this.terminal?.clearSelection(); return; }
      this.pty?.write("\x03");
      return;
    }
    if (k === "V") {
      navigator.clipboard.readText().then(text => {
        if (text) this.pty?.write(`\x1b[200~${text}\x1b[201~`);
      });
      return;
    }
    // Ctrl+A–Z → ASCII control characters
    if (code >= 65 && code <= 90) {
      this.pty?.write(String.fromCharCode(code - 64));
    }
  }

  // ─── Teardown (must be bulletproof) ─────────────────────────────────────────

  private killPty(): void {
    if (!this.pty) return;
    try {
      if (process.platform === "win32") {
        require("child_process").exec(`taskkill /PID ${this.pty.pid} /T /F`);
      } else {
        process.kill(this.pty.pid, "SIGTERM");
      }
    } catch { /* already dead */ }
    // Clean up all 6 node-pty handles
    try { (this.pty as any)._outSocket?.removeAllListeners(); } catch { /* */ }
    try { (this.pty as any)._agent?.closeTimeout && clearTimeout((this.pty as any)._agent.closeTimeout); } catch { /* */ }
    try { (this.pty as any)._conoutSocketWorker?._server?.removeAllListeners(); } catch { /* */ }
    try { (this.pty as any)._agent?.closeTimeout && clearTimeout((this.pty as any)._agent.closeTimeout); } catch { /* */ }
    try { (this.pty as any)._outSocket?.destroy(); (this.pty as any)._inSocket?.destroy(); } catch { /* */ }
    try { clearTimeout((this.pty as any)._drainTimeout); } catch { /* */ }
    this.pty = null;
  }

  private forceDispose(): void {
    this.isUnloaded = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.windowListener) {
      window.removeEventListener("keydown", this.windowListener, { capture: true });
      this.windowListener = null;
    }
    if (this.scope) {
      (this.app as any).keymap.popScope(this.scope);
      this.scope = null;
    }
    this.killPty();
    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
  }
}
