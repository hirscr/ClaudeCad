# ClaudeCAD Roadmap

---

## Open Bugs (Demo-Critical)

### Keep Python Truly Warm
- `src/main/python-manager.js:177` calls `stdin.end()`, forcing a respawn on every request
- This negates the demo's latency promise
- Fix: use a request delimiter without ending stdin; only recycle on timeout/crash

### Remove Duplicate Accelerator
- `src/main/main.js` assigns `CmdOrCtrl+Shift+K` to both "New" and "Clear Project"
- Fix: keep one, reassign the other

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

## Near Term

### Mesh-to-Shape Grouping
- Build123d exports each shape as multiple meshes (box = 6 face meshes, etc.)
- Current color system only colors individual meshes, not whole shapes
- Problems: clicking selects one mesh, not the whole shape; spatial clustering fails for overlapping shapes
- Fix: implement mesh-to-shape mapping so clicking selects/colors entire shapes
- Research: glTF node hierarchy, mesh naming patterns, or vertex connectivity

### Fix Stats for Indexed Geometry
- `src/renderer/renderer.js:470-486` assumes non-indexed geometry
- glTF likely has indices, so face count can be wrong
- Fix: use `geometry.index.count / 3` when indexed

### Add Recovery Path UX
- When Python/Claude fails, display brief message: "Last model kept; try rephrase or Retry"
- Makes errors feel controlled

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
- Use in prompts: "put a hole at this point"

### Properties Panel
- Face selected: area, normal vector
- Edge selected: length, type
- Vertex selected: coordinates
- Nothing selected: bounding box, volume, surface area

### Light Mode Toggle
- Toggle between camera-locked and scene-fixed lighting
- Default: camera-locked (better for inspection)

### Window State Persistence
- Remember window size, position, and panel sizes
- Restore on next launch

### Configurable Retry System
- `maxRetries` setting (default 3)
- Error categorization: syntax errors → more retries; geometry failures → fewer; timeouts → none

### Configurable Timeout
- Claude CLI timeout setting (default 30s)
- Python execution timeout setting (default 10s)

### Additional Export Formats
- STEP (CAD interchange)
- 3MF (modern 3D print format)

---

## Medium Term

### FDM Analysis (Real Geometry)
- Wall thickness detection via ray casting
- Overhang angle calculation from face normals
- Hole diameter and bridging distance checking
- Warnings displayed in chat with specific fixes

### FDM Proactive Mode
- Toggle: "Designing for: [Any] [FDM] [SLA] [CNC]"
- Claude receives constraints in system prompt and warns on unprintable geometry

### SLA/Resin Analysis
- Drain holes, suction cups, minimum feature size, support scarring

### Injection Molding Analysis
- Draft angles, undercuts, uniform wall thickness, gate placement

### CNC Machining Analysis
- Tool access, internal corners, deep pockets, fixturing

### Printer/Machine Profiles
- Printer-specific configs (bed size, nozzle diameter)
- Material profiles (PLA, PETG, ABS)

### Cross-Platform
- Windows and Linux builds via electron-builder

---

## Long Term

### Labels System
- Name faces/edges/features; reference in chat; visible as floating text in viewport

### Light Theme
- Full light color palette with theme toggle

### Unit Selector
- Millimeters (default) and inches with conversion on export

### Assemblies
- Multiple parts, part constraints (mate, align), exploded view, BOM

### Version History
- Git-like history within project with visual diff between versions

### Cloud Storage
- Save to cloud (Dropbox, Google Drive); share via link

### Collaboration
- Real-time multi-user editing, comments, view-only sharing

### AI Layer Abstraction
- Swap Claude for other models; configurable backend; API key management

### Photorealistic Rendering
- three-gpu-pathtracer, material properties, HDRI, progressive refinement

### ClaudeForm (Sister Product)
- Organic/mesh modeling (not parametric)
- Text-to-3D when technology matures
- Blender subprocess architecture

### Slicer Integration
- G-code generation, natural language print settings, layer preview
- Note: AGPL licensing concerns with CuraEngine/PrusaSlicer bundling

---

## Research / Investigation

### Topology Mapping
- Can Build123d export mesh with face IDs preserved?
- Investigate: vertex colors, face groups, OCP layer access
- Goal: map clicked triangle back to Build123d face for proper selection

### Slicer Licensing
- CuraEngine and PrusaSlicer are AGPL — subprocess invocation implications
- Alternative: export STL and let user use their own slicer

### Plugin System
- User-installable extensions, custom tools, community marketplace
