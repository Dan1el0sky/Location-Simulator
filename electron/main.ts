import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null
let pythonProcess: ChildProcess | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function startPythonBackend() {
  const isDev = !app.isPackaged;
  // In development, the script is in src/backend
  // In production, the script is in resources/backend (configured via extraResources)
  const scriptPath = isDev
    ? path.join(__dirname, '../../src/backend/ios_bridge.py')
    : path.join(process.resourcesPath, 'backend/ios_bridge.py');

  const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';

  console.log(`Starting python backend at: ${scriptPath}`);

  try {
    pythonProcess = spawn(pythonExecutable, [scriptPath], {
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
    pythonProcess.kill()
    pythonProcess = null
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
