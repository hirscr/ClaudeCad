const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const pythonManager = require('./python-manager');

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
