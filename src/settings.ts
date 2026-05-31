import { App, PluginSettingTab, Setting } from "obsidian";
import type BrainTerminalPlugin from "./main";
import { DEFAULT_SETTINGS } from "./constants";

export class BrainTerminalSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BrainTerminalPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Shell path")
      .setDesc("Leave blank to auto-detect (PowerShell 7 on Windows, $SHELL on Unix).")
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
      .setDesc("Command written to the shell on first open (e.g. devin, claude, windsurf).")
      .addText(text =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.startupCommand)
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
  }
}
