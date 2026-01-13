# ClaudeCAD Roadmap

Features deferred from demo scope. Implement after core demo is working and Anthropic pitch is complete.

---

## Phase 8: Autonomous Iteration Mode

User provides reference images + description, Claude iterates autonomously until satisfied.

### Flow
1. User: "Build R2D2" + pastes 2-3 reference images
2. Claude generates Build123d code
3. Python executes → mesh renders in viewport
4. Viewport screenshot captured
5. Claude sees: reference images + current render + code
6. Claude compares, decides what to fix
7. Loop back to step 2 until:
   - User clicks "Stop"
   - Iteration limit reached (user-configurable, e.g., "try 17 times")
   - Claude makes no code changes (converged)
   - Context hits 80% (track tokens internally)

### Technical Requirements
- **Image input to Claude CLI**: Ctrl+V paste works in interactive mode; need programmatic image passing or upload button in UI
- **Viewport screenshot**: Three.js canvas → image buffer → send to Claude
- **Loop driver**: Renderer triggers IPC calls in loop, respects stop conditions
- **Context tracking**: Estimate token usage, warn/stop at 80%
- **Model selector**: User chooses Sonnet or Opus (cost/quality tradeoff)

### UI
- "Autonomous Mode" or "Auto-Iterate" button/command
- Iteration counter display ("Iteration 5 of 17")
- Stop button (prominent, always visible during loop)
- Model dropdown (Sonnet/Opus)

---

## Post-Phase 7: Priority Fixes (Demo-Critical)

### Keep Python Truly Warm
- src/main/python-manager.js:173-180 closes stdin and forces respawn every call
- This negates the demo's latency promise
- Fix: Use request delimiter without ending stdin; only recycle on timeout/crash

### Correct Project File Validation
- src/main/main.js:500 uses `!projectData.code === undefined` which is logically wrong
- Fix: Replace with clear check like `projectData.code === undefined`

### Remove Duplicate Accelerator
- src/main/main.js:562-640 assigns CmdOrCtrl+Shift+K to both "New" and "Clear Project"
- Fix: Keep one, reassign the other to avoid UI confusion

---

## Known Issues (Observed, Not Blocking)

### UI Wonkiness
- Edge highlight toggle button behavior is inconsistent
- Measure tool has quirky behavior (needs investigation)
- Selection dot (yellow marker) disappears before 5 second timeout

### Geometry Operations Failing
- Fillets often fail (Build123d/OCP limitation or code issue?)
- Chamfers fail due to timeout (30s Claude CLI timeout not enough for complex operations)

---

## Post-Phase 7: Nice-to-Have (Demo-Credibility)

### Mesh-to-Shape Grouping
- Build123d exports each shape as multiple meshes (box = 6 face meshes, etc.)
- Current color system only colors individual meshes, not whole shapes
- Problems:
  - Clicking selects one mesh, not the whole shape
  - Can't easily color a whole sphere/box
  - Spatial clustering fails for overlapping shapes
- Fix: Implement mesh-to-shape mapping so clicking selects/colors entire shapes
- Research: glTF node hierarchy, mesh naming patterns, or vertex connectivity

### Fix Stats for Indexed Geometry
- src/renderer/renderer.js:470-486 assumes non-indexed geometry
- glTF likely has indices, so face count can be wrong
- Fix: Use `geometry.index.count / 3` when indexed

### Add Recovery Path UX Note
- When Python/Claude fails, display brief message: "Last model kept; try rephrase or Retry"
- Makes errors feel controlled (no user panic)

---

## Post-Demo: Near Term

### View Cube
- 3D cube widget in viewport corner
- Drag cube to rotate view
- Double-click face to snap to that view
- Labels on faces: Top, Bottom, Front, Back, Left, Right

### Full Undo/Redo Stack
- Multiple undo levels (not just one)
- Redo support
- Consider: undo stack persisted with project file

### Point Tool
- Click to capture exact 3D coordinates
- Show coordinates in UI
- Use in prompts: "put a hole at this point"

### Labels System
- Name faces/edges/features
- Labels stored with project
- Reference in chat: "make the mounting hole bigger"
- Labels visible as floating text in viewport
- Toggle labels on/off

### Properties Panel
- Context-sensitive display
- Face selected: area, normal vector
- Edge selected: length, type
- Vertex selected: coordinates
- Nothing selected: bounding box, volume, surface area

### Light Mode Toggle
- Toggle between two lighting modes:
  - **Camera-locked**: Light moves with camera (always illuminates front of model)
  - **Scene-fixed**: Light stays in fixed position as camera orbits
- Button in toolbar to switch modes
- Default: Camera-locked (better for inspection)

### Window State Persistence
- Remember window size and position
- Remember panel sizes (chat height)
- Restore on next launch

### Configurable Retry System
- `maxRetries` setting (default 3)
- Error categorization with per-type retry counts:
  - Syntax/import errors (e.g., "name 'x' not defined") → more retries
  - Geometry failures → fewer retries
  - Timeouts → no retry
- Settings UI to expose retry configuration

### Configurable Timeout
- Claude CLI timeout setting (default 30s)
- Python execution timeout setting (default 10s)
- Settings UI to expose
- Consider: longer timeouts for complex models, shorter for simple edits

### Additional Export Formats
- STEP (CAD interchange)
- 3MF (modern 3D print format)

---

## Post-Demo: Medium Term

### FDM Analysis (Real Geometry Analysis)
- Actual geometry analysis, not just AI commentary
- Wall thickness detection via ray casting
- Overhang angle calculation from face normals
- Hole diameter checking
- Bridging distance detection
- Warnings displayed in chat with specific fixes

### FDM Proactive Mode
- Toggle in UI: "Designing for: [Any] [FDM] [SLA] [CNC]"
- When on: Claude receives constraints in system prompt
- Claude warns/refuses unprintable geometry
- Constraints: 0.8mm min wall, 45° max overhang, 2mm min hole

### SLA/Resin Analysis
- Drain holes for uncured resin
- Suction cups (trapped volumes)
- Minimum feature size
- Support scarring locations

### Injection Molding Analysis
- Draft angles for ejection
- Undercuts blocking part removal
- Uniform wall thickness
- Gate placement suggestions
- Sink mark prediction

### CNC Machining Analysis
- Tool access constraints
- Internal corners need radius for tool
- Deep pocket limitations
- Fixturing considerations

### Printer/Machine Profiles
- Printer-specific configs (bed size, nozzle diameter)
- Material profiles (PLA, PETG, ABS defaults)
- Machine-specific constraints

### Error Recovery (Advanced)
- Auto-rollback on failure
- Attempt alternative approaches automatically
- Offer concrete alternatives to user
- Feature-by-feature rebuild from last working state

### Cross-Platform
- Windows build
- Linux build
- electron-builder configuration for all platforms

---

## Post-Demo: Long Term

### Light Theme
- Full light color palette
- Theme toggle in settings

### Unit Selector
- Millimeters (default)
- Inches
- Conversion on export

### Assemblies
- Multiple parts in one project
- Part constraints (mate, align)
- Exploded view
- Bill of materials
- Subassembly management

### Version History
- Git-like history within project
- Branch/merge for design variants
- Visual diff between versions

### Cloud Storage
- Save to cloud (Dropbox, Google Drive, etc.)
- Share projects via link

### Collaboration
- Real-time multi-user editing
- Comments and annotations
- Share with view-only access

### AI Layer Abstraction
- Swap Claude for other models (Codex, etc.)
- Configurable AI backend
- API key management

### Photorealistic Rendering
- three-gpu-pathtracer integration
- Material properties (metal, plastic, etc.)
- Environment lighting (HDRI)
- Progressive refinement
- High-res export for marketing/documentation

### ClaudeForm (Sister Product)
- Organic/mesh modeling (not parametric CAD)
- Text-to-3D generation (when technology matures)
- Sculpting tools
- Blender subprocess architecture (GPL workaround)
- Surface modeling vs. solid modeling

### Slicer Integration
- Direct G-code generation
- Natural language print settings ("add supports", "use tree supports")
- Preview toolpaths / layer-by-layer view
- Note: AGPL licensing concerns with bundling CuraEngine/PrusaSlicer

---

## Research / Investigation

### Topology Mapping
- Can Build123d export mesh with face IDs preserved?
- Investigate: vertex colors, face groups, OCP layer access
- Goal: map clicked triangle back to Build123d face
- Would enable proper selection without Claude interpretation

### Slicer Licensing
- CuraEngine is AGPL — can we call it as subprocess?
- PrusaSlicer is AGPL — same question
- Alternative: don't bundle, just export STL and let user use their slicer

### Plugin System
- User-installable extensions
- Custom tools and workflows
- Marketplace for community plugins
