# Vault Structure

> Placeholder — AGENT.md will rewrite this on first run after scanning your vault.

---

## Folder Tree

```
vault/
├── project/                    ← one subfolder per project
├── skills/                     ← one note per skill (flat)
├── learning/                   ← structured learning notes
├── ideas/                      ← freeform ideas, can have subfolders
├── training/                   ← training logs and plans
├── AI Profiles/                ← AI persona profiles
├── docs/                       ← general documentation
├── images/                     ← image attachments
├── _templates/                 ← note templates (do not edit directly)
│
├── .brain/                     ← Brain Terminal agent system
│   ├── AGENT.md
│   ├── vault-structure.md      ← this file (updated by AI on first run)
│   ├── note-format.md
│   └── profiles/
│       ├── note-manager.md
│       └── brainstormer.md
│
├── .claude/skills/             ← BMAD skills for Claude Code (installed by AI)
├── .agents/skills/             ← BMAD skills for Windsurf/Devin (installed by AI)
│
├── CLAUDE.md                   ← Claude Code entry point (auto-read)
└── AGENT.md                    ← router for all agents
```

> The above is the default structure. AGENT.md will update this with your actual folders, files, and conventions on first run.

---

## Folder Purposes

| Folder | Purpose | New notes go here when... |
|---|---|---|
| `project/<name>/` | Everything about one project | Starting or working on a project |
| `skills/` | Individual skill notes | Learning or tracking a new skill |
| `learning/` | Structured learning journeys | Following a course or curriculum |
| `ideas/` | Raw ideas and brainstorms | Got an idea to capture |
| `training/` | Training logs (fitness, habits) | Logging workouts, habits, progress |
| `AI Profiles/` | AI persona configs | Creating a new AI assistant persona |
| `docs/` | General documentation | Reference material |
| `_templates/` | Note templates | NEVER — read only |

---

## Project Structure Convention

Each project lives in its own folder:
```
project/<project-name>/
  <Project Name>.md      ← main project note (Title Case)
  <sub-note>.md          ← additional notes, designs, logs
```

---

## Naming Conventions

| Type | Convention | Example |
|---|---|---|
| Project folders | kebab-case | `my-project/` |
| Note titles | Title Case with spaces | `My Note.md` |
| Skill notes | Title Case | `Python.md` |
| Template files | kebab-case | `project-template.md` |
| AI profiles | kebab-case | `my-assistant.md` |

> AGENT.md will update these with the actual conventions found in your vault.

---

## Known Git Repos

> AGENT.md will discover repos on first-run scan.
