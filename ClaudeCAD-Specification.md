# ClaudeCAD Product Specification

**Demo Version 1.0**  
**January 2026**

---

## 1. Overview

### 1.1 Product Vision

ClaudeCAD is an AI-powered parametric CAD application that enables users to create 3D printable models through natural language conversation. Users describe what they want to build, and Claude generates the parametric geometry in real-time.

### 1.2 Target Use Case

Primary: 3D printing enthusiasts and makers who want to create custom parts without learning traditional CAD software. The demo focuses on functional parts (brackets, enclosures, mounts) rather than artistic or organic shapes.

### 1.3 Strategic Goal

Build a compelling demo to pitch Anthropic for a "Login with Claude" partnership, enabling subscription-based access to Claude Code from third-party applications.

### 1.4 Demo Scope

- Platform: macOS only
- Theme: Dark mode only
- Units: Millimeters only
- Export: STL format only

### 1.5 Core Loop

The demo must nail this flow:

```
User types → Claude returns code → Python runs → mesh appears → User sees it
```

If this loop is smooth and fast, the demo sells. Everything else is secondary.

---

## 2. Architecture

### 2.1 Technology Stack

| Component | Technology | License |
|-----------|------------|---------|
| Desktop Shell | Electron | MIT |
| 3D Rendering | Three.js | MIT |
| CAD Engine | Build123d (Python) | Apache 2.0 |
| CAD Kernel | OpenCASCADE | LGPL 2.1 + exception |
| AI Engine | Claude Code CLI | User subscription |

### 2.2 Component Communication

1. User enters natural language prompt in chat panel
2. Electron main process constructs prompt with context
3. Main process sends prompt to Claude Code CLI subprocess
4. Claude returns response containing Build123d Python code
5. Main process extracts Python code block from response
6. Main process sends code to **warm** Python subprocess
7. Python executes Build123d, exports mesh to temp file
8. Electron loads mesh into Three.js viewport
9. User sees rendered model and can continue conversation

### 2.3 Subprocess Management

**Critical for demo reliability:**

- **Warm Python subprocess:** Keep Python process alive between requests. Don't spawn fresh each time. Eliminates startup latency.
- **Aggressive timeouts:** Claude CLI: 30 seconds. Python execution: 10 seconds. Surface timeout errors clearly.
- **Last good mesh fallback:** On any error, keep previous mesh visible. Never show empty viewport.

### 2.4 File Structure

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
├── venv/               # Python virtual environment
├── demo/               # Canned models for fallback demo mode
├── package.json
└── *.md                # Specs and docs
```

### 2.5 Project File Format (.cc)

JSON structure:

```json
{
  "version": "1.0",
  "name": "my-bracket",
  "created": "2026-01-10T...",
  "modified": "2026-01-10T...",
  "code": "from build123d import *\n...",
  "chat": [
    {"role": "user", "content": "...", "timestamp": "..."},
    {"role": "assistant", "content": "...", "timestamp": "..."}
  ]
}
```

---

## 3. User Interface

### 3.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  ClaudeCAD                              [View ▼] [—][×] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                                                         │
│                    3D Viewport                          │
│                                                         │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Chat Panel                                              │
│ Claude: I created a 20x20x10mm box with a 4mm hole...   │
│ [Type a message...                              ] [Send]│
├─────────────────────────────────────────────────────────┤
│ Status: Ready                 [Retry]  │ 1,234 faces    │
└─────────────────────────────────────────────────────────┘
```

Simple two-panel layout:
- Viewport on top (majority of space)
- Chat on bottom (resizable)
- Status bar at bottom edge (includes Retry button on errors)
- View dropdown in title bar area

### 3.2 Viewport

#### 3.2.1 Initial State

- Empty viewport with global XYZ axes visible
- Grid on XY plane (Z-up orientation)
- Isometric view angle
- Dark background (#1e1e1e)

#### 3.2.2 View Controls

**Dropdown presets:**
- Front
- Back
- Top
- Bottom
- Left
- Right
- Isometric (default)

**Mouse controls (always active):**
- Orbit: Left mouse drag
- Pan: Right mouse drag (or Shift + left drag)
- Zoom: Scroll wheel

#### 3.2.3 Grid

- Grid on XY plane
- Grid spacing: 10mm major lines
- Toggle via menu or button (default: on)

#### 3.2.4 Loading State

- Spinner overlay on viewport while Claude/Python running
- Status bar shows "Generating..." or "Building model..."
- Input disabled during generation

### 3.3 Selection (Coordinate-Based)

User clicks on model:
1. Raycaster captures 3D coordinates + surface normal
2. Coordinates included in next prompt to Claude
3. Claude interprets: "User clicked at (15.2, 8.0, 10.0) on surface with normal (0, 0, 1)"
4. Claude identifies geometry and responds: "I'll fillet that edge on the top face"
5. **Confirmation step:** Show dialog: "Modify the top face? [Yes] [No]"
6. User clicks Yes → model updates, or No → cancel and rephrase

This approach avoids topology ID mapping — Claude interprets intent from coordinates.

**Why this works for demo:**
- No complex OCP tessellation code needed
- Claude is good at spatial reasoning
- User can always click again or describe differently if misinterpreted

**Upgrade path (see Section 9):** Real topology mapping is proven possible via OCP. Can upgrade later if coordinate-based feels unreliable.

### 3.4 Measure Tool

- Click two points on model
- Display distance between them
- Measurement shown as overlay text
- Cleared on next action

### 3.5 Chat Panel

#### 3.5.1 Layout

- Resizable height (drag top border)
- Default: ~25% of window height
- Minimum height: 100px
- Scrollable message history

#### 3.5.2 Messages

- User messages: Right-aligned, accent background
- Claude messages: Left-aligned, subtle background
- Code blocks: Monospace, collapsed by default
- Error messages: Red accent, include "Retry" button

#### 3.5.3 Input

- Multi-line text input
- Send button (or Enter to send)
- Disabled while Claude is generating

### 3.6 Status Bar

- Left: Status message ("Ready", "Generating...", "Error: ...")
- Center: Retry button (visible on errors)
- Right: Model stats (face count, volume)

---

## 4. Core Features

### 4.1 Model Generation

Users describe geometry in plain English:

- "Create a box 50mm wide, 30mm deep, and 20mm tall"
- "Add a 6mm hole in the center of the top face"
- "Fillet all the edges with 2mm radius"
- "Make the walls 3mm thick"

Iterative refinement:

- "Make it taller"
- "Move the hole to the left by 5mm"
- "Undo that"

With selection:

- "Fillet this edge" (after clicking near an edge)
- "Make this face thicker" (after clicking a face)

### 4.2 Undo

- Single level undo
- Stores previous code snapshot in memory
- "Undo" restores previous code and rebuilds model
- No redo (redo = re-request the change from Claude)

Implementation:
```javascript
let previousCode = null;

function saveUndo() {
  previousCode = currentCode;
}

function undo() {
  if (previousCode) {
    currentCode = previousCode;
    previousCode = null;
    rebuildModel();
  }
}
```

### 4.3 Save/Load

**Save:**
- File > Save (Cmd+S shows save dialog)
- Saves .cc file (JSON with code + chat)

**Load:**
- File > Open
- Loads .cc file
- Restores model and chat history

### 4.4 Export

- Export > STL
- Binary STL format
- Units: millimeters

### 4.5 FDM Commentary

When user asks about printability:
- "Is this printable?"
- "Any issues with this design?"
- "Check for overhangs"

Claude provides commentary based on the code/geometry it generated. No actual geometry analysis — just AI interpretation of what it built.

---

## 5. Prompt Engineering

### 5.1 System Prompt

Claude receives:
1. Role: CAD assistant that outputs Build123d Python code
2. Build123d API reference (condensed, essential functions)
3. Output format: code block + brief explanation
4. Current code (if editing existing model)
5. Click coordinates + normal (if user selected something)

### 5.2 Code Extraction

Parse Claude's response:
- Extract code between ```python and ```
- Display explanation text in chat
- If no code block found, show error + Retry button

### 5.3 Retry Logic

On retry, use simplified fallback prompt:
```
Return only valid Build123d code in a single python block. No explanation needed.

Original request: [user's message]
Current model: [current code]
```

This maximizes chance of getting valid code on second attempt.

### 5.3 Context Management

- Send only current code (not history of all versions)
- Send chat history (last N messages, summarize if > 10 turns)
- Keep prompts minimal to avoid drift

### 5.4 Error Handling

When Claude produces invalid code:
1. Build123d execution fails with error
2. Display error message in chat (red, with details)
3. Show "Retry" button
4. **Previous model stays visible** (last good mesh fallback)
5. User can retry or rephrase

No auto-recovery. Keep it simple.

---

## 6. Error Handling

### 6.1 Claude Errors

| Error | Message | Action |
|-------|---------|--------|
| Timeout (>30s) | "Claude is taking too long." | Retry button |
| Connection | "Cannot reach Claude." | Retry button |
| No code block | "Couldn't find code in response." | Show raw response, Retry button |
| Bad response | "Unexpected response format." | Show raw response, Retry button |

### 6.2 Build123d Errors

| Error | Message | Action |
|-------|---------|--------|
| Syntax error | "Code error: [details]" | Retry button, user rephrases |
| Geometry error | "Can't create shape: [details]" | Retry button, user rephrases |
| Timeout (>10s) | "Model taking too long to build." | Retry button |
| Export error | "Export failed: [details]" | Retry button |

**Critical:** On any Build123d error, keep last good mesh visible.

### 6.3 File Errors

| Error | Message | Action |
|-------|---------|--------|
| Save failed | "Couldn't save file." | Try again / Save As |
| Load failed | "Couldn't open file." | Show details |
| Invalid file | "Not a valid .cc file." | Cancel |

---

## 7. Demo Day Reliability

### 7.1 Pre-Demo Checklist

Run `npm run check` before demo (**must complete in <10 seconds**):
- [ ] Python venv activates
- [ ] Build123d imports successfully
- [ ] Claude CLI responds to test prompt
- [ ] Test model exports to STL
- [ ] Electron app launches

### 7.2 Fallback Demo Mode

If Python/Build123d fails on demo day:
- Load pre-built models from `demo/` folder
- **Show visible "DEMO MODE" banner** in title bar (yellow background)
- Chat still works (Claude describes what it "would" build)
- Selection/measure work on canned models
- Graceful degradation, demo continues

The banner ensures viewers know it's a fallback, maintaining trust.

### 7.3 Canned Models

Include in `demo/` folder:
- `box_with_hole.py` + `.stl` — simple demo
- `bracket.py` + `.stl` — more complex example
- `enclosure.py` + `.stl` — shows shell/hollow

---

## 8. Implementation Phases

### Phase 1: Foundation

1. Electron app with dark theme
2. Three.js viewport with grid and axes
3. Mouse controls (orbit, pan, zoom) using OrbitControls
4. View dropdown (Front/Top/Side/Iso presets)
5. Basic layout (viewport + chat panel + status bar)
6. Resizable chat panel
7. Loading spinner overlay

### Phase 2: Python Backend

1. Warm Python subprocess manager (stay alive between requests)
2. Build123d code execution wrapper
3. Mesh export (glTF preferred, OBJ fallback)
4. Mesh loading into Three.js
5. Error capture and reporting
6. Timeout handling (10 second limit)
7. Last-good-mesh fallback

### Phase 3: Claude Integration

1. Claude Code CLI subprocess wrapper
2. System prompt construction
3. Response parsing and code extraction
4. Chat UI with message display
5. Loading states (spinner, disabled input)
6. Timeout handling (30 second limit)
7. Retry button on errors

### Phase 4: Selection & Measure

1. Raycaster for click detection
2. Click coordinates + normal capture
3. Coordinate injection into prompts
4. Confirmation step ("I'll modify the top face — proceed?")
5. Highlight on hover (whole model for now)
6. Measure tool (two-click distance)

### Phase 5: Persistence

1. Save project (.cc file)
2. Load project
3. Single-level undo
4. Export STL
5. Unsaved changes warning on close

### Phase 6: Polish

1. Status bar with model stats
2. Error messages with details
3. File menu (New, Open, Save, Export)
4. Pre-demo checklist script (`npm run check`)
5. Fallback demo mode with canned models
6. Toolbar controls next to View dropdown:
   - Render mode selector (Solid | Wireframe | X-Ray)
   - Undo/Redo buttons (Undo restores previous code, Redo re-sends last request)
   - Measure tool toggle (activates two-click distance mode from Phase 4)
   - Grid toggle (show/hide XY grid)
   - Fit to view button (reset camera to frame model)
   - Axes toggle (show/hide XYZ axes)

---

## 9. Future: Real Topology Mapping

**Why it's not in demo:** Adds implementation complexity. Coordinate-based selection is sufficient.

**Why it's proven feasible:** OpenCASCADE stores triangulation per-face. Research confirmed we can:
1. Tessellate via OCP directly (not Build123d's export_stl)
2. Use `TopTools_IndexedMapOfShape` for stable face ordering
3. Get triangles per face via `BRep_Tool.Triangulation()`
4. Build mapping: `triangle_face_ids[tri_index] → face_index`

Three.js raycasting returns `faceIndex`. Look up in mapping. Real face selection.

**Proof of concept code:**

```python
from build123d import *
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import topexp
from OCP.TopAbs import TopAbs_FACE
from OCP.TopLoc import TopLoc_Location
from OCP.TopTools import TopTools_IndexedMapOfShape

def tessellate_with_face_ids(shape, tolerance=0.1):
    """Returns vertices, triangles, and face ID per triangle."""
    mesher = BRepMesh_IncrementalMesh(shape.wrapped, tolerance, False, 0.5)
    mesher.Perform()

    face_map = TopTools_IndexedMapOfShape()
    topexp.MapShapes_s(shape.wrapped, TopAbs_FACE, face_map)

    vertices, triangles, tri_face_ids = [], [], []
    v_offset = 0

    for face_idx in range(1, face_map.Extent() + 1):
        face = face_map.FindKey(face_idx)
        loc = TopLoc_Location()
        poly = BRep_Tool.Triangulation_s(face, loc)
        if not poly:
            continue

        xform = loc.Transformation()
        for i in range(1, poly.NbNodes() + 1):
            pt = poly.Node(i).Transformed(xform)
            vertices.append((pt.X(), pt.Y(), pt.Z()))

        for i in range(1, poly.NbTriangles() + 1):
            n1, n2, n3 = poly.Triangle(i).Get()
            triangles.append((n1-1+v_offset, n2-1+v_offset, n3-1+v_offset))
            tri_face_ids.append(face_idx - 1)  # 0-indexed

        v_offset += poly.NbNodes()

    return vertices, triangles, tri_face_ids
```

**Three.js side:**
```javascript
const hit = raycaster.intersectObjects(mesh)[0];
const faceId = triangleFaceIds[hit.faceIndex];
// Highlight all triangles where triangleFaceIds[i] === faceId
```

**Caveats:**
- Face IDs change after boolean ops / fillets (re-tessellate on each change)
- Persistent labels would need geometric fingerprints (roadmap item)

**Upgrade path:**
1. Replace coordinate-based selection with topology mapping
2. Click → instant face highlight (no Claude interpretation needed)
3. Send face ID to Claude: "User selected Face 3"
4. Much faster, more reliable

---

## Appendix A: Build123d Quick Reference

### Basic Box

```python
from build123d import *

with BuildPart() as part:
    Box(20, 20, 10)
```

### Box with Hole

```python
with BuildPart() as part:
    Box(20, 20, 10)
    with Locations((0, 0, 10)):
        Hole(radius=3, depth=10)
```

### Filleted Edges

```python
with BuildPart() as part:
    Box(20, 20, 10)
    fillet(part.edges(), radius=2)
```

### Shell (Hollow)

```python
with BuildPart() as part:
    Box(20, 20, 10)
    shell(part.faces().sort_by(Axis.Z)[-1], thickness=2)
```

### Export

```python
export_stl(part.part, "output.stl")
export_step(part.part, "output.step")
```

---

## Appendix B: Color Palette

| Element | Color |
|---------|-------|
| Background | #1e1e1e |
| Panel background | #252526 |
| Border | #3c3c3c |
| Text primary | #ffffff |
| Text secondary | #888888 |
| Accent | #4a9eff |
| Success | #4ec9b0 |
| Warning | #dcdcaa |
| Error | #f44747 |

---

## Appendix C: Risk Assessment

### Eliminated Risks

| Original Risk | How Solved |
|---------------|------------|
| Geometry ID stability | Coordinate-based selection |
| Undo/redo complexity | Single-level undo (just store previous code) |
| FDM analysis accuracy | AI commentary only, no real geometry analysis |
| View cube implementation | Dropdown presets |
| Labels persistence | Cut entirely |
| Context explosion | Minimal context (code + recent chat only) |

### Remaining Risks (Low-Medium)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Claude produces broken code | Medium | Error shown, Retry button, user rephrases |
| Claude misinterprets click | Low | Confirmation step, user clicks again or describes differently |
| Subprocess timeout/crash | Low | Timeouts, error messages, last-good-mesh fallback |
| Demo day setup failure | Low | Pre-demo checklist, fallback demo mode |
| Core loop feels slow | Medium | Warm subprocess, loading spinner, aggressive timeouts |

### The Only Real Risk

**Core loop reliability.** If the loop works smoothly, the demo sells. Everything in this spec supports that loop.
