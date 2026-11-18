// Strodano VJ desktop bridge: the only things the page may ask of the main process. GPL-3.0.
// Displays (list, hot-plug events, identify) and placing an output window fullscreen on a display (web/display.js).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('strodanoDesktop', {
  displays: () => ipcRenderer.invoke('displays:list'),
  onDisplays: fn => { ipcRenderer.on('displays:changed', (e, list) => fn(list)); },
  // frame = the output window's name ('strodano_out_N'); displayId = null puts it back as a normal window
  placeOutput: (frame, displayId) => ipcRenderer.invoke('output:place', { frame: String(frame), displayId: displayId == null ? null : Number(displayId) }),
  // NDI network output (desktop/ndi.js): status (with the loopback frame endpoint's port and token), sources on / off
  ndi: {
    status: () => ipcRenderer.invoke('ndi:status'),
    start: (id, name) => ipcRenderer.invoke('ndi:start', { id: String(id), name: String(name).slice(0, 120) }),
    stop: id => ipcRenderer.invoke('ndi:stop', String(id)),
  },
  // updates (desktop/updater.js, web/update.js): the state, and the three things the page may ask for
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    onState: fn => { ipcRenderer.on('update:state', (e, s) => fn(s)); },
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
  },
  identify: marks => ipcRenderer.invoke('displays:identify', (Array.isArray(marks) ? marks : []).slice(0, 16).map(m => ({ id: Number(m.id), text: String(m.text).slice(0, 80) }))),
});
