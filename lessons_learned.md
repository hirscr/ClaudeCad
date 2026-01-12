# Lessons Learned

## Phase 1-2: ClaudeCAD Development

### glTF + Build123d Integration

1. **Coordinate System Mismatch**
   - glTF standard: Y-up
   - Build123d/CAD convention: Z-up
   - Fix: Rotate loaded mesh by -90° on X axis (`mesh.rotation.x = -Math.PI / 2`)

2. **Units Mismatch**
   - glTF standard: meters
   - Build123d: millimeters
   - Fix: Scale loaded mesh by 1000 (`mesh.scale.set(1000, 1000, 1000)`)

3. **Materials Don't Transfer**
   - glTF exports geometry only (or default grey material)
   - Fix: Traverse loaded mesh and apply MeshStandardMaterial with DoubleSide

4. **Edge Lines Not Automatic**
   - Three.js meshes don't show edges by default
   - Fix: Create EdgesGeometry + LineSegments for each mesh

### Three.js Camera

5. **Clipping Planes**
   - Near plane too far = corners get cut off
   - Fix: Set camera.near = 0.01, camera.far = 10000

6. **View Presets Need Auto-Fit**
   - Fixed camera distances don't work for variable-size objects
   - Fix: Calculate distance from bounding box, use direction vectors not positions

### Electron + Vite

7. **ES Module Imports Don't Work in Electron**
   - Bare imports like `import * as THREE from 'three'` fail
   - Fix: Use Vite to bundle renderer code
   - Config: `base: './'` for Electron file:// protocol

### Autonomous Task Runner

8. **Exit Code Not Reliable**
   - Claude CLI sometimes returns error code even when work is done
   - Fix: Check for code changes as success criteria, not exit code

9. **Artur Runs npm start Without Being Asked**
   - Even with instructions not to, Artur may verify by running app
   - Fix: Explicit "Do NOT run npm start" in artur.md

## Phase 3: Claude Integration

### Claude CLI Subprocess

10. **Shell Escaping Corrupts Prompts**
    - Using `shell: true` with spawn causes backticks in prompt to be interpreted as command substitution
    - Prompts contain markdown code blocks with ` ``` ` which break shell parsing
    - Fix: Use stdin to pass prompt instead of command-line argument, remove `shell: true`

11. **Global Key Listeners Fire During Text Input**
    - T key (test pipeline) and L key (spinner) fire even when typing in chat input
    - Fix: Check `e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'` and return early

### System Prompt Engineering

12. **OUTPUT_PATH Not Defined**
    - System prompt told Claude to use `OUTPUT_PATH` placeholder for export
    - cad_engine.py didn't inject this variable
    - Fix: Tell Claude NOT to include export lines - cad_engine handles it automatically

13. **'part' Variable Required**
    - cad_engine.py expects code to have variable named exactly `part`
    - Fix: System prompt must specify `with BuildPart() as part:` pattern

14. **Don't Over-Specify the API**
    - Listing only Box, Cylinder, Sphere limited what Claude could create
    - Claude already knows Build123d from training
    - Fix: Give minimal constraints (use `part`, no export) and let Claude use its full knowledge

### Build123d Limitations

15. **Export Wrong Object**
    - cad_engine.py was exporting `part` (BuildPart context manager) not `part.part` (geometry)
    - Error: `'BuildPart' has no attribute 'wrapped'`
    - Fix: Change `export_mesh(part)` to `export_mesh(part.part)`

16. **No Non-Uniform Scaling**
    - Build123d's `scale()` only accepts single float for uniform scaling
    - Cannot create ellipsoids via scaled spheres
    - Fix: Add to system prompt as limitation, suggest simpler alternatives

17. **Mesh Z-Inversion**
    - Initial rotation -90° on X was wrong direction
    - Fix: Change to +90° (positive `Math.PI / 2`)

## Phase 4: Selection & Measure

### Selection System

18. **Coordinate-Based Selection Is Imprecise**
    - User clicks, Claude gets coordinates + normal, but neither can be certain which face/edge was selected
    - Claude often guesses wrong ("this click is near the eye lens area...")
    - Real fix requires topology mapping (Section 9 in spec) - future work
    - Workaround: Show clicked coordinates in UI so user can verify

19. **Selection Marker Should Persist Until Escape**
    - Click marker was disappearing on its own
    - Fix: Only clear on explicit Escape key press

20. **Camera Resets After Generation Is Annoying**
    - `fitCameraToObject()` was called on every mesh load
    - User positions camera, generates model, camera jumps to different view
    - Fix: Only fit camera on first model load (when test cube removed), not subsequent loads

21. **View Presets Need camera.up Reset**
    - TrackballControls allows free rotation including tilting "up" direction
    - View presets (Front, Top, etc.) looked wrong because up vector was tilted
    - Fix: Reset `camera.up` to (0, 0, 1) in view preset functions

### Prompt Engineering for Models

22. **Detailed Quantitative Prompts Work Best**
    - Explicit coordinates, dimensions, primitive types, and positions
    - Vague prompts ("make it look like Mickey Mouse") fail
    - Good: "Sphere diameter 25mm centered at (0, 0, 0)"
    - Bad: "Add ears on top"

23. **Simple Primitives Only**
    - Spheres, cylinders, boxes with union/subtract work reliably
    - Angled geometry (rotated boxes, trapezoids) fails - Claude can't generate correct Build123d code
    - R2-D2 with angled legs broke; Minion with simple cylinders worked great

24. **Dome/Hemisphere Orientation Must Be Explicit**
    - "Hemisphere" is ambiguous - which way does the flat side face?
    - Must specify: "flat side faces DOWN, rounded side faces UP"
    - BB-8 head was inverted until explicitly corrected

25. **Disconnected Geometry Happens**
    - Parts can end up floating (BB-8 antenna detached from head)
    - Fix: Explicitly state "attached to" or give coordinates that ensure overlap
    - Union operations need parts to actually touch/overlap

26. **Build123d Functions Not Always Known**
    - Claude sometimes uses undefined functions (e.g., `shell()` without proper syntax)
    - Error: "name 'shell' is not defined"
    - Claude's Build123d knowledge is imperfect
