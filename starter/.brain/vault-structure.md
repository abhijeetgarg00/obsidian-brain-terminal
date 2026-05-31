# Vault Structure

> Last updated: 2026-05-31 (manually seeded — AGENT.md will refine on first run)

---

## Folder Tree

```
vault/
├── project/                    ← one subfolder per project
│   ├── brain-terminal/
│   ├── agenticAI/
│   ├── AI powered Paper Trading/
│   ├── calorietracking/
│   ├── dragonball-volleyball/
│   ├── NewTakeOnSnake/
│   ├── random games/
│   └── WallClimbing/
│
├── skills/                     ← one note per skill (flat)
│   ├── Python.md
│   ├── ML.md
│   ├── SQL.md
│   └── ...
│
├── learning/                   ← structured learning notes
│   └── Agentic AI.md
│
├── ideas/                      ← freeform ideas, can have subfolders
│   └── mealPlan/
│
├── training/                   ← training logs and plans
│   └── AI.md
│
├── AI Profiles/                ← AI persona profiles for different use cases
│   ├── game-designer.md
│   ├── godot-engineer.md
│   ├── obsidian-note-taking-assistant.md
│   └── ...
│
├── bhawna/                     ← personal section (Bhawna's notes)
│
├── docs/                       ← general documentation
│
├── images/                     ← image attachments
│
├── _templates/                 ← note templates (do not edit directly)
│   ├── project-template.md
│   ├── skills-template.md
│   ├── ideas-template.md
│   ├── learning-template.md
│   ├── progress-template.md
│   ├── ai-profile-template.md
│   └── _bhawna_learning.md
│
├── .brain/                     ← Brain Terminal agent system
│   ├── AGENT.md
│   ├── vault-structure.md      ← this file
│   ├── note-format.md
│   └── profiles/
│       ├── note-manager.md
│       ├── brainstormer.md
│       ├── researcher.md
│       ├── project-manager.md
│       ├── git-manager.md
│       └── mermaid-writer.md
│
├── .claude/skills/             ← 69 BMAD skills for Claude Code
├── .agents/skills/             ← 69 BMAD skills for Windsurf/Devin
├── _bmad/                      ← BMAD core framework
├── _bmad-output/               ← BMAD generated artifacts
│
├── CLAUDE.md                   ← Claude Code entry point (auto-read)
└── AGENT.md                    ← (in .brain/) router for all agents
```

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
| `bhawna/` | Bhawna's personal notes | Bhawna's content |
| `docs/` | General documentation | Reference material |
| `_templates/` | Note templates | NEVER — read only |

---

## Project Structure Convention

Each project lives in its own folder:
```
project/<project-name>/
  <Project Name>.md      ← main project note (same name as folder, Title Case)
  <sub-note>.md          ← additional notes, designs, logs
```

Example:
```
project/brain-terminal/
  Brain Terminal.md      ← main note
  Blueprint.md           ← sub-note
  Setup & Agent Plan.md  ← sub-note
```

---

## Naming Conventions

| Type | Convention | Example |
|---|---|---|
| Project folders | kebab-case | `brain-terminal/` |
| Note titles | Title Case with spaces | `Brain Terminal.md` |
| Skill notes | Title Case | `Python.md`, `Machine Learning.md` |
| Template files | kebab-case | `project-template.md` |
| AI profiles | kebab-case description | `game-designer.md` |

---

## Known Git Repos

| Project | Repo Path |
|---|---|
| brain-terminal | `D:\repo\brain-terminal` |

> AGENT.md will discover additional repos on first-run scan.
