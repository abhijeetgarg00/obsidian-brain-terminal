import { Plugin, WorkspaceLeaf, TFile, MarkdownView, normalizePath } from "obsidian";
import { BrainTerminalSettings, DEFAULT_SETTINGS, VIEW_TYPE_TERMINAL, btLog } from "./constants";
import { BrainTerminalSettingTab } from "./settings";
import { TerminalView } from "./terminal-view";
import { diffExtension, setDiffEffect } from "./diff-decoration";
import { computeDiff } from "./diff-engine";

const MAX_CACHE = 2000;
const DIFF_FADE_MS = 10_000;
const MODIFY_DEBOUNCE_MS = 600;

export default class BrainTerminalPlugin extends Plugin {
  settings!: BrainTerminalSettings;

  private contextFile = "";
  private openNoteFile = "";
  private fileContentCache: Map<string, string[]> = new Map();
  private diffFadeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private modifyDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private pendingDiffBaselines: Map<string, string[]> = new Map();
  private openNoteWatcher: ReturnType<typeof setInterval> | null = null;
  private isUnloaded = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    const dir = (this.app.vault.adapter as any).basePath
      ? require("path").join((this.app.vault.adapter as any).basePath, ".obsidian", "plugins", this.manifest.id)
      : this.manifest.dir ?? "";
    this.contextFile  = require("path").join(dir, ".context");
    this.openNoteFile = require("path").join(dir, ".open-note");

    this.registerView(VIEW_TYPE_TERMINAL, leaf => new TerminalView(leaf, this.settings, dir));

    this.addRibbonIcon("terminal", "Brain: New Terminal", () => this.createNewTerminal());
    this.addCommand({ id: "toggle-terminal", name: "Brain: Toggle Terminal", callback: () => this.toggleTerminal() });
    this.addCommand({ id: "new-terminal",    name: "Brain: New Terminal",    callback: () => this.createNewTerminal() });

    this.addSettingTab(new BrainTerminalSettingTab(this.app, this));
    this.registerEditorExtension(diffExtension);
    this.registerImagePasteHandler();

    // Snapshot open files for diff baseline
    this.app.workspace.iterateAllLeaves(leaf => {
      if (leaf.view instanceof MarkdownView && leaf.view.file) {
        this.snapshotFile(leaf.view.file.path);
      }
    });

    this.updateContext();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateContext()));
    this.registerEvent(this.app.vault.on("create", f => { if (f instanceof TFile && f.extension === "md") this.handleCreate(f); }));
    this.registerEvent(this.app.vault.on("modify", f => { if (f instanceof TFile && f.extension === "md") this.handleModify(f); }));

    this.openNoteWatcher = setInterval(() => this.checkOpenNote(), 250);

    await this.maybeScaffoldStarterPack();
    btLog("loaded");
  }

  onunload(): void {
    this.isUnloaded = true;
    if (this.openNoteWatcher) clearInterval(this.openNoteWatcher);
    this.diffFadeTimers.forEach(t => clearTimeout(t));
    this.modifyDebounceTimers.forEach(t => clearTimeout(t));
    this.diffFadeTimers.clear();
    this.modifyDebounceTimers.clear();
    this.fileContentCache.clear();
    this.pendingDiffBaselines.clear();
    try { require("fs").unlinkSync(this.contextFile); } catch { /* */ }
    try { require("fs").unlinkSync(this.openNoteFile); } catch { /* */ }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
    btLog("unloaded");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ─── Terminal ────────────────────────────────────────────────────────────────

  private createNewTerminal(): void {
    const leaf = this.app.workspace.getRightLeaf(false);
    leaf?.setViewState({ type: VIEW_TYPE_TERMINAL });
  }

  private toggleTerminal(): void {
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

  private _lastOpenNote = "";
  private async checkOpenNote(): Promise<void> {
    if (this.isUnloaded) return;
    try {
      const raw = require("fs").readFileSync(this.openNoteFile, "utf8");
      if (raw === this._lastOpenNote) return;
      this._lastOpenNote = raw;
      require("fs").writeFileSync(this.openNoteFile, "", "utf8");
      const { parseOpenSignal } = await import("./parse-open-signal");
      const vaultRoot = (this.app.vault.adapter as any).basePath ?? "";
      for (const lineRaw of raw.split("\n")) {
        const sig = parseOpenSignal(lineRaw, vaultRoot);
        if (sig) this.openNote(sig.path, sig.line);
      }
    } catch { /* file not created yet */ }
  }

  private openNote(vaultRelPath: string, line?: number): void {
    const file = this.app.vault.getFileByPath(normalizePath(vaultRelPath));
    if (!file) return;
    const existing = this.app.workspace.getLeavesOfType("markdown")
      .find(l => (l.view as MarkdownView).file?.path === file.path);
    if (existing) {
      if (line && existing.view instanceof MarkdownView)
        existing.view.editor.setCursor({ line: line - 1, ch: 0 });
      return;
    }
    this.app.workspace.openLinkText(file.path, "", false).then(() => {
      if (!line) return;
      setTimeout(() => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf?.view instanceof MarkdownView)
          leaf.view.editor.setCursor({ line: line - 1, ch: 0 });
      }, 100);
    });
  }

  // ─── Diff ────────────────────────────────────────────────────────────────────

  private snapshotFile(filePath: string): void {
    try {
      const abs = require("path").join((this.app.vault.adapter as any).basePath ?? "", filePath);
      const raw = require("fs").readFileSync(abs, "utf8");
      this.cacheSet(filePath, raw.replace(/\r\n/g, "\n").split("\n"));
    } catch { /* */ }
  }

  private cacheSet(filePath: string, lines: string[]): void {
    if (this.fileContentCache.size >= MAX_CACHE) {
      const first = this.fileContentCache.keys().next().value;
      if (first) this.fileContentCache.delete(first);
    }
    this.fileContentCache.set(filePath, lines);
  }

  private async handleCreate(file: TFile): Promise<void> {
    if (this.isUnloaded) return;
    await new Promise(r => setTimeout(r, 500));
    const content = await this.app.vault.read(file);
    const newLines = content.split("\n");
    const baseline = this.pendingDiffBaselines.get(file.path) ?? [];
    this.pendingDiffBaselines.delete(file.path);
    this.cacheSet(file.path, newLines);
    const diff = computeDiff(baseline, newLines);
    if (diff.hunks.length > 0) this.showDiff(file, diff);
    this.startFadeTimer(file.path, newLines);
  }

  private handleModify(file: TFile): void {
    if (this.isUnloaded) return;
    const t = this.modifyDebounceTimers.get(file.path);
    if (t) clearTimeout(t);
    this.modifyDebounceTimers.set(
      file.path,
      setTimeout(() => this.doModify(file), MODIFY_DEBOUNCE_MS)
    );
  }

  private async doModify(file: TFile): Promise<void> {
    if (this.isUnloaded) return;
    this.modifyDebounceTimers.delete(file.path);
    const baseline = this.fileContentCache.get(file.path);
    const content = await this.app.vault.read(file);
    const newLines = content.split("\n");
    this.cacheSet(file.path, newLines);
    if (!baseline) { this.startFadeTimer(file.path, newLines); return; }
    const diff = computeDiff(baseline, newLines);
    if (diff.hunks.length > 0) this.showDiff(file, diff);
    this.startFadeTimer(file.path, newLines);
  }

  private startFadeTimer(filePath: string, baseline: string[]): void {
    const t = this.diffFadeTimers.get(filePath);
    if (t) clearTimeout(t);
    this.diffFadeTimers.set(filePath, setTimeout(() => {
      if (this.isUnloaded) return;
      this.clearDiff(filePath);
      this.diffFadeTimers.delete(filePath);
      this.cacheSet(filePath, baseline);
    }, DIFF_FADE_MS));
  }

  private showDiff(file: TFile, diff: import("./diff-engine").DiffResult): void {
    const leaf = this.app.workspace.getLeavesOfType("markdown")
      .find(l => (l.view as MarkdownView).file?.path === file.path);
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    const cm = (leaf.view.editor as any).cm;
    if (cm) cm.dispatch({ effects: setDiffEffect.of(diff) });
  }

  private clearDiff(filePath: string): void {
    const leaf = this.app.workspace.getLeavesOfType("markdown")
      .find(l => (l.view as MarkdownView).file?.path === filePath);
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    const cm = (leaf.view.editor as any).cm;
    if (cm) cm.dispatch({ effects: setDiffEffect.of(null) });
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

  // ─── Starter pack ────────────────────────────────────────────────────────────

  private async maybeScaffoldStarterPack(): Promise<void> {
    const data = (await this.loadData()) ?? {};
    if (data.starterPackVersion) return;
    try {
      const { STARTER_PACK, STARTER_PACK_VERSION } = await import("./starter-pack");
      for (const { path: p, content } of STARTER_PACK) {
        const norm = normalizePath(p);
        if (!await this.app.vault.adapter.exists(norm))
          await this.app.vault.create(norm, content);
      }
      await this.saveData({ ...data, starterPackVersion: STARTER_PACK_VERSION });
      btLog("starter pack scaffolded");
    } catch { btLog("starter pack not bundled — skipping"); }
  }
}
