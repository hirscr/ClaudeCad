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

## Phase 5: Persistence & Claude Code Integration

### Arch/Artur Workflow

27. **Arch Doesn't Code**
    - Arch designs features and approves plans
    - Artur implements code
    - Arch violated this rule and made unauthorized edits - caused confusion
    - Fix: Arch creates prompts, reviews plans, says APPROVE/REJECT - never touches code

### Claude Code CLI Context

28. **Claude Code CLI Maintains Its Own Context**
    - The subprocess keeps full conversation history internally
    - Our `history` array in renderer.js is separate from what Claude Code sends to Anthropic
    - We don't directly control Claude Code's context - it manages its own
    - Fix: Only way to truly reset is to restart the subprocess

29. **App Restart Clears Polluted Context**
    - Long conversations with errors degrade Claude's performance
    - Claude starts hallucinating, generating syntax errors, timing out
    - Restarting the app kills Claude Code subprocess, giving fresh context
    - This is why "save, quit, reload" fixed issues that retrying couldn't

30. **Context Injection on Project Load**
    - When loading a project, chat history may conflict with actual model state
    - Example: Chat says "I deleted the model" but model code was restored from file
    - Fix: Prepend message after load: "[Note: Project was just loaded. Current code is ground truth - ignore conflicting chat history.]"

31. **Claude Hallucinating Changes**
    - Claude can claim to modify code but return identical code
    - Comments say "changed X from 15.5 to 18.5" but value is still 15.5
    - User sees no visual change, thinks rendering is broken
    - Fix: Ask Claude to state exact before/after values; consider code diff detection

32. **Error Messages Pollute Context**
    - Failed attempts and error messages in history confuse Claude
    - Each retry adds more noise, making subsequent attempts worse
    - Fix: "Refresh Context" feature - /clear + clean continuation prompt (exclude errors)

33. **Refresh Context Pattern**
    - Send `/clear` to Claude Code CLI to reset
    - Re-inject: current code + cleaned history (successful exchanges only) + "Await next command"
    - User controls when to reset, not auto-compaction
    - Warn at 70-80% context usage so user can proactively refresh

34. **/context Command Is Free**
    - Local CLI command, doesn't make API call
    - Can poll periodically to show context usage meter
    - Use to warn user before auto-compaction kicks in

### Electron/macOS

35. **macOS Needs Explicit app.quit()**
    - Default Electron behavior: macOS apps stay running when windows close
    - For ClaudeCAD, closing window should quit app
    - Fix: In `window-all-closed`, always call `app.quit()` (not just on non-macOS)

36. **Electron Menu Intercepts Keyboard Shortcuts**
    - Cmd+S, Cmd+Z, Cmd+O, Cmd+X intercepted by Electron's default Edit/File menus
    - Renderer's keydown handler never receives these events
    - Fix: Create custom Electron Menu with proper accelerators that send IPC to renderer

37. **Cmd+X Conflict**
    - Cmd+X is standard "Cut" - Electron menu intercepts it
    - Using for "Clear Project" conflicts with text editing
    - Fix: Use Cmd+Shift+K for Clear (or just menu item, no shortcut)

### Save/Load

38. **Save As Needed for New Models**
    - User loads project A, asks Claude to "make something completely different"
    - Model replaced, but `currentFilePath` still points to A
    - Cmd+S silently overwrites A with new content
    - Fix: Claude returns `new_model: true` flag; when set, clear `currentFilePath` so Save prompts for new filename

39. **Undo Requires Correct previousCode**
    - If Claude returns same code repeatedly (hallucinating changes), `previousCode` equals `currentCode`
    - Undo appears to do nothing because there's no actual difference
    - Not a bug in Undo - bug is Claude not making real changes

### UI/UX

40. **Toolbar Buttons Should Be Icon-Only**
    - Text labels take space and clutter toolbar
    - Fix: Remove text, use icons only, show label + shortcut in tooltip on hover

41. **Status Messages Need Distinct Colors**
    - "Project saved" was green - same as success messages
    - Fix: Use yellow (#dcdcaa) for save confirmation to draw user attention

42. **Measurement Display Position**
    - Measurement text should appear near Measure button, not floating
    - Yellow color (#dcdcaa) for visibility

## Phase 6: Color & Multi-Shape Architecture

### glTF Color Export

43. **Build123d Colors Don't Transfer to glTF**
    - Setting `shape.color = Color("red")` in Build123d code doesn't appear in exported glTF
    - Build123d's `export_gltf` uses OpenCASCADE's `RWGltf_CafWriter` which requires explicit PBR material setup
    - The XDE/XCAF document infrastructure exists but isn't properly populated
    - Result: glTF files contain geometry only, colors are lost

44. **Colors Come From Pipeline, Not File**
    - Professional CAD web viewers (three-cad-viewer, CAD Exchanger) don't rely on glTF to carry colors
    - They pass color metadata separately as JSON alongside geometry
    - Pattern: Export geometry in mesh format, pass colors explicitly, apply in viewer
    - This is industry standard, not a workaround

45. **Per-Shape Export Solution**
    - Export each colored shape as its own glTF file
    - Return array of {mesh_path, color, label} to JavaScript
    - Load each mesh, apply color, add to scene
    - No complex mesh-to-face mapping needed
    - Each shape = one color = deterministic

### OpenCASCADE Color Behavior

46. **TopoDS_Shape Contains Geometry Only**
    - OpenCASCADE shapes don't store color attributes
    - Colors must be stored separately (AIS_ColoredShape, XCAF documents, or application data)
    - "It is a responsibility of application-level modification operation to preserve necessary attributes"
    - Source: OpenCASCADE forum discussion on boolean operation colors

47. **Boolean Union Merges Into One Solid**
    - `combined = box + sphere` creates ONE topological solid
    - No "box part" or "sphere part" remains - just faces on a unified solid
    - Color history is lost - the solid can only have one color
    - This is fundamental CAD behavior, not a bug

48. **Face Tracking Through Booleans Is Possible But Complex**
    - OpenCASCADE's `BRepTools_History` can trace which output faces came from which input solid
    - `Modified(shape)` and `Generated(shape)` APIs exist
    - But Build123d doesn't expose this history API
    - Would require dropping to OCP (OpenCASCADE Python) layer
    - Deferred to future phase as "Mesh-to-Shape Grouping" research

### Shape Architecture

49. **Overlapping ≠ Merged**
    - Two shapes occupying same space but not boolean-unioned remain SEPARATE
    - Each keeps its own color, exports as its own mesh
    - Only explicit `+` operator or `fuse()` merges shapes
    - Compound([shape1, shape2]) keeps them separate

50. **Cross-Shape Fillet Strategy**
    - Filleting across shape boundaries requires union first
    - Union + fillet = one solid = one color
    - Acceptable trade-off: user can change color after if needed
    - Claude generates appropriate pattern based on operation type

### Project File Format

51. **Version Field Required for Breaking Changes**
    - New .cc format stores shapes array instead of single mesh
    - Must include `version` field to detect format
    - Old files without version field should be rejected with clear message
    - Don't attempt migration - clean rejection preferred for demo stability

52. **Shape-Based .cc Structure**
    - New format: `{ version, code, history, shapes: [{mesh, color, label}, ...] }`
    - Each shape's mesh stored as base64-encoded glb
    - Colors persist through save/load cycle
    - Labels enable future "make the head bigger" style commands

## Phase 7: Coordinate System & Orientation

### glTF Export Transformation

53. **glTF Export Adds -90° X Rotation**
    - Build123d's `export_gltf` automatically converts from Z-up to Y-up (glTF standard)
    - The rotation is embedded in the glTF node: `"rotation":[-0.7071,0,0,0.7071]`
    - Build123d +Z → Rendered +Y (forward)
    - Build123d +Y → Rendered -Z (down)
    - Testing Build123d coordinates directly gives WRONG answers for rendered output

54. **Don't Counter-Rotate in Renderer**
    - Original fix was `shapeGroup.rotation.x = -Math.PI / 2` to undo glTF rotation
    - This caused double-rotation issues
    - Correct fix: Remove renderer rotation, let glTF transformation stand
    - Snowman stands correctly; just need to understand the coordinate mapping

### Cone/Cylinder Orientation

55. **Default Cone Points Forward (+Y), Not Up**
    - Due to glTF export transformation
    - Build123d default (+Z) becomes rendered +Y (forward)
    - For a forward-pointing nose: use default, no plane parameter needed

56. **Orientation Table for Rendered Output**
    - Forward (+Y): default (no plane)
    - Up (+Z): `plane=Plane.XZ`
    - Down (-Z): `plane=Plane.XZ.rotated((180,0,0))`
    - Right (+X): `plane=Plane.YZ`
    - Left (-X): `plane=Plane.YZ.rotated((0,180,0))`
    - Backward (-Y): `plane=Plane.XY.rotated((180,0,0))`

57. **Use plane= Not Rot() for Orientation**
    - LLMs are terrible at rotation math
    - Claude consistently gets Rot() angles wrong
    - `Solid.make_cone(..., plane=Plane.XZ)` is deterministic
    - Rot() should only be used for unusual angles not in the table

### Build123d Syntax

58. **Position Syntax: Pos() * shape, Not shape @ Pos()**
    - `shape @ Pos(x, y, z)` throws error: "unsupported operand type(s) for @"
    - Correct: `Pos(0, 0, 25) * Sphere(25)`
    - plane= is for orientation, Pos() * is for position - don't mix them

59. **Solid.make_cone/make_cylinder for Oriented Shapes**
    - High-level `Cone()` and `Cylinder()` don't accept plane parameter
    - Must use `Solid.make_cone(r1, r2, h, plane=...)` for orientation
    - Returns Solid which works with Compound and .color assignment

### The Coordinate System Fix (MAJOR BREAKTHROUGH)

60. **One Coordinate System End-to-End**
    - Build123d writes Z-up code
    - glTF should store Z-up data
    - Three.js should render Z-up (camera.up = (0,0,1))
    - No rotations anywhere in the pipeline
    - When AI writes `Cylinder(20, 5)` expecting vertical, it renders vertical

61. **export_gltf's Hidden -90° X Rotation**
    - Build123d's `export_gltf()` applies a hardcoded -90° X rotation
    - Purpose: Convert Z-up (CAD convention) to Y-up (glTF standard)
    - This is NOT optional - no parameter to disable it
    - The rotation is embedded as quaternion: `"rotation":[-0.7071,0,0,0.7071]`

62. **Pre-Rotation Solution in cad_engine.py**
    - Apply +90° X rotation BEFORE calling export_gltf
    - The two rotations cancel: +90° + (-90°) = 0° net rotation
    - glTF still says Y-up in metadata, but geometry data is effectively Z-up
    - Three.js with camera.up = (0,0,1) renders it correctly

63. **Location Transform vs Vertex Rotation**
    - `solid.rotate(Axis.X, 90)` modifies geometry vertices - moves translations!
    - Shape at (0, 20, 78) rotates around world origin → moves to (0, -78, 20)
    - Parts scatter across space - completely broken
    - `solid.location *= Location((0,0,0), (1,0,0), 90)` modifies the location matrix
    - Location transform composes with export_gltf's transform
    - Translations stay intact - parts remain in position

64. **The Correct Pre-Rotation Code**
    ```python
    from build123d import Location
    original_location = solid.location
    solid.location *= Location((0, 0, 0), (1, 0, 0), 90)  # +90° X
    export_gltf(solid, gltf_path)
    solid.location = original_location  # Restore to avoid side effects
    ```

65. **Renderer Must NOT Add Rotation**
    - Previously had `shapeGroup.rotation.x = -Math.PI / 2` or similar
    - With the pre-rotation fix, NO rotation in renderer
    - Just: `shapeGroup.add(mesh)` - mesh orientation comes from glTF as-is
    - Camera already configured for Z-up: `camera.up.set(0, 0, 1)`

66. **System Prompt Simplification**
    - Before fix: Needed complex `plane=` syntax for every oriented shape
    - After fix: Natural language works - "pointing up", "pointing forward"
    - Cylinders/cones default to vertical (+Z) as expected
    - No more plane= workarounds or orientation tables for AI
    - AI writes intuitive code, coordinate system handles the rest

67. **Model Prompts Use Natural Language**
    - Good: "Cylinder pointing up along Z axis"
    - Good: "Cone pointing forward along Y axis"
    - Avoid: `plane=Plane.XZ` unless truly unusual orientation needed
    - The coordinate system fix eliminated most orientation problems

68. **Why Previous Attempts Failed**
    - Renderer rotation: Only affected display, not underlying data
    - Toggling between +90°/-90°/0° in renderer: Different symptoms, same problem
    - The issue was in Python export, not JavaScript rendering
    - "Going in circles" - kept trying to fix rendering when export was wrong

69. **Debugging Coordinate Mismatches**
    - If shapes look wrong: Check the ENTIRE pipeline
    - Source (Build123d) → Export (cad_engine.py) → Load (Three.js) → Render
    - Each step can transform coordinates
    - Test with simple primitive (vertical cylinder) to isolate issue
    - Print coordinates at each stage if needed
