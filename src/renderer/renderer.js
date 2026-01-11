import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

// Test cube
const geometry = new THREE.BoxGeometry(20, 20, 20);
const material = new THREE.MeshStandardMaterial({ color: 0x4a9eff });
const cube = new THREE.Mesh(geometry, material);
cube.position.set(0, 0, 10); // Place on grid
scene.add(cube);

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

// Handle window resize
window.addEventListener('resize', () => {
  const width = viewportElement.clientWidth;
  const height = viewportElement.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

// Start animation
animate();
