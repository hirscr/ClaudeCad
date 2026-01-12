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
camera.position.set(70, -70, 50); // Isometric-like view
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

// Raycaster for click detection and hover
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Store last click information
let lastClickInfo = null;

// Hover state tracking
let hoveredMesh = null;
let originalMaterial = null;
let isDragging = false;
let lastHoverCheck = 0;
const hoverCheckInterval = 33; // ~30fps (33ms)

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
const viewPresets = {
  isometric: new THREE.Vector3(1, -1, 0.7).normalize(),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
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
    // Phase 1: Asking Claude
    loadingOverlay.classList.remove('hidden');
    statusText.textContent = 'Asking Claude...';
    statusText.style.color = '#888888';
  } else if (phase === 'python') {
    // Phase 2: Building model
    loadingOverlay.classList.remove('hidden');
    statusText.textContent = 'Building model...';
    statusText.style.color = '#888888';
  } else {
    // Done: Hide loading, reset status
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

// Load glTF mesh from file path
function loadMesh(path) {
  setProcessing('python');

  // Clear hover state when loading new mesh
  if (hoveredMesh) {
    removeHighlight(hoveredMesh);
    hoveredMesh = null;
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

      // Apply accent color material and edge lines to all meshes
      const accentMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a9eff,
        side: THREE.DoubleSide
      });
      const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6ab0ff });
      let meshCount = 0;
      loadedMesh.traverse((child) => {
        if (child.isMesh) {
          meshCount++;
          // Dispose old material
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
          child.material = accentMaterial;

          // Add edge lines
          const edges = new THREE.EdgesGeometry(child.geometry);
          const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
          child.add(edgeLines);
        }
      });
      console.log(`Applied DoubleSide material and edges to ${meshCount} mesh(es)`);

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

      // Fit camera to mesh
      fitCameraToObject(loadedMesh);

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

// Expose functions on window object
window.setProcessing = setProcessing;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.loadMesh = loadMesh;
window.executeCode = executeCode;

// Temporary key listeners for testing
document.addEventListener('keydown', (e) => {
  // Ignore key events when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
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
 * @param {string} role - 'user' | 'assistant' | 'error'
 * @param {string} content - Message content
 * @param {object} options - Optional parameters (rawResponse for error messages)
 */
function addMessage(role, content, options = {}) {
  // Store in history
  const message = {
    role,
    content,
    timestamp: new Date(),
    ...options
  };
  messageHistory.push(message);

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

  try {
    // Set processing state
    isProcessing = true;
    chatInput.disabled = true;
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';

    // Clear input immediately
    chatInput.value = '';

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

    console.log('[Chat] Sending to Claude via IPC...');
    console.log('[Chat] Message:', message);
    console.log('[Chat] Current code length:', currentCode.length);
    console.log('[Chat] History entries:', history.length);
    console.log('[Chat] Click info:', clickInfo ? 'included' : 'none');

    // Call IPC
    const result = await ipcRenderer.invoke('send-chat-message', {
      message,
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
      // Success: code executed, mesh generated
      console.log('[Chat] Success! Loading mesh:', result.meshPath);

      // Update current code
      currentCode = result.code;

      // Add assistant message
      addMessage('assistant', result.explanation);

      // Load the mesh (this will trigger Phase 2: "Building model...")
      loadMesh(result.meshPath);
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
    console.error('[Chat] Error in sendChatMessage:', err);

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

// ============================================================
// HOVER HIGHLIGHT SYSTEM
// ============================================================

/**
 * Apply highlight effect to a mesh
 */
function applyHighlight(mesh) {
  // Store original material properties if not already stored
  if (!originalMaterial && mesh.material) {
    originalMaterial = {
      emissive: mesh.material.emissive.clone(),
      emissiveIntensity: mesh.material.emissiveIntensity
    };
  }

  // Apply subtle blue emissive glow (accent color)
  if (mesh.material) {
    mesh.material.emissive.setHex(0x4a9eff);
    mesh.material.emissiveIntensity = 0.3;
  }
}

/**
 * Remove highlight effect from a mesh
 */
function removeHighlight(mesh) {
  // Restore original material properties
  if (originalMaterial && mesh.material) {
    mesh.material.emissive.copy(originalMaterial.emissive);
    mesh.material.emissiveIntensity = originalMaterial.emissiveIntensity;
    originalMaterial = null;
  }
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

  // Log intersection point and normal if found
  if (meshIntersects.length > 0) {
    const firstHit = meshIntersects[0];
    const point = firstHit.point;

    // Get face normal if available
    if (firstHit.face && firstHit.face.normal) {
      // Clone the local face normal
      const localNormal = firstHit.face.normal.clone();

      // Transform to world space using the object's rotation matrix
      const worldNormal = localNormal.transformDirection(firstHit.object.matrixWorld);

      // Normalize to ensure it's a unit vector
      worldNormal.normalize();

      // Store last click info with timestamp
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
        timestamp: Date.now()
      };

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
        timestamp: Date.now()
      };

      console.log(`[Raycaster] Hit at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`);
      console.log(`[Raycaster] Warning: No face normal available`);
    }
  }
});

// ============================================================

console.log('ClaudeCAD Phase 2 Complete');
