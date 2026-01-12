const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pythonManager = require('./python-manager');
const claudeManager = require('./claude-manager');

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

let mainWindow = null;
let isQuitting = false;

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

ipcMain.handle('send-chat-message', async (event, { message, currentCode, history, clickInfo }) => {
  try {
    console.log('[Main] Received send-chat-message request');
    console.log('[Main] Message:', message);
    console.log('[Main] Current code length:', currentCode?.length || 0);
    console.log('[Main] History length:', history?.length || 0);
    console.log('[Main] Click info:', clickInfo ? 'present' : 'none');

    // Send prompt to Claude
    const rawResponse = await claudeManager.sendPrompt(message, currentCode, history, clickInfo);
    console.log('[Main] Claude response received, length:', rawResponse.length);

    // Parse response
    const parsed = claudeManager.parseResponse(rawResponse);
    console.log('[Main] Parsed code:', parsed.code ? `${parsed.code.length} chars` : 'none');
    console.log('[Main] Explanation:', parsed.explanation.substring(0, 100));

    // If code exists, execute it
    if (parsed.code) {
      console.log('[Main] Executing generated code...');
      const execResult = await pythonManager.execute(parsed.code);

      if (execResult.success) {
        console.log('[Main] Code execution successful');
        return {
          success: true,
          code: parsed.code,
          explanation: parsed.explanation,
          meshPath: execResult.mesh_path
        };
      } else {
        console.error('[Main] Code execution failed:', execResult.error);
        return {
          success: false,
          explanation: parsed.explanation,
          error: `Python execution failed: ${execResult.error}`
        };
      }
    } else {
      // No code generated - just return explanation
      console.log('[Main] No code in response, returning explanation only');
      return {
        success: false,
        explanation: parsed.explanation,
        error: 'No Python code was generated'
      };
    }
  } catch (err) {
    console.error('[Main] send-chat-message error:', err);
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
ipcMain.handle('save-project', async (event, { code, chatHistory, projectName, currentFilePath }) => {
  try {
    console.log('[Main] Received save-project request');
    console.log('[Main] Current file path:', currentFilePath || 'none (new file)');
    console.log('[Main] Project name:', projectName || 'untitled');
    console.log('[Main] Code length:', code?.length || 0);
    console.log('[Main] Chat history length:', chatHistory?.length || 0);

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

    // Construct project JSON
    const now = new Date().toISOString();
    const projectData = {
      version: '1.0',
      name: projectName || 'untitled',
      created: now, // For simplicity, using current time (should track this separately in future)
      modified: now,
      code: code || '',
      chat: chatHistory || []
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

app.whenReady().then(async () => {
  // Initialize Python manager
  try {
    await pythonManager.initialize();
    console.log('[Main] Python manager initialized');
  } catch (err) {
    console.error('[Main] Failed to initialize Python manager:', err);
    // Continue anyway - will try to initialize on first execute
  }

  createWindow();
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

  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('quit', () => {
  // Ensure Python manager is shut down
  pythonManager.shutdown();
});
