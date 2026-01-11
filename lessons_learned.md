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
