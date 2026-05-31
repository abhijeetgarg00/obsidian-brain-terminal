import type { ITheme } from "@xterm/xterm";

export const VIEW_TYPE_TERMINAL = "obsidian-brain-terminal";

export interface BrainTerminalSettings {
  shellPath: string;
  shellArgs: string[];
  startupCommand: string;
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorBlink: boolean;
  theme: "dark" | "light";
}

export const DEFAULT_SETTINGS: BrainTerminalSettings = {
  shellPath: "",
  shellArgs: [],
  startupCommand: "devin",
  fontFamily: "Cascadia Code, Consolas, Courier New, monospace",
  fontSize: 14,
  scrollback: 5000,
  cursorBlink: true,
  theme: "light",
};

const THEME_DARK: ITheme = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#264f78",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

const THEME_LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#383a42",
  cursor: "#383a42",
  selectionBackground: "#add6ff",
  black: "#000000",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#4078f2",
  magenta: "#a626a4",
  cyan: "#0184bc",
  white: "#a0a1a7",
  brightBlack: "#696c77",
  brightRed: "#e45649",
  brightGreen: "#50a14f",
  brightYellow: "#c18401",
  brightBlue: "#4078f2",
  brightMagenta: "#a626a4",
  brightCyan: "#0184bc",
  brightWhite: "#383a42",
};

export const THEMES: Record<BrainTerminalSettings["theme"], ITheme> = {
  dark: THEME_DARK,
  light: THEME_LIGHT,
};

export const BT_DEBUG = true;

export function btLog(...args: unknown[]): void {
  if (BT_DEBUG) console.log("[BrainTerminal]", ...args);
}
