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

// Track current model volume (from Build123d, in cubic mm)
let currentVolume = 0;

// Track current shapes array for save functionality
let currentShapes = [];

// Track current Build123d code (for iterative editing)
let currentCode = '';

// Track current project file path and saved state
let currentFilePath = null; // Path to currently open .cc file
let projectName = 'untitled'; // Project name (extracted from chat or file)
let isDirty = false; // Whether current state has unsaved changes

// Feature color overrides (featureIndex -> colorHex)
let featureColors = {};

// Images waiting to be sent with next message
let pendingImages = [];  // Array of { number, path, thumbnail }

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
let edgeLinesVisible = true;
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

// Axes visibility state
let axesVisible = true;

// Render mode state
let renderMode = 'solid'; // 'solid' | 'wireframe' | 'xray'

// Design mode state
let designMode = false;

// Pulse animation state (for red pulsing during Claude processing)
let pulseAnimationId = null;
let originalColors = new Map(); // Map<material, {color: Color, emissive: Color}>
let isPulsing = false;
let pulseStartTime = null;
let pulseMesh = null; // The mesh currently being animated (currentMesh or testCube)

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(0, 50, 50);
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

document.getElementById('clear-button').addEventListener('click', () => {
  clearProject();
});

document.getElementById('axes-button').addEventListener('click', () => {
  toggleAxes();
});

document.getElementById('highlight-button').addEventListener('click', () => {
  toggleHighlight();
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

document.getElementById('fit-view-button').addEventListener('click', () => {
  fitToView();
});

// Handle render mode buttons
document.getElementById('solid-button').addEventListener('click', () => {
  setRenderMode('solid');
});

document.getElementById('wireframe-button').addEventListener('click', () => {
  setRenderMode('wireframe');
});

document.getElementById('xray-button').addEventListener('click', () => {
  setRenderMode('xray');
});

document.getElementById('design-mode-button').addEventListener('click', () => {
  toggleDesignMode();
});

// Spec Load button handler
document.getElementById('spec-load-button').addEventListener('click', async () => {
  try {
    const result = await ipcRenderer.invoke('load-spec-file');

    if (result.canceled) {
      return;
    }

    if (result.success) {
      document.getElementById('spec-editor').value = result.content;
      addMessage('system', `Loaded spec: ${result.fileName}`);
      isDirty = true;
      updateWindowTitle();
    } else {
      addMessage('error', `Failed to load spec: ${result.error}`);
    }
  } catch (err) {
    addMessage('error', `Load error: ${err.message}`);
  }
});

// Spec Save button handler
document.getElementById('spec-save-button').addEventListener('click', async () => {
  const spec = document.getElementById('spec-editor').value.trim();

  if (!spec) {
    addMessage('error', 'No spec to save.');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('save-spec-file', { content: spec });

    if (result.canceled) {
      return;
    }

    if (result.success) {
      addMessage('system', `Spec saved: ${result.fileName}`);
    } else {
      addMessage('error', `Failed to save spec: ${result.error}`);
    }
  } catch (err) {
    addMessage('error', `Save error: ${err.message}`);
  }
});

// Spec Build button handler
document.getElementById('spec-build-button').addEventListener('click', () => {
  handleBuildCommand();
});

// Spec editor input handler - update build button state
document.getElementById('spec-editor').addEventListener('input', updateBuildButtonState);

// Spec editor Tab key handler - insert spaces instead of moving focus
document.getElementById('spec-editor').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const editor = e.target;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
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
const generatingOverlay = document.getElementById('generating-overlay');
const statusText = document.getElementById('status-text');
const statusStats = document.getElementById('status-stats');

// Toolbar buttons that should be disabled during processing
const toolbarButtonIds = [
  'open-button', 'save-button', 'undo-button', 'redo-button', 'clear-button',
  'axes-button', 'highlight-button', 'measure-button', 'refresh-context-button', 'export-stl-button',
  'fit-view-button', 'solid-button', 'wireframe-button', 'xray-button'
];

/**
 * Enable or disable toolbar buttons during processing
 * @param {boolean} disabled - Whether buttons should be disabled
 */
function setToolbarDisabled(disabled) {
  toolbarButtonIds.forEach(id => {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = disabled;
    }
  });
}

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

    // Disable toolbar buttons
    setToolbarDisabled(true);

    // Start pulse animation (handles currentMesh, testCube, or no mesh)
    startPulseAnimation();

    // If no mesh to pulse, show generating overlay instead
    if (!currentMesh && !testCube) {
      generatingOverlay.classList.remove('hidden');
    }
  } else if (phase === 'python') {
    // Phase 2: Building model - stop pulse, show spinner
    stopPulseAnimation(); // Stop pulse if active
    generatingOverlay.classList.add('hidden'); // Hide generating overlay
    loadingOverlay.classList.remove('hidden');
    statusText.textContent = 'Building model...';
    statusText.style.color = '#888888';

    // Keep toolbar disabled
    setToolbarDisabled(true);
  } else {
    // Done: Stop pulse, hide loading, reset status
    stopPulseAnimation(); // Stop pulse if active
    loadingOverlay.classList.add('hidden');
    generatingOverlay.classList.add('hidden'); // Hide generating overlay

    // Set status based on design mode
    if (designMode) {
      statusText.textContent = 'Design Mode';
      statusText.style.color = '#4ec9b0';
    } else {
      statusText.textContent = 'Ready';
      statusText.style.color = '#888888';
    }

    // Re-enable toolbar buttons
    setToolbarDisabled(false);
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
 * Start pulsing red animation on the current mesh (or test cube if no mesh loaded)
 */
function startPulseAnimation() {
  // Determine which mesh to animate - prefer currentMesh, fallback to testCube
  pulseMesh = currentMesh || testCube;

  // Only animate if we have a mesh
  if (!pulseMesh) {
    console.log('[Pulse] No mesh to animate');
    return;
  }

  // Don't start if already pulsing
  if (isPulsing) {
    console.log('[Pulse] Already pulsing');
    return;
  }

  console.log('[Pulse] Starting pulse animation on', currentMesh ? 'currentMesh' : 'testCube');
  isPulsing = true;
  pulseStartTime = performance.now();

  // Store original colors for all materials in the mesh (including edge lines)
  originalColors.clear();
  pulseMesh.traverse((child) => {
    if (child.isMesh && child.material) {
      // Store original color and emissive for mesh faces
      originalColors.set(child.material, {
        color: child.material.color.clone(),
        emissive: child.material.emissive ? child.material.emissive.clone() : null,
        emissiveIntensity: child.material.emissiveIntensity
      });
    } else if (child.isLineSegments && child.material) {
      // Store original color for edge lines
      originalColors.set(child.material, {
        color: child.material.color.clone(),
        emissive: null,
        emissiveIntensity: 0
      });
    }
  });

  // Define pulse colors (vivid red)
  const dimRed = new THREE.Color(0xcc2222);    // Base red
  const lightRed = new THREE.Color(0xff4444);  // Peak red

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

    // Apply to all mesh materials and edge lines
    if (pulseMesh) {
      pulseMesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.color.copy(currentColor);
        } else if (child.isLineSegments && child.material) {
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

  // Restore original colors (meshes and edge lines)
  if (pulseMesh) {
    pulseMesh.traverse((child) => {
      if ((child.isMesh || child.isLineSegments) && child.material && originalColors.has(child.material)) {
        const original = originalColors.get(child.material);
        child.material.color.copy(original.color);
        if (original.emissive && child.material.emissive) {
          child.material.emissive.copy(original.emissive);
          child.material.emissiveIntensity = original.emissiveIntensity;
        }
      }
    });
  }

  // Clear stored colors and pulse mesh reference
  originalColors.clear();
  pulseStartTime = null;
  pulseMesh = null;
}

/**
 * Calculate total face count from the current mesh
 * @returns {number} - Total number of triangular faces
 */
function calculateFaceCount() {
  if (!currentMesh) {
    return 0;
  }

  let faceCount = 0;
  currentMesh.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const positions = child.geometry.attributes.position;
      if (positions) {
        // Each triangle has 3 vertices
        faceCount += positions.count / 3;
      }
    }
  });

  return Math.floor(faceCount);
}

/**
 * Estimate context window usage percentage
 * Based on character count of code + chat history
 * Claude's context is ~200k tokens, roughly 800k characters
 * @returns {number} - Estimated percentage (0-100)
 */
function estimateContextPercentage() {
  const MAX_CONTEXT_CHARS = 800000; // ~200k tokens

  let totalChars = 0;

  // Count current code
  if (currentCode) {
    totalChars += currentCode.length;
  }

  // Count chat history
  messageHistory.forEach(msg => {
    if (msg.content) {
      totalChars += msg.content.length;
    }
  });

  const percentage = Math.round((totalChars / MAX_CONTEXT_CHARS) * 100);
  return Math.min(percentage, 100); // Cap at 100%
}

/**
 * Update status bar with model statistics
 * @param {number} volume - Volume in cubic mm (from Build123d)
 */
function updateModelStats(volume) {
  if (!currentMesh) {
    // Clear stats if no mesh
    statusStats.textContent = '';
    return;
  }

  const faceCount = calculateFaceCount();

  // Format volume in cm³ (divide by 1000)
  const volumeCm3 = volume / 1000;

  // Format with thousands separators and appropriate decimals
  const faceCountStr = faceCount.toLocaleString();
  const volumeStr = volumeCm3.toFixed(2);

  // Get context estimate
  const contextPercent = estimateContextPercentage();

  statusStats.textContent = `Faces: ${faceCountStr} | Volume: ${volumeStr} cm³ | Context: ~${contextPercent}%`;
  console.log(`[Stats] Updated: Faces=${faceCount}, Volume=${volumeStr} cm³, Context=${contextPercent}%`);
}

/**
 * Clear model statistics from status bar
 */
function clearModelStats() {
  statusStats.textContent = '';
  console.log('[Stats] Cleared');
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

// Load multiple shapes from individual glTF files
// shapes: array of {mesh_path, color, label}
// volume: total volume in mm³
function loadShapes(shapes, volume = 0) {
  setProcessing('python');

  // Store volume for stats display
  currentVolume = volume;

  // Store shapes for save functionality
  currentShapes = shapes;

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

  // Check for first load (test cube removal)
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

  // Handle empty shapes array
  if (!shapes || shapes.length === 0) {
    console.log('[LoadShapes] No shapes to load');
    hideLoading();
    updateModelStats(0);
    return;
  }

  // Create parent group for all shapes
  const shapeGroup = new THREE.Group();
  shapeGroup.name = 'shapeGroup';
  // No rotation needed - coordinates are Z-up from export
  // shapeGroup.rotation.x = Math.PI / 2;  // REMOVED

  // Track loading progress
  let loadedCount = 0;
  const totalCount = shapes.length;
  const loader = new GLTFLoader();
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6ab0ff });

  shapes.forEach((shapeData, shapeIndex) => {
    const fileUrl = shapeData.mesh_path.startsWith('file://')
      ? shapeData.mesh_path
      : `file://${shapeData.mesh_path}`;

    loader.load(
      fileUrl,
      (gltf) => {
        const shapeMesh = gltf.scene;

        // Scale from mm (Build123d) to scene units (glTF uses meters)
        shapeMesh.scale.set(1000, 1000, 1000);

        // Store shape metadata
        shapeMesh.userData.shapeIndex = shapeIndex;
        shapeMesh.userData.shapeLabel = shapeData.label;
        shapeMesh.userData.shapeColor = shapeData.color;

        // Apply color and edge lines to all child meshes
        shapeMesh.traverse((child) => {
          if (child.isMesh) {
            // Use shapeIndex as featureIndex for selection
            child.userData.featureIndex = shapeIndex;
            child.userData.shapeLabel = shapeData.label;

            // Apply shape color (or default accent)
            const color = shapeData.color || '#4a9eff';
            child.material = new THREE.MeshStandardMaterial({
              color: color,
              side: THREE.DoubleSide
            });

            // Add edge lines
            const edges = new THREE.EdgesGeometry(child.geometry);
            const edgeLines = new THREE.LineSegments(edges, edgeMaterial.clone());
            child.add(edgeLines);
          }
        });

        // Add to group
        shapeGroup.add(shapeMesh);
        loadedCount++;

        console.log(`[LoadShapes] Loaded shape ${shapeIndex} (${shapeData.label}): color=${shapeData.color || 'default'}`);

        // Check if all shapes loaded
        if (loadedCount === totalCount) {
          finishLoadingShapes(shapeGroup, isFirstLoad);
        }
      },
      null,
      (error) => {
        console.error(`[LoadShapes] Error loading shape ${shapeIndex}:`, error);
        loadedCount++;

        // Still finish if some shapes loaded
        if (loadedCount === totalCount) {
          finishLoadingShapes(shapeGroup, isFirstLoad);
        }
      }
    );
  });
}

// Finish loading shapes and add to scene
function finishLoadingShapes(shapeGroup, isFirstLoad) {
  if (shapeGroup.children.length === 0) {
    console.error('[LoadShapes] No shapes loaded successfully');
    statusText.textContent = 'Error: Failed to load any shapes';
    statusText.style.color = '#f44747';
    hideLoading();
    return;
  }

  // Add to scene
  scene.add(shapeGroup);
  currentMesh = shapeGroup;

  // Apply feature color overrides (user-set colors)
  applyFeatureColors();

  // Apply current render mode
  applyRenderMode(shapeGroup);

  // Fit camera on first load
  if (isFirstLoad) {
    fitCameraToObject(shapeGroup);
  }

  // Update stats
  updateModelStats(currentVolume);

  hideLoading();
  console.log(`[LoadShapes] Successfully loaded ${shapeGroup.children.length} shapes`);
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

  // Clear model statistics
  clearModelStats();
  currentVolume = 0;

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
  // If in design mode, ask about unsaved spec
  if (designMode) {
    const spec = document.getElementById('spec-editor').value.trim();
    if (spec) {
      const response = await ipcRenderer.invoke('show-message-box', {
        type: 'question',
        buttons: ['Clear Anyway', 'Cancel'],
        defaultId: 1,
        title: 'Unsaved Spec',
        message: 'You have an unsaved spec. Clear anyway?'
      });

      if (response.response !== 0) {
        console.log('[Renderer] Clear canceled - unsaved spec');
        return;
      }
    }

    // Clear spec editor and exit design mode
    document.getElementById('spec-editor').value = '';
    exitDesignMode();
  }

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

/**
 * Fit camera to view entire model (uses isometric view)
 */
function fitToView() {
  const target = currentMesh || testCube;
  if (target) {
    fitCameraToObject(target, viewPresets.isometric);
    console.log('[View] Fit to view - camera repositioned');
  } else {
    console.log('[View] No mesh to fit to view');
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
      if (result.empty) {
        // Empty geometry - clear viewport
        clearViewport();
        hideLoading();
      } else {
        // Load shapes with volume data
        loadShapes(result.shapes, result.volume || 0);
      }
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
  // Check if in design mode
  if (designMode) {
    statusText.textContent = 'Build first, then undo';
    statusText.style.color = '#dcdcaa';
    setTimeout(() => {
      statusText.textContent = 'Design Mode';
      statusText.style.color = '#4ec9b0';
    }, 2000);
    return;
  }

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
  // Check if in design mode
  if (designMode) {
    statusText.textContent = 'Build first, then redo';
    statusText.style.color = '#dcdcaa';
    setTimeout(() => {
      statusText.textContent = 'Design Mode';
      statusText.style.color = '#4ec9b0';
    }, 2000);
    return;
  }

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
window.fitToView = fitToView;

// ============================================================
// AXES TOGGLE
// ============================================================

/**
 * Toggle axes and labels visibility
 */
function toggleAxes() {
  axesVisible = !axesVisible;
  axesHelper.visible = axesVisible;
  labelX.visible = axesVisible;
  labelY.visible = axesVisible;
  labelZ.visible = axesVisible;

  const axesButton = document.getElementById('axes-button');
  axesButton.classList.toggle('active', axesVisible);

  console.log(`[Axes] Visibility toggled: ${axesVisible ? 'visible' : 'hidden'}`);
}

// Expose for debugging
window.toggleAxes = toggleAxes;

/**
 * Toggle edge lines visibility on/off
 */
function toggleHighlight() {
  edgeLinesVisible = !edgeLinesVisible;

  // Toggle visibility of all LineSegments in currentMesh
  if (currentMesh) {
    currentMesh.traverse((child) => {
      if (child.isLineSegments) {
        child.visible = edgeLinesVisible;
      }
    });
  }

  const highlightButton = document.getElementById('highlight-button');
  highlightButton.classList.toggle('active', edgeLinesVisible);

  console.log(`[EdgeLines] Toggled: ${edgeLinesVisible ? 'visible' : 'hidden'}`);
}

// Expose for debugging
window.toggleHighlight = toggleHighlight;

// ============================================================
// RENDER MODE FUNCTIONALITY
// ============================================================

/**
 * Set the render mode for the current mesh
 * @param {string} mode - 'solid' | 'wireframe' | 'xray'
 */
function setRenderMode(mode) {
  renderMode = mode;

  // Update button states
  document.getElementById('solid-button').classList.toggle('active', mode === 'solid');
  document.getElementById('wireframe-button').classList.toggle('active', mode === 'wireframe');
  document.getElementById('xray-button').classList.toggle('active', mode === 'xray');

  // Apply to current mesh if loaded
  if (currentMesh) {
    applyRenderMode(currentMesh);
  }

  console.log(`[RenderMode] Mode set to: ${mode}`);
}

/**
 * Apply current render mode to a mesh
 * @param {THREE.Object3D} mesh - The mesh to apply the render mode to
 */
function applyRenderMode(mesh) {
  mesh.traverse((child) => {
    if (child.isMesh) {
      switch (renderMode) {
        case 'solid':
          child.material.wireframe = false;
          child.material.transparent = false;
          child.material.opacity = 1;
          child.visible = true;
          break;
        case 'wireframe':
          child.material.wireframe = true;
          child.material.transparent = false;
          child.material.opacity = 1;
          child.visible = true;
          break;
        case 'xray':
          child.material.wireframe = false;
          child.material.transparent = true;
          child.material.opacity = 0.3;
          child.visible = true;
          break;
      }
    }
  });
}

// Expose for debugging
window.setRenderMode = setRenderMode;

// ============================================================
// DESIGN MODE FUNCTIONALITY
// ============================================================

/**
 * Toggle design mode on/off
 */
function toggleDesignMode() {
  designMode = !designMode;

  if (designMode) {
    enterDesignMode();
  } else {
    exitDesignMode();
  }
}

/**
 * Enter design mode - show spec panel and update UI
 */
function enterDesignMode() {
  // Set design mode flag to true
  designMode = true;

  // Show spec panel
  document.getElementById('spec-panel').style.display = 'flex';
  document.getElementById('spec-resize-handle').style.display = 'block';

  // Update status bar
  statusText.textContent = 'Design Mode';
  statusText.style.color = '#4ec9b0'; // Success green/teal

  // Update toggle button state
  document.getElementById('design-mode-button').classList.add('active');

  // Dim viewport slightly
  document.getElementById('viewport').classList.add('design-mode-active');

  // If spec is empty, show hint in chat
  const spec = document.getElementById('spec-editor').value.trim();
  if (!spec) {
    addMessage('system', 'Design Mode active. Describe what you want to build, or Load an existing spec.');
  }

  // Update build button state
  updateBuildButtonState();

  console.log('[DesignMode] Entered design mode');
}

/**
 * Exit design mode - hide spec panel and restore UI
 */
function exitDesignMode() {
  // Set design mode flag to false
  designMode = false;

  // Hide spec panel
  document.getElementById('spec-panel').style.display = 'none';
  document.getElementById('spec-resize-handle').style.display = 'none';

  // Update status bar
  statusText.textContent = 'Ready';
  statusText.style.color = '#888888';

  // Update toggle button state
  document.getElementById('design-mode-button').classList.remove('active');

  // Remove viewport dim
  document.getElementById('viewport').classList.remove('design-mode-active');

  console.log('[DesignMode] Exited design mode');
}

/**
 * Update build button state based on spec content
 */
function updateBuildButtonState() {
  const spec = document.getElementById('spec-editor').value.trim();
  document.getElementById('spec-build-button').disabled = !spec;
}

// Expose for debugging
window.toggleDesignMode = toggleDesignMode;

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
window.loadShapes = loadShapes;
window.executeCode = executeCode;
window.toggleMeasureMode = toggleMeasureMode;
window.clearMeasurement = clearMeasurement;
window.startPulseAnimation = startPulseAnimation;
window.stopPulseAnimation = stopPulseAnimation;
window.applyFeatureColors = applyFeatureColors;
window.updateModelStats = updateModelStats;
window.clearModelStats = clearModelStats;
window.calculateFaceCount = calculateFaceCount;

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

ipcRenderer.on('menu-toggle-design-mode', () => {
  toggleDesignMode();
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
    statusText.style.color = '#ffffff';

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
  // Warn if in design mode with unsaved spec
  if (designMode) {
    const spec = document.getElementById('spec-editor').value.trim();
    if (spec) {
      addMessage('system', 'Note: Spec is not included in project file. Use "Save" in spec panel to save spec separately.');
    } else {
      addMessage('system', 'Build your spec first to save a project.');
      return;
    }
  }

  try {
    console.log('[Renderer] Saving project...');

    // Prepare chat history for saving (role, content, timestamp, images)
    const chatHistoryForSave = messageHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp.toISOString(),
      images: msg.images // Include image paths if present
    }));

    // Call IPC to save
    const result = await ipcRenderer.invoke('save-project', {
      code: currentCode,
      chatHistory: chatHistoryForSave,
      projectName: projectName,
      currentFilePath: currentFilePath,
      featureColors: featureColors,
      shapes: currentShapes
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
          timestamp: new Date(msg.timestamp),
          images: msg.images // Restore image paths
        });

        // Add to UI (simplified - just add the message element)
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${msg.role}`;

        // Add images if present (show placeholder since we don't have thumbnails)
        if (msg.images && msg.images.length > 0) {
          const imagesContainer = document.createElement('div');
          imagesContainer.className = 'message-images';

          for (const img of msg.images) {
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'message-image-item';
            imgWrapper.style.background = '#2d2d30';
            imgWrapper.style.display = 'flex';
            imgWrapper.style.alignItems = 'center';
            imgWrapper.style.justifyContent = 'center';
            imgWrapper.style.fontSize = '10px';
            imgWrapper.style.color = '#888888';
            imgWrapper.textContent = '🖼️';

            const numberEl = document.createElement('span');
            numberEl.className = 'message-image-number';
            numberEl.textContent = img.number;

            imgWrapper.appendChild(numberEl);
            imagesContainer.appendChild(imgWrapper);
          }

          messageEl.appendChild(imagesContainer);
        }

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

    // Load shapes from project (v2.0 format has embedded shapes)
    if (projectData.shapes && projectData.shapes.length > 0) {
      console.log('[Renderer] Loading', projectData.shapes.length, 'shapes from project');
      currentShapes = projectData.shapes;
      loadShapes(projectData.shapes, 0);
    } else {
      // No shapes - clear viewport
      console.log('[Renderer] No shapes in project');
      currentShapes = [];
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

  // Cmd+D / Ctrl+D: Toggle design mode
  if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
    e.preventDefault(); // Prevent browser bookmark dialog
    toggleDesignMode();
    return;
  }

  // Escape key: clear various states
  if (e.key === 'Escape') {
    // Exit design mode if active
    if (designMode) {
      exitDesignMode();
      return;
    }

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

  // A key: toggle axes
  if (e.key === 'a' || e.key === 'A') {
    toggleAxes();
  }

  // F key: fit to view
  if (e.key === 'f' || e.key === 'F') {
    fitToView();
  }

  // M key: toggle measure mode
  if (e.key === 'm' || e.key === 'M') {
    toggleMeasureMode();
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

// Spec panel resize functionality
const specPanel = document.getElementById('spec-panel');
const specResizeHandle = document.getElementById('spec-resize-handle');

let isResizingSpec = false;
let startX = 0;
let startWidth = 0;

// Function to update resize handle visibility based on spec panel visibility
function updateSpecResizeHandleVisibility() {
  const isVisible = specPanel.style.display === 'flex';
  specResizeHandle.style.display = isVisible ? 'block' : 'none';
}

// Initial visibility check
updateSpecResizeHandleVisibility();

// Restore spec panel width from localStorage
const savedWidth = localStorage.getItem('specPanelWidth');
if (savedWidth) {
  specPanel.style.width = savedWidth + 'px';
}

// Watch for style changes to spec panel
const specPanelObserver = new MutationObserver(updateSpecResizeHandleVisibility);
specPanelObserver.observe(specPanel, { attributes: true, attributeFilter: ['style'] });

specResizeHandle.addEventListener('mousedown', (e) => {
  isResizingSpec = true;
  startX = e.clientX;
  startWidth = specPanel.offsetWidth;

  // Prevent text selection during drag
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizingSpec) return;

  // Calculate new width (dragging left increases width, dragging right decreases)
  const deltaX = startX - e.clientX;
  let newWidth = startWidth + deltaX;

  // Enforce constraints
  const minWidth = 250;
  const maxWidth = window.innerWidth * 0.95;

  newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

  // Apply new width
  specPanel.style.width = `${newWidth}px`;
});

document.addEventListener('mouseup', () => {
  if (isResizingSpec) {
    isResizingSpec = false;
    // Re-enable text selection
    document.body.style.userSelect = '';
    // Save spec panel width to localStorage
    localStorage.setItem('specPanelWidth', specPanel.offsetWidth);
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
    // Store for history (without thumbnail URLs)
    const historyMessage = {
      role,
      content,
      images: options.images?.map(img => ({ number: img.number, path: img.path }))
    };
    messageHistory.push(historyMessage);
  }

  // Mark as unsaved (chat changed)
  isDirty = true;
  updateWindowTitle();

  // Create message element
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${role}`;

  // Add images if present
  if (options.images && options.images.length > 0) {
    const imagesContainer = document.createElement('div');
    imagesContainer.className = 'message-images';

    for (const img of options.images) {
      const imgWrapper = document.createElement('div');
      imgWrapper.className = 'message-image-item';

      const imgEl = document.createElement('img');
      imgEl.src = img.thumbnail;
      imgEl.alt = `Image ${img.number}`;

      const numberEl = document.createElement('span');
      numberEl.className = 'message-image-number';
      numberEl.textContent = img.number;

      imgWrapper.appendChild(imgEl);
      imgWrapper.appendChild(numberEl);
      imagesContainer.appendChild(imgWrapper);
    }

    messageEl.appendChild(imagesContainer);
  }

  // Create content wrapper (only if there's text content)
  let contentEl = null;
  if (content) {
    contentEl = document.createElement('div');
    contentEl.className = 'message-content';
  }

  // Parse content based on role (only if we have content)
  if (content && contentEl) {
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
  }

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
 * Handle /build command - generate code from spec and build the model
 */
async function handleBuildCommand() {
  console.log('[DesignMode] Build command triggered');

  // Clear chat input
  chatInput.value = '';

  // Get spec from editor
  const spec = document.getElementById('spec-editor').value.trim();

  if (!spec) {
    addMessage('error', 'No spec to build. Create a design spec first using /design [description].');
    return;
  }

  // Check if spec is just a placeholder
  if (spec.startsWith('Generating spec for')) {
    addMessage('error', 'Spec is still generating. Please wait for it to complete.');
    return;
  }

  // Set processing state
  isProcessing = true;
  chatInput.disabled = true;
  sendButton.disabled = true;
  setProcessing('claude');

  try {
    // Add user message
    addMessage('user', '/build');

    console.log('[DesignMode] Sending spec to Claude for code generation...');

    // Call IPC to build from spec
    const result = await ipcRenderer.invoke('build-from-spec', { spec });

    console.log('[DesignMode] Build result:', result);

    if (result.success) {
      // Save current code for undo before updating
      saveUndo();

      // Update current code
      currentCode = result.code;

      // Mark as unsaved
      isDirty = true;
      updateWindowTitle();

      // Clear file path for new model
      currentFilePath = null;
      projectName = 'untitled';

      // Add success message
      addMessage('assistant', result.explanation || 'Model built successfully from spec.');

      // Load the shapes
      console.log('[DesignMode] Loading shapes:', result.shapes?.length || 0);
      loadShapes(result.shapes, result.volume);

      // Exit design mode on success
      exitDesignMode();
    } else {
      // Show error
      console.error('[DesignMode] Build failed:', result.error);

      if (result.explanation) {
        addMessage('assistant', result.explanation);
      }

      addMessage('error', result.error || 'Failed to build from spec');
      setProcessing(null);
    }
  } catch (err) {
    console.error('[DesignMode] Build error:', err);
    addMessage('error', `Build failed: ${err.message}`);
    setProcessing(null);
  } finally {
    // Re-enable input
    isProcessing = false;
    chatInput.disabled = false;
    sendButton.disabled = false;
  }
}

/**
 * Send a chat message through the full pipeline:
 * User -> Claude -> Python -> Mesh
 */
async function sendChatMessage() {
  // Get message text
  const message = chatInput.value.trim();

  // Validate
  if (!message && pendingImages.length === 0) {
    console.log('[Chat] Empty message and no images, ignoring');
    return;
  }

  if (isProcessing) {
    console.log('[Chat] Already processing, ignoring');
    return;
  }

  // Capture pending images before clearing
  const imagesToSend = [...pendingImages];
  const imagePaths = imagesToSend.map(img => ({
    number: img.number,
    path: img.path
  }));

  // Check for /design command
  let actualMessage = message;
  if (message.startsWith('/design')) {
    const designArg = message.replace('/design', '').trim();

    if (!designArg) {
      // /design with no argument - just enter design mode, don't call Claude
      if (!designMode) {
        enterDesignMode();
      }
      chatInput.value = '';
      return;
    }

    // /design with argument - enter design mode and generate spec
    if (!designMode) {
      enterDesignMode();
    }

    // Clear old spec and show placeholder
    document.getElementById('spec-editor').value = `Generating spec for "${designArg}"...`;

    actualMessage = designArg;
  }

  // Check for /build command
  if (message === '/build' || message.toLowerCase() === 'build it') {
    await handleBuildCommand();
    return;
  }

  // Clear input and pending images immediately
  chatInput.value = '';
  clearPendingImages();

  try {
    // Set processing state
    isProcessing = true;
    chatInput.disabled = true;
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';

    // Add user message to chat with images
    addMessage('user', message, { images: imagesToSend });

    // Build history for Claude (exclude timestamps, only role + content)
    const history = messageHistory
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map(msg => ({ role: msg.role, content: msg.content }));

    if (designMode) {
      // Design mode: get spec from Claude
      setProcessing('claude');

      const currentSpec = document.getElementById('spec-editor').value;

      console.log('[Chat] Design mode - sending to Claude via IPC...');
      console.log('[Chat] Message:', actualMessage);
      console.log('[Chat] Current spec length:', currentSpec.length);
      console.log('[Chat] History entries:', history.length);

      const result = await ipcRenderer.invoke('send-design-message', {
        message: actualMessage,
        currentSpec,
        history
      });

      setProcessing(null);

      if (result.success) {
        // Update spec panel
        document.getElementById('spec-editor').value = result.spec;

        // Update build button state (input event doesn't fire on programmatic changes)
        updateBuildButtonState();

        // Add brief confirmation to chat with preview
        const preview = result.spec.substring(0, 200) + (result.spec.length > 200 ? '...' : '');
        addMessage('assistant', `Spec updated:\n\n${preview}\n\n(See full spec in panel)`);

        // Mark dirty
        isDirty = true;
        updateWindowTitle();
      } else {
        addMessage('error', result.error);
      }
    } else {
      // Normal mode: existing code generation flow
      // Show loading state - Phase 1: Asking Claude
      setProcessing('claude');

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
      console.log('[Chat] Images:', imagePaths.length > 0 ? imagePaths : 'none');

      // Call IPC
      const result = await ipcRenderer.invoke('send-chat-message', {
        message: messageToSend,
        currentCode,
        history,
        clickInfo,
        imagePaths
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
          // Success: code executed, shapes generated
          console.log('[Chat] Success! Loading shapes:', result.shapes?.length || 0);
          console.log('[Chat] Volume:', result.volume, 'mm³');
          // Load the shapes (this will trigger Phase 2: "Building model...")
          loadShapes(result.shapes, result.volume);
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
 * Apply per-feature highlight effect to a single mesh
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
 * Remove per-feature highlight effect from a single mesh
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
 * Apply highlight to ALL meshes with the same featureIndex as the given mesh
 */
function applyHighlight(mesh) {
  if (!mesh || !currentMesh) return;

  const featureIndex = mesh.userData.featureIndex;
  if (featureIndex === undefined) {
    // No featureIndex, just highlight the single mesh
    applyFeatureHighlight(mesh);
    return;
  }

  // Highlight all meshes with matching featureIndex
  currentMesh.traverse((child) => {
    if (child.isMesh && child.userData.featureIndex === featureIndex) {
      applyFeatureHighlight(child);
    }
  });
}

/**
 * Remove highlight from ALL meshes with the same featureIndex as the given mesh
 */
function removeHighlight(mesh) {
  if (!mesh || !currentMesh) return;

  const featureIndex = mesh.userData.featureIndex;
  if (featureIndex === undefined) {
    // No featureIndex, just unhighlight the single mesh
    removeFeatureHighlight(mesh);
    return;
  }

  // Unhighlight all meshes with matching featureIndex
  currentMesh.traverse((child) => {
    if (child.isMesh && child.userData.featureIndex === featureIndex) {
      removeFeatureHighlight(child);
    }
  });
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
    const hitFeatureIndex = hitMesh.userData.featureIndex;

    // Get featureIndex of currently hovered mesh (if any)
    const currentFeatureIndex = hoveredMesh ? hoveredMesh.userData.featureIndex : undefined;

    // If this is a new feature (different featureIndex), update highlight
    if (currentFeatureIndex !== hitFeatureIndex) {
      // Remove highlight from previous feature
      if (hoveredMesh) {
        removeHighlight(hoveredMesh);
      }

      // Apply highlight to new feature (all meshes with same featureIndex)
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
 * Apply color to selected feature (all meshes with same featureIndex)
 */
function applyColorToFeature(colorHex) {
  if (!selectedFeature || !selectedFeature.material) {
    console.warn('[ColorPalette] No feature selected or no material');
    return;
  }

  // Get feature index of clicked mesh
  const featureIndex = selectedFeature.userData.featureIndex;

  if (featureIndex === undefined) {
    console.warn('[ColorPalette] Selected feature has no featureIndex');
    return;
  }

  const newColor = new THREE.Color(colorHex);

  // Apply color to ALL meshes with the same featureIndex (entire shape)
  let meshesColored = 0;
  if (currentMesh) {
    currentMesh.traverse((child) => {
      if (child.isMesh && child.userData.featureIndex === featureIndex && child.material) {
        child.material.color.copy(newColor);
        meshesColored++;
      }
    });
  }

  // Get color name for chat message
  const colorInt = parseInt(colorHex.replace('#', ''), 16);
  const colorName = colorNames[colorInt] || 'custom';

  console.log(`[ColorPalette] Applied color ${colorHex} to feature ${featureIndex} (${meshesColored} meshes)`);

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
// PASTE HANDLING FOR REFERENCE IMAGES
// ============================================================

/**
 * Set up paste event handler on chat input
 */
function setupPasteHandler() {
  const chatInput = document.getElementById('chat-input');

  chatInput.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();  // Don't paste as text

        const blob = item.getAsFile();
        if (!blob) continue;

        const buffer = await blob.arrayBuffer();

        try {
          const result = await ipcRenderer.invoke('save-temp-image', {
            buffer: Array.from(new Uint8Array(buffer)),
            type: 'reference'
          });

          if (result.success) {
            // Create thumbnail for preview
            const thumbnailUrl = URL.createObjectURL(blob);

            pendingImages.push({
              number: result.number,
              path: result.path,
              thumbnail: thumbnailUrl
            });

            updatePendingImagesUI();

            console.log(`[Renderer] Image ${result.number} ready: ${result.path}`);
          } else {
            console.error('[Renderer] Failed to save pasted image:', result.error);
          }
        } catch (err) {
          console.error('[Renderer] Paste handler error:', err);
        }

        break;  // Only handle first image
      }
    }
  });
}

/**
 * Clear all pending images and revoke object URLs
 */
function clearPendingImages() {
  // Revoke object URLs to free memory
  for (const img of pendingImages) {
    if (img.thumbnail) {
      URL.revokeObjectURL(img.thumbnail);
    }
  }
  pendingImages = [];
  updatePendingImagesUI();
}

/**
 * Remove a single pending image by number
 */
function removePendingImage(number) {
  const index = pendingImages.findIndex(img => img.number === number);
  if (index !== -1) {
    if (pendingImages[index].thumbnail) {
      URL.revokeObjectURL(pendingImages[index].thumbnail);
    }
    pendingImages.splice(index, 1);
    updatePendingImagesUI();
  }
}

/**
 * Update pending images UI
 */
function updatePendingImagesUI() {
  const container = document.getElementById('pending-images-container');
  container.innerHTML = '';

  if (pendingImages.length === 0) {
    container.classList.remove('has-images');
    return;
  }

  container.classList.add('has-images');

  for (const img of pendingImages) {
    const item = document.createElement('div');
    item.className = 'pending-image-item';

    const thumbnail = document.createElement('img');
    thumbnail.src = img.thumbnail;
    thumbnail.alt = `Image ${img.number}`;

    const number = document.createElement('span');
    number.className = 'pending-image-number';
    number.textContent = img.number;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'pending-image-remove';
    removeBtn.textContent = '\u00D7';  // × symbol
    removeBtn.title = 'Remove image';
    removeBtn.addEventListener('click', () => {
      removePendingImage(img.number);
    });

    item.appendChild(thumbnail);
    item.appendChild(number);
    item.appendChild(removeBtn);
    container.appendChild(item);
  }
}

// Initialize paste handler
setupPasteHandler();

// ============================================================

console.log('ClaudeCAD Phase 2 Complete');
