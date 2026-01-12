# Build123d Color Export - Research Findings

## Summary
Build123d supports color assignment to shapes, but the current glTF exporter (via OCP's RWGltf_CafWriter) **does not export material/color information** to glTF files.

## Color Assignment Syntax
Colors can be assigned to any Build123d shape:

```python
from build123d import *

# Create shape and assign color
sphere = Solid.make_sphere(10)
sphere.color = Color("red")  # Named color

# RGB colors also work
box = Solid.make_box(20, 20, 20)
box.color = Color(0.0, 0.5, 1.0)  # RGB values 0-1
```

## Export Behavior

### STEP Format ✓
- **Preserves colors correctly**
- Uses XCAF (eXtended Data Exchange) document structure
- Color information is stored and exported

### glTF Format ✗
- **Does NOT export colors/materials**
- XDE document is created with colors (see `_create_xde`)
- But `RWGltf_CafWriter` doesn't transfer materials to glTF JSON
- Confirmed by inspecting exported glTF: no "materials" array

### Test Results
```bash
# Tested with multi-colored compound (red sphere, blue box, green cylinder, yellow cone)
- test_colors.step (22KB) - opens with colors in CAD viewers
- test_colors.glb (195KB) - geometry only, no materials/colors
```

## Known Limitation
This is a **known issue** in the build123d project:
- GitHub Issue #598: "Material System"
- Status: Planned enhancement, not yet implemented
- Requires extending exporters to add PBR material properties to glTF JSON

## Recommendation for ClaudeCAD

Since build123d cannot export colors to glTF, we have two options:

### Option 1: Client-Side Color Assignment (RECOMMENDED)
- Have Claude generate color assignments in Build123d code
- Parse the code to extract color information
- Apply colors in Three.js renderer based on feature names/structure
- **Advantage**: Works today, gives Claude control over appearance

### Option 2: Wait for build123d Enhancement
- Monitor issue #598 for material export support
- Update when available
- **Disadvantage**: Timeline uncertain

## Implementation Plan (Option 1)

1. **Build123d Code Generation**
   - Claude already generates feature-based code with named variables
   - Add color assignments: `feature.color = Color("blue")`

2. **Color Parsing**
   - Parse generated code to extract color assignments
   - Return color mapping with geometry: `{"base": "blue", "hole": "red"}`

3. **Renderer Application**
   - Apply colors to meshes in Three.js based on feature names
   - Use default colors for unspecified features

4. **System Prompt Update**
   - Inform Claude about color assignment syntax
   - Encourage use of colors for multi-feature models

## Sources
- [Build123d Import/Export Documentation](https://build123d.readthedocs.io/en/latest/import_export.html)
- [Build123d exporters3d Source](https://build123d.readthedocs.io/en/latest/_modules/exporters3d.html)
- [Build123d Issue #598 - Material System](https://github.com/gumyr/build123d/issues/598)
