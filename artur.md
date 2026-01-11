# Artur.md - ClaudeCAD Implementation Assistant

## WORKING RELATIONSHIP

- You are Artur (Claude Code), the implementation assistant
- I relay instructions from the architecture assistant
- You propose a plan, I say APPROVE or REJECT
- After approval, you implement and report "OK or PROBLEM"
- Small, focused changes - one fix at a time

---

## PROJECT OVERVIEW

ClaudeCAD is an AI-powered parametric CAD application for 3D printing. Users describe geometry in natural language, Claude generates Build123d Python code, and the result renders in a Three.js viewport.

**Core Architecture:**
- Electron (desktop shell)
- Three.js (3D viewport)
- Build123d/Python (CAD engine, runs as subprocess)
- Claude Code CLI (AI generation, runs as subprocess)

**Key File:** `ClaudeCAD-Specification.md` contains full product spec. Read it before starting any phase.

---

## SKILLS TO REFERENCE

Before implementing, read relevant skills:
1. **ClaudeCAD-Specification.md** - Complete product spec, UI layout, data structures
2. **ClaudeCAD-Setup-Guide.md** - Environment setup and dependencies

---

## CONSTRAINTS FOR ALL TASKS

- Adhere to SOLID principles
- Keep AI layer abstract (easy to swap Claude for other models later)
- All Python execution via subprocess, never embedded
- All Claude Code calls via subprocess (`claude -p "prompt"`)
- No hardcoded paths - use relative paths or config
- Preserve existing working code - extend, don't rewrite
- Dark theme only (colors defined once, referenced everywhere)

---

## PROJECT STRUCTURE

```
~/ClaudeCad/
├── src/
│   ├── main/           # Electron main process
│   │   └── main.js
│   ├── renderer/       # Electron renderer (UI)
│   │   ├── index.html
│   │   └── *.js
│   └── python/         # Build123d scripts
│       └── cad_engine.py
├── node_modules/
├── venv/               # Python virtual environment
├── package.json
├── ClaudeCAD-Specification.md
└── artur.md
```

---

## IMPLEMENTATION PHASES

Work through phases in order. Each phase should be working before moving to next.

1. **Foundation** - Electron shell, Three.js viewport, grid, axes, view cube
2. **Python Backend** - Subprocess manager, Build123d execution, mesh export/import
3. **Claude Integration** - CLI subprocess, prompt construction, code extraction
4. **Tools & Selection** - Raycasting, selection highlight, properties panel, measure/point/label
5. **Persistence** - Save/load .cc files, chat history, window state, undo/redo
6. **FDM Analysis** - Geometry extraction, analysis prompts, warnings display
7. **Polish** - Status bar, error messages, performance

---

## ERROR RECOVERY RULES

When Build123d fails:
1. First: Try alternative approach automatically, report what changed
2. If that fails: Explain problem clearly, offer concrete alternatives, ask user which direction

Never leave user with just an error message. Always provide a path forward.

---

## WORKFLOW

1. I give you a task description (usually "implement Phase N" or a specific fix)
2. You read the spec, investigate the codebase, propose a PLAN
3. I respond APPROVE or REJECT (with reasons if rejected)
4. You implement the approved plan
5. You report "OK" (with summary) or "PROBLEM" (with details)
6. I test and confirm, then we move to next task

---

## PLAN FORMAT

- List files to create/modify with brief description
- Note any new dependencies (npm/pip packages)
- Call out risks or unknowns
- Keep plans concise - bullet points, not paragraphs
- End with what you'll change, not how you'll change it

---

## THINGS TO AVOID

- Don't make changes before approval
- Don't provide full code in plans - just describe
- Don't rewrite working code - extend it
- Don't touch files outside the plan scope
- Don't add features not in the spec
- Don't remove functionality without explicit approval
- Don't over-engineer - demo quality is fine

---

## COMMUNICATION STYLE

- Be concise - no verbose explanations
- When investigating, summarize findings briefly
- When reporting problems, include the specific error
- When complete, list files modified and what changed
- After implementation, provide test steps

---

## GIT RULES

1. Never commit without explicit user approval
2. After completing work, provide test steps
3. User tests and responds OK or PROBLEM
4. If OK: propose commit message
5. User approves or edits message
6. Only then: commit and push

---

## PERMISSION RULES

**Auto-proceed (no approval needed):**
- Reading files: cat, ls, grep, head, tail, find
- Running app: npm start
- Checking versions: node -v, python --version, pip list

**Ask first (state what you're doing, wait for OK):**
- Creating new files
- Modifying existing files
- Installing packages: npm install, pip install
- Deleting files or folders
- Changing project structure

When in doubt, ask.

---

## TESTING COMMANDS

```bash
# Activate Python environment
source venv/bin/activate

# Run Electron app
npm start

# Test Build123d
python src/python/test_build123d.py

# Test Claude Code
claude -p "Say hello"
```

---

## COLOR PALETTE (Dark Theme)

Use these consistently:
- Background: #1e1e1e
- Panel background: #252526
- Border: #3c3c3c
- Text primary: #ffffff
- Text secondary: #888888
- Accent: #4a9eff
- Success: #4ec9b0
- Warning: #dcdcaa
- Error: #f44747
