---
created: 2026-05-31T20:48
updated: 2026-05-31T20:55
---
# Brain Terminal — Claude Code Instructions

You are running inside an **Obsidian vault** via the **Brain Terminal** plugin, built by Abhijeet Garg.

---

## Your Obsidian Superpowers

### See what the user is looking at RIGHT NOW
```
.obsidian/plugins/obsidian-brain-terminal/.context
```
Read this file. It contains the vault-relative path of the note currently open in Obsidian.
Update your context every time you start a new task.

### Open any note in Obsidian + scroll to a line
```
.obsidian/plugins/obsidian-brain-terminal/.open-note
```
Write `path/to/note.md:lineNumber` to this file.
Obsidian will instantly open that note and scroll to the line.
Example: `project/my-project/My Note.md:42`

### Live diff highlighting
When you edit any `.md` file in this vault:
- Added lines → highlighted **green** in Obsidian instantly
- Deleted lines → shown as **red ghost lines**
- Highlights fade automatically after 10 seconds
- You do not need to do anything special — just edit the files normally

---

## This Vault

### First Run Detection
Check if `.brain/AGENT.md` exists and has `first_run: true` in its frontmatter.
If yes — run the first-run vault scan sequence (see `.brain/AGENT.md`).

### Vault Structure
See `.brain/vault-structure.md` — auto-generated from the actual vault.
If it is empty or missing, run the first-run scan.

### Note Format
See `.brain/note-format.md` — frontmatter rules, wikilinks, naming conventions.

---

## BMAD Agents

Full BMAD agent suite is installed in `.claude/skills/`:
- `bmad-agent-analyst` — requirements, research
- `bmad-agent-architect` — system design
- `bmad-agent-dev` — implementation
- `bmad-agent-pm` — product management
- `bmad-agent-ux-designer` — UX/UI
- `bmad-brainstorming` — creative ideation
- And 63 more skills

Use `@bmad-help` anytime to get guidance on what to do next.

---

## Brain Terminal Thin Profiles

Vault-aware shortcuts for Obsidian-specific tasks (in `.brain/profiles/`):
- `note-manager` — create, edit, link, organize notes
- `brainstormer` — ideation, mind maps
- `researcher` — research → structured notes
- `project-manager` — tasks, roadmaps
- `git-manager` — git via terminal + write summaries to notes
- `mermaid-writer` — write mermaid diagrams into notes

---

## Rules

1. Always read `.context` at the start of every session
2. Always read `.brain/vault-structure.md` before touching any files
3. Use `.open-note` to navigate — never ask the user to open files manually
4. Follow `.brain/note-format.md` for all note writing
5. If `.brain/AGENT.md` says `first_run: true` — scan the vault first, update profiles, then proceed
6. **Every note you create must use a template** — see `.brain/note-format.md` for the full table
7. Strip Templater `<%* ... %>` blocks when writing notes — those only run inside Obsidian
8. Always place notes in the correct folder per the template's target folder
