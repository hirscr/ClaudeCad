# ClaudeCAD Development Setup Guide

Get each component working independently before letting Claude Code integrate them.

---

## Step 1: Project Structure

```bash
mkdir -p ~/claudecad
cd ~/claudecad
mkdir -p src/main src/renderer src/python
```

---

## Step 2: Build123d (Python CAD Engine)

### Check Python Version

```bash
python3 --version
```

Need Python 3.10+. If not installed:
```bash
brew install python@3.11
```

### Create Virtual Environment

```bash
cd ~/claudecad
python3 -m venv venv
source venv/bin/activate
```

You should see `(venv)` in your prompt.

### Install Build123d

```bash
pip install --upgrade pip
pip install build123d
```

### Test It

```bash
cd ~/claudecad

cat > src/python/test_build123d.py << 'EOF'
from build123d import *

with BuildPart() as part:
    Box(20, 20, 10)
    with Locations((0, 0, 10)):
        Hole(radius=4, depth=10)

part.part.export_stl("test_cube.stl")
print(f"SUCCESS: Exported test_cube.stl")
print(f"Volume: {part.part.volume:.2f} mm³")
EOF

python src/python/test_build123d.py
```

**Expected output:**
```
SUCCESS: Exported test_cube.stl
Volume: 3497.34 mm³
```

**Checkpoint:** You should see `test_cube.stl` in ~/claudecad. Open it in your slicer to verify it's a box with a hole.

---

## Step 3: Node.js & npm

### Install (if needed)

```bash
brew install node
```

### Verify

```bash
node --version   # should be v18+ 
npm --version    # should be v9+
```

---

## Step 4: Electron App Scaffold

```bash
cd ~/claudecad

# Initialize npm project
npm init -y

# Install Electron
npm install electron --save-dev

# Install electron-builder for packaging later
npm install electron-builder --save-dev
```

### Create Main Process

```bash
cat > src/main/main.js << 'EOF'
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('src/renderer/index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
EOF
```

### Create Renderer (HTML)

```bash
cat > src/renderer/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ClaudeCAD</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: #1e1e1e; 
      color: #ffffff; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    h1 { font-size: 48px; font-weight: 300; }
  </style>
</head>
<body>
  <h1>ClaudeCAD</h1>
</body>
</html>
EOF
```

### Update package.json

```bash
cat > package.json << 'EOF'
{
  "name": "claudecad",
  "version": "0.1.0",
  "description": "AI-powered parametric CAD",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  }
}
EOF
```

### Test It

```bash
npm start
```

**Checkpoint:** A dark window should open with "ClaudeCAD" centered. Close it with Cmd+Q.

---

## Step 5: Three.js Viewport

### Install Three.js

```bash
npm install three
```

### Update Renderer

```bash
cat > src/renderer/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ClaudeCAD</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e1e; overflow: hidden; }
    #viewport { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="viewport"></div>
  <script src="./test_threejs.js"></script>
</body>
</html>
EOF
```

### Create Three.js Test

```bash
cat > src/renderer/test_threejs.js << 'EOF'
const THREE = require('three');
const { OrbitControls } = require('three/examples/jsm/controls/OrbitControls.js');

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);

// Camera
const camera = new THREE.PerspectiveCamera(
  50, 
  window.innerWidth / window.innerHeight, 
  0.1, 
  1000
);
camera.position.set(30, 30, 30);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('viewport').appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Grid
const grid = new THREE.GridHelper(100, 10, 0x444444, 0x333333);
grid.rotation.x = Math.PI / 2; // XY plane (Z-up)
scene.add(grid);

// Axes
const axes = new THREE.AxesHelper(20);
scene.add(axes);

// Test cube
const geometry = new THREE.BoxGeometry(20, 20, 10);
const material = new THREE.MeshStandardMaterial({ 
  color: 0x4a9eff,
  metalness: 0.1,
  roughness: 0.6
});
const cube = new THREE.Mesh(geometry, material);
cube.position.set(10, 10, 5); // Offset so corner is at origin
scene.add(cube);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, 50, 50);
scene.add(directionalLight);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

console.log('SUCCESS: Three.js viewport running');
EOF
```

### Test It

```bash
npm start
```

**Checkpoint:** You should see:
- Dark background
- Grid on XY plane
- RGB axes at origin (red=X, green=Y, blue=Z)
- Blue cube
- Orbit with left mouse, zoom with scroll

---

## Step 6: Claude Code CLI

### Verify Installation

```bash
claude --version
```

If not installed:
```bash
npm install -g @anthropic-ai/claude-cli
claude login
```

### Test It

```bash
claude -p "Say 'Claude Code is working' and nothing else"
```

**Checkpoint:** Should respond with "Claude Code is working" (or similar).

### Test Code Generation

```bash
claude -p "Write a Python function that adds two numbers. Only output the code, no explanation."
```

**Checkpoint:** Should return clean Python code.

---

## Step 7: Verify Full Chain

This tests the complete flow: Claude → Python → Mesh

```bash
cd ~/claudecad
source venv/bin/activate

# Ask Claude to generate Build123d code
claude -p "Write Build123d Python code to create a 30x20x15mm box with a 5mm radius hole in the center of the top face. Export to 'claude_test.stl'. Only output the Python code, no explanation." > src/python/claude_generated.py

# View what Claude generated
cat src/python/claude_generated.py

# Run it
python src/python/claude_generated.py

# Check result
ls -la claude_test.stl
```

**Checkpoint:** 
- `claude_generated.py` contains valid Build123d code
- `claude_test.stl` exists and can be opened in your slicer

---

## Summary: What You Should Have Working

| Component | Test Command | Expected Result |
|-----------|--------------|-----------------|
| Build123d | `python src/python/test_build123d.py` | Creates test_cube.stl |
| Node/npm | `node --version` | v18+ |
| Electron | `npm start` | Window opens |
| Three.js | `npm start` | 3D viewport with cube |
| Claude Code | `claude -p "hello"` | Claude responds |
| Full chain | Step 7 above | Claude-generated STL file |

---

## Next: Hand Off to Claude Code

Once all checkpoints pass, you're ready. Open Claude Code in the ~/claudecad directory and give it:

1. The spec file: `ClaudeCAD-Specification.md`
2. This instruction: "Read the spec and implement Phase 1: Foundation"

Claude Code will take it from there.

---

## Troubleshooting

### Build123d: "No module named 'OCP'"
```bash
cd ~/claudecad
source venv/bin/activate
pip install build123d --force-reinstall
```

### Electron: "Cannot find module 'electron'"
```bash
cd ~/claudecad
rm -rf node_modules
npm install
```

### Three.js: "Cannot find module 'three'"
```bash
npm install three
```

### Claude Code: "command not found"
```bash
npm install -g @anthropic-ai/claude-cli
claude login
```

### Python not using venv
Make sure you see `(venv)` in your terminal prompt. If not:
```bash
cd ~/claudecad
source venv/bin/activate
```
