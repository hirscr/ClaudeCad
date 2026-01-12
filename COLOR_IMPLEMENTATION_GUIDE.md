# Color Implementation Guide for ClaudeCAD

## Overview
ClaudeCAD now supports color extraction from Build123d code. While Build123d's glTF exporter doesn't include material data, we extract color assignments from the Python code and return them alongside the geometry.

## How It Works

### 1. Claude Generates Colored Code
The system prompt now informs Claude about color support:

```python
with BuildPart() as part:
    Box(20, 20, 10)

# Assign color
part.color = Color("blue")
```

### 2. CAD Engine Extracts Colors
The `cad_engine.py` now includes `extract_colors()` function that parses the code for:

**Named colors:**
```python
part.color = Color("red")  # → {"part": "red"}
```

**RGB colors:**
```python
part.color = Color(1, 0, 0)  # → {"part": "#ff0000"}
```

### 3. Response Format
The CAD engine now returns:

```json
{
  "success": true,
  "mesh_path": "/tmp/claudecad_12345.glb",
  "colors": {
    "part": "blue",
    "base": "red",
    "accent": "#ff8800"
  }
}
```

## Renderer Integration

### Current Behavior
The renderer needs to be updated to:
1. Receive the `colors` object from the CAD engine response
2. Map color names/values to Three.js materials
3. Apply colors to the loaded mesh

### Suggested Implementation

**In `renderer.js` or wherever meshes are loaded:**

```javascript
// After loading glTF mesh
function applyColors(mesh, colorMap) {
  // Default material if no colors specified
  if (!colorMap || Object.keys(colorMap).length === 0) {
    mesh.material = new THREE.MeshStandardMaterial({
      color: 0x4a9eff,  // Default accent color
      metalness: 0.1,
      roughness: 0.4
    });
    return;
  }

  // Apply colors from map
  // Since glTF doesn't preserve feature names, we apply the first color
  // or the "part" color if available
  const colorValue = colorMap.part || Object.values(colorMap)[0];

  mesh.material = new THREE.MeshStandardMaterial({
    color: parseColor(colorValue),
    metalness: 0.1,
    roughness: 0.4
  });
}

// Helper to parse color names and hex values
function parseColor(colorValue) {
  // Named colors
  const namedColors = {
    'red': 0xff0000,
    'blue': 0x0000ff,
    'green': 0x00ff00,
    'yellow': 0xffff00,
    'orange': 0xff8800,
    'purple': 0x8800ff,
    'cyan': 0x00ffff,
    'magenta': 0xff00ff,
    'white': 0xffffff,
    'black': 0x000000,
    'gray': 0x808080,
    'darkgray': 0x404040,
    'lightgray': 0xc0c0c0
  };

  if (namedColors[colorValue]) {
    return namedColors[colorValue];
  }

  // Hex color (#rrggbb)
  if (colorValue.startsWith('#')) {
    return parseInt(colorValue.substring(1), 16);
  }

  // Default fallback
  return 0x4a9eff;
}
```

### Integration with Python Manager

**In `python-manager.js`:**

```javascript
// Update the response parsing to include colors
function executeBuild123d(code) {
  return new Promise((resolve, reject) => {
    // ... existing code ...

    process.on('exit', (code) => {
      if (code === 0) {
        const response = JSON.parse(stdout);
        resolve({
          meshPath: response.mesh_path,
          colors: response.colors || {},  // Add colors to response
          empty: response.empty || false
        });
      } else {
        reject(new Error('Build123d execution failed'));
      }
    });
  });
}
```

**In `main.js` (IPC handler):**

```javascript
ipcMain.handle('execute-build123d', async (event, code) => {
  try {
    const result = await executeBuild123d(code);
    return {
      success: true,
      meshPath: result.meshPath,
      colors: result.colors,  // Pass colors to renderer
      empty: result.empty
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});
```

**In `renderer.js` (when loading mesh):**

```javascript
// After receiving result from IPC
const result = await window.api.executeBuild123d(code);

if (result.success && !result.empty) {
  const mesh = await loadGLTF(result.meshPath);

  // Apply colors if provided
  if (result.colors) {
    applyColors(mesh, result.colors);
  }

  scene.add(mesh);
}
```

## Limitations

### Multi-Body Models
Currently, glTF export merges all bodies into a single mesh, losing per-feature boundaries. Colors are applied to the entire model.

**Future Enhancement:**
- Export each feature separately
- Use glTF node names to match features with colors
- Apply different materials to different parts

### Color Coverage
Only top-level color assignments are extracted:
```python
part.color = Color("blue")  # ✓ Extracted
feature.color = Color("red")  # ✓ Extracted (if feature is a variable)
```

Inline colors are NOT extracted:
```python
Box(10, 10, 10).move(...).fillet(...)  # ✗ No variable to assign color
```

**Recommendation:** Encourage Claude to use named variables for colorable features.

## Testing

### Manual Test
```bash
cd src/python

# Test color extraction
python test_color_parsing.py

# Test full pipeline
cat test_color_pipeline.py | python cad_engine.py

# Expected output:
# {
#   "success": true,
#   "mesh_path": "...",
#   "colors": {"part": "darkgray"}
# }
```

### Test Files
- `test_color_export.py` - Creates multi-body glTF with colors (confirms Build123d syntax)
- `test_color_parsing.py` - Tests regex extraction of color assignments
- `test_color_pipeline.py` - Tests full CAD engine with colors
- `test_with_colors.py` - Simple integration test

## Next Steps

1. **Update Renderer** (Required)
   - Modify `python-manager.js` to include `colors` in response
   - Update IPC handlers to pass colors
   - Implement `applyColors()` in `renderer.js`

2. **Test with Claude** (Recommended)
   - Create a model and ask Claude to "make it blue"
   - Verify colors are extracted and applied

3. **Multi-Body Support** (Future)
   - Export features as separate glTF nodes
   - Match node names with color map
   - Apply per-feature materials

## References
- Build123d Color API: https://build123d.readthedocs.io/en/latest/
- Build123d Issue #598: Material System (future enhancement)
- Three.js Materials: https://threejs.org/docs/#api/en/materials/MeshStandardMaterial
