// Strodano VJ: keep Windows from slowing the app down when its window is not on screen. GPL-3.0.
// Windows 11 power throttling (EcoQoS) runs the processes of an app whose window is minimized or covered on efficiency
// cores at low clocks. For a live show that is wrong: the control window sits behind OBS / Resolume / a full-screen
// output while the show runs. Measured 2026-11-20 (RTX 3080 Ti laptop, control window minimized, NDI receiver timing
// every frame): 960x540 at 60 fps reached the receiver at 12.8 fps and 720p30 at 4.3 fps, the page's loopback upload took
// 0.16-1.9 s (Chromium's network service) and NDI's send 35 ms; with every process of the app opted out: 52.6 and 29 fps,
// 37-65 ms, 4-9 ms. So every process of the app (main, GPU, network service, renderers, the NDI sender) is opted out, and
// new ones (a GPU process restart, a new utility process) are picked up every few seconds.
// SetProcessInformation(ProcessPowerThrottling) through koffi (already shipped for NDI). Windows only; does nothing elsewhere.
'use strict';
const { app } = require('electron');

let api = null, timer = null;
const done = new Set();

function load() {
  if (api !== null) return api;
  api = false;
  try {
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');
    const State = koffi.struct('PROCESS_POWER_THROTTLING_STATE', { Version: 'uint32', ControlMask: 'uint32', StateMask: 'uint32' });
    api = {
      open: k32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      set: k32.func('bool __stdcall SetProcessInformation(void *h, int cls, const PROCESS_POWER_THROTTLING_STATE *info, uint32 size)'),
      close: k32.func('bool __stdcall CloseHandle(void *h)'),
    };
  } catch (e) { console.warn('power throttling opt-out unavailable:', e.message); }
  return api;
}

// ProcessPowerThrottling = 4; control EXECUTION_SPEED (1) and IGNORE_TIMER_RESOLUTION (4), state 0 = never throttle
function optOut(pid) {
  const a = load();
  if (!a) return false;
  const h = a.open(0x0200 /* PROCESS_SET_INFORMATION */ | 0x1000 /* QUERY_LIMITED */, false, pid);
  if (!h) return false;
  try { return a.set(h, 4, { Version: 1, ControlMask: 5, StateMask: 0 }, 12); } finally { a.close(h); }
}

function scan() {
  let pids;
  try { pids = app.getAppMetrics().map(m => m.pid); } catch (e) { return; }
  for (const pid of pids) if (!done.has(pid) && optOut(pid)) done.add(pid);
  for (const pid of done) if (!pids.includes(pid)) done.delete(pid);
}

function setupPower() {
  if (process.platform !== 'win32' || timer) return;
  scan();
  timer = setInterval(scan, 3000);
}

module.exports = { setupPower, optOut };
