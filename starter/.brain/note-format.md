# Note Format

> This vault's actual conventions — seeded 2026-05-31, refined by AGENT.md on first run.

---

## Frontmatter by Note Type

### Project note (`project/<name>/<Name>.md`)
```yaml
---
tags:
  - "#project"
title: ""
status: "planning|in-progress|completed"
priority: "low|medium|high"
deadline: ""
---
```

### Skill note (`skills/<Skill Name>.md`)
```yaml
---
tags:
  - "#skill"
person: Abhijeet
skill: ""
area: coding|biology|music|sports|other
current-level: beginner|intermediate|advanced|expert
goal-level: beginner|intermediate|advanced|expert
category: ""
---
```

### Idea note (`ideas/<name>.md`)
```yaml
---
tags:
  - "#ideas"
idea: ""
category: ""
priority: low|medium|high
status: draft|developing|implemented
---
```

### Learning note (`learning/<Topic>.md`)
```yaml
---
tags:
  - "#learning"
topic: ""
category: ""
difficulty: beginner|intermediate|advanced
status: "planning|in-progress|completed"
priority: "low|medium|high"
---
```

### AI Profile (`AI Profiles/<name>.md`)
```yaml
---
tags:
  - "#ai-profile"
persona: ""
role: ""
tools: []
---
```

---

## Templates

All templates live in `_templates/`. **Every note must use a template.**
Templates have Templater (`tp.*`) syntax — they auto-move notes to the right folder.

| Template | Use for | Target folder |
|---|---|---|
| `project-template.md` | New projects | `project/` |
| `skills-template.md` | Skill notes | `skills/` |
| `ideas-template.md` | Ideas & brainstorms | `ideas/` |
| `learning-template.md` | Learning journeys | `learning/` |
| `research-template.md` | Deep research notes | `learning/` |
| `training-template.md` | Training & habit logs | `training/` |
| `daily-template.md` | Daily journal/log | `training/` |
| `session-template.md` | Work sessions & meetings | `project/<name>/` |
| `progress-template.md` | Progress snapshots | `project/<name>/` |
| `ai-profile-template.md` | AI personas | `AI Profiles/` |

### AI Rule: Always Use a Template
When creating any note:
1. Pick the matching template from the table above
2. Copy its content as the note body (without the Templater `<%* ... %>` block — that runs in Obsidian only)
3. Fill in frontmatter fields
4. Place the file in the correct target folder manually

---

## Standard Note Structure

### Project note
```markdown
---
[frontmatter]
---

# Project Name

Brief description.

## Overview
What this project is and why it exists.

## Requirements
- Requirement 1
- Requirement 2

## Tasks
- [ ] Task 1
- [ ] Task 2

## Progress
### YYYY-MM-DD
- What was done

## Notes
Freeform notes, decisions, links.
```

### Skill note
```markdown
---
[frontmatter]
---

# Skill Name

## Learning Plan
How you plan to learn this skill.

## Resources
- Book/course/tutorial links

## Progress
Current progress log.

## Notes
Key insights and takeaways.
```

---

## Wikilinks — Always Use These for Internal Links

```markdown
[[Note Title]]                    ← link to a note
[[Note Title#Section]]            ← link to a section
[[Note Title|Display Text]]       ← custom display text
![[image.png]]                    ← embed an image
```

**Never** use markdown links `[text](path)` for internal vault notes.

---

## Naming Rules

- Note filenames use **Title Case with spaces**: `Brain Terminal.md`
- Project folders use **kebab-case**: `brain-terminal/`
- Skill notes: just the skill name: `Python.md`, `Machine Learning.md`
- Never use underscores in note filenames (only in template filenames)
- Images go in `images/` or `<note-folder>/attachments/`

---

## Tags

Always use the `#` prefix inside the yaml list:
```yaml
tags:
  - "#project"
  - "#in-progress"
```
