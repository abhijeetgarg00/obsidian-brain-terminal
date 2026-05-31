import { Plugin, WorkspaceLeaf, TFile, MarkdownView, normalizePath } from "obsidian";
import { BrainTerminalSettings, DEFAULT_SETTINGS, VIEW_TYPE_TERMINAL, btLog } from "./constants";
import { BrainTerminalSettingTab } from "./settings";
import { TerminalView } from "./terminal-view";
import { diffExtension, setDiffEffect } from "./diff-decoration";
import { computeDiff } from "./diff-engine";
import { STARTER_PACK, STARTER_PACK_VERSION } from "./starter-pack";

const MAX_CACHE = 2000;
const DIFF_FADE_MS = 10_000;
const MODIFY_DEBOUNCE_MS = 600;

export default class BrainTerminalPlugin extends Plugin {
  settings!: BrainTerminalSettings;

  private vaultRoot = "";
  private contextFile = "";
  private openNoteFile = "";

  // Diff system
  private fileContentCache: Map<string, string[]> = new Map();
  private diffFadeTimers: Map<string, { baseline: string[]; timer: ReturnType<typeof setTimeout> }> = new Map();
  private modifyDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingDiffBaselines: Map<string, string[]> = new Map();
  private shownScrollLines: Map<string, Set<number>> = new Map();

  private openNoteWatcher: ReturnType<typeof setInterval> | null = null;
  private _lastOpenNote = "";
  private isUnloaded = false;
  private _snapshotDone = false;

  // ─── Load ───────────────────────────────────────────────────────────────────

  async onload(): Promise<void> {
    await this.loadSettings();
    // Cache plugin data so isPluginFirstRun() can read it synchronously
    (this as any)._loadedData = (await this.loadData()) ?? {};

    this.vaultRoot = (this.app.vault.adapter as any).basePath ?? "";
    const dir = this.vaultRoot
      ? require("path").join(this.vaultRoot, ".obsidian", "plugins", this.manifest.id)
      : this.manifest.dir ?? "";
    this.contextFile  = require("path").join(dir, ".context");
    this.openNoteFile = require("path").join(dir, ".open-note");

    this.registerView(VIEW_TYPE_TERMINAL, leaf => new TerminalView(
      leaf, this.settings, dir,
      () => this.onFirstTerminal(),
      this.isPluginFirstRun(),
    ));

    this.addRibbonIcon("brain", "Brain Terminal", () => this.createNewTerminal());
    this.addCommand({ id: "toggle-terminal", name: "Brain: Toggle Terminal", callback: () => this.toggleTerminal() });
    this.addCommand({ id: "new-terminal",    name: "Brain: New Terminal",    callback: () => this.createNewTerminal() });

    this.addSettingTab(new BrainTerminalSettingTab(this.app, this));
    this.registerEditorExtension(diffExtension);
    this.app.workspace.updateOptions(); // force existing editors to pick up diffExtension
    this.registerImagePasteHandler();

    this.updateContext();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.updateContext();
      // Snapshot the newly-active file so we always have a baseline
      const f = this.app.workspace.getActiveFile();
      if (f?.extension === "md") this.snapshotFile(f.path);
    }));

    this.registerEvent(this.app.vault.on("create", f => {
      if (f instanceof TFile && f.extension === "md") this.handleCreate(f);
    }));
    this.registerEvent(this.app.vault.on("modify", f => {
      if (f instanceof TFile && f.extension === "md") this.handleModify(f);
    }));

    this.openNoteWatcher = setInterval(() => this.checkOpenNote(), 250);

    this.app.workspace.onLayoutReady(async () => {
      console.log("[BrainTerminal] onLayoutReady fired");
      try { await this.maybeInstallNodePty(dir); } catch(e) { console.error("[BrainTerminal] maybeInstallNodePty error:", e); }
      try { await this.checkPrerequisites(); } catch(e) { console.error("[BrainTerminal] checkPrerequisites error:", e); }
      try { await this.maybeScaffoldStarterPack(); } catch(e) { console.error("[BrainTerminal] maybeScaffoldStarterPack error:", e); }
      try { await this.maybeInstallCompanionPlugins(); } catch(e) { console.error("[BrainTerminal] maybeInstallCompanionPlugins error:", e); }
      console.log("[BrainTerminal] onLayoutReady complete");
    });
    btLog("loaded");
  }

  onunload(): void {
    this.isUnloaded = true;
    if (this.openNoteWatcher) clearInterval(this.openNoteWatcher);
    this.diffFadeTimers.forEach(v => clearTimeout(v.timer));
    this.modifyDebounceTimers.forEach(t => clearTimeout(t));
    this.diffFadeTimers.clear();
    this.modifyDebounceTimers.clear();
    this.fileContentCache.clear();
    this.pendingDiffBaselines.clear();
    try { require("fs").unlinkSync(this.contextFile); } catch { /* */ }
    try { require("fs").writeFileSync(this.openNoteFile, "", "utf8"); } catch { /* */ }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
    btLog("unloaded");
  }

  // Called by TerminalView when the first terminal spawns
  onFirstTerminal(): void {
    if (this._snapshotDone) return;
    this._snapshotDone = true;
    btLog("first terminal — snapshotting all markdown files");
    // Synchronously snapshot every markdown file for diff baselines
    const fs = require("fs");
    const path = require("path");
    this.app.vault.getFiles().forEach(f => {
      if (f.extension !== "md") return;
      try {
        const abs = path.join(this.vaultRoot, f.path);
        const raw = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
        this.cacheSet(f.path, raw.split("\n"));
      } catch { /* */ }
    });
    btLog("snapshot done,", this.fileContentCache.size, "files");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ─── Terminal ────────────────────────────────────────────────────────────────

  private _toggleGuard = false;

  private createNewTerminal(): void {
    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("split");
    if (!leaf) return;
    leaf.setViewState({ type: VIEW_TYPE_TERMINAL }).then(() => {
      this.app.workspace.revealLeaf(leaf);
    });
  }

  private toggleTerminal(): void {
    if (this._toggleGuard) return;
    this._toggleGuard = true;
    setTimeout(() => this._toggleGuard = false, 300);
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (leaves.length > 0) leaves.forEach(l => l.detach());
    else this.createNewTerminal();
  }

  // ─── .context ────────────────────────────────────────────────────────────────

  private updateContext(): void {
    if (this.isUnloaded) return;
    const file = this.app.workspace.getActiveFile();
    const rel = file ? normalizePath(file.path) : "";
    try { require("fs").writeFileSync(this.contextFile, rel, "utf8"); } catch { /* */ }
  }

  // ─── .open-note ──────────────────────────────────────────────────────────────

  private async checkOpenNote(): Promise<void> {
    if (this.isUnloaded) return;
    try {
      const fs = require("fs");
      const raw = fs.readFileSync(this.openNoteFile, "utf8").trim();
      if (!raw || raw === this._lastOpenNote) return;
      this._lastOpenNote = raw;
      fs.writeFileSync(this.openNoteFile, "", "utf8"); // blank immediately

      const { parseOpenSignal } = await import("./parse-open-signal");
      for (const line of raw.split("\n")) {
        const sig = parseOpenSignal(line.trim(), this.vaultRoot);
        if (sig) await this.openNote(sig.path, sig.line);
      }

      // After opening, apply any pending diff baselines
      setTimeout(() => this.applyPendingDiffs(), 500);
    } catch { /* file not created yet */ }
  }

  private async openNote(vaultRelPath: string, line?: number): Promise<void> {
    const file = this.app.vault.getFileByPath(normalizePath(vaultRelPath));
    if (!file) { btLog("openNote: not found:", vaultRelPath); return; }
    btLog("openNote:", file.path, "line:", line);

    // Snapshot before open so diff baseline is ready
    this.snapshotFile(file.path);

    const existing = this.app.workspace.getLeavesOfType("markdown")
      .find(l => (l.view as MarkdownView).file?.path === file.path);

    if (existing) {
      this.app.workspace.revealLeaf(existing);
      if (line && existing.view instanceof MarkdownView)
        existing.view.editor.setCursor({ line: line - 1, ch: 0 });
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
    if (line && leaf.view instanceof MarkdownView) {
      setTimeout(() => {
        (leaf.view as MarkdownView).editor.setCursor({ line: line - 1, ch: 0 });
      }, 150);
    }
  }

  private async applyPendingDiffs(): Promise<void> {
    for (const [relPath, baseline] of this.pendingDiffBaselines) {
      const file = this.app.vault.getFileByPath(normalizePath(relPath));
      if (!file) continue;
      try {
        const content = await this.app.vault.read(file);
        const newLines = content.replace(/\r\n/g, "\n").split("\n");
        const diff = computeDiff(baseline, newLines);
        if (diff.hunks.length > 0) this.dispatchDiff(file, diff);
        this.startFadeTimer(relPath, baseline);
      } catch { /* */ }
      this.pendingDiffBaselines.delete(relPath);
    }
    this.restoreTerminalFocus();
  }

  // ─── Diff system ─────────────────────────────────────────────────────────────

  private cacheSet(filePath: string, lines: string[]): void {
    if (this.fileContentCache.size >= MAX_CACHE) {
      const first = this.fileContentCache.keys().next().value;
      if (first) this.fileContentCache.delete(first);
    }
    this.fileContentCache.set(filePath, lines);
  }

  private snapshotFile(filePath: string): void {
    if (this.fileContentCache.has(filePath)) return; // already cached
    try {
      const abs = require("path").join(this.vaultRoot, filePath);
      const raw = require("fs").readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
      this.cacheSet(filePath, raw.split("\n"));
    } catch { /* */ }
  }

  private startFadeTimer(filePath: string, baseline: string[]): void {
    const existing = this.diffFadeTimers.get(filePath);
    if (existing) {
      clearTimeout(existing.timer); // reset timer but KEEP original baseline
    }
    const keepBaseline = existing?.baseline ?? baseline;
    const timer = setTimeout(() => {
      if (this.isUnloaded) return;
      this.dispatchClearDiff(filePath);
      this.diffFadeTimers.delete(filePath);
      this.shownScrollLines.delete(filePath);
    }, DIFF_FADE_MS);
    this.diffFadeTimers.set(filePath, { baseline: keepBaseline, timer });
  }

  private async handleCreate(file: TFile): Promise<void> {
    if (this.isUnloaded) return;
    if (!this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL).length) return;
    await new Promise(r => setTimeout(r, 500));
    if (this.isUnloaded) return;
    const content = await this.app.vault.read(file);
    const newLines = content.replace(/\r\n/g, "\n").split("\n");
    this.cacheSet(file.path, newLines);
    const diff = computeDiff([], newLines);
    if (diff.hunks.length > 0) await this.showDiffHighlights(file, diff);
    this.startFadeTimer(file.path, []);
  }

  private handleModify(file: TFile): void {
    if (this.isUnloaded) return;
    if (!this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL).length) return;
    // Don't diff files the user is actively editing
    const active = this.app.workspace.getActiveFile();
    const isUserEditing = active?.path === file.path &&
      !this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL)
        .some(l => l === this.app.workspace.activeLeaf);
    if (isUserEditing) {
      // Just update cache silently
      this.app.vault.read(file).then(c => this.cacheSet(file.path, c.replace(/\r\n/g, "\n").split("\n")));
      return;
    }

    const t = this.modifyDebounceTimers.get(file.path);
    if (t) clearTimeout(t);
    this.modifyDebounceTimers.set(file.path,
      setTimeout(() => this.doModify(file), MODIFY_DEBOUNCE_MS)
    );
  }

  private async doModify(file: TFile): Promise<void> {
    if (this.isUnloaded) return;
    this.modifyDebounceTimers.delete(file.path);

    const content = await this.app.vault.read(file);
    const newLines = content.replace(/\r\n/g, "\n").split("\n");

    // Get baseline: prefer fade-timer's original baseline over cache
    const fadeEntry = this.diffFadeTimers.get(file.path);
    const baseline = fadeEntry?.baseline ?? this.fileContentCache.get(file.path);

    this.cacheSet(file.path, newLines);

    if (!baseline) {
      btLog("doModify: no baseline for", file.path, "— skipping diff");
      return;
    }

    const isOpen = this.app.workspace.getLeavesOfType("markdown")
      .some(l => (l.view as MarkdownView).file?.path === file.path);

    if (!isOpen) {
      // Store pending baseline — diff will be shown when .open-note opens this file
      if (!this.pendingDiffBaselines.has(file.path))
        this.pendingDiffBaselines.set(file.path, baseline);
      return;
    }

    const diff = computeDiff(baseline, newLines);
    btLog("doModify", file.path, "hunks:", diff.hunks.length, "added:", diff.addedCount, "removed:", diff.removedCount);
    if (diff.hunks.length > 0) await this.showDiffHighlights(file, diff);
    this.startFadeTimer(file.path, baseline);
  }

  // ─── showDiffHighlights ───────────────────────────────────────────────────────

  private async showDiffHighlights(file: TFile, diff: import("./diff-engine").DiffResult): Promise<void> {
    const restoreLeaf = this.app.workspace.activeLeaf;
    const isUserInTerminal = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL)
      .some(l => l === restoreLeaf);

    const existingLeaf = this.app.workspace.getLeavesOfType("markdown")
      .find(l => (l.view as MarkdownView).file?.path === file.path);

    if (existingLeaf) {
      // Path 1: file already open — dispatch decorations
      this.dispatchDiff(file, diff);

      // Only scroll if user is in terminal
      if (!isUserInTerminal) return;

      // Collect new scroll targets (lines not yet shown)
      const shown = this.shownScrollLines.get(file.path) ?? new Set<number>();
      const targets: number[] = [];
      for (const hunk of diff.hunks) {
        const firstNew = hunk.lines.find(l => l.type !== "removed" && l.newLineNo != null)?.newLineNo;
        if (firstNew && !shown.has(firstNew)) {
          targets.push(firstNew);
          shown.add(firstNew);
        }
      }
      this.shownScrollLines.set(file.path, shown);
      if (!targets.length) return;

      // Scroll through each hunk
      const dwell = targets.length === 1 ? 150 : 1200;
      this.app.workspace.revealLeaf(existingLeaf);
      for (const lineNo of targets) {
        await this.scrollEditorToLine(existingLeaf, lineNo);
        await new Promise(r => setTimeout(r, dwell));
      }
      // Restore focus to terminal
      if (restoreLeaf) this.app.workspace.setActiveLeaf(restoreLeaf, { focus: true });
      this.focusTerminal();

    } else {
      // Path 2: file not open — open in new tab, restore terminal focus immediately
      const newLeaf = this.app.workspace.getLeaf("tab");
      await newLeaf.openFile(file);
      this.app.workspace.revealLeaf(newLeaf);
      if (restoreLeaf) this.app.workspace.setActiveLeaf(restoreLeaf, { focus: true });
      this.focusTerminal();

      // Poll for cm to be ready then dispatch decorations
      let attempts = 0;
      const poll = setInterval(() => {
        if (this.isUnloaded || attempts++ > 10) { clearInterval(poll); return; }
        const cm = (newLeaf.view as any)?.editor?.cm;
        if (!cm) return;
        clearInterval(poll);
        cm.dispatch({ effects: setDiffEffect.of(diff) });
        // Scroll to first changed line
        const firstLine = diff.hunks[0]?.lines.find(l => l.type !== "removed" && l.newLineNo != null)?.newLineNo ?? 1;
        this.scrollEditorToLine(newLeaf, firstLine);
      }, 100);
    }
  }

  private dispatchDiff(file: TFile, diff: import("./diff-engine").DiffResult): void {
    const leaf = this.app.workspace.getLeavesOfType("markdown")
      .find(l => (l.view as MarkdownView).file?.path === file.path);
    if (!leaf) return;
    const cm = (leaf.view as any)?.editor?.cm;
    if (cm) cm.dispatch({ effects: setDiffEffect.of(diff) });
  }

  private dispatchClearDiff(filePath: string): void {
    const leaf = this.app.workspace.getLeavesOfType("markdown")
      .find(l => (l.view as MarkdownView).file?.path === filePath);
    if (!leaf) return;
    const cm = (leaf.view as any)?.editor?.cm;
    if (cm) cm.dispatch({ effects: setDiffEffect.of(null) });
  }

  private async scrollEditorToLine(leaf: WorkspaceLeaf, lineNo: number): Promise<void> {
    const cm = (leaf.view as any)?.editor?.cm;
    if (!cm) return;
    try {
      const { EditorView } = require("@codemirror/view");
      const pos = cm.state.doc.line(Math.min(lineNo, cm.state.doc.lines)).from;
      cm.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    } catch { /* @codemirror/view not available via require — use editor API */
      if (leaf.view instanceof MarkdownView)
        leaf.view.editor.setCursor({ line: lineNo - 1, ch: 0 });
    }
  }

  private focusTerminal(): void {
    const tLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL)[0];
    if (tLeaf) (tLeaf.view as any)?.focusTerminal?.();
  }

  private restoreTerminalFocus(): void {
    this.focusTerminal();
  }

  // ─── Image paste ─────────────────────────────────────────────────────────────

  private registerImagePasteHandler(): void {
    this.registerEvent(
      this.app.workspace.on("editor-paste" as any, (evt: ClipboardEvent, editor: any, view: MarkdownView) => {
        const files = Array.from(evt.clipboardData?.files ?? []).filter(f => f.type.startsWith("image/"));
        if (!files.length) return;
        evt.preventDefault();
        const activeFile = view.file;
        if (!activeFile) return;
        const attachDir = activeFile.parent?.path ? `${activeFile.parent.path}/attachments` : "attachments";
        for (const img of files) {
          const ext = img.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
          const name = `${activeFile.basename}-${Date.now()}.${ext}`;
          const dest = normalizePath(`${attachDir}/${name}`);
          img.arrayBuffer().then(async buf => {
            await this.app.vault.createBinary(dest, buf);
            editor.replaceSelection(`![[${dest}]]`);
          });
        }
      })
    );
  }

  // ─── node-pty bootstrap ──────────────────────────────────────────────────────

  /**
   * Download node-pty.zip from the GitHub release and extract it into the
   * plugin directory if node-pty isn't already present.
   */
  private async maybeInstallNodePty(pluginDir: string): Promise<void> {
    const path   = require("path");
    const fs     = require("fs");
    const ptyDir = path.join(pluginDir, "node_modules", "node-pty");
    const ptyLib = path.join(ptyDir, "lib", "index.js");

    if (fs.existsSync(ptyLib)) {
      btLog("node-pty already present — skipping install");
      return;
    }

    btLog("node-pty missing — downloading from release…");
    new (require("obsidian").Notice)(
      "Brain Terminal: downloading terminal engine (node-pty)… one moment.",
      8000
    );

    try {
      const zipUrl = `https://github.com/abhijeetgarg00/obsidian-brain-terminal/releases/download/${this.manifest.version}/node-pty.zip`;
      const zipPath = path.join(pluginDir, "node-pty.zip");

      // Download
      await this.downloadFile(zipUrl, zipPath);
      btLog("downloaded node-pty.zip");

      // Extract
      fs.mkdirSync(ptyDir, { recursive: true });
      await this.extractZip(zipPath, ptyDir);
      fs.unlinkSync(zipPath);

      btLog("node-pty installed successfully");
      new (require("obsidian").Notice)(
        "Brain Terminal: terminal engine ready.",
        4000
      );
    } catch (e: any) {
      btLog("node-pty install failed:", e.message);
      new (require("obsidian").Notice)(
        "Brain Terminal: failed to download terminal engine. Check your internet connection and reload Obsidian.",
        10000
      );
    }
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const https  = require("https");
      const http   = require("http");
      const fs     = require("fs");
      const module = url.startsWith("https") ? https : http;

      const follow = (u: string) => {
        module.get(u, (res: any) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            return follow(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }
          const out = fs.createWriteStream(dest);
          res.pipe(out);
          out.on("finish", () => out.close(resolve));
          out.on("error", reject);
        }).on("error", reject);
      };

      follow(url);
    });
  }

  private extractZip(zipPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { execFile } = require("child_process");
      const isWin = process.platform === "win32";

      if (isWin) {
        // Use PowerShell Expand-Archive (available on all modern Windows)
        execFile("powershell", [
          "-NoProfile", "-NonInteractive", "-Command",
          `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
        ], { timeout: 30000 }, (err: any) => err ? reject(err) : resolve());
      } else {
        execFile("unzip", ["-o", zipPath, "-d", destDir],
          { timeout: 30000 }, (err: any) => err ? reject(err) : resolve());
      }
    });
  }

  // ─── First run detection ─────────────────────────────────────────────────────

  /** True only until the first terminal has been opened and the user has seen the welcome screen */
  private _shownFirstRunWelcome = false;

  private isPluginFirstRun(): boolean {
    // Show first-run welcome only on the very first terminal open ever
    // After that always return false
    if (this._shownFirstRunWelcome) return false;
    const data = (this as any)._loadedData ?? {};
    const isFirst = !data.starterPackVersion || !data.seenWelcome;
    if (isFirst) {
      this._shownFirstRunWelcome = true;
      // Mark welcome as seen so next terminal in same session shows normal message
      this.loadData().then(d => this.saveData({ ...(d ?? {}), seenWelcome: true }));
    }
    return isFirst;
  }

  // ─── Prerequisites check ─────────────────────────────────────────────────────

  private async checkPrerequisites(): Promise<boolean> {
    const data = (await this.loadData()) ?? {};
    if (data.prerequisitesChecked) return true;

    const { execFile } = require("child_process");
    const isWin = process.platform === "win32";

    const check = (cmd: string, args: string[]): Promise<string | null> =>
      new Promise(resolve => {
        execFile(cmd, args, { timeout: 5000, shell: true }, (err: any, stdout: string) => {
          resolve(err ? null : stdout.trim());
        });
      });

    // Check Node/npx — needed only for BMAD auto-install
    const nodeVersion = await check(isWin ? "node.exe" : "node", ["--version"]);
    const npxVersion  = await check(isWin ? "npx.cmd"  : "npx",  ["--version"]);

    // Check PowerShell 7 — needed only for terminal on Windows
    let pwshOk = true;
    if (isWin) {
      pwshOk = (await check("pwsh.exe", ["--version"])) !== null;
    }

    btLog("prereq check — node:", nodeVersion, "npx:", npxVersion, "pwsh:", pwshOk);

    const warnings: { title: string; detail: string; affects: string }[] = [];

    if (!nodeVersion || !npxVersion) {
      warnings.push({
        title:   "Node.js is not installed",
        detail:  isWin
          ? "https://nodejs.org  (download LTS)"
          : "brew install node  OR  https://nodejs.org",
        affects: "BMAD agent suite will not auto-install. Everything else works fine.",
      });
    }

    if (isWin && !pwshOk) {
      warnings.push({
        title:   "PowerShell 7 (pwsh) is not installed",
        detail:  "winget install Microsoft.PowerShell  OR  https://aka.ms/powershell",
        affects: "The terminal will fall back to cmd.exe. All other features work fine.",
      });
    }

    await this.saveData({ ...data, prerequisitesChecked: true });

    if (warnings.length > 0) {
      this.showPrerequisitesModal(warnings);
    }

    // Always return true — warnings are informational, not blocking
    return true;
  }

  private showPrerequisitesModal(warnings: { title: string; detail: string; affects: string }[]): void {
    const { Modal } = require("obsidian");

    class PrereqModal extends Modal {
      private warnings: { title: string; detail: string; affects: string }[];
      constructor(app: any, warnings: any[]) {
        super(app);
        this.warnings = warnings;
      }
      onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "Brain Terminal is installed and working!" });

        contentEl.createEl("p", {
          text: "The terminal and all core features are ready. A couple of optional tools are missing that unlock extra features:",
        });

        this.warnings.forEach(w => {
          const box = contentEl.createEl("div");
          box.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:6px;padding:12px;margin:12px 0";

          box.createEl("strong", { text: "⚠ " + w.title });
          box.createEl("br");
          box.createEl("code",   { text: w.detail });
          box.createEl("p",      { text: "Impact: " + w.affects }).style.cssText =
            "margin:8px 0 0;font-size:0.85em;color:var(--text-muted)";
        });

        contentEl.createEl("p", {
          text: "Install any missing tools and restart Obsidian to activate those features.",
        }).style.marginTop = "12px";

        const btn = contentEl.createEl("button", { text: "OK — continue" });
        btn.style.cssText = "margin-top:12px;padding:8px 20px;cursor:pointer";
        btn.addEventListener("click", () => this.close());
      }
      onClose() { this.contentEl.empty(); }
    }

    new PrereqModal(this.app, warnings).open();
  }

  // ─── Starter pack ────────────────────────────────────────────────────────────

  private async maybeScaffoldStarterPack(force = false): Promise<void> {
    console.log("[BrainTerminal] maybeScaffoldStarterPack start, STARTER_PACK length:", STARTER_PACK.length, "version:", STARTER_PACK_VERSION);
    let data = (await this.loadData()) ?? {};
    console.log("[BrainTerminal] loaded data:", JSON.stringify(data));

    // ── Detect existing vault structure ──────────────────────────────────────
    const vaultState = await this.detectVaultState();
    console.log("[BrainTerminal] vault state:", vaultState);

    // If vault is empty, always re-run setup regardless of saved version
    // This handles the case where a previous install failed mid-way
    const installedVersion = (force || vaultState === "empty")
      ? "0"
      : (data.starterPackVersion ?? "0");

    // ── First install ─────────────────────────────────────────────────────────
    if (installedVersion === "0") {
      if (vaultState === "good") {
        // Well organized vault — only copy bridge files, never touch their content
        btLog("well-organized vault detected — copying bridge files only");
        await this.copyBridgeFiles(STARTER_PACK);

      } else if (vaultState === "partial") {
        // Some structure exists — create missing folders + missing templates only
        btLog("partial vault — creating missing folders and templates");
        await this.scaffoldVaultStructure();   // creates missing folders
        await this.ensureStarterPackDirs(STARTER_PACK);
        await this.copyBridgeFiles(STARTER_PACK); // bridge files
        // Copy only templates that don't exist yet (native fs)
        const fs   = require("fs");
        const path = require("path");
        for (const { path: p, content } of STARTER_PACK) {
          if (!normalizePath(p).includes("_templates")) continue;
          const abs = path.join(this.vaultRoot, normalizePath(p));
          if (!fs.existsSync(abs)) {
            fs.writeFileSync(abs, content, "utf8");
            btLog("wrote template:", p);
          }
        }

      } else {
        // Empty vault — scaffold everything from scratch
        btLog("empty vault — scaffolding full structure");
        await this.scaffoldVaultStructure();   // user folders + Home.md
        // Ensure all parent dirs for starter pack files exist
        await this.ensureStarterPackDirs(STARTER_PACK);
        await this.writeStarterFiles(STARTER_PACK);
        new (require("obsidian").Notice)("Brain Terminal: vault set up! Open the terminal to get started.", 6000);
      }

      await this.saveData({ ...data, starterPackVersion: STARTER_PACK_VERSION });
      btLog("starter pack installed v" + STARTER_PACK_VERSION);
      return;
    }

    // ── Update check ──────────────────────────────────────────────────────────
    if (STARTER_PACK_VERSION > installedVersion) {
      btLog("starter pack update:", installedVersion, "→", STARTER_PACK_VERSION);
      await this.applyStarterPackUpdate(STARTER_PACK, installedVersion, STARTER_PACK_VERSION);
      await this.saveData({ ...data, starterPackVersion: STARTER_PACK_VERSION });
    }
  }

  /** Checks how organized the vault is. Returns "good" | "partial" | "empty" */
  private async detectVaultState(): Promise<"good" | "partial" | "empty"> {
    // Score based on USER content — not plugin files (AGENT.md doesn't count)
    const checks = [
      { path: "_templates", weight: 2 },   // templates folder
      { path: "project",    weight: 2 },   // project folder
      { path: "skills",     weight: 1 },
      { path: "ideas",      weight: 1 },
      { path: "learning",   weight: 1 },
      { path: "training",   weight: 1 },
    ];
    let score = 0;
    for (const c of checks) {
      if (await this.app.vault.adapter.exists(normalizePath(c.path))) score += c.weight;
    }
    // Templates folder with actual notes = strong signal of organized vault
    if (await this.app.vault.adapter.exists(normalizePath("_templates"))) {
      const listed = await this.app.vault.adapter.list(normalizePath("_templates"));
      const count = (listed.files ?? []).filter((f: string) => f.endsWith(".md")).length;
      if (count >= 5) score += 3;       // lots of templates — well organized
      else if (count >= 1) score += 1;
    }
    if (score >= 6) return "good";     // well organized vault — skip setup
    if (score >= 2) return "partial";  // some structure — fill in gaps
    return "empty";                    // blank vault — create everything
  }

  /** Create the full recommended folder + README structure for a blank/partial vault */
  private async scaffoldVaultStructure(): Promise<void> {
    const folders = [
      "project",
      "skills",
      "ideas",
      "learning",
      "training",
      "docs",
      "images",
      "_templates",
      "AI Profiles",
    ];

    // Create folders using native fs — handles all folder names including spaces
    const fs   = require("fs");
    const path = require("path");
    for (const folder of folders) {
      const abs = path.join(this.vaultRoot, folder);
      if (!fs.existsSync(abs)) {
        fs.mkdirSync(abs, { recursive: true });
        btLog("created folder:", folder);
      }
    }

    // Create a Home note as the vault entry point (native fs — reliable)
    const homeAbs = path.join(this.vaultRoot, "Home.md");
    if (!fs.existsSync(homeAbs)) {
      fs.writeFileSync(homeAbs,
`---
tags:
  - "#home"
---
# Welcome to Your Vault

This vault is powered by **Brain Terminal** — an AI terminal inside Obsidian.

---

## Your Folders

| Folder | Purpose |
|---|---|
| [[project/]] | One subfolder per project |
| [[skills/]] | One note per skill |
| [[ideas/]] | Raw ideas and brainstorms |
| [[learning/]] | Learning journeys and research |
| [[training/]] | Training logs and habits |
| [[docs/]] | Reference documentation |
| [[AI Profiles/]] | AI persona configs |
| [[_templates/]] | Note templates — do not edit |

---

## Quick Start

1. Open Brain Terminal (brain icon in ribbon)
2. Run \`claude\` or \`devin\` in the terminal
3. Your AI can see what note you're on and edit your vault live

---

## Brain Terminal Files

- \`.brain/AGENT.md\` — your AI router (living document)
- \`.brain/vault-structure.md\` — your vault map (auto-updated)
- \`CLAUDE.md\` — Claude Code instructions
`);
      btLog("created Home.md");
    }
  }

  /** Ensure every parent directory for starter pack files exists */
  private async ensureStarterPackDirs(pack: any[]): Promise<void> {
    const fs   = require("fs");
    const path = require("path");
    const dirs = new Set<string>();
    for (const { path: p } of pack) {
      const parts = normalizePath(p).split("/");
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"));
      }
    }
    for (const dir of dirs) {
      // Use native fs.mkdirSync — vault.adapter.mkdir silently skips dot-folders on Windows
      const abs = path.join(this.vaultRoot, dir);
      if (!fs.existsSync(abs)) {
        fs.mkdirSync(abs, { recursive: true });
        btLog("mkdir (native):", abs);
      }
    }
  }

  /** Write all starter pack files using native fs (handles hidden dot-folders on Windows) */
  private writeStarterFiles(pack: any[]): void {
    const fs   = require("fs");
    const path = require("path");
    for (const { path: p, content } of pack) {
      const abs = path.join(this.vaultRoot, normalizePath(p).replace(/\//g, path.sep));
      if (!fs.existsSync(abs)) {
        fs.writeFileSync(abs, content, "utf8");
        btLog("wrote:", p);
      }
    }
  }

  /** Copy only bridge files (CLAUDE.md, AGENT.md, .brain/, .agents/) — skip templates */
  private async copyBridgeFiles(pack: any[]): Promise<void> {
    const fs   = require("fs");
    const path = require("path");
    const bridgePaths = [
      "CLAUDE.md",
      "AGENT.md",
      ".brain/AGENT.md",
      ".brain/vault-structure.md",
      ".brain/note-format.md",
      ".brain/profiles/note-manager.md",
      ".brain/profiles/brainstormer.md",
      ".agents/AGENT.md",
      ".devin/config.json",
      ".claude/settings.json",
    ];
    await this.ensureStarterPackDirs(pack);
    for (const { path: p, content } of pack) {
      const norm = normalizePath(p);
      if (bridgePaths.some(b => normalizePath(b) === norm)) {
        const abs = path.join(this.vaultRoot, norm.replace(/\//g, path.sep));
        if (!fs.existsSync(abs)) {
          fs.writeFileSync(abs, content, "utf8");
          btLog("wrote bridge:", p);
        }
      }
    }
  }

  /** Merge update: add new files, append new sections to existing profiles */
  private async applyStarterPackUpdate(pack: any[], oldVersion: string, newVersion: string): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);

    for (const { path: p, content, updateStrategy } of pack) {
      const norm = normalizePath(p);
      const exists = await this.app.vault.adapter.exists(norm);

      if (!exists) {
        // New file added in this version — always copy
        await this.app.vault.create(norm, content);
        btLog("update: added new file", norm);
        continue;
      }

      if (updateStrategy === "never") continue; // vault-structure.md — user owns it

      if (updateStrategy === "append" && exists) {
        // Append new sections to existing profiles/note-format
        const existing = await this.app.vault.adapter.read(norm);
        if (!existing.includes(`<!-- bt-version:${newVersion} -->`)) {
          const addition = `\n\n<!-- bt-version:${newVersion} -->\n${content}`;
          await this.app.vault.adapter.write(norm, existing + addition);
          btLog("update: appended new sections to", norm);
        }
        continue;
      }

      // Default: skip (never overwrite user content)
    }

    // Append update entry to AGENT.md update_log
    const agentPath = normalizePath(".brain/AGENT.md");
    if (await this.app.vault.adapter.exists(agentPath)) {
      const agentContent = await this.app.vault.adapter.read(agentPath);
      const logEntry = `  - "${date} — Plugin updated to v${newVersion}. New profiles and templates added."`;
      if (!agentContent.includes(logEntry)) {
        // Insert into update_log in frontmatter
        const updated = agentContent.replace(
          /^(update_log:.*?)(\n---)/ms,
          `$1\n${logEntry}$2`
        ).replace(
          /^(version:)\s*.+$/m,
          `$1 ${newVersion}`
        );
        await this.app.vault.adapter.write(agentPath, updated);
        btLog("update: AGENT.md version bumped to", newVersion);
      }
    }

    new (require("obsidian").Notice)(`Brain Terminal updated to v${newVersion} — new agent profiles available`);
  }

  // ─── Companion plugins ───────────────────────────────────────────────────────

  private readonly COMPANION_PLUGINS = [
    {
      id:   "templater-obsidian",
      name: "Templater",
      repo: "SilentVoid13/Templater",
    },
    {
      id:   "update-time-on-edit",
      name: "Update time on edit",
      repo: "beaussan/update-time-on-edit-obsidian",
    },
    {
      id:   "nldates-obsidian",
      name: "Natural Language Dates",
      repo: "argenos/nldates-obsidian",
    },
  ];

  private async maybeInstallCompanionPlugins(force = false): Promise<void> {
    const data = (await this.loadData()) ?? {};

    // Always verify plugins are actually on disk — don't just trust the flag
    const plugins = (this.app as any).plugins;
    if (!plugins) return;

    const missing = this.COMPANION_PLUGINS.filter(p => {
      // Missing if not in manifests OR plugin dir has no main.js
      if (plugins.manifests[p.id]) return false;
      const pluginDir = normalizePath(`.obsidian/plugins/${p.id}`);
      return true; // not in manifests = needs install
    });

    if (!force && data.companionPluginsInstalled && missing.length === 0) return;
    if (!missing.length) {
      await this.saveData({ ...data, companionPluginsInstalled: true });
      return;
    }

    btLog("installing companion plugins:", missing.map(p => p.id).join(", "));

    for (const plugin of missing) {
      try {
        const pluginDir = normalizePath(`.obsidian/plugins/${plugin.id}`);
        const adapter   = this.app.vault.adapter;

        if (!await adapter.exists(pluginDir)) {
          await adapter.mkdir(pluginDir);
        }

        // Use Node https — fetch() is blocked by CORS from app://obsidian.md
        const get = (url: string): Promise<string> => new Promise((resolve, reject) => {
          const https = require("https");
          const follow = (u: string) => {
            https.get(u, { headers: { "User-Agent": "obsidian-brain-terminal" } }, (res: any) => {
              if (res.statusCode === 301 || res.statusCode === 302) return follow(res.headers.location);
              if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
              const chunks: Buffer[] = [];
              res.on("data", (d: Buffer) => chunks.push(d));
              res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
              res.on("error", reject);
            }).on("error", reject);
          };
          follow(url);
        });

        const base = `https://github.com/${plugin.repo}/releases/latest/download`;
        const manifest = await get(`${base}/manifest.json`);
        await adapter.write(normalizePath(`${pluginDir}/manifest.json`), manifest);

        const main = await get(`${base}/main.js`);
        await adapter.write(normalizePath(`${pluginDir}/main.js`), main);

        try {
          const styles = await get(`${base}/styles.css`);
          await adapter.write(normalizePath(`${pluginDir}/styles.css`), styles);
        } catch { /* styles optional */ }

        // Refresh Obsidian's manifest cache so it knows the plugin exists
        if (typeof plugins.loadManifests === "function") await plugins.loadManifests();

        await plugins.loadPlugin(plugin.id);
        await plugins.enablePlugin(plugin.id);

        btLog("installed companion plugin:", plugin.id);
      } catch (e) {
        btLog("failed to install", plugin.id, e);
      }
    }

    await this.saveData({ ...data, companionPluginsInstalled: true });

    const { Notice, Modal, Setting } = require("obsidian");
    const installedNames = missing.map(p => p.name).join(", ");

    // Show a reload prompt — newly enabled plugins often need it
    class ReloadModal extends Modal {
      constructor(app: any) { super(app); }
      onOpen() {
        this.titleEl.setText("Companion plugins installed");
        this.contentEl.createEl("p", {
          text: `Installed and enabled: ${installedNames}. Reload Obsidian now so they fully activate?`
        });
        new Setting(this.contentEl)
          .addButton(btn => btn.setButtonText("Reload now").setCta().onClick(() => {
            this.close();
            (this.app as any).commands.executeCommandById("app:reload");
          }))
          .addButton(btn => btn.setButtonText("Later").onClick(() => this.close()));
      }
    }
    new ReloadModal(this.app).open();
  }

  // ─── BMAD install (manual, from settings page) ───────────────────────────────

  /** Spawn `npx bmad-method install` as a child process */
  private runBmadInstall(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { spawn } = require("child_process");
      const isWin = process.platform === "win32";

      const cmd  = isWin ? "npx.cmd" : "npx";
      const args = [
        "bmad-method", "install",
        "--directory", this.vaultRoot,
        "--tools",     "claude-code,windsurf",
        "--yes",
      ];

      btLog("spawning:", cmd, args.join(" "));

      const proc = spawn(cmd, args, {
        cwd:   this.vaultRoot,
        shell: false,
        env:   { ...process.env, CI: "1" },   // suppress interactive prompts
      });

      proc.stdout?.on("data", (d: Buffer) => btLog("[bmad]", d.toString().trim()));
      proc.stderr?.on("data", (d: Buffer) => btLog("[bmad err]", d.toString().trim()));

      proc.on("close", (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`bmad-method exited with code ${code}`));
      });

      proc.on("error", reject);
    });
  }
}
