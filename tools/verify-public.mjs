#!/usr/bin/env node
// tools/verify-public.mjs - gate for the PUBLIC build of a game.
//
//   node tools/verify-public.mjs <dist-dir> [--allow-host host] [--allow-missing ref] ...
//
// The public build is everything a player's browser can download, so it must
// carry nothing but the game. This script FAILS (exit 1) when the build holds:
//   - repository metadata (.git, .github), dev docs, tools, tests, configs
//   - source maps, or JS/CSS that points at one (sourceMappingURL)
//   - anything shaped like a credential (keys, tokens, private keys, JWTs)
//   - private / LAN / Tailscale IP addresses
//   - a local file reference (src/href/url()/'path.ext') that is not shipped
// It is dependency-free on purpose: no npm install runs in the deploy job.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dist = args[0];
if (!dist || !fs.existsSync(dist)) { console.error('usage: verify-public.mjs <dist-dir>'); process.exit(2); }
const allowHosts = [], allowMissing = [];
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--allow-host') allowHosts.push(args[++i].toLowerCase());
  else if (args[i] === '--allow-missing') allowMissing.push(args[++i]);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isSymbolicLink()) { fail(`symlink in build: ${rel(p)}`); continue; }
    e.isDirectory() ? walk(p) : files.push(p);
  }
})(dist);
function rel(p) { return path.relative(dist, p).split(path.sep).join('/'); }

let failures = 0;
function fail(msg) { failures++; console.error('FAIL: ' + msg); }

// 1. Forbidden files and folders --------------------------------------------
const FORBIDDEN = [
  [/(^|\/)\.git(\/|$)/, 'git metadata'],
  [/(^|\/)\.github(\/|$)/, 'GitHub config'],
  [/(^|\/)(tools|docs|tests?|scripts|dev|match-profile)\//, 'development folder'],
  [/\.map$/i, 'source map'],
  [/\.(md|py|sh|mjs\.bak|bak|orig|log|ts|tsx|zip|psd|kra|aseprite|blend)$/i, 'development/source file'],
  [/(^|\/)(package(-lock)?\.json|\.env.*|\.npmrc|\.gitignore|\.gitattributes|Makefile|README.*|CLAUDE.*|AGENTS.*)$/i, 'dev config'],
  [/\.(pem|key|p12|pfx)$/i, 'key material'],
];
const ALLOWED_DOCS = new Set(['LICENSES.md']); // shipped licence notices are fine
for (const f of files) {
  const r = rel(f);
  if (ALLOWED_DOCS.has(r)) continue;
  if (r.startsWith('vendor/') && /(COPYING|LICENSE)/i.test(r)) continue;
  for (const [rx, why] of FORBIDDEN) if (rx.test(r)) fail(`${why}: ${r}`);
}

// 2. Content scan of every text file ----------------------------------------
const TEXT = /\.(html?|js|mjs|css|json|webmanifest|txt|svg|xml|md)$/i;
const SECRETS = {
  'AWS key': /AKIA[0-9A-Z]{16}/,
  'GitHub token': /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}/,
  'Google API key': /AIza[0-9A-Za-z\-_]{35}/,
  'Slack token': /xox[baprs]-[0-9A-Za-z-]{10,}/,
  'Stripe key': /[sr]k_live_[0-9A-Za-z]{20,}/,
  'OpenAI/Anthropic key': /sk-(ant-|proj-)?[A-Za-z0-9_\-]{32,}/,
  'private key': /-----BEGIN [A-Z ]*PRIVATE KEY/,
  'JWT': /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  'URL with credentials': /\b(?:https?|wss?|ftp):\/\/[^\/\s:@"'`]+:[^\/\s:@"'`]+@/,
  'Discord webhook': /discord(?:app)?\.com\/api\/webhooks\/\d+/,
  'source map reference': /[#@]\s*sourceMappingURL=/,
  'private IP (10/8)': /\b10\.(?:\d{1,3}\.){2}\d{1,3}\b(?!\.)/,
  'private IP (192.168/16)': /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
  'private IP (172.16/12)': /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
  'Tailscale/CGNAT IP (100.64/10)': /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/,
};
const tsNet = /\b[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b/gi;
for (const f of files) {
  if (!TEXT.test(f)) continue;
  const r = rel(f);
  if (r.startsWith('vendor/')) continue; // third-party, shipped verbatim
  const s = fs.readFileSync(f, 'utf8');
  for (const [name, rx] of Object.entries(SECRETS)) {
    const m = s.match(rx);
    if (m) fail(`${name} in ${r}: ${m[0].slice(0, 12)}...`);
  }
  for (const m of s.matchAll(tsNet)) {
    if (!allowHosts.includes(m[0].toLowerCase())) fail(`Tailscale host ${m[0]} in ${r} (pass --allow-host to accept)`);
  }
}

// 3. Every local reference is shipped -----------------------------------------
const shipped = new Set(files.map(rel));
const EXT = 'png|jpe?g|webp|gif|svg|ico|mp3|ogg|wav|woff2?|ttf|glb|gltf|json|webmanifest|css|js|mjs|wasm|html';
const refRx = new RegExp(`(?:src|href)\\s*=\\s*["']([^"'#?]+\\.(?:${EXT}))|url\\(\\s*["']?([^"')#?]+\\.(?:${EXT}))|["'\`]((?:\\.{1,2}\\/)?[A-Za-z0-9_][A-Za-z0-9_\\-./]*\\.(?:${EXT}))["'\`]`, 'gi');
let checked = 0;
for (const f of files) {
  if (!/\.(html?|css|js|mjs|webmanifest)$/i.test(f)) continue;
  const r = rel(f);
  if (r.startsWith('vendor/')) continue;
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(refRx)) {
    let ref = (m[1] || m[2] || m[3]).trim();
    if (/^[a-z]+:|^\/\/|\$\{|^data:/i.test(ref)) continue;
    if (!ref.includes('/') && !m[1] && !m[2]) continue; // bare 'name.png' strings are usually not paths
    const base = /\.(css)$/i.test(f) || ref.startsWith('.') ? path.dirname(r) : '';
    const target = path.posix.normalize(path.posix.join(base, ref.replace(/^\//, '')));
    checked++;
    // JS modules resolve relative to themselves; HTML-relative otherwise.
    const alt = path.posix.normalize(path.posix.join(path.dirname(r), ref));
    if (allowMissing.includes(ref)) { console.log(`known pre-existing missing file (allowed): ${ref}`); continue; }
    if (!shipped.has(target) && !shipped.has(alt)) fail(`missing in build: ${ref} (referenced from ${r})`);
  }
}

const bytes = files.reduce((a, f) => a + fs.statSync(f).size, 0);
console.log(`verify-public: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB, ${checked} local references checked`);
if (failures) { console.error(`verify-public: ${failures} problem(s) - build REJECTED`); process.exit(1); }
console.log('verify-public: OK - nothing but the game');
