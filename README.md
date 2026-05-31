# Brain Terminal

> An AI-powered terminal inside Obsidian. Watch your AI CLI edit your notes live with green/red diff highlights.

Built by **Abhijeet Garg**

---

## What It Does

Brain Terminal embeds a real terminal (xterm.js + node-pty) in Obsidian's sidebar. When an AI CLI (Claude Code, Devin, Windsurf, etc.) runs in the terminal and edits your vault notes:

- **Added lines** → highlighted green instantly
- **Deleted lines** → shown as red ghost lines  
- **Scroll-through** → Obsidian briefly reveals the changed note, scrolls through each changed hunk, then returns focus to the terminal
- **Highlights fade** after 10 seconds automatically
- **`.context`** → plugin writes the active note path so the CLI always knows what you're looking at
- **`.open-note`** → CLI writes a note path (with optional `:line`) and Obsidian opens + scrolls to it

---

## Features

| Feature | Status |
|---|---|
| Terminal (PowerShell / bash / zsh) | ✅ |
| Brain icon (ribbon + tab) | ✅ |
| Named terminals (Brain Terminal 1, 2…) | ✅ |
| Double-click to rename terminal | ✅ |
| Welcome message on spawn | ✅ |
| `.context` file (active note path) | ✅ |
| `.open-note` file (CLI opens + scrolls) | ✅ |
| Green/red live diff highlighting | ✅ |
| Scroll-through on diff hunks | ✅ |
| 10s fade on diff decorations | ✅ |
| Image paste → attachments folder | ✅ |
| Auto-install companion plugins | ✅ |
| Smart vault scaffolding on first run | ✅ |
| BMAD agent suite (69 skills) | ✅ |
| Auto-updating profiles | ✅ |

---

## Installation

### Manual (until Obsidian Community Plugin store approval)

1. Download the latest release: `main.js`, `manifest.json`, `styles.css`
2. Copy them to your vault: `.obsidian/plugins/obsidian-brain-terminal/`
3. Enable the plugin in Obsidian Settings → Community Plugins

### What happens on first enable

Brain Terminal automatically:
1. Detects your vault structure (empty / partial / well-organized)
2. Creates missing folders (`project/`, `skills/`, `ideas/`, etc.) if needed
3. Copies 11 generic note templates to `_templates/`
4. Copies `CLAUDE.md` and `AGENT.md` (AI routing files)
5. Auto-installs 3 companion plugins: **Templater**, **Update time on edit**, **Natural Language Dates**

---

## Using with AI CLIs

### Claude Code
```bash
cd /path/to/your/vault
claude
```
Claude Code reads `CLAUDE.md` automatically — it knows your vault structure, how to open notes, and how to show live diffs.

### Devin CLI
```bash
devin
```

### Windsurf / any AI CLI
Point your CLI at the vault folder. Brain Terminal writes:
- `.obsidian/plugins/obsidian-brain-terminal/.context` — the note currently open in Obsidian
- `.obsidian/plugins/obsidian-brain-terminal/.open-note` — write `path/to/note.md:lineNumber` here to open it

---

## Agent System

On first terminal open, `AGENT.md` scans your vault and enriches itself with your real structure. Two profiles handle everything:

| Profile | Does |
|---|---|
| **note-manager** | Create, edit, organize, research, plan projects, run git, draw diagrams |
| **brainstormer** | Ideation, mind maps, what-if exploration, creative thinking |

Plus the full **BMAD suite** (69 skills) for deep technical work — PM, Architect, Dev, QA, and more.

---

## How `.context` and `.open-note` Work

```
Your AI CLI reads:
  .obsidian/plugins/obsidian-brain-terminal/.context
  → "project/brain-terminal/Brain Terminal.md"
  → now the AI knows what you're looking at

Your AI CLI writes:
  .obsidian/plugins/obsidian-brain-terminal/.open-note
  → "project/brain-terminal/Brain Terminal.md:42"
  → Obsidian opens the note and scrolls to line 42
```

---

## Dev Setup

```bash
git clone https://github.com/abhijeetgarg00/obsidian-brain-terminal
cd obsidian-brain-terminal
npm install
npm run install:pty    # rebuild node-pty for Obsidian's Electron
node scripts/patch-plugin-pty.mjs
npm run dev            # builds + watches, copies to vault
```

Point `esbuild.config.mjs` to your vault's plugin folder.

---

## Tech Stack

- **xterm.js** (`@xterm/xterm`) — terminal rendering, bundled into `main.js`
- **node-pty** — native PTY (patched for Obsidian's Electron sandbox)
- **CodeMirror 6** — diff decorations via `StateEffect`
- **TypeScript** + **esbuild**

---

## License

MIT — built by [Abhijeet Garg](https://github.com/abhijeetgarg00)
