import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { execSync } from 'node:child_process'

let mainWindow: BrowserWindow | null
let pythonProcess: ChildProcess | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function killPort5001() {
  const port = 5001;
  try {
    if (process.platform === 'win32') {
      try {
        const output = execSync(`netstat -ano | findstr :${port}`).toString();
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const localAddress = parts[1] || '';
            if (localAddress.endsWith(`:${port}`)) {
              const pid = parts[parts.length - 1];
              if (pid && !isNaN(Number(pid)) && Number(pid) > 0) {
                console.log(`Killing process ${pid} listening on port ${port}...`);
                execSync(`taskkill /F /PID ${pid} /T`);
              }
            }
          }
        }
      } catch (e) {
        // netstat or findstr will return exit code 1 if no matching connections are found
      }
    } else {
      try {
        const pid = execSync(`lsof -t -i:${port}`).toString().trim();
        if (pid) {
          console.log(`Killing process ${pid} listening on port ${port}...`);
          execSync(`kill -9 ${pid}`);
        }
      } catch (e) {
        // lsof returns exit code 1 if no process found
      }
    }
  } catch (err) {
    console.error(`Error while attempting to release port ${port}:`, err);
  }
}

function startPythonBackend() {
  const isDev = !app.isPackaged;

  // Make sure port 5001 is free before starting python backend
  killPort5001();

  // In Vite dev, __dirname is `dist-electron`.
  // We need to go up one directory to project root, then down to src/backend.
  const scriptPath = isDev
    ? path.join(__dirname, '../src/backend/ios_bridge.py')
    : path.join(process.resourcesPath, 'backend/ios_bridge.py');

  const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';

  console.log(`Starting python backend at: ${scriptPath}`);

  try {
    // Wrap the script path in double quotes to handle spaces when shell: true is used
    pythonProcess = spawn(pythonExecutable, [`"${scriptPath}"`], {
      shell: true
    })

    pythonProcess.stdout?.on('data', (data) => {
      console.log(`Python: ${data.toString()}`)
    })

    pythonProcess.stderr?.on('data', (data) => {
      console.error(`Python Error: ${data.toString()}`)
    })
  } catch (err) {
    console.error("Failed to start Python backend:", err);
  }
}

function stopPythonBackend() {
  if (pythonProcess) {
    if (process.platform === 'win32' && pythonProcess.pid) {
      try {
        spawn('taskkill', ['/pid', pythonProcess.pid.toString(), '/T', '/F'], { shell: true });
      } catch (err) {
        console.error("Failed to kill Python process tree:", err);
      }
    } else {
      pythonProcess.kill();
    }
    pythonProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
    backgroundColor: '#000000',
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', () => {
  startPythonBackend()
  createWindow()
})

app.on('window-all-closed', () => {
  stopPythonBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  stopPythonBackend()
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

ipcMain.handle('read-saved-locations', async () => {
  const locFilePath = path.join(app.getPath('userData'), 'saved_locations.locsim')
  if (fs.existsSync(locFilePath)) {
    try {
      const data = fs.readFileSync(locFilePath, 'utf-8')
      return JSON.parse(data)
    } catch (e) {
      console.error("Error reading .locsim file:", e)
      return []
    }
  }
  return []
})

ipcMain.handle('save-location', async (_, locationData) => {
  const locFilePath = path.join(app.getPath('userData'), 'saved_locations.locsim')
  try {
    let existingData: any[] = []
    if (fs.existsSync(locFilePath)) {
      const data = fs.readFileSync(locFilePath, 'utf-8')
      existingData = JSON.parse(data)
    }
    if (!existingData.some(loc => loc.lat === locationData.lat && loc.lng === locationData.lng)) {
       existingData.push(locationData)
       fs.writeFileSync(locFilePath, JSON.stringify(existingData, null, 2), 'utf-8')
    }
    return existingData
  } catch (e) {
    console.error("Error writing .locsim file:", e)
    return null
  }
})

ipcMain.handle('delete-location', async (_, locationData) => {
  const locFilePath = path.join(app.getPath('userData'), 'saved_locations.locsim')
  try {
    if (fs.existsSync(locFilePath)) {
      const data = fs.readFileSync(locFilePath, 'utf-8')
      let existingData: any[] = JSON.parse(data)
      existingData = existingData.filter(loc => loc.lat !== locationData.lat || loc.lng !== locationData.lng)
      fs.writeFileSync(locFilePath, JSON.stringify(existingData, null, 2), 'utf-8')
      return existingData
    }
    return []
  } catch (e) {
    console.error("Error deleting from .locsim file:", e)
    return null
  }
})
