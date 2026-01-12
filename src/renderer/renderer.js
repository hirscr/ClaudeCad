import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
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
  0.01,
  10000
);
camera.position.set(70, 70, 50); // Front-right-top isometric view
camera.up.set(0, 0, 1); // Z-up orientation

// Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewportElement.clientWidth, viewportElement.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
viewportElement.appendChild(renderer.domElement);

// TrackballControls setup - full free rotation in all directions
const controls = new TrackballControls(camera, renderer.domElement);
controls.rotateSpeed = 2.0;
controls.zoomSpeed = 1.2;
controls.panSpeed = 0.8;
controls.dynamicDampingFactor = 0.1;

// Track drag state for hover highlighting
controls.addEventListener('start', () => {
  isDragging = true;
});

controls.addEventListener('end', () => {
  isDragging = false;
});

// Grid on XY plane (Z-up)
const gridHelper = new THREE.GridHelper(100, 10, 0x3c3c3c, 0x3c3c3c);
gridHelper.rotation.x = Math.PI / 2; // Rotate to XY plane for Z-up
scene.add(gridHelper);

// Axes helper (RGB = XYZ)
const axesHelper = new THREE.AxesHelper(50);
scene.add(axesHelper);

// Axis labels using canvas sprites
function createAxisLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(8, 8, 1);
  return sprite;
}

const labelX = createAxisLabel('X', '#ff4444');
labelX.position.set(55, 0, 0);
scene.add(labelX);

const labelY = createAxisLabel('Y', '#44ff44');
labelY.position.set(0, 55, 0);
scene.add(labelY);

const labelZ = createAxisLabel('Z', '#4444ff');
labelZ.position.set(0, 0, 55);
scene.add(labelZ);

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

// Track current Build123d code (for iterative editing)
let currentCode = '';

// Track current project file path and saved state
let currentFilePath = null; // Path to currently open .cc file
let projectName = 'untitled'; // Project name (extracted from chat or file)
let isDirty = false; // Whether current state has unsaved changes

// Feature color overrides (featureIndex -> colorHex)
let featureColors = {};

// Undo state (single-level)
let previousCode = null;
let undoneCode = null; // For redo support

// Context reset flag - set after loading a project
let projectJustLoaded = false;

// Raycaster for click detection and hover
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Store last click information
let lastClickInfo = null;

// Store reference to selected feature (specific child mesh)
let selectedFeature = null;

// Click marker visual
let clickMarker = null;
let clickMarkerTimeout = null;

// Hover state tracking
let hoveredMesh = null;
let isDragging = false;
let lastHoverCheck = 0;
const hoverCheckInterval = 33; // ~30fps (33ms)

// Measure mode state
let measureMode = false;
let measurePointA = null;
let measurePointB = null;
let measureVisuals = {
  markerA: null,
  markerB: null,
  line: null
};

// Pulse animation state (for red pulsing during Claude processing)
let pulseAnimationId = null;
let originalColors = new Map(); // Map<material, {color: Color, emissive: Color}>
let isPulsing = false;
let pulseStartTime = null;

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

// View preset directions (normalized camera direction vectors)
// Camera position relative to object center - X and Y should point toward camera for front-isometric
const viewPresets = {
  isometric: new THREE.Vector3(1, 1, 0.7).normalize(), // Front-right-top view
  front: new THREE.Vector3(0, 1, 0),
  back: new THREE.Vector3(0, -1, 0),
  top: new THREE.Vector3(0, 0, 1),
  bottom: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0)
};

// Handle view dropdown change
document.getElementById('view-dropdown').addEventListener('change', (e) => {
  const direction = viewPresets[e.target.value];
  if (direction) {
    const target = currentMesh || testCube;
    if (target) {
      fitCameraToObject(target, direction);
    }
  }
});

// Handle toolbar button clicks
document.getElementById('open-button').addEventListener('click', () => {
  loadProject();
});

document.getElementById('save-button').addEventListener('click', () => {
  saveProject();
});

document.getElementById('undo-button').addEventListener('click', () => {
  undo();
});

document.getElementById('redo-button').addEventListener('click', () => {
  redo();
});

document.getElementById('measure-button').addEventListener('click', () => {
  toggleMeasureMode();
});

document.getElementById('refresh-context-button').addEventListener('click', () => {
  refreshContext();
});

document.getElementById('export-stl-button').addEventListener('click', () => {
  exportSTL();
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

/**
 * Set processing state with optional phase indicator
 * @param {string|null} phase - 'claude' | 'python' | null
 */
function setProcessing(phase) {
  if (phase === 'claude') {
    // Phase 1: Asking Claude - use pulse animation instead of spinner
    loadingOverlay.classList.add('hidden'); // Hide spinner overlay
    statusText.textContent = 'Asking Claude...';
    statusText.style.color = '#888888';

    // Start pulse animation if model exists
    if (currentMesh) {
      startPulseAnimation();
    }
  } else if (phase === 'python') {
    // Phase 2: Building model - stop pulse, show spinner
    stopPulseAnimation(); // Stop pulse if active
    loadingOverlay.classList.remove('hidden');
    statusText.textContent = 'Building model...';
    statusText.style.color = '#888888';
  } else {
    // Done: Stop pulse, hide loading, reset status
    stopPulseAnimation(); // Stop pulse if active
    loadingOverlay.classList.add('hidden');
    statusText.textContent = 'Ready';
    statusText.style.color = '#888888';
  }
}

// Legacy functions for backward compatibility
function showLoading() {
  setProcessing('claude');
}

function hideLoading() {
  setProcessing(null);
}

// ============================================================
// PULSE ANIMATION (Red pulsing during Claude processing)
// ============================================================

/**
 * Start pulsing red animation on the current mesh
 */
function startPulseAnimation() {
  // Only animate if we have a mesh
  if (!currentMesh) {
    console.log('[Pulse] No mesh to animate');
    return;
  }

  // Don't start if already pulsing
  if (isPulsing) {
    console.log('[Pulse] Already pulsing');
    return;
  }

  console.log('[Pulse] Starting pulse animation');
  isPulsing = true;
  pulseStartTime = performance.now();

  // Store original colors for all materials in the mesh
  originalColors.clear();
  currentMesh.traverse((child) => {
    if (child.isMesh && child.material) {
      // Store original color and emissive
      originalColors.set(child.material, {
        color: child.material.color.clone(),
        emissive: child.material.emissive.clone(),
        emissiveIntensity: child.material.emissiveIntensity
      });
    }
  });

  // Define pulse colors
  const dimRed = new THREE.Color(0x661111);    // Dark red
  const lightRed = new THREE.Color(0xaa3333);  // Lighter red

  // Animation loop
  function animatePulse() {
    if (!isPulsing) {
      return; // Stop animation if flag is cleared
    }

    // Calculate elapsed time and pulse phase (0 to 1)
    const elapsed = performance.now() - pulseStartTime;
    const pulseDuration = 1500; // 1.5 seconds per cycle
    const phase = (elapsed % pulseDuration) / pulseDuration;

    // Sine wave interpolation for smooth pulsing (0 -> 1 -> 0)
    const t = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;

    // Interpolate between dim and light red
    const currentColor = new THREE.Color();
    currentColor.lerpColors(dimRed, lightRed, t);

    // Apply to all mesh materials
    if (currentMesh) {
      currentMesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.color.copy(currentColor);
        }
      });
    } else {
      // Mesh was removed - stop animation
      stopPulseAnimation();
      return;
    }

    // Continue animation
    pulseAnimationId = requestAnimationFrame(animatePulse);
  }

  // Start the animation loop
  animatePulse();
}

/**
 * Stop pulsing animation and restore original colors
 */
function stopPulseAnimation() {
  if (!isPulsing) {
    return; // Not pulsing, nothing to stop
  }

  console.log('[Pulse] Stopping pulse animation');
  isPulsing = false;

  // Cancel animation frame
  if (pulseAnimationId !== null) {
    cancelAnimationFrame(pulseAnimationId);
    pulseAnimationId = null;
  }

  // Restore original colors
  if (currentMesh) {
    currentMesh.traverse((child) => {
      if (child.isMesh && child.material && originalColors.has(child.material)) {
        const original = originalColors.get(child.material);
        child.material.color.copy(original.color);
        child.material.emissive.copy(original.emissive);
        child.material.emissiveIntensity = original.emissiveIntensity;
      }
    });
  }

  // Clear stored colors
  originalColors.clear();
  pulseStartTime = null;
}

/**
 * Apply saved feature color overrides to the current mesh
 */
function applyFeatureColors() {
  if (!currentMesh) {
    console.log('[FeatureColors] No mesh to apply colors to');
    return;
  }

  if (!featureColors || Object.keys(featureColors).length === 0) {
    console.log('[FeatureColors] No color overrides to apply');
    return;
  }

  console.log('[FeatureColors] Applying color overrides...');
  let appliedCount = 0;

  currentMesh.traverse((child) => {
    if (child.isMesh && child.userData.featureIndex !== undefined) {
      const featureIndex = child.userData.featureIndex;
      const colorOverride = featureColors[featureIndex];

      if (colorOverride !== undefined) {
        child.material.color.setHex(colorOverride);
        appliedCount++;
        console.log(`[FeatureColors] Applied color 0x${colorOverride.toString(16)} to feature ${featureIndex}`);
      }
    }
  });

  console.log(`[FeatureColors] Applied ${appliedCount} color override(s)`);
}

// Load glTF mesh from file path
function loadMesh(path) {
  setProcessing('python');

  // Clear hover state when loading new mesh
  if (hoveredMesh) {
    removeHighlight(hoveredMesh);
    hoveredMesh = null;
  }

  // Deselect feature and hide color palette
  if (selectedFeature) {
    deselectFeature();
  }

  // Clear any active measurements when loading new mesh
  if (measurePointA || measurePointB) {
    clearMeasurement();
  }
  // Exit measure mode if active
  if (measureMode) {
    measureMode = false;
    const measureButton = document.getElementById('measure-button');
    measureButton.classList.remove('active');
  }

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

      // Scale from mm (Build123d) to scene units (glTF uses meters)
      loadedMesh.scale.set(1000, 1000, 1000);

      // Rotate from Y-up (glTF) to Z-up (scene)
      loadedMesh.rotation.x = Math.PI / 2;

      // Assign feature indices to all child meshes (for click detection)
      let featureIndex = 0;
      loadedMesh.traverse((child) => {
        if (child.isMesh) {
          child.userData.featureIndex = featureIndex++;
        }
      });

      // Apply material and edge lines to all meshes
      // Preserve source colors if present, otherwise apply accent blue
      const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6ab0ff });
      let meshCount = 0;
      let preservedCount = 0;
      const defaultGrey = new THREE.Color(0x808080);

      loadedMesh.traverse((child) => {
        if (child.isMesh) {
          meshCount++;

          // Check if material has a meaningful color (not default grey)
          const hasSourceColor = child.material &&
            child.material.color &&
            !child.material.color.equals(defaultGrey);

          if (hasSourceColor) {
            // Preserve source color, just ensure DoubleSide
            child.material.side = THREE.DoubleSide;
            preservedCount++;
          } else {
            // Dispose old material and apply default accent color
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(mat => mat.dispose());
              } else {
                child.material.dispose();
              }
            }
            child.material = new THREE.MeshStandardMaterial({
              color: 0x4a9eff,
              side: THREE.DoubleSide
            });
          }

          // Add edge lines
          const edges = new THREE.EdgesGeometry(child.geometry);
          const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
          child.add(edgeLines);
        }
      });
      console.log(`Processed ${meshCount} mesh(es): preserved ${preservedCount} color(s), applied accent to ${meshCount - preservedCount}`);

      // Remove test cube on first successful load
      const isFirstLoad = testCube !== null;
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

      // Apply feature color overrides if any
      applyFeatureColors();

      // Only fit camera on first load, preserve user's camera position afterward
      if (isFirstLoad) {
        fitCameraToObject(loadedMesh);
      }

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
      statusText.style.color = '#f44747';

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 3000);

      hideLoading();

      // Keep previous mesh visible (if any)
    }
  );
}

/**
 * Clear the viewport (remove current mesh)
 */
function clearViewport() {
  // Stop pulse animation if active
  stopPulseAnimation();

  // Clear hover state
  if (hoveredMesh) {
    removeHighlight(hoveredMesh);
    hoveredMesh = null;
  }

  // Deselect feature and hide color palette
  if (selectedFeature) {
    deselectFeature();
  }

  // Clear any active measurements
  if (measurePointA || measurePointB) {
    clearMeasurement();
  }
  // Exit measure mode if active
  if (measureMode) {
    measureMode = false;
    const measureButton = document.getElementById('measure-button');
    measureButton.classList.remove('active');
  }

  // Remove current mesh if exists
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
    console.log('[Viewport] Mesh cleared');
  }

  // Also remove test cube if it exists
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
  }
}

/**
 * Clear the entire project (viewport, chat, code, state)
 * Used for Cmd+X (Clear) command
 */
async function clearProject() {
  // Check for unsaved changes first
  const canProceed = await checkUnsavedChanges();
  if (!canProceed) {
    console.log('[Renderer] Clear canceled - unsaved changes');
    return;
  }

  console.log('[Renderer] Clearing project...');

  // Clear viewport
  clearViewport();

  // Clear click marker
  clearClickMarker();

  // Clear message history and chat UI
  messageHistory.length = 0;
  chatMessagesContainer.innerHTML = '';

  // Reset state
  currentCode = '';
  previousCode = null;
  currentFilePath = null;
  projectName = 'untitled';
  isDirty = false;
  lastClickInfo = null;
  featureColors = {};

  // Clear measure distance display
  document.getElementById('measure-distance').textContent = '';

  // Update window title
  updateWindowTitle();

  // Reset status
  statusText.textContent = 'Project cleared';
  statusText.style.color = '#4ec9b0';

  setTimeout(() => {
    statusText.textContent = 'Ready';
    statusText.style.color = '#888888';
  }, 2000);

  console.log('[Renderer] Project cleared');
}

// Expose clearProject for debugging
window.clearProject = clearProject;

// Fit camera to object with optional direction
function fitCameraToObject(object, direction = viewPresets.isometric) {
  // Compute bounding box
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // Calculate distance needed to fit object in view
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 1.5; // 1.5x for margin

  // Reset camera up vector to Z-up for consistent orientation
  camera.up.set(0, 0, 1);

  // Position camera along direction from center
  camera.position.copy(center).add(direction.clone().multiplyScalar(cameraDistance));

  // Update controls target to object center
  controls.target.copy(center);
  controls.update();
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
        statusText.style.color = '#888888';
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
      statusText.style.color = '#888888';
    }, 5000);

    hideLoading();
    throw err;
  }
}

// ============================================================
// UNDO/REDO FUNCTIONALITY (Single-Level)
// ============================================================

/**
 * Save current code state for undo (called before making changes)
 */
function saveUndo() {
  previousCode = currentCode;
  undoneCode = null; // Clear redo state when new change is made
  console.log('[Undo] Saved previous state');
}

/**
 * Undo last change (single-level)
 */
async function undo() {
  if (previousCode === null) {
    console.log('[Undo] No previous state to restore');
    statusText.textContent = 'Nothing to undo';
    statusText.style.color = '#888888';
    setTimeout(() => {
      statusText.textContent = 'Ready';
    }, 1500);
    return;
  }

  console.log('[Undo] Restoring previous state...');

  // Store current code for redo
  undoneCode = currentCode;

  // Restore previous code
  currentCode = previousCode;
  previousCode = null; // Clear undo state (single-level)

  // Mark as unsaved (dirty)
  isDirty = true;
  updateWindowTitle();

  // Show status bar message (white text, no chat message)
  statusText.textContent = 'Undid last change';
  statusText.style.color = '#ffffff';
  setTimeout(() => {
    statusText.textContent = 'Ready';
    statusText.style.color = '#888888';
  }, 2000);

  // Rebuild model with previous code
  if (currentCode) {
    try {
      await executeCode(currentCode);
    } catch (err) {
      console.error('[Undo] Failed to execute restored code:', err);
      statusText.textContent = `Undo failed: ${err.message}`;
      statusText.style.color = '#f44747';
      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 3000);
    }
  } else {
    // No code to restore - clear the viewport
    clearViewport();
    hideLoading();
  }
}

/**
 * Redo last undone change (single-level)
 */
async function redo() {
  if (undoneCode === null) {
    console.log('[Redo] No undone state to restore');
    statusText.textContent = 'Nothing to redo';
    statusText.style.color = '#888888';
    setTimeout(() => {
      statusText.textContent = 'Ready';
    }, 1500);
    return;
  }

  console.log('[Redo] Restoring undone state...');

  // Store current code for undo
  previousCode = currentCode;

  // Restore undone code
  currentCode = undoneCode;
  undoneCode = null; // Clear redo state (single-level)

  // Mark as unsaved (dirty)
  isDirty = true;
  updateWindowTitle();

  // Show status bar message (white text, no chat message)
  statusText.textContent = 'Redid last change';
  statusText.style.color = '#ffffff';
  setTimeout(() => {
    statusText.textContent = 'Ready';
    statusText.style.color = '#888888';
  }, 2000);

  // Rebuild model with redone code
  if (currentCode) {
    try {
      await executeCode(currentCode);
    } catch (err) {
      console.error('[Redo] Failed to execute redone code:', err);
      statusText.textContent = `Redo failed: ${err.message}`;
      statusText.style.color = '#f44747';
      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 3000);
    }
  } else {
    // No code - clear the viewport
    clearViewport();
    hideLoading();
  }
}

// Expose undo/redo functions for debugging
window.undo = undo;
window.redo = redo;

// ============================================================
// MEASURE TOOL
// ============================================================

/**
 * Clear all measurement visuals from the scene
 */
function clearMeasurement() {
  if (measureVisuals.markerA) {
    scene.remove(measureVisuals.markerA);
    measureVisuals.markerA.geometry.dispose();
    measureVisuals.markerA.material.dispose();
    measureVisuals.markerA = null;
  }
  if (measureVisuals.markerB) {
    scene.remove(measureVisuals.markerB);
    measureVisuals.markerB.geometry.dispose();
    measureVisuals.markerB.material.dispose();
    measureVisuals.markerB = null;
  }
  if (measureVisuals.line) {
    scene.remove(measureVisuals.line);
    measureVisuals.line.geometry.dispose();
    measureVisuals.line.material.dispose();
    measureVisuals.line = null;
  }

  measurePointA = null;
  measurePointB = null;
}

/**
 * Clear click marker from scene
 */
function clearClickMarker() {
  if (clickMarkerTimeout) {
    clearTimeout(clickMarkerTimeout);
    clickMarkerTimeout = null;
  }
  if (clickMarker) {
    scene.remove(clickMarker);
    clickMarker.geometry.dispose();
    clickMarker.material.dispose();
    clickMarker = null;
  }
}

/**
 * Create click marker at position
 */
function createClickMarker(position) {
  // Clear any existing marker
  clearClickMarker();

  // Create a small yellow sphere
  const geometry = new THREE.SphereGeometry(1.5, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xdcdcaa }); // Warning/yellow color
  clickMarker = new THREE.Mesh(geometry, material);
  clickMarker.position.copy(position);
  scene.add(clickMarker);

  // Auto-remove after 5 seconds
  clickMarkerTimeout = setTimeout(() => {
    clearClickMarker();
  }, 5000);
}

/**
 * Create a small sphere marker at a point
 */
function createMarker(position) {
  const geometry = new THREE.SphereGeometry(1, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0x4a9eff });
  const marker = new THREE.Mesh(geometry, material);
  marker.position.copy(position);
  return marker;
}

/**
 * Toggle measure mode on/off
 */
function toggleMeasureMode() {
  measureMode = !measureMode;

  const measureButton = document.getElementById('measure-button');
  const measureDistance = document.getElementById('measure-distance');
  if (measureMode) {
    // Hide color palette when entering measure mode
    if (selectedFeature) {
      deselectFeature();
    }

    measureButton.classList.add('active');
    statusText.textContent = 'Measure mode: Click first point';
    statusText.style.color = '#4a9eff';
    console.log('[Measure] Mode activated');
  } else {
    measureButton.classList.remove('active');
    clearMeasurement();
    measureDistance.textContent = ''; // Clear toolbar distance display
    statusText.textContent = 'Ready';
    statusText.style.color = '#888888';
    console.log('[Measure] Mode deactivated');
  }
}

/**
 * Handle measure click - called when user clicks in measure mode
 */
function handleMeasureClick(point) {
  if (!measurePointA) {
    // First click - set point A
    measurePointA = point.clone();

    // Create marker at point A
    measureVisuals.markerA = createMarker(measurePointA);
    scene.add(measureVisuals.markerA);

    statusText.textContent = 'Measure mode: Click second point';
    statusText.style.color = '#4a9eff';
    console.log(`[Measure] Point A: (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`);
  } else if (!measurePointB) {
    // Second click - set point B and complete measurement
    measurePointB = point.clone();

    // Create marker at point B
    measureVisuals.markerB = createMarker(measurePointB);
    scene.add(measureVisuals.markerB);

    // Calculate distance
    const distance = measurePointA.distanceTo(measurePointB);
    const distanceText = `${distance.toFixed(1)} mm`;
    console.log(`[Measure] Point B: (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`);
    console.log(`[Measure] Distance: ${distanceText}`);

    // Create yellow line between points
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([measurePointA, measurePointB]);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xdcdcaa, linewidth: 2 });
    measureVisuals.line = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(measureVisuals.line);

    // Display distance in toolbar (no floating label)
    document.getElementById('measure-distance').textContent = distanceText;

    // Exit measure mode
    measureMode = false;
    const measureButton = document.getElementById('measure-button');
    measureButton.classList.remove('active');

    statusText.textContent = 'Ready';
    statusText.style.color = '#888888';
  }
}

// Expose functions on window object
window.setProcessing = setProcessing;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.loadMesh = loadMesh;
window.executeCode = executeCode;
window.toggleMeasureMode = toggleMeasureMode;
window.clearMeasurement = clearMeasurement;
window.startPulseAnimation = startPulseAnimation;
window.stopPulseAnimation = stopPulseAnimation;
window.applyFeatureColors = applyFeatureColors;

// ============================================================
// WINDOW TITLE MANAGEMENT
// ============================================================

/**
 * Update window title to show project name and dirty state
 */
function updateWindowTitle() {
  const dirtyIndicator = isDirty ? '* ' : '';
  const title = `${dirtyIndicator}${projectName} - ClaudeCAD`;
  ipcRenderer.send('set-window-title', title);
}

// Initialize window title
updateWindowTitle();

// IPC handler: main process asks for dirty state
ipcRenderer.on('request-dirty-state', () => {
  ipcRenderer.send('dirty-state-response', isDirty);
});

// IPC handler: main process requests save before close
ipcRenderer.on('save-and-close', async () => {
  await saveProject();
  // Only proceed with close if save succeeded (isDirty will be false)
  // If user canceled save dialog, isDirty stays true - don't close
  if (!isDirty) {
    ipcRenderer.send('proceed-with-close');
  }
});

// IPC handler: force close without saving
ipcRenderer.on('force-close', () => {
  ipcRenderer.send('proceed-with-close');
});

// IPC handlers for menu commands (Electron menu sends these)
ipcRenderer.on('menu-new', () => {
  clearProject();
});

ipcRenderer.on('menu-open', () => {
  loadProject();
});

ipcRenderer.on('menu-save', () => {
  saveProject();
});

ipcRenderer.on('menu-save-as', () => {
  saveProjectAs();
});

ipcRenderer.on('menu-export-stl', () => {
  exportSTL();
});

ipcRenderer.on('menu-undo', () => {
  undo();
});

ipcRenderer.on('menu-redo', () => {
  redo();
});

ipcRenderer.on('menu-refresh-context', () => {
  refreshContext();
});

// ============================================================
// REFRESH CONTEXT
// ============================================================

/**
 * Refresh Claude's context by clearing and re-establishing state.
 * Filters out error messages from history.
 */
async function refreshContext() {
  try {
    console.log('[Renderer] Refreshing Claude context...');

    // Show status
    statusText.textContent = 'Refreshing context...';
    statusText.style.color = '#4a9eff';

    // Filter chat history - exclude error messages
    const cleanedHistory = messageHistory
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({ role: msg.role, content: msg.content }));

    console.log('[Renderer] Cleaned history entries:', cleanedHistory.length);

    // Call IPC to refresh context
    const result = await ipcRenderer.invoke('refresh-context', {
      currentCode,
      cleanedHistory
    });

    if (result.success) {
      console.log('[Renderer] Context refreshed successfully');
      statusText.textContent = 'Context refreshed';
      statusText.style.color = '#ffffff'; // White
    } else {
      console.error('[Renderer] Context refresh failed:', result.error);
      statusText.textContent = `Refresh failed: ${result.error}`;
      statusText.style.color = '#f44747';
    }

    setTimeout(() => {
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }, 2000);

  } catch (err) {
    console.error('[Renderer] Error in refreshContext:', err);
    statusText.textContent = `Error: ${err.message}`;
    statusText.style.color = '#f44747';

    setTimeout(() => {
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }, 3000);
  }
}

// Expose for debugging
window.refreshContext = refreshContext;

// ============================================================
// SAVE/LOAD PROJECT
// ============================================================

/**
 * Check if there are unsaved changes and prompt user to save
 * Returns true if it's safe to proceed (saved, discarded, or no changes)
 * Returns false if user canceled
 */
async function checkUnsavedChanges() {
  if (!isDirty) {
    return true; // No unsaved changes, safe to proceed
  }

  // Show dialog using Electron's dialog (via IPC)
  const result = await ipcRenderer.invoke('show-unsaved-changes-dialog');

  if (result === 0) {
    // Save
    await saveProject();
    // Check if save succeeded (isDirty will be false if it did)
    return !isDirty;
  } else if (result === 1) {
    // Don't Save
    return true;
  } else {
    // Cancel (result === 2)
    return false;
  }
}

// Expose for future New Project / Load Project features
window.checkUnsavedChanges = checkUnsavedChanges;

/**
 * Save the current project to a .cc file
 */
async function saveProject() {
  try {
    console.log('[Renderer] Saving project...');

    // Prepare chat history for saving (only role, content, timestamp)
    const chatHistoryForSave = messageHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp.toISOString()
    }));

    // Call IPC to save
    const result = await ipcRenderer.invoke('save-project', {
      code: currentCode,
      chatHistory: chatHistoryForSave,
      projectName: projectName,
      currentFilePath: currentFilePath,
      featureColors: featureColors
    });

    if (result.success) {
      // Update current file path
      currentFilePath = result.filePath;
      isDirty = false;

      // Extract project name from file path (remove extension and path)
      const fileName = result.filePath.split(/[\\/]/).pop(); // Get last part of path
      projectName = fileName.replace(/\.cc$/, ''); // Remove .cc extension

      // Update window title
      updateWindowTitle();

      console.log('[Renderer] Project saved successfully to:', result.filePath);
      console.log('[Renderer] Project name:', projectName);

      // Show success feedback in status bar (yellow for visibility)
      statusText.textContent = 'Project saved';
      statusText.style.color = '#dcdcaa'; // Yellow/warning color for visibility

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 2000);
    } else if (result.canceled) {
      console.log('[Renderer] Save canceled by user');
    } else {
      console.error('[Renderer] Save failed:', result.error);

      // Show error feedback
      statusText.textContent = `Save failed: ${result.error}`;
      statusText.style.color = '#f44747'; // Error color

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 3000);
    }
  } catch (err) {
    console.error('[Renderer] Error in saveProject:', err);

    statusText.textContent = `Error: ${err.message}`;
    statusText.style.color = '#f44747';

    setTimeout(() => {
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }, 3000);
  }
}

// Expose for debugging
window.saveProject = saveProject;

/**
 * Save the current project to a new .cc file (Save As)
 */
async function saveProjectAs() {
  // Temporarily clear currentFilePath to force "Save As" dialog
  const previousPath = currentFilePath;
  currentFilePath = null;

  try {
    await saveProject();
  } finally {
    // If save was canceled, restore previous path
    if (currentFilePath === null) {
      currentFilePath = previousPath;
    }
  }
}

// Expose for debugging
window.saveProjectAs = saveProjectAs;

/**
 * Load a project from a .cc file or .md prompt file
 */
async function loadProject() {
  try {
    console.log('[Renderer] Loading project...');

    // Check for unsaved changes first
    const canProceed = await checkUnsavedChanges();
    if (!canProceed) {
      console.log('[Renderer] Load canceled - unsaved changes');
      return;
    }

    // Call IPC to open file dialog and read file
    const result = await ipcRenderer.invoke('load-project');

    if (result.canceled) {
      console.log('[Renderer] Load canceled by user');
      return;
    }

    if (!result.success) {
      console.error('[Renderer] Load failed:', result.error);
      statusText.textContent = `Load failed: ${result.error}`;
      statusText.style.color = '#f44747';

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 3000);
      return;
    }

    // Handle prompt file (.md)
    if (result.isPrompt) {
      console.log('[Renderer] Loading prompt file');

      // Put prompt content into chat input
      chatInput.value = result.promptContent;
      chatInput.focus();

      statusText.textContent = 'Prompt loaded - press Enter to send';
      statusText.style.color = '#4ec9b0';

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 3000);
      return;
    }

    // Handle project file (.cc)
    const projectData = result.projectData;

    // Clear existing state
    clearMeasurement();
    clearClickMarker();
    if (measureMode) {
      measureMode = false;
      document.getElementById('measure-button').classList.remove('active');
    }

    // Clear message history and chat UI
    messageHistory.length = 0;
    chatMessagesContainer.innerHTML = '';

    // Restore chat history
    if (projectData.chat && Array.isArray(projectData.chat)) {
      projectData.chat.forEach(msg => {
        // Add to history
        messageHistory.push({
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp)
        });

        // Add to UI (simplified - just add the message element)
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${msg.role}`;

        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        contentEl.textContent = msg.content;
        messageEl.appendChild(contentEl);

        const timestampEl = document.createElement('div');
        timestampEl.className = 'message-timestamp';
        timestampEl.textContent = formatTimestamp(new Date(msg.timestamp));
        messageEl.appendChild(timestampEl);

        chatMessagesContainer.appendChild(messageEl);
      });
    }

    // Update state
    currentCode = projectData.code || '';
    currentFilePath = result.filePath;
    projectName = projectData.name || 'untitled';
    previousCode = null; // Clear undo state
    undoneCode = null; // Clear redo state
    isDirty = false;
    projectJustLoaded = true; // Flag to inject context on next message

    // Restore feature color overrides
    featureColors = projectData.featureColors || {};
    console.log('[Renderer] Restored feature colors:', Object.keys(featureColors).length, 'override(s)');

    // Update window title
    updateWindowTitle();

    // Rebuild model if there's code
    if (currentCode && currentCode.trim()) {
      try {
        await executeCode(currentCode);
      } catch (err) {
        console.error('[Renderer] Failed to rebuild model:', err);
        addMessage('error', `Failed to rebuild model: ${err.message}`);
      }
    } else {
      // No code - clear viewport
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
    }

    console.log('[Renderer] Project loaded successfully:', projectName);

    statusText.textContent = 'Project loaded';
    statusText.style.color = '#4ec9b0';

    setTimeout(() => {
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }, 2000);

  } catch (err) {
    console.error('[Renderer] Error in loadProject:', err);

    statusText.textContent = `Error: ${err.message}`;
    statusText.style.color = '#f44747';

    setTimeout(() => {
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }, 3000);
  }
}

// Expose for debugging
window.loadProject = loadProject;

// ============================================================
// EXPORT STL
// ============================================================

/**
 * Export the current model to STL format
 */
async function exportSTL() {
  try {
    console.log('[Renderer] Exporting STL...');

    // Check if we have code to export
    if (!currentCode || !currentCode.trim()) {
      console.error('[Renderer] No model code to export');
      statusText.textContent = 'Error: No model to export';
      statusText.style.color = '#f44747';

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 3000);
      return;
    }

    // Show status
    statusText.textContent = 'Exporting STL...';
    statusText.style.color = '#4a9eff';

    // Call IPC to export
    const result = await ipcRenderer.invoke('export-stl', {
      code: currentCode
    });

    if (result.success) {
      console.log('[Renderer] STL exported successfully to:', result.filePath);

      // Show success feedback in status bar
      statusText.textContent = 'STL exported successfully';
      statusText.style.color = '#4ec9b0'; // Success color

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 3000);
    } else if (result.canceled) {
      console.log('[Renderer] Export canceled by user');
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    } else {
      console.error('[Renderer] Export failed:', result.error);

      // Show error feedback
      statusText.textContent = `Export failed: ${result.error}`;
      statusText.style.color = '#f44747'; // Error color

      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 5000);
    }
  } catch (err) {
    console.error('[Renderer] Error in exportSTL:', err);

    statusText.textContent = `Error: ${err.message}`;
    statusText.style.color = '#f44747';

    setTimeout(() => {
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }, 3000);
  }
}

// Expose for debugging
window.exportSTL = exportSTL;

// Expose project state for debugging
Object.defineProperty(window, 'currentFilePath', {
  get: () => currentFilePath,
  set: (value) => { currentFilePath = value; }
});

Object.defineProperty(window, 'projectName', {
  get: () => projectName,
  set: (value) => { projectName = value; }
});

Object.defineProperty(window, 'isDirty', {
  get: () => isDirty,
  set: (value) => {
    isDirty = value;
    updateWindowTitle();
  }
});

// Temporary key listeners for testing
document.addEventListener('keydown', (e) => {
  // Ignore key events when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }

  // Cmd+S / Ctrl+S: Save project
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault(); // Prevent browser save dialog
    saveProject();
    return;
  }

  // Cmd+E / Ctrl+E: Export STL
  if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
    e.preventDefault(); // Prevent browser default
    exportSTL();
    return;
  }

  // Cmd+O / Ctrl+O: Open project
  if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
    e.preventDefault(); // Prevent browser open dialog
    loadProject();
    return;
  }

  // Cmd+Shift+K / Ctrl+Shift+K: Clear project
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    clearProject();
    return;
  }

  // Cmd+Shift+Z / Ctrl+Shift+Z: Redo last undone change
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault(); // Prevent browser redo
    redo();
    return;
  }

  // Cmd+Z / Ctrl+Z: Undo last change
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
    e.preventDefault(); // Prevent browser undo
    undo();
    return;
  }

  // Escape key: clear various states
  if (e.key === 'Escape') {
    // Deselect feature and hide color palette
    if (selectedFeature) {
      deselectFeature();
    }

    // Clear click marker if present
    if (clickMarker) {
      clearClickMarker();
      lastClickInfo = null;
    }

    // Clear measurement visuals and/or exit measure mode
    if (measureMode || measurePointA || measurePointB) {
      // Always clear measurement visuals
      clearMeasurement();
      // Clear toolbar distance display
      document.getElementById('measure-distance').textContent = '';
      // Exit measure mode if active
      if (measureMode) {
        measureMode = false;
        document.getElementById('measure-button').classList.remove('active');
      }
      // Reset status
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }
  }

  // M key: toggle measure mode
  if (e.key === 'm' || e.key === 'M') {
    toggleMeasureMode();
  }

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
    with Locations((0, 0, 10)):  # Top of centered box
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

// ============================================================
// CHAT MESSAGE SYSTEM
// ============================================================

// Message history storage
const messageHistory = [];

// Get chat messages container
const chatMessagesContainer = document.getElementById('chat-messages');

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format timestamp
 */
function formatTimestamp(date) {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Parse markdown code blocks from text
 * Returns array of { type: 'text'|'code', content: string, language?: string }
 */
function parseCodeBlocks(text) {
  const parts = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const textContent = text.substring(lastIndex, match.index).trim();
      if (textContent) {
        parts.push({ type: 'text', content: textContent });
      }
    }

    // Add code block
    parts.push({
      type: 'code',
      language: match[1] || 'code',
      content: match[2].trim()
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < text.length) {
    const textContent = text.substring(lastIndex).trim();
    if (textContent) {
      parts.push({ type: 'text', content: textContent });
    }
  }

  // If no code blocks found, return the whole text as a single text part
  if (parts.length === 0) {
    parts.push({ type: 'text', content: text });
  }

  return parts;
}

/**
 * Create a code block element with collapse/expand functionality
 */
function createCodeBlockElement(language, code) {
  const codeBlock = document.createElement('div');
  codeBlock.className = 'message-code-block';

  // Create header
  const header = document.createElement('div');
  header.className = 'code-block-header';

  const languageSpan = document.createElement('span');
  languageSpan.className = 'code-block-language';
  languageSpan.textContent = language;

  const toggleSpan = document.createElement('span');
  toggleSpan.className = 'code-block-toggle';
  toggleSpan.textContent = 'Click to expand';

  header.appendChild(languageSpan);
  header.appendChild(toggleSpan);

  // Create content
  const content = document.createElement('pre');
  content.className = 'code-block-content collapsed';
  content.textContent = code;

  // Toggle functionality
  let isCollapsed = true;
  header.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    if (isCollapsed) {
      content.classList.add('collapsed');
      toggleSpan.textContent = 'Click to expand';
    } else {
      content.classList.remove('collapsed');
      toggleSpan.textContent = 'Click to collapse';
    }
  });

  codeBlock.appendChild(header);
  codeBlock.appendChild(content);

  return codeBlock;
}

/**
 * Add a message to the chat
 * @param {string} role - 'user' | 'assistant' | 'error' | 'system'
 * @param {string} content - Message content
 * @param {object} options - Optional parameters (rawResponse for error messages)
 */
function addMessage(role, content, options = {}) {
  // Store in history (only store user/assistant, not system/error)
  const message = {
    role,
    content,
    timestamp: new Date(),
    ...options
  };

  // Only add user and assistant messages to history for Claude context
  if (role === 'user' || role === 'assistant') {
    messageHistory.push(message);
  }

  // Mark as unsaved (chat changed)
  isDirty = true;
  updateWindowTitle();

  // Create message element
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${role}`;

  // Create content wrapper
  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';

  // Parse content based on role
  if (role === 'assistant') {
    // Parse code blocks for assistant messages
    const parts = parseCodeBlocks(content);

    parts.forEach(part => {
      if (part.type === 'text') {
        // Add text content
        const textEl = document.createElement('div');
        textEl.textContent = part.content;
        contentEl.appendChild(textEl);
      } else if (part.type === 'code') {
        // Add collapsible code block
        const codeBlockEl = createCodeBlockElement(part.language, part.content);
        contentEl.appendChild(codeBlockEl);
      }
    });
  } else if (role === 'error') {
    // Error messages: show error text and optional raw response
    const errorText = document.createElement('div');
    errorText.textContent = content;
    contentEl.appendChild(errorText);

    if (options.rawResponse) {
      const rawEl = document.createElement('div');
      rawEl.style.marginTop = '8px';
      rawEl.style.fontSize = '11px';
      rawEl.style.opacity = '0.8';
      rawEl.textContent = `Raw: ${options.rawResponse}`;
      contentEl.appendChild(rawEl);
    }
  } else if (role === 'system') {
    // System messages: simple text (like user messages)
    contentEl.textContent = content;
  } else {
    // User messages: simple text
    contentEl.textContent = content;
  }

  messageEl.appendChild(contentEl);

  // Add timestamp
  const timestampEl = document.createElement('div');
  timestampEl.className = 'message-timestamp';
  timestampEl.textContent = formatTimestamp(message.timestamp);
  messageEl.appendChild(timestampEl);

  // Add to DOM
  chatMessagesContainer.appendChild(messageEl);

  // Scroll into view
  messageEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Expose message functions globally
window.addMessage = addMessage;
window.messageHistory = messageHistory;

// ============================================================
// CHAT INPUT AND SEND FLOW
// ============================================================

// Get chat input elements
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');

// Processing state flag
let isProcessing = false;

/**
 * Send a chat message through the full pipeline:
 * User -> Claude -> Python -> Mesh
 */
async function sendChatMessage() {
  // Get message text
  const message = chatInput.value.trim();

  // Validate
  if (!message) {
    console.log('[Chat] Empty message, ignoring');
    return;
  }

  if (isProcessing) {
    console.log('[Chat] Already processing, ignoring');
    return;
  }

  // Clear input immediately
  chatInput.value = '';
  try {
    // Set processing state
    isProcessing = true;
    chatInput.disabled = true;
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';

    // Add user message to chat
    addMessage('user', message);

    // Show loading state - Phase 1: Asking Claude
    setProcessing('claude');

    // Build history for Claude (exclude timestamps, only role + content)
    const history = messageHistory
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({ role: msg.role, content: msg.content }));

    // Check if we have recent click info (within last 30 seconds)
    let clickInfo = null;
    if (lastClickInfo && lastClickInfo.timestamp) {
      const timeSinceClick = Date.now() - lastClickInfo.timestamp;
      if (timeSinceClick <= 30000) { // 30 seconds
        clickInfo = {
          position: lastClickInfo.position,
          normal: lastClickInfo.normal
        };
        console.log('[Chat] Including recent click info from', (timeSinceClick / 1000).toFixed(1), 'seconds ago');
      }
    }

    // Clear click marker when sending
    clearClickMarker();

    // If project was just loaded, prepend context note to help Claude understand current state
    let messageToSend = message;
    if (projectJustLoaded && currentCode) {
      messageToSend = `[Note: A project was just loaded. The current model code shown above is the ground truth - ignore any conflicting context from chat history.]\n\n${message}`;
      projectJustLoaded = false; // Clear flag after first message
      console.log('[Chat] Injected context reset note for post-load message');
    }

    console.log('[Chat] Sending to Claude via IPC...');
    console.log('[Chat] Message:', messageToSend);
    console.log('[Chat] Current code length:', currentCode.length);
    console.log('[Chat] History entries:', history.length);
    console.log('[Chat] Click info:', clickInfo ? 'included' : 'none');

    // Call IPC
    const result = await ipcRenderer.invoke('send-chat-message', {
      message: messageToSend,
      currentCode,
      history,
      clickInfo
    });

    // Clear click info after using it
    if (clickInfo) {
      lastClickInfo = null;
      console.log('[Chat] Cleared click info after sending');
    }

    console.log('[Chat] Received result:', result);

    if (result.success) {
      // Save current code for undo before updating
      saveUndo();

      // If this is a new model, clear the file path so next save prompts for filename
      if (result.newModel) {
        console.log('[Chat] New model detected - clearing file path for Save As');
        currentFilePath = null;
        projectName = 'untitled';
      }

      // Update current code
      currentCode = result.code;

      // Mark as unsaved (code changed)
      isDirty = true;
      updateWindowTitle();

      // Add assistant message
      addMessage('assistant', result.explanation);

      // Check if result is empty (no geometry produced)
      if (result.empty) {
        console.log('[Chat] Empty geometry result - clearing viewport');
        clearViewport();
        setProcessing(null);
      } else {
        // Success: code executed, mesh generated
        console.log('[Chat] Success! Loading mesh:', result.meshPath);
        // Load the mesh (this will trigger Phase 2: "Building model...")
        loadMesh(result.meshPath);
      }
    } else {
      // Failure: show error
      console.error('[Chat] Failed:', result.error);

      // Add assistant explanation (if any)
      if (result.explanation) {
        addMessage('assistant', result.explanation);
      }

      // Add error message
      addMessage('error', result.error || 'Unknown error occurred');

      // Hide loading and show error in status
      statusText.textContent = result.error || 'Error occurred';
      statusText.style.color = '#f44747';
      setProcessing(null);

      // Reset status after 5 seconds
      setTimeout(() => {
        statusText.textContent = 'Ready';
        statusText.style.color = '#888888';
      }, 5000);
    }
  } catch (err) {
    console.error('[Chat] Error in executeChatMessage:', err);

    // Show error in chat
    addMessage('error', `Failed to send message: ${err.message}`);

    // Show error in status bar
    statusText.textContent = `Error: ${err.message}`;
    statusText.style.color = '#f44747';
    setProcessing(null);

    // Reset status after 5 seconds
    setTimeout(() => {
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }, 5000);
  } finally {
    // Re-enable input
    isProcessing = false;
    chatInput.disabled = false;
    sendButton.disabled = false;
    sendButton.textContent = 'Send';

    // Focus input for next message
    chatInput.focus();
  }
}

// Send button click handler
sendButton.addEventListener('click', () => {
  sendChatMessage();
});

// Chat input key handler
// Enter = send, Shift+Enter = new line
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault(); // Prevent new line
    sendChatMessage();
  }
});

// Expose for debugging
window.sendChatMessage = sendChatMessage;

// Expose currentCode as a getter so it always returns the latest value
Object.defineProperty(window, 'currentCode', {
  get: () => currentCode,
  set: (value) => { currentCode = value; }
});

// Expose lastClickInfo for debugging
Object.defineProperty(window, 'lastClickInfo', {
  get: () => lastClickInfo
});

// Expose selectedFeature for debugging
Object.defineProperty(window, 'selectedFeature', {
  get: () => selectedFeature
});

// Expose color palette functions for debugging
window.showColorPalette = showColorPalette;
window.hideColorPalette = hideColorPalette;
window.applyColorToFeature = applyColorToFeature;
window.deselectFeature = deselectFeature;

// Expose feature colors for debugging
Object.defineProperty(window, 'featureColors', {
  get: () => featureColors
});

// ============================================================
// HOVER HIGHLIGHT SYSTEM
// ============================================================

/**
 * Lighten a color by increasing its HSL lightness
 * @param {THREE.Color} color - The color to lighten
 * @param {number} amount - Amount to increase lightness (0-1)
 * @returns {THREE.Color} - New lightened color
 */
function lightenColor(color, amount = 0.3) {
  const hsl = {};
  color.getHSL(hsl);
  hsl.l = Math.min(1, hsl.l + amount);
  return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
}

/**
 * Apply per-feature highlight effect to a mesh
 * Stores original color and applies lightened version
 */
function applyFeatureHighlight(mesh) {
  if (!mesh.material) return;

  // Store original color in userData
  mesh.userData.originalColor = mesh.material.color.clone();

  // Apply lightened color
  mesh.material.color.copy(lightenColor(mesh.userData.originalColor));
}

/**
 * Remove per-feature highlight effect from a mesh
 * Restores original color from userData
 */
function removeFeatureHighlight(mesh) {
  if (!mesh.material) return;

  // Restore original color if stored
  if (mesh.userData.originalColor) {
    mesh.material.color.copy(mesh.userData.originalColor);
    delete mesh.userData.originalColor;
  }
}

/**
 * Apply highlight effect to a mesh (legacy function for compatibility)
 */
function applyHighlight(mesh) {
  applyFeatureHighlight(mesh);
}

/**
 * Remove highlight effect from a mesh (legacy function for compatibility)
 */
function removeHighlight(mesh) {
  removeFeatureHighlight(mesh);
}

/**
 * Check for hover intersection and apply/remove highlight
 */
function updateHover() {
  // Skip if dragging or no mesh loaded
  if (isDragging || !currentMesh) {
    return;
  }

  // Cast ray from camera through mouse position
  raycaster.setFromCamera(mouse, camera);

  // Check for intersections with scene objects
  const intersects = raycaster.intersectObjects(scene.children, true);

  // Filter to only include intersections with the current mesh (not grid, axes, etc.)
  const meshIntersects = intersects.filter(intersect => {
    if (!intersect.object.isMesh) {
      return false;
    }

    // Walk up the parent chain to see if this belongs to currentMesh
    let obj = intersect.object;
    while (obj) {
      if (obj === currentMesh) {
        return true;
      }
      obj = obj.parent;
    }
    return false;
  });

  // Check if we're hovering over the mesh
  if (meshIntersects.length > 0) {
    const firstHit = meshIntersects[0];
    const hitMesh = firstHit.object;

    // If this is a new hover target, update highlight
    if (hoveredMesh !== hitMesh) {
      // Remove highlight from previous mesh
      if (hoveredMesh) {
        removeHighlight(hoveredMesh);
      }

      // Apply highlight to new mesh
      hoveredMesh = hitMesh;
      applyHighlight(hoveredMesh);
    }
  } else {
    // No intersection - remove highlight if present
    if (hoveredMesh) {
      removeHighlight(hoveredMesh);
      hoveredMesh = null;
    }
  }
}

/**
 * Throttled mousemove handler for hover detection
 */
renderer.domElement.addEventListener('mousemove', (event) => {
  // Throttle to ~30fps
  const now = performance.now();
  if (now - lastHoverCheck < hoverCheckInterval) {
    return;
  }
  lastHoverCheck = now;

  // Get canvas bounding rectangle
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();

  // Calculate normalized device coordinates (-1 to +1)
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Update hover state
  updateHover();
});

/**
 * Remove highlight when mouse leaves the viewport
 */
renderer.domElement.addEventListener('mouseleave', () => {
  if (hoveredMesh) {
    removeHighlight(hoveredMesh);
    hoveredMesh = null;
  }
});

// ============================================================
// COLOR PALETTE
// ============================================================

// Get color palette elements
const colorPalette = document.getElementById('color-palette');
const colorSwatches = document.querySelectorAll('.color-swatch');

// Color name mapping for chat messages
const colorNames = {
  0x000000: 'black',
  0xffffff: 'white',
  0x4a9eff: 'blue',
  0xff4444: 'red',
  0xffff00: 'yellow',
  0x44ff44: 'green',
  0x00ffff: 'cyan',
  0xff00ff: 'magenta',
  0xff9900: 'orange'
};

/**
 * Initialize color swatches with their background colors
 */
function initializeColorPalette() {
  colorSwatches.forEach(swatch => {
    const color = swatch.getAttribute('data-color');
    swatch.style.backgroundColor = color;
  });
}

// Initialize palette on load
initializeColorPalette();

/**
 * Show color palette when a feature is selected
 */
function showColorPalette() {
  if (!selectedFeature) return;

  colorPalette.classList.remove('hidden');

  // Update active state to show current color
  updateActiveColorSwatch();
}

/**
 * Hide color palette
 */
function hideColorPalette() {
  colorPalette.classList.add('hidden');

  // Clear active states
  colorSwatches.forEach(swatch => {
    swatch.classList.remove('active');
  });
}

/**
 * Update active color swatch based on selected feature's current color
 */
function updateActiveColorSwatch() {
  if (!selectedFeature || !selectedFeature.material) return;

  const currentColor = selectedFeature.material.color;

  // Find matching swatch
  colorSwatches.forEach(swatch => {
    const swatchColor = new THREE.Color(swatch.getAttribute('data-color'));

    // Compare colors (with small tolerance for floating point)
    if (currentColor.equals(swatchColor)) {
      swatch.classList.add('active');
    } else {
      swatch.classList.remove('active');
    }
  });
}

/**
 * Apply color to selected feature
 */
function applyColorToFeature(colorHex) {
  if (!selectedFeature || !selectedFeature.material) {
    console.warn('[ColorPalette] No feature selected or no material');
    return;
  }

  const newColor = new THREE.Color(colorHex);
  selectedFeature.material.color.copy(newColor);

  // Get feature index
  const featureIndex = selectedFeature.userData.featureIndex;

  // Get color name for chat message
  const colorInt = parseInt(colorHex.replace('#', ''), 16);
  const colorName = colorNames[colorInt] || 'custom';

  console.log(`[ColorPalette] Applied color ${colorHex} to feature ${featureIndex}`);

  // Add system message to chat
  addMessage('system', `Color of Feature ${featureIndex} changed to ${colorName}`);

  // Store color override for save/load
  featureColors[featureIndex] = colorInt;

  // Update active swatch
  updateActiveColorSwatch();

  // Mark project as dirty
  isDirty = true;
  updateWindowTitle();
}

/**
 * Deselect current feature
 */
function deselectFeature() {
  selectedFeature = null;
  hideColorPalette();
}

// Add click handlers to color swatches
colorSwatches.forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent viewport click
    const color = swatch.getAttribute('data-color');
    applyColorToFeature(color);
  });
});

// ============================================================
// RAYCASTER CLICK DETECTION
// ============================================================

/**
 * Handle mouse click on viewport to detect mesh intersections
 */
renderer.domElement.addEventListener('click', (event) => {
  // Only process if we have a mesh loaded
  if (!currentMesh) {
    return;
  }

  // Get canvas bounding rectangle
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();

  // Calculate normalized device coordinates (-1 to +1)
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Cast ray from camera through mouse position
  raycaster.setFromCamera(mouse, camera);

  // Check for intersections with all objects in the scene
  const intersects = raycaster.intersectObjects(scene.children, true);

  // Filter to only include intersections with the current mesh
  // (Exclude grid, axes, labels, test cube, lights)
  // Also filter out LineSegments (edge lines) which don't have faces
  const meshIntersects = intersects.filter(intersect => {
    // Skip non-mesh objects (LineSegments, etc.)
    if (!intersect.object.isMesh) {
      return false;
    }

    // Walk up the parent chain to see if this object belongs to currentMesh
    let obj = intersect.object;
    while (obj) {
      if (obj === currentMesh) {
        return true;
      }
      obj = obj.parent;
    }
    return false;
  });

  // If we hit the mesh
  if (meshIntersects.length > 0) {
    const firstHit = meshIntersects[0];
    const point = firstHit.point;
    const hitMesh = firstHit.object;

    // If in measure mode, handle measurement
    if (measureMode) {
      handleMeasureClick(point);
      return; // Don't process normal click info
    }

    // Normal click handling (not in measure mode)
    // Store selected feature reference
    selectedFeature = hitMesh;
    const featureIdx = hitMesh.userData.featureIndex;
    console.log(`[Selection] Feature ${featureIdx} selected`);

    // Show color palette
    showColorPalette();

    // Get face normal if available
    if (firstHit.face && firstHit.face.normal) {
      // Clone the local face normal
      const localNormal = firstHit.face.normal.clone();

      // Transform to world space using the object's rotation matrix
      const worldNormal = localNormal.transformDirection(firstHit.object.matrixWorld);

      // Normalize to ensure it's a unit vector
      worldNormal.normalize();

      // Store last click info with timestamp and feature index
      lastClickInfo = {
        position: {
          x: point.x,
          y: point.y,
          z: point.z
        },
        normal: {
          x: worldNormal.x,
          y: worldNormal.y,
          z: worldNormal.z
        },
        featureIndex: featureIdx,
        timestamp: Date.now()
      };

      // Create visual marker at click point
      createClickMarker(point);

      // Log with formatted output
      console.log(`[Raycaster] Hit at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`);
      console.log(`[Raycaster] Normal: (${worldNormal.x.toFixed(3)}, ${worldNormal.y.toFixed(3)}, ${worldNormal.z.toFixed(3)})`);
    } else {
      // No face normal available (shouldn't happen with filtered meshes, but handle it)
      lastClickInfo = {
        position: {
          x: point.x,
          y: point.y,
          z: point.z
        },
        normal: null,
        featureIndex: featureIdx,
        timestamp: Date.now()
      };

      // Create visual marker at click point
      createClickMarker(point);

      console.log(`[Raycaster] Hit at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`);
      console.log(`[Raycaster] Warning: No face normal available`);
    }
  } else {
    // Clicked on empty space (not on mesh) - deselect feature
    if (selectedFeature) {
      console.log('[Selection] Deselected feature (clicked empty space)');
      deselectFeature();
    }
  }
});

// ============================================================

console.log('ClaudeCAD Phase 2 Complete');
