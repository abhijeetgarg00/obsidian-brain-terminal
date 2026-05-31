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

    this.vaultRoot = (this.app.vault.adapter as any).basePath ?? "";
    const dir = this.vaultRoot
      ? require("path").join(this.vaultRoot, ".obsidian", "plugins", this.manifest.id)
      : this.manifest.dir ?? "";
    this.contextFile  = require("path").join(dir, ".context");
    this.openNoteFile = require("path").join(dir, ".open-note");

    this.registerView(VIEW_TYPE_TERMINAL, leaf => new TerminalView(leaf, this.settings, dir, () => this.onFirstTerminal()));

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
      await this.maybeScaffoldStarterPack();
      await this.maybeInstallCompanionPlugins();
      await this.maybeInstallBmad();
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

  // ─── Starter pack ────────────────────────────────────────────────────────────

  private async maybeScaffoldStarterPack(): Promise<void> {
    let data = (await this.loadData()) ?? {};
    let { STARTER_PACK, STARTER_PACK_VERSION } = { STARTER_PACK: [] as any[], STARTER_PACK_VERSION: "0" };
    try {
      ({ STARTER_PACK, STARTER_PACK_VERSION } = await import("./starter-pack"));
    } catch { btLog("starter pack not bundled — skipping"); return; }

    const installedVersion = data.starterPackVersion ?? "0";

    // ── Detect existing vault structure ──────────────────────────────────────
    const vaultState = await this.detectVaultState();
    btLog("vault state:", vaultState);

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
        await this.copyBridgeFiles(STARTER_PACK); // bridge files
        // Copy only templates that don't exist yet
        for (const { path: p, content } of STARTER_PACK) {
          if (!normalizePath(p).includes("_templates")) continue;
          const norm = normalizePath(p);
          if (!await this.app.vault.adapter.exists(norm))
            await this.app.vault.create(norm, content);
        }

      } else {
        // Empty vault — scaffold everything from scratch
        btLog("empty vault — scaffolding full structure");
        await this.scaffoldVaultStructure();   // folders + Home.md
        for (const { path: p, content } of STARTER_PACK) {
          const norm = normalizePath(p);
          if (!await this.app.vault.adapter.exists(norm))
            await this.app.vault.create(norm, content);
        }
        new (require("obsidian").Notice)("Brain Terminal: vault structure created! Check Home.md to get started.");
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
    const checks = [
      { path: "_templates", weight: 2 },   // templates folder = strong signal
      { path: "project",    weight: 2 },   // project folder = strong signal
      { path: "skills",     weight: 1 },
      { path: "ideas",      weight: 1 },
      { path: "learning",   weight: 1 },
      { path: "CLAUDE.md",           weight: 1 },
      { path: ".brain/AGENT.md",     weight: 2 },
    ];
    let score = 0;
    for (const c of checks) {
      if (await this.app.vault.adapter.exists(normalizePath(c.path))) score += c.weight;
    }
    // Also check if _templates has actual .md files in it
    let templateCount = 0;
    if (await this.app.vault.adapter.exists(normalizePath("_templates"))) {
      const listed = await this.app.vault.adapter.list(normalizePath("_templates"));
      templateCount = (listed.files ?? []).filter((f: string) => f.endsWith(".md")).length;
      if (templateCount >= 3) score += 2;
    }
    if (score >= 6) return "good";     // well organized — skip setup
    if (score >= 2) return "partial";  // some structure — create missing pieces
    return "empty";                    // blank vault — create everything
  }

  /** Create the full recommended folder + README structure for a blank/partial vault */
  private async scaffoldVaultStructure(): Promise<void> {
    const fs = require("fs");
    const path = require("path");
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

    // Create folders (Obsidian needs at least one file in each)
    for (const folder of folders) {
      const norm = normalizePath(folder);
      if (!await this.app.vault.adapter.exists(norm)) {
        // Create a .gitkeep so the folder exists
        await this.app.vault.create(normalizePath(`${folder}/.gitkeep`), "");
        btLog("created folder:", folder);
      }
    }

    // Create a Home note as the vault entry point
    const homePath = normalizePath("Home.md");
    if (!await this.app.vault.adapter.exists(homePath)) {
      await this.app.vault.create(homePath,
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

  /** Copy only bridge files (CLAUDE.md, .brain/, .agents/AGENT.md) — skip templates */
  private async copyBridgeFiles(pack: any[]): Promise<void> {
    const bridgePaths = [
      "CLAUDE.md",
      ".brain/AGENT.md",
      ".brain/vault-structure.md",
      ".brain/note-format.md",
      ".brain/profiles/note-manager.md",
      ".brain/profiles/brainstormer.md",
      ".brain/profiles/researcher.md",
      ".brain/profiles/project-manager.md",
      ".brain/profiles/git-manager.md",
      ".brain/profiles/mermaid-writer.md",
      ".agents/AGENT.md",
    ];
    for (const { path: p, content } of pack) {
      const norm = normalizePath(p);
      if (bridgePaths.some(b => norm.endsWith(normalizePath(b)))) {
        if (!await this.app.vault.adapter.exists(norm))
          await this.app.vault.create(norm, content);
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
      repo: "beaussan/update-time-on-edit",
    },
    {
      id:   "nldates-obsidian",
      name: "Natural Language Dates",
      repo: "argenos/nldates-obsidian",
    },
  ];

  private async maybeInstallCompanionPlugins(): Promise<void> {
    const data = (await this.loadData()) ?? {};
    if (data.companionPluginsInstalled) return;

    const plugins = (this.app as any).plugins;
    if (!plugins) return;

    const missing = this.COMPANION_PLUGINS.filter(p => !plugins.manifests[p.id]);
    if (!missing.length) {
      await this.saveData({ ...data, companionPluginsInstalled: true });
      return;
    }

    btLog("installing companion plugins:", missing.map(p => p.id).join(", "));

    for (const plugin of missing) {
      try {
        // Download manifest from GitHub releases
        const manifestUrl = `https://github.com/${plugin.repo}/releases/latest/download/manifest.json`;
        const mainUrl     = `https://github.com/${plugin.repo}/releases/latest/download/main.js`;
        const stylesUrl   = `https://github.com/${plugin.repo}/releases/latest/download/styles.css`;

        const pluginDir = normalizePath(`.obsidian/plugins/${plugin.id}`);
        const adapter   = this.app.vault.adapter;

        if (!await adapter.exists(pluginDir)) {
          await adapter.mkdir(pluginDir);
        }

        // Fetch and write manifest.json
        const manifestRes = await fetch(manifestUrl);
        if (!manifestRes.ok) throw new Error(`manifest fetch failed: ${manifestRes.status}`);
        await adapter.write(normalizePath(`${pluginDir}/manifest.json`), await manifestRes.text());

        // Fetch and write main.js
        const mainRes = await fetch(mainUrl);
        if (!mainRes.ok) throw new Error(`main.js fetch failed: ${mainRes.status}`);
        await adapter.write(normalizePath(`${pluginDir}/main.js`), await mainRes.text());

        // Fetch styles.css if it exists (optional)
        try {
          const stylesRes = await fetch(stylesUrl);
          if (stylesRes.ok) await adapter.write(normalizePath(`${pluginDir}/styles.css`), await stylesRes.text());
        } catch { /* no styles — fine */ }

        // Enable the plugin
        await plugins.loadPlugin(plugin.id);
        await plugins.enablePlugin(plugin.id);

        btLog("installed companion plugin:", plugin.id);
      } catch (e) {
        btLog("failed to install", plugin.id, e);
      }
    }

    await this.saveData({ ...data, companionPluginsInstalled: true });

    const installedNames = missing.map(p => p.name).join(", ");
    new (require("obsidian").Notice)(
      `Brain Terminal: installed companion plugins — ${installedNames}`,
      8000
    );
  }

  // ─── BMAD install ────────────────────────────────────────────────────────────

  private async maybeInstallBmad(): Promise<void> {
    const data = (await this.loadData()) ?? {};
    if (data.bmadInstalled) return;

    // Check if already installed — .claude/skills or .agents/skills exists with content
    const alreadyInstalled =
      await this.isBmadPresent(".claude/skills") ||
      await this.isBmadPresent(".agents/skills");

    if (alreadyInstalled) {
      btLog("BMAD already present — skipping install");
      await this.saveData({ ...data, bmadInstalled: true });
      return;
    }

    btLog("BMAD not found — running npx bmad-method install");
    new (require("obsidian").Notice)(
      "Brain Terminal: installing BMAD agent suite (this takes ~30s)…",
      6000
    );

    try {
      await this.runBmadInstall();
      await this.saveData({ ...data, bmadInstalled: true });
      new (require("obsidian").Notice)(
        "Brain Terminal: BMAD installed — 69 AI agents ready in your vault!",
        8000
      );
      btLog("BMAD install complete");
    } catch (e) {
      btLog("BMAD install failed:", e);
      new (require("obsidian").Notice)(
        `Brain Terminal: BMAD install failed — open Brain Terminal and run:\nnpx bmad-method install --directory "${this.vaultRoot}" --tools claude-code,windsurf --yes`,
        12000
      );
    }
  }

  /** Returns true if the BMAD skills folder exists and has at least one subfolder */
  private async isBmadPresent(skillsPath: string): Promise<boolean> {
    const norm = normalizePath(skillsPath);
    if (!await this.app.vault.adapter.exists(norm)) return false;
    const listed = await this.app.vault.adapter.list(norm);
    return (listed.folders ?? []).length > 0;
  }

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
