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
| Terminal (PowerShell 7 / bash / zsh) | ✅ |
| Brain icon (ribbon + tab) | ✅ |
| Named terminals (Brain Terminal 1, 2…) | ✅ |
| Double-click to rename terminal | ✅ |
| First-run + returning welcome screen | ✅ |
| `.context` file (active note path) | ✅ |
| `.open-note` file (CLI opens + scrolls) | ✅ |
| Green/red live diff highlighting | ✅ |
| Scroll-through on diff hunks | ✅ |
| 10s fade on diff decorations | ✅ |
| Image paste → attachments folder | ✅ |
| node-pty auto-downloaded on first load | ✅ |
| Smart vault scaffolding (empty/partial/good) | ✅ |
| Dot-folders (.brain/, .agents/) written via native fs | ✅ |
| 19 starter files installed (templates, profiles, bridge files) | ✅ |
| Companion plugins auto-installed (no CORS — Node https) | ✅ |
| SessionStart hook → AI runs first-run setup automatically | ✅ |
| Settings page (Terminal / Vault Setup / About) | ✅ |

---

## Installation

### Via BRAT (recommended)

1. Install **BRAT** from Obsidian Community Plugins
2. Open BRAT settings → **Add Beta Plugin** → paste:
   ```
   https://github.com/abhijeetgarg00/obsidian-brain-terminal
   ```
3. Enable **Brain Terminal** in Settings → Community Plugins

### Prerequisites (Windows)

- **Node.js** — https://nodejs.org (LTS)
- **PowerShell 7** — `winget install Microsoft.PowerShell`

The plugin checks for these on first enable and shows a warning if missing.

---

## What Happens on First Enable

```
1. node-pty downloaded automatically (~7 MB zip from this release)
   → extracted to plugin folder, no manual steps needed

2. Vault scaffolding (empty / partial / already set up)
   → folders created: project/, skills/, ideas/, learning/, training/, docs/
   → 11 generic templates copied to _templates/
   → bridge files written: AGENT.md (root), CLAUDE.md,
     .brain/ (profiles + vault docs), .agents/AGENT.md

3. Companion plugins auto-installed
   → Templater
   → Natural Language Dates
   → Update time on edit

4. SessionStart hooks installed (.devin/config.json + .claude/settings.json)
   → when you run `devin` or `claude` in the terminal,
     the AI sees first_run: true and begins the setup sequence automatically
```

---

## First-Run AI Sequence

When you open Brain Terminal and run `claude` or `devin` for the first time:

```
Step 0  Install BMAD agent suite
        npx bmad-method install (bmm + bmb + tea + cis modules)
        → installs 69 skills to .claude/skills/ and .agents/skills/

Step 1  Scan every note in your vault
        → reads frontmatter, folder structure, wikilinks, naming conventions

Step 2  Update .brain/vault-structure.md
        → real folder tree, template inventory, naming patterns

Step 3  Update .brain/note-format.md
        → actual frontmatter fields found per note type

Step 4  Enrich both profiles
        → note-manager: real folders, templates, naming
        → brainstormer: where ideas live, connected projects

Step 5  Update AGENT.md
        → first_run: false  (setup never repeats)
        → last_scanned, vault_files, vault_folders filled in

Step 6  Report
        ✓ BMAD status
        ✓ X notes across Y folders
        ✓ Profiles enriched → ready
```

Every session after that: normal welcome, straight to work.

---

## Agent System

Two profiles handle everything vault-related:

| Profile | Does |
|---|---|
| **note-manager** | Create, edit, organize, research, plan projects, run git, draw diagrams |
| **brainstormer** | Ideation, mind maps, what-if exploration, creative thinking |

Plus the full **BMAD suite** (installed by AI on first run) for deep technical work — PM, Architect, Dev, QA, and more.

---

## Using with AI CLIs

### Claude Code
```bash
cd /path/to/your/vault
claude
```
Claude Code reads `CLAUDE.md` and `.claude/settings.json` automatically. The SessionStart hook checks `first_run` and triggers setup if needed.

### Devin CLI
```bash
cd /path/to/your/vault
devin
```
Devin reads `AGENT.md` and `.devin/config.json`. Same SessionStart hook — setup runs automatically on first session.

### Windsurf / any AI CLI
Point your CLI at the vault folder. Brain Terminal writes:
- `.obsidian/plugins/obsidian-brain-terminal/.context` — the note currently open in Obsidian
- `.obsidian/plugins/obsidian-brain-terminal/.open-note` — write `path/to/note.md:lineNumber` here to open it

---

## How `.context` and `.open-note` Work

```
Your AI CLI reads:
  .obsidian/plugins/obsidian-brain-terminal/.context
  → "project/my-project/My Note.md"
  → now the AI knows what you're looking at

Your AI CLI writes:
  .obsidian/plugins/obsidian-brain-terminal/.open-note
  → "project/my-project/My Note.md:42"
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
npm run dev            # builds + watches
```

To rebundle the starter pack after changing `starter/`:
```bash
npm run bundle-starter
# always run this before npm run build
```

---

## Tech Stack

- **xterm.js** (`@xterm/xterm`) — terminal rendering, bundled into `main.js`
- **node-pty** — native PTY (prebuilt for Obsidian's Electron, auto-downloaded on first load)
- **CodeMirror 6** — diff decorations via `StateEffect`
- **TypeScript** + **esbuild**

---

## License

MIT — built by [Abhijeet Garg](https://github.com/abhijeetgarg00)
