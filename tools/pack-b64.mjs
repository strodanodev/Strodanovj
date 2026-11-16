// Writes `window.<name> = "<base64 of gzip(file)>";` so a binary can be loaded by a plain <script> tag (works from file://).
// usage: node pack-b64.mjs <input> <output.js> <globalName> <comment>
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const [, , input, output, name, comment] = process.argv;
const raw = readFileSync(input), gz = gzipSync(raw, { level: 9 });
writeFileSync(output, `/* ${comment} gzip + base64; ${raw.length} bytes unpacked. */\nwindow.${name} = "${gz.toString('base64')}";\n`);
console.log(output, raw.length, '->', gz.length, 'gz');
