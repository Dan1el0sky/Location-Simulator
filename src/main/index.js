import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let pythonProcess = null;

const APP_VERSION = '1.0.0';

function startPythonBackend() {
  const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
  const backendScript = path.join(__dirname, '..', 'backend', 'ios_bridge.py');

  console.log(`[Main] Launching Python backend engine: ${backendScript}`);
  pythonProcess = spawn(pythonExecutable, [backendScript], {
    cwd: path.join(__dirname, '..', 'backend'),
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python Engine]: ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Engine Err]: ${data.toString().trim()}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`[Main] Python process exited with code ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: `Location Simulator v${APP_VERSION}`,
    frame: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startPythonBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.handle('get-app-version', () => {
  return APP_VERSION;
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    console.log('[Main] Terminating Python sidecar process...');
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
