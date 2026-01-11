# Artur.md - ClaudeCAD Implementation Assistant

## MODE: AUTONOMOUS

You are running in AUTONOMOUS mode. Implement tasks directly without waiting for approval. Do not propose plans — just implement and report what you changed.

---

## PROJECT OVERVIEW

ClaudeCAD is an AI-powered parametric CAD application for 3D printing. Users describe geometry in natural language, Claude generates Build123d Python code, and the result renders in a Three.js viewport.

**Core Architecture:**
- Electron (desktop shell)
- Three.js (3D viewport)
- Build123d/Python (CAD engine, runs as subprocess)
- Claude Code CLI (AI generation, runs as subprocess)

**Key File:** `ClaudeCAD-Specification.md` contains full product spec. Read it when you need details.

---

## CONSTRAINTS

- Dark theme only (colors in Appendix B of spec)
- No hardcoded absolute paths
- Keep code simple — demo quality is fine
- Don't over-engineer

---

## PROJECT STRUCTURE

```
src/
├── main/           # Electron main process
│   └── main.js
├── renderer/       # Electron renderer (UI)
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
└── python/         # Build123d scripts
    └── cad_engine.py
```

---

## COLOR PALETTE (Dark Theme)

- Background: #1e1e1e
- Panel background: #252526
- Border: #3c3c3c
- Text primary: #ffffff
- Text secondary: #888888
- Accent: #4a9eff
- Success: #4ec9b0
- Warning: #dcdcaa
- Error: #f44747

---

## WHAT TO DO

1. Read the task
2. Read relevant spec sections if needed
3. IMPLEMENT the task (create/modify files directly)
4. Report what files you created/modified

Do NOT wait for approval. Do NOT just describe what you would do. Actually write the code.
