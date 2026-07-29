import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  readSavedLocations: () => ipcRenderer.invoke('read-saved-locations'),
  saveLocation: (locationData: any) => ipcRenderer.invoke('save-location', locationData),
  deleteLocation: (locationData: any) => ipcRenderer.invoke('delete-location', locationData)
})
