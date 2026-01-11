const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const pythonManager = require('./python-manager');
const claudeManager = require('./claude-manager');

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

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

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
}

// IPC Handlers
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

ipcMain.handle('send-chat-message', async (event, { message, currentCode, history }) => {
  try {
    console.log('[Main] Received send-chat-message request');
    console.log('[Main] Message:', message);
    console.log('[Main] Current code length:', currentCode?.length || 0);
    console.log('[Main] History length:', history?.length || 0);

    // Send prompt to Claude
    const rawResponse = await claudeManager.sendPrompt(message, currentCode, history);
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
