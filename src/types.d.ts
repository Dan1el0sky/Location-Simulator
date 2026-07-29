interface Window {
  electronAPI: {
    readSavedLocations: () => Promise<any[]>;
    saveLocation: (locationData: any) => Promise<any[]>;
    deleteLocation: (locationData: any) => Promise<any[]>;
  }
}
