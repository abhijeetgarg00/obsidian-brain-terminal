import { ItemView, WorkspaceLeaf, Scope } from "obsidian";
import { Terminal } from "@xterm/xterm";
import type { ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
// @ts-ignore — css loaded as text by esbuild
import xtermCss from "@xterm/xterm/css/xterm.css";
import { VIEW_TYPE_TERMINAL, THEMES, btLog } from "./constants";
import type { BrainTerminalSettings } from "./constants";

// node-pty loaded at runtime from plugin dir (native module — stays external)
type IPty = import("node-pty").IPty;

export class TerminalView extends ItemView {
  static instanceCount = 0;

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private pty: IPty | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private scope: Scope | null = null;
  private windowListener: ((e: KeyboardEvent) => void) | null = null;
  private isUnloaded = false;
  private instanceId: number;
  private terminalName: string;
  private nameSpan: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private settings: BrainTerminalSettings,
    private pluginDir: string,
    private onFirstTerminal?: () => void,
    private isFirstRun = false,
  ) {
    super(leaf);
    this.instanceId = ++TerminalView.instanceCount;
    this.terminalName = `Brain Terminal ${this.instanceId}`;
  }

  getViewType(): string { return VIEW_TYPE_TERMINAL; }
  getDisplayText(): string { return this.terminalName; }
  getIcon(): string { return "brain"; }

  focusTerminal(): void {
    this.terminal?.focus();
  }

  async onOpen(): Promise<void> {
    this.buildDOM();
    await this.spawnTerminal();
  }

  async onClose(): Promise<void> {
    this.forceDispose();
  }

  // ─── DOM ────────────────────────────────────────────────────────────────────

  private buildDOM(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("brain-terminal-container");

    const header = root.createDiv({ cls: "brain-terminal-header" });

    // Name — double-click to rename
    this.nameSpan = header.createSpan({ text: this.terminalName, cls: "brain-terminal-name" });
    this.nameSpan.title = "Double-click to rename";
    this.nameSpan.ondblclick = () => this.startRename();

    const actions = header.createDiv({ cls: "brain-terminal-actions" });
    const btn = (label: string, tooltip: string, cb: () => void) => {
      const b = actions.createEl("button", { text: label, cls: "brain-terminal-btn" });
      b.title = tooltip;
      b.setAttribute("aria-label", tooltip);
      b.onclick = cb;
      return b;
    };
    btn("+", "New terminal", () => this.app.workspace.getRightLeaf(false)?.setViewState({ type: VIEW_TYPE_TERMINAL }));
    btn("↺", "Restart shell", () => this.restartPty());
    btn("✕", "Close terminal", () => this.leaf.detach());

    root.createDiv({ cls: "brain-terminal-xterm" });
  }

  private startRename(): void {
    if (!this.nameSpan) return;
    const input = document.createElement("input");
    input.type = "text";
    input.value = this.terminalName;
    input.className = "brain-terminal-rename-input";
    this.nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const newName = input.value.trim() || this.terminalName;
      this.terminalName = newName;
      this.nameSpan = document.createElement("span");
      this.nameSpan.className = "brain-terminal-name";
      this.nameSpan.textContent = newName;
      this.nameSpan.title = "Double-click to rename";
      this.nameSpan.ondblclick = () => this.startRename();
      input.replaceWith(this.nameSpan);
      // Update the tab title
      this.leaf.updateHeader();
    };
    input.onblur = commit;
    input.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); input.value = this.terminalName; commit(); }
    };
  }

  private get xtermMount(): HTMLElement {
    return this.contentEl.querySelector(".brain-terminal-xterm") as HTMLElement;
  }

  // ─── xterm ──────────────────────────────────────────────────────────────────

  private injectXtermCss(): void {
    const id = "brain-terminal-xterm-css";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = xtermCss;
      document.head.appendChild(style);
    }
  }

  private async spawnTerminal(): Promise<void> {
    console.log("[BrainTerminal] spawnTerminal called, mount:", this.xtermMount);
    this.injectXtermCss();
    const opts: ITerminalOptions = {
      fontFamily: this.settings.fontFamily,
      fontSize: this.settings.fontSize,
      scrollback: this.settings.scrollback,
      cursorBlink: this.settings.cursorBlink,
      theme: THEMES[this.settings.theme],
      allowProposedApi: true,
    };

    this.terminal = new Terminal(opts);
    this.fitAddon = new FitAddon();
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
      this.spawnPty().catch(e => {
        console.error("[BrainTerminal] spawnPty failed:", e);
        this.terminal?.writeln(`\r\n[Brain Terminal] Failed to spawn shell: ${e.message}`);
        this.terminal?.writeln(`[Brain Terminal] Check the Obsidian console for details.`);
      });
    }, 50);

    this.registerKeyForwarding();
  }

  // ─── Welcome ────────────────────────────────────────────────────────────────

  private printWelcome(): void {
    const w = (s: string) => this.terminal?.writeln(s);
    const c = {
      reset:  "\x1b[0m",
      bold:   "\x1b[1m",
      dim:    "\x1b[2m",
      cyan:   "\x1b[1;36m",
      green:  "\x1b[1;32m",
      yellow: "\x1b[1;33m",
      white:  "\x1b[1;37m",
      gray:   "\x1b[90m",
    };

    if (this.isFirstRun) {
      // ── First ever launch ──────────────────────────────────────────────────
      w(`${c.cyan}╔═══════════════════════════════════════════════════╗${c.reset}`);
      w(`${c.cyan}║${c.reset}         ${c.bold}${c.white}Welcome to Brain Terminal${c.reset}               ${c.cyan}║${c.reset}`);
      w(`${c.cyan}║${c.reset}         ${c.dim}Built by Abhijeet Garg${c.reset}                  ${c.cyan}║${c.reset}`);
      w(`${c.cyan}╚═══════════════════════════════════════════════════╝${c.reset}`);
      w(``);
      w(`${c.cyan}▸${c.reset} ${c.white}Vault setup${c.reset}       ${c.gray}— folders, templates, profiles (running in background)${c.reset}`);
      w(`${c.cyan}▸${c.reset} ${c.white}Companion plugins${c.reset} ${c.gray}— Templater, NL Dates, Update time (running in background)${c.reset}`);
      w(`${c.cyan}▸${c.reset} ${c.white}BMAD + vault scan${c.reset} ${c.gray}— runs on first AI session${c.reset}`);
      w(``);
      if (this.settings.preferredCli !== "none") {
        w(`${c.bold}${c.green}▸ Auto-launching ${this.settings.preferredCli} and sending first-run prompt…${c.reset}`);
        w(`  ${c.gray}(set Preferred AI CLI in settings to change this)${c.reset}`);
      } else {
        w(`${c.bold}What to do next:${c.reset}`);
        w(`  ${c.cyan}1.${c.reset} Type ${c.bold}claude${c.reset} or ${c.bold}devin${c.reset} to start your AI`);
        w(`  ${c.cyan}2.${c.reset} The AI will install BMAD and scan your vault automatically`);
        w(`  ${c.cyan}3.${c.reset} After that, just talk to your AI naturally`);
      }
      w(``);
      w(`${c.gray}─────────────────────────────────────────────────────${c.reset}`);
      w(``);
    } else {
      // ── Returning session ──────────────────────────────────────────────────
      w(`${c.cyan}${c.bold}${this.terminalName}${c.reset} ${c.dim}— Built by Abhijeet Garg${c.reset}`);
      w(`${c.dim}Type a command or let your AI take the wheel.${c.reset}`);
      w(``);
    }
  }

  // ─── Shell / PTY ────────────────────────────────────────────────────────────

  private resolveShell(): { shell: string; args: string[] } {
    if (this.settings.shellPath) {
      return { shell: this.settings.shellPath, args: this.settings.shellArgs };
    }

    if (process.platform === "win32") {
      const fs = require("fs");
      const candidates = [
        // hardcoded first — process.env may be undefined inside Electron renderer
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe",
        // env-based fallbacks
        (process.env["ProgramFiles"]    ?? "") + "\\PowerShell\\7\\pwsh.exe",
        (process.env["ProgramFiles(x86)"] ?? "") + "\\PowerShell\\7\\pwsh.exe",
        (process.env["LOCALAPPDATA"]    ?? "") + "\\Microsoft\\WindowsApps\\pwsh.exe",
        // last resort: inbox PowerShell 5
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ];
      for (const c of candidates) {
        if (!c.startsWith("\\") && c.length > 4) {
          try { if (fs.existsSync(c)) return { shell: c, args: [] }; } catch { /* skip */ }
        }
      }
      return { shell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", args: [] };
    }

    return { shell: process.env["SHELL"] ?? "/bin/bash", args: [] };
  }

  private async spawnPty(): Promise<void> {
    if (this.isUnloaded) return;

    const ptyPath = require("path").join(this.pluginDir, "node_modules", "node-pty");
    console.log("[BrainTerminal] loading node-pty from:", ptyPath);
    const nodePty = require(ptyPath);
    const { shell, args } = this.resolveShell();
    console.log("[BrainTerminal] spawning shell:", shell, args);
    const { cols, rows } = this.terminal ?? { cols: 80, rows: 24 };

    btLog("spawning PTY", shell, args);
    this.onFirstTerminal?.();

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
      useConpty: false,  // ConPTY deadlocks in Obsidian's Electron — use winpty
    }) as IPty;

    // Welcome message
    this.printWelcome();

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

    // Auto-launch preferred CLI + first-run prompt if vault AGENT.md has first_run: true
    if (this.settings.preferredCli !== "none") {
      this.maybeAutoLaunchCli();
    }
  }

  private maybeAutoLaunchCli(): void {
    try {
      const fs   = require("fs");
      const path = require("path");
      const vaultRoot = (this.app.vault.adapter as any).basePath ?? "";
      const agentPath = path.join(vaultRoot, "AGENT.md");
      if (!fs.existsSync(agentPath)) return;
      const content = fs.readFileSync(agentPath, "utf8");
      if (!content.includes("first_run: true")) return;

      const cli    = this.settings.preferredCli; // "devin" | "claude"
      const prompt = "Read AGENT.md now. It says first_run: true — run the First Run Sequence immediately, starting with Step 0. Do not wait for further input.";

      // Watch the PTY output stream for a shell prompt character (> or $),
      // then send the CLI command. This is reliable regardless of shell startup time.
      let launched = false;
      let buf = "";
      const unsub = this.pty?.onData((data: string) => {
        if (launched) { unsub?.dispose(); return; }
        buf += data;
        // PowerShell shows "PS C:\...>" or "> ", bash shows "$ "
        if (buf.includes(">") || buf.includes("$ ") || buf.includes("% ")) {
          launched = true;
          unsub?.dispose();
          // Small extra delay so the prompt fully renders before we type
          setTimeout(() => {
            this.pty?.write(cli + "\r");
            // Wait for the CLI to finish loading (watch for its prompt/ready signal)
            // Devin shows its UI, Claude shows its prompt — give them time
            // Wait for CLI output to go quiet for 1.5s — that means it's ready for input
            let cliReady = false;
            let quietTimer: ReturnType<typeof setTimeout> | null = null;
            const unsubCli = this.pty?.onData((_d: string) => {
              if (cliReady) { unsubCli?.dispose(); return; }
              // Reset the quiet timer every time new data arrives
              if (quietTimer) clearTimeout(quietTimer);
              quietTimer = setTimeout(() => {
                cliReady = true;
                unsubCli?.dispose();
                this.pty?.write(prompt + "\r");
              }, 1500);
            });
            // Safety timeout: send after 12s regardless
            setTimeout(() => {
              if (!cliReady) {
                cliReady = true;
                if (quietTimer) clearTimeout(quietTimer);
                this.pty?.write(prompt + "\r");
              }
            }, 12000);
          }, 300);
        }
      });

      // Safety timeout: if shell never shows a prompt in 10s, give up
      setTimeout(() => { if (!launched) unsub?.dispose(); }, 10000);
    } catch { /* non-fatal */ }
  }

  private async restartPty(): Promise<void> {
    this.killPty();
    await this.spawnPty();
  }

  // ─── Keyboard forwarding ────────────────────────────────────────────────────

  private registerKeyForwarding(): void {
    // 1. Obsidian Scope for Ctrl+A-Z and Alt+A-Z
    this.scope = new Scope();
    for (let c = 65; c <= 90; c++) {
      const key = String.fromCharCode(c);
      this.scope.register(["Ctrl"], key, (e: KeyboardEvent) => {
        this.forwardCtrlKeyToPty(key, e.shiftKey);
        return false;
      });
      this.scope.register(["Alt"], key, () => {
        this.terminal?.write(`\x1b${key.toLowerCase()}`);
        return false;
      });
    }
    this.app.keymap.pushScope(this.scope);

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
      this.app.keymap.popScope(this.scope);
      this.scope = null;
    }
    this.killPty();
    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
  }
}
