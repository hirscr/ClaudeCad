import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Electron IPC (available since contextIsolation is false)
const { ipcRenderer } = require('electron');

// Get viewport element
const viewportElement = document.getElementById('viewport');

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);

// Camera setup - Z-up orientation
const camera = new THREE.PerspectiveCamera(
  45,
  viewportElement.clientWidth / viewportElement.clientHeight,
  0.1,
  1000
);
camera.position.set(70, -70, 50); // Isometric-like view
camera.up.set(0, 0, 1); // Z-up orientation

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewportElement.clientWidth, viewportElement.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
viewportElement.appendChild(renderer.domElement);

// OrbitControls setup
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Smooth damping
controls.dampingFactor = 0.05;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,   // Left button: rotate
  MIDDLE: THREE.MOUSE.DOLLY,  // Middle button: zoom
  RIGHT: THREE.MOUSE.PAN      // Right button: pan
};

// Grid on XY plane (Z-up)
const gridHelper = new THREE.GridHelper(100, 10, 0x3c3c3c, 0x3c3c3c);
gridHelper.rotation.x = Math.PI / 2; // Rotate to XY plane for Z-up
scene.add(gridHelper);

// Axes helper (RGB = XYZ)
const axesHelper = new THREE.AxesHelper(50);
scene.add(axesHelper);

// Test cube for view control testing
const testCubeGeometry = new THREE.BoxGeometry(20, 20, 20);
const testCubeMaterial = new THREE.MeshStandardMaterial({ color: 0x4a9eff });
let testCube = new THREE.Mesh(testCubeGeometry, testCubeMaterial);
testCube.position.set(0, 0, 10);
scene.add(testCube);

// Edge lines for test cube
const testCubeEdges = new THREE.EdgesGeometry(testCubeGeometry);
const testCubeLineMaterial = new THREE.LineBasicMaterial({ color: 0x6ab0ff });
const testCubeLines = new THREE.LineSegments(testCubeEdges, testCubeLineMaterial);
testCube.add(testCubeLines);

// Placeholder for current mesh
let currentMesh = null;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, -50, 50);
scene.add(directionalLight);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update(); // Required when damping is enabled
  renderer.render(scene, camera);
}

// View preset positions
const viewPresets = {
  isometric: { position: [70, -70, 50], target: [0, 0, 0] },
  front: { position: [0, -100, 0], target: [0, 0, 0] },
  back: { position: [0, 100, 0], target: [0, 0, 0] },
  top: { position: [0, 0, 100], target: [0, 0, 0] },
  bottom: { position: [0, 0, -100], target: [0, 0, 0] },
  left: { position: [-100, 0, 0], target: [0, 0, 0] },
  right: { position: [100, 0, 0], target: [0, 0, 0] }
};

// Handle view dropdown change
document.getElementById('view-dropdown').addEventListener('change', (e) => {
  const preset = viewPresets[e.target.value];
  if (preset) {
    camera.position.set(...preset.position);
    controls.target.set(...preset.target);
    controls.update();
  }
});

// Handle viewport resize using ResizeObserver
const resizeObserver = new ResizeObserver(() => {
  const width = viewportElement.clientWidth;
  const height = viewportElement.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

resizeObserver.observe(viewportElement);

// Start animation
animate();

// Loading overlay functions
const loadingOverlay = document.getElementById('loading-overlay');
const statusText = document.getElementById('status-text');

function showLoading() {
  loadingOverlay.classList.remove('hidden');
  statusText.textContent = 'Generating...';
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
  statusText.textContent = 'Ready';
}

// Load glTF mesh from file path
function loadMesh(path) {
  showLoading();

  // Remove previous mesh if exists
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    currentMesh = null;
  }

  // Create loader
  const loader = new GLTFLoader();

  // Convert to file:// URL if not already
  const fileUrl = path.startsWith('file://') ? path : `file://${path}`;

  // Load the glTF file
  loader.load(
    fileUrl,
    // onLoad callback
    (gltf) => {
      const loadedMesh = gltf.scene;

      // Remove test cube on first successful load
      if (testCube) {
        scene.remove(testCube);
        testCube.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
        testCube = null;
        console.log('Test cube removed');
      }

      // Add mesh to scene
      scene.add(loadedMesh);
      currentMesh = loadedMesh;

      // Center camera on mesh
      centerCameraOnMesh(loadedMesh);

      hideLoading();
      console.log('Mesh loaded successfully:', path);
    },
    // onProgress callback
    (xhr) => {
      const percentComplete = (xhr.loaded / xhr.total) * 100;
      console.log(`Loading: ${percentComplete.toFixed(2)}%`);
    },
    // onError callback
    (error) => {
      console.error('Error loading mesh:', error);

      // Show error to user
      statusText.textContent = `Error: Failed to load mesh`;
      setTimeout(() => {
        statusText.textContent = 'Ready';
      }, 3000);

      hideLoading();

      // Keep previous mesh visible (if any)
    }
  );
}

// Center camera on loaded mesh
function centerCameraOnMesh(mesh) {
  // Compute bounding box
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // Calculate distance needed to fit object in view
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.5; // 1.5x for margin

  // Set camera to isometric-like view relative to mesh center
  const direction = new THREE.Vector3(1, -1, 0.7).normalize();
  camera.position.copy(center).add(direction.multiplyScalar(cameraDistance));

  // Update controls target to mesh center
  controls.target.copy(center);
  controls.update();

  // Update view dropdown to custom (since we moved camera)
  const viewDropdown = document.getElementById('view-dropdown');
  if (viewDropdown) {
    viewDropdown.value = 'isometric'; // Reset to isometric
  }
}

// Execute Build123d code via IPC
async function executeCode(code) {
  try {
    console.log('[Renderer] Executing code via IPC...');
    showLoading();

    const result = await ipcRenderer.invoke('execute-code', code);
    console.log('[Renderer] Execution result:', result);

    if (result.success) {
      // Load the mesh
      loadMesh(result.mesh_path);
    } else {
      // Show error
      console.error('[Renderer] Execution failed:', result.error);
      statusText.textContent = `Error: ${result.error}`;
      statusText.style.color = '#f44747';

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#ffffff';
      }, 5000);

      hideLoading();
    }

    return result;
  } catch (err) {
    console.error('[Renderer] IPC error:', err);
    statusText.textContent = `Error: ${err.message}`;
    statusText.style.color = '#f44747';

    setTimeout(() => {
      statusText.textContent = 'Ready';
      statusText.style.color = '#ffffff';
    }, 5000);

    hideLoading();
    throw err;
  }
}

// Expose functions on window object
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.loadMesh = loadMesh;
window.executeCode = executeCode;

// Temporary key listeners for testing
document.addEventListener('keydown', (e) => {
  // L key: toggle loading spinner
  if (e.key === 'l' || e.key === 'L') {
    if (loadingOverlay.classList.contains('hidden')) {
      showLoading();
    } else {
      hideLoading();
    }
  }

  // T key: test Python pipeline with simple box
  if (e.key === 't' || e.key === 'T') {
    console.log('[Renderer] Testing Python pipeline...');

    const testCode = `from build123d import *

# Create a simple box with a hole
with BuildPart() as part:
    Box(30, 30, 20)
    with Locations((0, 0, 20)):
        Hole(radius=5, depth=20)

part = part.part
`;

    executeCode(testCode);
  }
});

// Chat panel resize functionality
const chatPanel = document.getElementById('chat-panel');
const resizeHandle = document.getElementById('chat-resize-handle');

let isResizing = false;
let startY = 0;
let startHeight = 0;

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  startY = e.clientY;
  startHeight = chatPanel.offsetHeight;

  // Prevent text selection during drag
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  // Calculate new height (dragging up increases height, dragging down decreases)
  const deltaY = startY - e.clientY;
  let newHeight = startHeight + deltaY;

  // Enforce constraints
  const minHeight = 100;
  const maxHeight = window.innerHeight * 0.6;

  newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

  // Apply new height
  chatPanel.style.height = `${newHeight}px`;
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    // Re-enable text selection
    document.body.style.userSelect = '';
  }
});

console.log('ClaudeCAD Phase 1 Complete');
