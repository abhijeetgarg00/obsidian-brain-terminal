import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type BrainTerminalPlugin from "./main";
import { DEFAULT_SETTINGS } from "./constants";

export class BrainTerminalSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BrainTerminalPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Terminal ────────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Terminal" });

    new Setting(containerEl)
      .setName("Shell path")
      .setDesc("Leave blank to auto-detect (PowerShell 7 on Windows, $SHELL on Mac/Linux).")
      .addText(text =>
        text
          .setPlaceholder("e.g. C:\\Program Files\\PowerShell\\7\\pwsh.exe")
          .setValue(this.plugin.settings.shellPath)
          .onChange(async v => {
            this.plugin.settings.shellPath = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Startup command")
      .setDesc("Command to run automatically when a terminal opens (e.g. claude, devin, windsurf). Leave blank for a plain shell.")
      .addText(text =>
        text
          .setPlaceholder("e.g. claude")
          .setValue(this.plugin.settings.startupCommand)
          .onChange(async v => {
            this.plugin.settings.startupCommand = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Font family")
      .addText(text =>
        text
          .setValue(this.plugin.settings.fontFamily)
          .onChange(async v => {
            this.plugin.settings.fontFamily = v.trim() || DEFAULT_SETTINGS.fontFamily;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Font size")
      .addSlider(slider =>
        slider
          .setLimits(10, 24, 1)
          .setValue(this.plugin.settings.fontSize)
          .setDynamicTooltip()
          .onChange(async v => {
            this.plugin.settings.fontSize = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Scrollback lines")
      .addSlider(slider =>
        slider
          .setLimits(100, 50000, 100)
          .setValue(this.plugin.settings.scrollback)
          .setDynamicTooltip()
          .onChange(async v => {
            this.plugin.settings.scrollback = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Cursor blink")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.cursorBlink)
          .onChange(async v => {
            this.plugin.settings.cursorBlink = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Theme")
      .addDropdown(drop =>
        drop
          .addOption("light", "Light")
          .addOption("dark", "Dark")
          .setValue(this.plugin.settings.theme)
          .onChange(async v => {
            this.plugin.settings.theme = v as "light" | "dark";
            await this.plugin.saveSettings();
          })
      );

    // ── Vault Setup ─────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Vault Setup" });

    new Setting(containerEl)
      .setName("Re-run vault setup")
      .setDesc("Re-copies CLAUDE.md, AGENT.md, profiles, and any missing templates to your vault. Safe — never overwrites existing files.")
      .addButton(btn =>
        btn
          .setButtonText("Re-run setup")
          .onClick(async () => {
            await (this.plugin as any).maybeScaffoldStarterPack(true);
            new Notice("Brain Terminal: vault setup complete.");
          })
      );

    new Setting(containerEl)
      .setName("Install BMAD agent suite")
      .setDesc("Runs npx bmad-method install — installs 69 AI agents into your vault. Requires Node.js.")
      .addButton(btn =>
        btn
          .setButtonText("Install BMAD")
          .onClick(async () => {
            new Notice("Installing BMAD… this takes ~30s.");
            try {
              await (this.plugin as any).runBmadInstall();
              new Notice("BMAD installed — 69 agents ready!");
            } catch {
              new Notice("BMAD install failed. Make sure Node.js is installed and try again.");
            }
          })
      );

    new Setting(containerEl)
      .setName("Install companion plugins")
      .setDesc("Auto-installs Templater, Update time on edit, and Natural Language Dates if missing.")
      .addButton(btn =>
        btn
          .setButtonText("Install companions")
          .onClick(async () => {
            await (this.plugin as any).maybeInstallCompanionPlugins(true);
          })
      );

    // ── About ───────────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "About" });

    const about = containerEl.createEl("div");
    about.style.cssText = "color:var(--text-muted);font-size:0.9em;line-height:1.6";
    about.createEl("p", { text: "Brain Terminal — AI terminal inside Obsidian with live diff highlighting." });
    about.createEl("p").innerHTML =
      'Built by <a href="https://github.com/abhijeetgarg00" target="_blank">Abhijeet Garg</a> · ' +
      '<a href="https://github.com/abhijeetgarg00/obsidian-brain-terminal" target="_blank">GitHub</a>';
  }
}
