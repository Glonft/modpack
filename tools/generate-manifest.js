#!/usr/bin/env node
// Użycie: node tools/generate-manifest.js <folderPaczki> <folderWyjściowy> <bazowyURL>
// Przykład: node tools/generate-manifest.js pack public https://glonft.github.io/modpack
//
// Kopiuje pliki z <folderPaczki> do <folderWyjściowy>/files, liczy SHA-1
// i zapisuje <folderWyjściowy>/manifest.json, który czyta launcher.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [packDir, outDir, baseUrlRaw] = process.argv.slice(2);
if (!packDir || !outDir || !baseUrlRaw) {
  console.error('Użycie: node generate-manifest.js <pack> <out> <baseUrl>');
  process.exit(1);
}
const baseUrl = baseUrlRaw.replace(/\/+$/, '');
const pack = JSON.parse(fs.readFileSync(path.join(packDir, 'pack.json'), 'utf8'));
const keep = pack.keepUserChanges || [];
const SKIP = new Set(['pack.json', 'external.json']);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .gitkeep itp.
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = [];
fs.rmSync(outDir, { recursive: true, force: true });

for (const abs of walk(packDir)) {
  const rel = path.relative(packDir, abs).split(path.sep).join('/');
  if (SKIP.has(rel)) continue;
  const data = fs.readFileSync(abs);
  const dest = path.join(outDir, 'files', rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);

  const entry = {
    path: rel,
    url: `${baseUrl}/files/${rel.split('/').map(encodeURIComponent).join('/')}`,
    sha1: crypto.createHash('sha1').update(data).digest('hex'),
    size: data.length,
  };
  if (keep.some((k) => rel === k || (k.endsWith('/') && rel.startsWith(k)))) entry.overwrite = false;
  files.push(entry);
}

const extFile = path.join(packDir, 'external.json');
if (fs.existsSync(extFile)) {
  for (const e of JSON.parse(fs.readFileSync(extFile, 'utf8'))) {
    if (e.disabled) continue;
    if (!e.path || !e.url || !/^[0-9a-f]{40}$/i.test(e.sha1 || '')) {
      console.error('Błędny wpis w external.json:', e);
      process.exit(1);
    }
    files.push({ path: e.path, url: e.url, sha1: e.sha1.toLowerCase(), size: e.size });
  }
}

const manifest = {
  version: process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : new Date().toISOString(),
  generated: new Date().toISOString(),
  minecraft: pack.minecraft,
  loader: pack.loader,
  managedDirs: pack.managedDirs || ['mods'],
  files,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`manifest.json: ${files.length} plików, wersja ${manifest.version}`);
