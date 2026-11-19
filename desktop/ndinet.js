// Strodano VJ NDI network check, main-process side. GPL-3.0.
// Why NDI output can work on this computer and still be invisible to Resolume / OBS / VDMX on another one:
//  - this computer's firewall: receivers connect IN to the sender (TCP from 5960 up) and ask it over mDNS (UDP 5353).
//    Windows: checked here (network category + inbound rules for this exe) and fixable with one elevated command
//    (the installer adds the same rule; an "only for me" install has no admin rights to do it). macOS: the
//    application firewall asks on first use; only its on/off state is read here.
//  - the venue network (guest Wi-Fi isolation, multicast blocked, different subnets / VLANs): nothing on this computer
//    can fix that; the panel shows the addresses a receiver can be pointed at by hand and offers a Discovery Server.
//  - extra adapters (VPN, Hyper-V / WSL, Docker): NDI may announce an address the receiver cannot reach; the adapter
//    list flags them and the NDI settings can pin NDI to one adapter (desktop/ndi.js).
'use strict';
const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const os = require('os');

const RULE = 'Strodano VJ';
const VIRTUAL = /vethernet|virtual|vmware|vbox|virtualbox|hyper-?v|wsl|docker|\btap\b|tap-|\btun\b|wireguard|tailscale|zerotier|hamachi|npcap|loopback|bluetooth|utun|awdl|llw|bridge|vpn|openvpn|nordlynx|radmin/i;

// IPv4 addresses of this computer, real adapters first (what a receiver would type in)
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      out.push({ name, address: a.address, virtual: VIRTUAL.test(name), linkLocal: a.address.startsWith('169.254.') });
    }
  }
  return out.sort((a, b) => (a.virtual || a.linkLocal) - (b.virtual || b.linkLocal));
}

// run a PowerShell script (passed encoded, so paths with spaces / quotes need no escaping), JSON out
function ps(script, timeout = 20000) {
  return new Promise(res => {
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, timeout, maxBuffer: 1 << 20 }, (err, stdout) => {
      try { res(JSON.parse(String(stdout).trim() || 'null')); } catch (e) { res({ error: err ? err.message : 'no answer' }); }
    });
  });
}
const psq = s => "'" + String(s).replace(/'/g, "''") + "'";

// Windows: is inbound traffic to this exe allowed on the networks this computer is on now?
async function windowsFirewall() {
  const exe = process.execPath;
  const r = await ps(`
$ErrorActionPreference = 'SilentlyContinue'
$exe = ${psq(exe)}
$net = @(Get-NetConnectionProfile | ForEach-Object { @{ name = "$($_.InterfaceAlias)"; category = "$($_.NetworkCategory)" } })
$fw = @(Get-NetFirewallProfile | ForEach-Object { @{ name = "$($_.Name)"; enabled = ("$($_.Enabled)" -ne 'False') } })
$rules = @(Get-NetFirewallApplicationFilter -Program $exe | Get-NetFirewallRule | Where-Object { "$($_.Direction)" -eq 'Inbound' -and "$($_.Enabled)" -eq 'True' } | ForEach-Object { @{ action = "$($_.Action)"; profile = "$($_.Profile)" } })
@{ net = $net; fw = $fw; rules = $rules } | ConvertTo-Json -Depth 4 -Compress
`);
  if (!r || r.error) return { state: 'unknown', error: (r && r.error) || 'could not read the firewall' };
  const net = [].concat(r.net || []), fw = [].concat(r.fw || []), rules = [].concat(r.rules || []);
  const covers = (rule, cat) => /any/i.test(rule.profile) || rule.profile.split(/,\s*/).some(p => p.toLowerCase() === cat.toLowerCase());
  // NetworkCategory 'DomainAuthenticated' uses the Domain profile
  const cats = net.map(n => ({ ...n, profile: /domain/i.test(n.category) ? 'Domain' : n.category }));
  const per = cats.map(n => {
    const on = (fw.find(p => p.name.toLowerCase() === n.profile.toLowerCase()) || { enabled: true }).enabled;
    const blocked = rules.some(x => /block/i.test(x.action) && covers(x, n.profile));
    const allowed = rules.some(x => /allow/i.test(x.action) && covers(x, n.profile));
    return { name: n.name, category: n.profile, firewallOn: on, ok: !on || (allowed && !blocked), blocked: on && blocked };
  });
  const state = !per.length ? 'offline' : per.every(p => p.ok) ? 'ok' : per.some(p => p.blocked) ? 'blocked' : 'missing';
  return { state, networks: per, exe };
}
// Windows: replace this exe's inbound rules with one allow rule on every profile (one UAC prompt)
async function windowsFix() {
  const inner = `
$exe = ${psq(process.execPath)}
Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { "$($_.Direction)" -eq 'Inbound' } | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName ${psq(RULE)} -Direction Inbound -Program $exe -Action Allow -Profile Any | Out-Null
`;
  const enc = Buffer.from(inner, 'utf16le').toString('base64');
  const r = await ps(`
try {
  $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${enc}'
  @{ ok = ($p.ExitCode -eq 0); code = $p.ExitCode } | ConvertTo-Json -Compress
} catch { @{ ok = $false; cancelled = $true; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress }
`, 120000);
  return r || { ok: false, error: 'no answer' };
}

// macOS: the application firewall's global state (it asks per app on first use; a "Deny" there is in System Settings)
function macFirewall() {
  return new Promise(res => execFile('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate'], { timeout: 5000 }, (err, out) => {
    if (err) return res({ state: 'unknown', error: err.message });
    const on = /enabled|state = [12]/i.test(String(out));
    res({ state: on ? 'ask' : 'ok', firewallOn: on });
  }));
}

let cache = null, cacheAt = 0;
async function check(force) {
  if (!force && cache && Date.now() - cacheAt < 15000) return cache;
  const firewall = process.platform === 'win32' ? await windowsFirewall() : process.platform === 'darwin' ? await macFirewall() : { state: 'unknown' };
  cache = { platform: process.platform, host: os.hostname(), addresses: addresses(), firewall };
  cacheAt = Date.now();
  return cache;
}

function setupNdiNet() {
  ipcMain.handle('ndi:netcheck', (e, force) => check(!!force));
  ipcMain.handle('ndi:firewallfix', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Only needed on Windows.' };
    const r = await windowsFix();
    cache = null;
    return r;
  });
}

module.exports = { setupNdiNet, addresses };
