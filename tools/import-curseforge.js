#!/usr/bin/env node
// Aktualizuje pack/external.json na podstawie instancji CurseForge.
// Użycie:
//   node tools/import-curseforge.js "C:\Users\damia\curseforge\minecraft\Instances\MelinaSMP"
// Potem: git add -A && git commit -m "Aktualizacja modów" && git push
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const inst = process.argv[2];
if (!inst) {
  console.error('Podaj ścieżkę do instancji CurseForge.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(path.join(inst, 'minecraftinstance.json'), 'utf8'));
const modsDir = path.join(inst, 'mods');
const byName = new Map();
for (const a of data.installedAddons || []) {
  const f = a.installedFile || {};
  byName.set(f.fileNameOnDisk || f.fileName, { url: f.downloadUrl, mod: a.name });
}

const out = [];
const notOnCurseForge = [];
for (const name of fs.readdirSync(modsDir)) {
  if (!name.endsWith('.jar')) continue; // pomija .disabled itp.
  const buf = fs.readFileSync(path.join(modsDir, name));
  const info = byName.get(name);
  if (!info || !info.url) { notOnCurseForge.push(name); continue; }
  out.push({
    path: `mods/${name}`,
    url: info.url,
    sha1: crypto.createHash('sha1').update(buf).digest('hex'),
    size: buf.length,
    _mod: info.mod,
  });
}
out.sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));

const target = path.join(__dirname, '..', 'pack', 'external.json');
fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n');

const loader = (data.baseModLoader && data.baseModLoader.name) || '';
console.log(`external.json: ${out.length} modów z CurseForge (loader instancji: ${loader})`);
if (notOnCurseForge.length) {
  console.log('\nTe mody nie pochodzą z CurseForge – skopiuj je ręcznie do pack/mods/:');
  for (const n of notOnCurseForge) console.log('  ' + n);
}
