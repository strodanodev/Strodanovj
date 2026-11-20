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
    // network check (desktop/ndinet.js): firewall state, this computer's addresses; fix = one Windows admin prompt
    netcheck: force => ipcRenderer.invoke('ndi:netcheck', !!force),
    fixFirewall: () => ipcRenderer.invoke('ndi:firewallfix'),
    // Discovery Server / adapter (desktop/ndi.js); setting them restarts the sender, the page restarts its sources
    settings: () => ipcRenderer.invoke('ndi:settings'),
    setSettings: s => ipcRenderer.invoke('ndi:setsettings', { discovery: String((s && s.discovery) || '').slice(0, 300), adapter: String((s && s.adapter) || '').slice(0, 200) }),
  },
  // updates (desktop/updater.js, web/update.js): the state, and the three things the page may ask for
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    onState: fn => { ipcRenderer.on('update:state', (e, s) => fn(s)); },
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
  },
  // rekordbox USB sticks (desktop/rekordbox.js, web/rekordbox.js): which are plugged in, a small file of one, and its
  // song files put into a file input of the page
  rekordbox: {
    list: () => ipcRenderer.invoke('rekordbox:sticks'),
    onSticks: fn => { ipcRenderer.on('rekordbox:sticks', (e, l) => fn(l)); },
    read: (id, rel) => ipcRenderer.invoke('rekordbox:read', { id: String(id).slice(0, 80), rel: String(rel).slice(0, 2048) }),
    files: (id, rels, inputId) => ipcRenderer.invoke('rekordbox:files', { id: String(id).slice(0, 80), rels: (Array.isArray(rels) ? rels : []).slice(0, 50000).map(r => String(r).slice(0, 2048)), inputId: String(inputId).slice(0, 40) }),
  },
  // Strodano VJ Pro (desktop/pro.js, web/prodl.js): the stored bundle, checked by the main process (sync, at start-up),
  // and keeping a downloaded one (the main process checks it again)
  pro: {
    load: () => ipcRenderer.sendSync('pro:load'),
    save: b => ipcRenderer.invoke('pro:save', { manifest: String(b && b.manifest), sig: String(b && b.sig), code: String(b && b.code) }),
  },
  identify: marks => ipcRenderer.invoke('displays:identify', (Array.isArray(marks) ? marks : []).slice(0, 16).map(m => ({ id: Number(m.id), text: String(m.text).slice(0, 80) }))),
});
