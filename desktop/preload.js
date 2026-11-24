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
  // the control window's full screen (the menu bar hides while it is on; the state is kept across starts)
  fullscreen: {
    get: () => ipcRenderer.invoke('window:fullscreen', null),
    set: on => ipcRenderer.invoke('window:fullscreen', !!on),
    onChange: fn => { ipcRenderer.on('window:fullscreen', (e, on) => fn(!!on)); },
  },
  // Remote control without internet (desktop/remote.js, web/remotelink.js): this computer serves the remote page and a
  // WebSocket on one adapter; the page signs and checks every message. find: computers heard on this network (Remote mode).
  lan: {
    addresses: () => ipcRenderer.invoke('lan:addresses'),
    start: o => ipcRenderer.invoke('lan:start', { address: String((o && o.address) || '').slice(0, 64), room: String((o && o.room) || '').slice(0, 40) }),
    stop: () => ipcRenderer.invoke('lan:stop'),
    send: (id, text) => ipcRenderer.send('lan:send', { id: String(id).slice(0, 20), text: String(text) }),
    drop: id => ipcRenderer.send('lan:drop', String(id).slice(0, 20)),
    onEvent: fn => { ipcRenderer.on('lan:event', (e, ev) => fn(ev)); },
    find: on => ipcRenderer.invoke('lan:find', !!on),
    hosts: () => ipcRenderer.invoke('lan:hosts'),
    onHosts: fn => { ipcRenderer.on('lan:hosts', (e, l) => fn(l)); },
  },
  // Remote mode: the window shows the remote control screen (web/remote.html) instead of the show, and back
  remoteMode: {
    get: () => ipcRenderer.invoke('window:remote', null),
    set: on => ipcRenderer.invoke('window:remote', !!on),
  },
  identify: marks => ipcRenderer.invoke('displays:identify', (Array.isArray(marks) ? marks : []).slice(0, 16).map(m => ({ id: Number(m.id), text: String(m.text).slice(0, 80) }))),
});
