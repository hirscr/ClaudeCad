const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pythonManager = require('./python-manager');
const claudeManager = require('./claude-manager');

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

let mainWindow = null;
let isQuitting = false;

// Temp directory for images (Phase 8)
const TEMP_IMAGE_DIR = path.join(os.tmpdir(), 'claudecad-images');
let imageCounter = 0;

/**
 * Ensure temp image directory exists
 */
function ensureTempDir() {
  if (!fs.existsSync(TEMP_IMAGE_DIR)) {
    fs.mkdirSync(TEMP_IMAGE_DIR, { recursive: true });
    console.log('[Main] Created temp image directory:', TEMP_IMAGE_DIR);
  }
}

/**
 * Clear all temp images
 */
function clearTempDir() {
  if (fs.existsSync(TEMP_IMAGE_DIR)) {
    const files = fs.readdirSync(TEMP_IMAGE_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEMP_IMAGE_DIR, file));
    }
    console.log('[Main] Cleared temp image directory');
  }
  imageCounter = 0;
}

/**
 * Downscale image to max dimension (to reduce CLI latency)
 */
function downscaleImage(imageBuffer, maxDimension = 768) {
  const image = nativeImage.createFromBuffer(imageBuffer);
  const size = image.getSize();

  if (size.width <= maxDimension && size.height <= maxDimension) {
    return image.toPNG();
  }

  const scale = maxDimension / Math.max(size.width, size.height);
  const newWidth = Math.round(size.width * scale);
  const newHeight = Math.round(size.height * scale);

  const resized = image.resize({ width: newWidth, height: newHeight });
  return resized.toPNG();
}

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

  mainWindow = win;

  // Intercept window close event
  win.on('close', (event) => {
    // Allow close if we're already in the process of quitting
    if (isQuitting) {
      return;
    }

    if (!win.isDestroyed() && win.webContents) {
      // Prevent default close
      event.preventDefault();

      // Check if dirty via IPC
      checkDirtyAndClose(win);
    }
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
}

/**
 * Check if renderer has unsaved changes and show dialog if needed
 */
function checkDirtyAndClose(win) {
  // Request dirty state from renderer
  win.webContents.send('request-dirty-state');

  // Listen for response (one-time)
  ipcMain.once('dirty-state-response', (event, isDirty) => {
    if (isDirty) {
      // Show confirmation dialog
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Save', 'Don\'t Save', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Save before closing?',
        detail: 'Your changes will be lost if you don\'t save them.'
      });

      if (choice === 0) {
        // Save
        console.log('[Main] User chose to save before closing');

        // Listen for save completion or close signal
        ipcMain.once('proceed-with-close', () => {
          // Mark as quitting and destroy window
          isQuitting = true;
          if (!win.isDestroyed()) {
            win.destroy();
          }
        });

        // Request save from renderer
        win.webContents.send('save-and-close');
      } else if (choice === 1) {
        // Don't Save
        console.log('[Main] User chose not to save, closing');

        // Mark as quitting and destroy window
        isQuitting = true;
        if (!win.isDestroyed()) {
          win.destroy();
        }
      } else {
        // Cancel (choice === 2 or dialog was closed)
        console.log('[Main] User canceled close operation');
        // Do nothing - window stays open
      }
    } else {
      // Not dirty - close immediately
      console.log('[Main] No unsaved changes, closing');
      isQuitting = true;
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
  });
}

// IPC Handlers

// Set window title from renderer
ipcMain.on('set-window-title', (event, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title);
  }
});

// Show unsaved changes dialog (for New Project / Load Project)
ipcMain.handle('show-unsaved-changes-dialog', async () => {
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Save', 'Don\'t Save', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved Changes',
    message: 'You have unsaved changes. Save before continuing?',
    detail: 'Your changes will be lost if you don\'t save them.'
  });
  return choice;
});

ipcMain.handle('execute-code', async (event, code) => {
  try {
    console.log('[Main] Received execute-code request');
    const result = await pythonManager.execute(code);
    console.log('[Main] Python execution result:', result);
    return result;
  } catch (err) {
    console.error('[Main] Python execution error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

ipcMain.handle('send-chat-message', async (event, { message, currentCode, history, clickInfo, imagePaths }) => {
  try {
    console.log('[Main] Received send-chat-message request');
    console.log('[Main] Message:', message);
    console.log('[Main] Current code length:', currentCode?.length || 0);
    console.log('[Main] History length:', history?.length || 0);
    console.log('[Main] Click info:', clickInfo ? 'present' : 'none');
    console.log('[Main] Image paths:', imagePaths ? imagePaths.length : 0);

    // Track retry state
    let attemptCount = 0;
    const maxAttempts = 2; // Original + 1 retry
    let lastError = null;
    let currentMessage = message;

    while (attemptCount < maxAttempts) {
      attemptCount++;
      console.log(`[Main] Attempt ${attemptCount}/${maxAttempts}`);

      // Build prompt with images
      const prompt = claudeManager.buildPrompt(currentMessage, currentCode, history, clickInfo, imagePaths);

      // Get temp directory if images are present
      const tempImageDir = imagePaths && imagePaths.length > 0 ? TEMP_IMAGE_DIR : null;

      // Debug log image paths
      if (imagePaths && imagePaths.length > 0) {
        console.log('[Main] Image paths being sent:', JSON.stringify(imagePaths));
      }

      // Send prompt to Claude with image directory access
      const rawResponse = await claudeManager.sendPrompt(prompt, tempImageDir);
      console.log('[Main] Claude response received, length:', rawResponse.length);

      // Parse response
      const parsed = claudeManager.parseResponse(rawResponse);
      console.log('[Main] Parsed code:', parsed.code ? `${parsed.code.length} chars` : 'none');
      console.log('[Main] Explanation:', parsed.explanation.substring(0, 100));

      // If no code generated, return explanation only
      if (!parsed.code) {
        console.log('[Main] No code in response, returning explanation only');
        return {
          success: false,
          explanation: parsed.explanation,
          error: 'No Python code was generated'
        };
      }

      // Execute the code
      console.log('[Main] Executing generated code...');
      const execResult = await pythonManager.execute(parsed.code);

      if (execResult.success) {
        console.log('[Main] Code execution successful');
        // Check if result is empty (no geometry produced)
        if (execResult.empty) {
          console.log('[Main] Empty geometry result');
          return {
            success: true,
            empty: true,
            code: parsed.code,
            explanation: parsed.explanation,
            newModel: parsed.newModel
          };
        }
        // DEBUG: Log shapes being passed to renderer
        console.log('[DEBUG Main] Shapes from Python:', JSON.stringify(execResult.shapes));
        return {
          success: true,
          code: parsed.code,
          explanation: parsed.explanation,
          shapes: execResult.shapes, // Array of {mesh_path, color, label}
          volume: execResult.volume,
          newModel: parsed.newModel
        };
      }

      // Execution failed
      lastError = execResult.error;
      console.error(`[Main] Code execution failed (attempt ${attemptCount}):`, lastError);

      // If we haven't exhausted retries, prepare retry message
      if (attemptCount < maxAttempts) {
        console.log('[Main] Preparing auto-retry with error context...');
        currentMessage = `${message}\n\n[IMPORTANT: Your previous code attempt failed with this error: "${lastError}". Please fix the issue and try again. Make sure to use valid Build123d API calls.]`;
        // Clear click info for retry (already used)
        clickInfo = null;
      }
    }

    // All attempts failed
    console.error('[Main] All attempts failed, returning error');
    return {
      success: false,
      error: `Python execution failed after ${maxAttempts} attempts: ${lastError}`
    };
  } catch (err) {
    console.error('[Main] send-chat-message error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for refreshing Claude context
ipcMain.handle('refresh-context', async (event, { currentCode, cleanedHistory }) => {
  try {
    console.log('[Main] Received refresh-context request');
    console.log('[Main] Current code length:', currentCode?.length || 0);
    console.log('[Main] Cleaned history entries:', cleanedHistory?.length || 0);

    await claudeManager.refreshContext(currentCode, cleanedHistory);

    return { success: true };
  } catch (err) {
    console.error('[Main] refresh-context error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for exporting STL
ipcMain.handle('export-stl', async (event, { code }) => {
  try {
    console.log('[Main] Received export-stl request');
    console.log('[Main] Code length:', code?.length || 0);

    // Validate code
    if (!code || !code.trim()) {
      return {
        success: false,
        error: 'No model code to export'
      };
    }

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: 'Export STL',
      defaultPath: 'model.stl',
      filters: [
        { name: 'STL Files', extensions: ['stl'] }
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });

    if (result.canceled) {
      console.log('[Main] Export dialog canceled');
      return {
        success: false,
        canceled: true
      };
    }

    const outputPath = result.filePath;
    console.log('[Main] User selected export path:', outputPath);

    // Call Python with export_stl mode
    const { spawn } = require('child_process');
    const pythonPath = path.join(__dirname, '../../venv/bin/python3');
    const scriptPath = path.join(__dirname, '../python/cad_engine.py');

    const pythonProcess = spawn(pythonPath, [scriptPath, 'export_stl', outputPath]);

    // Send code via stdin
    pythonProcess.stdin.write(code);
    pythonProcess.stdin.write('\n__END__\n');
    pythonProcess.stdin.end();

    // Collect output
    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Wait for process to complete
    const exitCode = await new Promise((resolve) => {
      pythonProcess.on('close', (code) => {
        resolve(code);
      });
    });

    console.log('[Main] Python export process exited with code:', exitCode);
    if (stderr) {
      console.log('[Main] Python stderr:', stderr);
    }

    // Parse result
    if (exitCode !== 0) {
      return {
        success: false,
        error: `Python process failed with exit code ${exitCode}. ${stderr}`
      };
    }

    // Parse JSON response
    try {
      const response = JSON.parse(stdout.trim());
      if (response.success) {
        console.log('[Main] STL exported successfully to:', outputPath);
        return {
          success: true,
          filePath: outputPath
        };
      } else {
        console.error('[Main] Export failed:', response.error);
        return {
          success: false,
          error: response.error
        };
      }
    } catch (parseError) {
      console.error('[Main] Failed to parse Python output:', stdout);
      return {
        success: false,
        error: `Failed to parse export result: ${parseError.message}`
      };
    }
  } catch (err) {
    console.error('[Main] export-stl error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for saving project
ipcMain.handle('save-project', async (event, { code, chatHistory, projectName, currentFilePath, featureColors, shapes }) => {
  try {
    console.log('[Main] Received save-project request');
    console.log('[Main] Current file path:', currentFilePath || 'none (new file)');
    console.log('[Main] Project name:', projectName || 'untitled');
    console.log('[Main] Code length:', code?.length || 0);
    console.log('[Main] Chat history length:', chatHistory?.length || 0);
    console.log('[Main] Feature colors count:', featureColors ? Object.keys(featureColors).length : 0);
    console.log('[Main] Shapes count:', shapes?.length || 0);

    let filePath = currentFilePath;

    // If no current file path, show save dialog
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        title: 'Save Project',
        defaultPath: (projectName || 'untitled') + '.cc',
        filters: [
          { name: 'ClaudeCAD Project', extensions: ['cc'] }
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });

      if (result.canceled) {
        console.log('[Main] Save dialog canceled');
        return {
          success: false,
          canceled: true
        };
      }

      filePath = result.filePath;
      console.log('[Main] User selected path:', filePath);
    }

    // Convert shape mesh files to base64
    const shapesForSave = [];
    if (shapes && Array.isArray(shapes)) {
      for (const shape of shapes) {
        if (shape.mesh_path && fs.existsSync(shape.mesh_path)) {
          const meshData = fs.readFileSync(shape.mesh_path);
          shapesForSave.push({
            mesh: meshData.toString('base64'),
            color: shape.color,
            label: shape.label
          });
        }
      }
    }
    console.log('[Main] Encoded', shapesForSave.length, 'shapes to base64');

    // Construct project JSON with v2.0 format
    const now = new Date().toISOString();
    const projectData = {
      version: '2',
      name: projectName || 'untitled',
      created: now,
      modified: now,
      code: code || '',
      chat: chatHistory || [],
      featureColors: featureColors || {},
      shapes: shapesForSave
    };

    // Write to file
    const jsonString = JSON.stringify(projectData, null, 2);
    fs.writeFileSync(filePath, jsonString, 'utf8');
    console.log('[Main] Project saved successfully to:', filePath);

    return {
      success: true,
      filePath: filePath
    };
  } catch (err) {
    console.error('[Main] save-project error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for design mode message
ipcMain.handle('send-design-message', async (event, { message, currentSpec, history }) => {
  try {
    console.log('[Main] Design mode message received');

    // Build design prompt
    const prompt = claudeManager.buildDesignPrompt(message, currentSpec, history);

    // Send to Claude (no images for design mode)
    const response = await claudeManager.sendPrompt(prompt, null);

    // Parse response (just return the spec text)
    const parsed = claudeManager.parseDesignResponse
      ? claudeManager.parseDesignResponse(response)
      : { spec: response.trim(), raw: response };

    return {
      success: true,
      spec: parsed.spec
    };
  } catch (err) {
    console.error('[Main] Design message error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for build-from-spec: generate code from design spec, execute, return mesh
ipcMain.handle('build-from-spec', async (event, { spec }) => {
  try {
    console.log('[Main] Build from spec request received');
    console.log('[Main] Spec length:', spec?.length || 0);

    // Validate spec
    if (!spec || !spec.trim()) {
      return {
        success: false,
        error: 'No spec to build from'
      };
    }

    // Track retry state
    let attemptCount = 0;
    const maxAttempts = 2; // Original + 1 retry
    let lastError = null;
    let currentSpec = spec;

    while (attemptCount < maxAttempts) {
      attemptCount++;
      console.log(`[Main] Build from spec attempt ${attemptCount}/${maxAttempts}`);

      // Build prompt for code generation
      const prompt = claudeManager.buildCodeFromSpecPrompt(currentSpec);

      // Send to Claude (no images for spec-based generation)
      console.log('[Main] Sending spec to Claude for code generation...');
      const response = await claudeManager.sendPrompt(prompt, null);

      // Parse response
      const parsed = claudeManager.parseResponse(response);

      if (!parsed.code) {
        console.log('[Main] No code in response, returning explanation only');
        return {
          success: false,
          error: 'Claude did not return valid code',
          explanation: parsed.explanation,
          raw: parsed.raw
        };
      }

      console.log('[Main] Code generated, executing...');
      console.log('[Main] Code length:', parsed.code.length);

      // Execute the code
      const execResult = await pythonManager.execute(parsed.code);

      if (execResult.success) {
        console.log('[Main] Build from spec successful');
        return {
          success: true,
          code: parsed.code,
          explanation: parsed.explanation,
          shapes: execResult.shapes,
          volume: execResult.volume,
          newModel: parsed.newModel
        };
      }

      // Execution failed
      lastError = execResult.error;
      console.error(`[Main] Code execution failed (attempt ${attemptCount}):`, lastError);

      // If we haven't exhausted retries, prepare retry with error context
      if (attemptCount < maxAttempts) {
        console.log('[Main] Preparing auto-retry with error context...');
        currentSpec = `${spec}\n\n[IMPORTANT: Your previous code attempt failed with this error: "${lastError}". Please fix the issue and try again. Make sure to use valid Build123d API calls.]`;
      }
    }

    // All attempts failed
    console.error('[Main] All attempts failed, returning error');
    return {
      success: false,
      error: `Python execution failed after ${maxAttempts} attempts: ${lastError}`
    };
  } catch (err) {
    console.error('[Main] Build from spec error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for loading project
ipcMain.handle('load-project', async () => {
  try {
    console.log('[Main] Received load-project request');

    // Show open dialog
    const result = await dialog.showOpenDialog({
      title: 'Open Project',
      filters: [
        { name: 'ClaudeCAD Project', extensions: ['cc'] },
        { name: 'ClaudeCAD Prompt', extensions: ['md'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled) {
      console.log('[Main] Open dialog canceled');
      return {
        success: false,
        canceled: true
      };
    }

    const filePath = result.filePaths[0];
    console.log('[Main] User selected file:', filePath);

    // Read file
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Check if it's a .md file (prompt file)
    if (filePath.endsWith('.md')) {
      // Check for "claudecad prompt:" header (case insensitive)
      const firstLine = fileContent.split('\n')[0].toLowerCase().trim();
      if (!firstLine.includes('claudecad prompt')) {
        return {
          success: false,
          error: 'Markdown file must start with "claudecad prompt:" on the first line'
        };
      }

      // Extract the prompt (everything after the first line)
      const promptContent = fileContent.split('\n').slice(1).join('\n').trim();

      return {
        success: true,
        isPrompt: true,
        promptContent: promptContent,
        filePath: filePath
      };
    }

    // Parse JSON for .cc files
    let projectData;
    try {
      projectData = JSON.parse(fileContent);
    } catch (parseError) {
      console.error('[Main] Failed to parse project file:', parseError);
      return {
        success: false,
        error: 'Invalid project file: not valid JSON'
      };
    }

    // Check version
    const version = projectData.version || '1.0';
    console.log('[Main] Project version:', version);

    if (version === '1.0' || version === '1') {
      // Reject old format with clear message
      console.log('[Main] Rejecting old v1.0 format');
      return {
        success: false,
        error: 'This project uses an older format that is no longer supported. Please recreate the model.'
      };
    }

    if (version !== '2' && version !== '2.0') {
      return {
        success: false,
        error: `Unsupported project version: ${version}`
      };
    }

    // v2.0: Restore shapes from embedded base64
    const os = require('os');
    const tempDir = os.tmpdir();
    const restoredShapes = [];

    if (projectData.shapes && Array.isArray(projectData.shapes)) {
      for (let i = 0; i < projectData.shapes.length; i++) {
        const shape = projectData.shapes[i];
        const meshPath = path.join(tempDir, `claudecad_restored_${Date.now()}_${i}.glb`);

        // Decode base64 and write to temp file
        const meshBuffer = Buffer.from(shape.mesh, 'base64');
        fs.writeFileSync(meshPath, meshBuffer);

        restoredShapes.push({
          mesh_path: meshPath,
          color: shape.color,
          label: shape.label
        });
      }
      console.log('[Main] Restored', restoredShapes.length, 'shapes from base64');
    }

    console.log('[Main] Project loaded successfully');
    console.log('[Main] Project name:', projectData.name);
    console.log('[Main] Code length:', projectData.code?.length || 0);
    console.log('[Main] Chat history length:', projectData.chat?.length || 0);

    return {
      success: true,
      isPrompt: false,
      filePath: filePath,
      projectData: {
        ...projectData,
        shapes: restoredShapes // Replace base64 with temp file paths
      }
    };
  } catch (err) {
    console.error('[Main] load-project error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for loading spec file
ipcMain.handle('load-spec-file', async (event) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Load Spec File',
      defaultPath: path.join(__dirname, '../../models'),  // Start in models/ folder
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    const fileName = path.basename(filePath);

    return {
      success: true,
      content,
      fileName,
      filePath
    };
  } catch (err) {
    console.error('[Main] Load spec error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for saving spec file
ipcMain.handle('save-spec-file', async (event, { content }) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');

    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Spec File',
      defaultPath: path.join(__dirname, '../../models/my-design.md'),
      filters: [
        { name: 'Markdown', extensions: ['md'] }
      ]
    });

    if (result.canceled) {
      return { canceled: true };
    }

    await fs.writeFile(result.filePath, content, 'utf-8');
    const fileName = path.basename(result.filePath);

    return {
      success: true,
      fileName,
      filePath: result.filePath
    };
  } catch (err) {
    console.error('[Main] Save spec error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for saving temp image (Phase 8)
ipcMain.handle('save-temp-image', async (event, { buffer, type = 'reference' }) => {
  try {
    ensureTempDir();

    imageCounter++;
    const prefix = type === 'viewport' ? 'viewport' : 'img';
    const filename = `${prefix}_${String(imageCounter).padStart(3, '0')}.png`;
    const filepath = path.join(TEMP_IMAGE_DIR, filename);

    // Downscale if needed
    const imageBuffer = Buffer.from(buffer);
    const processedBuffer = downscaleImage(imageBuffer);

    fs.writeFileSync(filepath, processedBuffer);

    console.log(`[Main] Saved image: ${filepath}`);

    return {
      success: true,
      path: filepath,
      number: imageCounter,
      filename
    };
  } catch (err) {
    console.error('[Main] Save image error:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// IPC handler for getting temp image directory (Phase 8)
ipcMain.handle('get-temp-image-dir', () => {
  ensureTempDir();
  return TEMP_IMAGE_DIR;
});

// IPC handler for clearing temp images (Phase 8)
ipcMain.handle('clear-temp-images', () => {
  clearTempDir();
  return { success: true };
});

app.whenReady().then(async () => {
  // Initialize temp image directory (Phase 8)
  ensureTempDir();

  // Initialize Python manager
  try {
    await pythonManager.initialize();
    console.log('[Main] Python manager initialized');
  } catch (err) {
    console.error('[Main] Failed to initialize Python manager:', err);
    // Continue anyway - will try to initialize on first execute
  }

  createWindow();

  // Create application menu with proper keyboard shortcuts
  const isMac = process.platform === 'darwin';
  const menuTemplate = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-new');
            }
          }
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-open');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-save');
            }
          }
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-save-as');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Export STL...',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-export-stl');
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-undo');
            }
          }
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-redo');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Clear Project',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-new');
            }
          }
        },
        {
          label: 'Refresh Context',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-refresh-context');
            }
          }
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Design Mode',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-toggle-design-mode');
            }
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
});

app.on('before-quit', (event) => {
  // On macOS Cmd+Q, check for unsaved changes before quitting
  if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    checkDirtyAndClose(mainWindow);
  }
});

app.on('window-all-closed', () => {
  // Shutdown Python manager
  pythonManager.shutdown();

  // Always quit when window is closed (even on macOS for this app)
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('quit', () => {
  // Clear temp images (Phase 8)
  clearTempDir();

  // Ensure Python manager is shut down
  pythonManager.shutdown();
});
