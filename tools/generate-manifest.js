#!/usr/bin/env node
// Użycie: node tools/generate-manifest.js <folderPaczki> <folderWyjściowy> <bazowyURL>
// Przykład: node tools/generate-manifest.js pack public https://glonft.github.io/modpack
//
// - kopiuje pliki z <folderPaczki> do <folderWyjściowy>/files i liczy SHA-1,
// - dołącza mody z pack/external.json (linki CurseForge),
// - dołącza dodatki opcjonalne z pack/optional.json (brakujące SHA-1 liczy, pobierając plik),
// - dołącza newsy z news.md (w katalogu głównym repo),
// - kopiuje stronę z site/ do <folderWyjściowy>/,
// - zapisuje <folderWyjściowy>/manifest.json, który czyta launcher.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [packDir, outDir, baseUrlRaw] = process.argv.slice(2);
if (!packDir || !outDir || !baseUrlRaw) {
  console.error('Użycie: node generate-manifest.js <pack> <out> <baseUrl>');
  process.exit(1);
}
const repoDir = path.resolve(packDir, '..');
const baseUrl = baseUrlRaw.replace(/\/+$/, '');

function fail(msg) {
  console.error('BŁĄD: ' + msg);
  process.exit(1);
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fail(`${path.relative(repoDir, file)} – niepoprawny JSON: ${e.message}`); }
}

const pack = readJson(path.join(packDir, 'pack.json'));
if (!pack.server || !pack.server.host || !Number(pack.server.port)) {
  fail('pack.json: brak poprawnego "server": { "host": ..., "port": ... }');
}
pack.server.port = Number(pack.server.port);
const LOADER_TYPES = ['vanilla', 'fabric', 'neoforge'];
pack.loader = pack.loader || { type: 'vanilla' };
pack.loader.type = String(pack.loader.type || 'vanilla').toLowerCase();
if (!LOADER_TYPES.includes(pack.loader.type)) fail(`pack.json: nieznany silnik "${pack.loader.type}" (obsługiwane: ${LOADER_TYPES.join(', ')})`);
if (pack.loader.type !== 'vanilla' && !pack.loader.version) fail(`pack.json: brak "loader.version" dla ${pack.loader.type}`);
if (!pack.minecraft) fail('pack.json: brak "minecraft" (wersja gry, np. "1.21.1")');
const keep = pack.keepUserChanges || [];
const SKIP = new Set(['pack.json', 'external.json', 'optional.json']);

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

function checkPath(p, where) {
  if (!p || typeof p !== 'string' || p.startsWith('/') || p.includes('..') || p.includes('\\')) {
    fail(`${where}: niepoprawna ścieżka "${p}" (użyj np. "shaderpacks/nazwa.zip")`);
  }
}

async function hashUrl(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'melinasmp-modpack-ci' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} dla ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { sha1: crypto.createHash('sha1').update(buf).digest('hex'), size: buf.length };
}

/** news.md: sekcje "## Tytuł" (opcjonalnie z datą na początku), najnowsze na górze. */
function parseNews(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  return text
    .split(/^## +/m)
    .slice(1)
    .map((chunk) => {
      const [head, ...rest] = chunk.split('\n');
      const m = head.match(/^(\d{1,2}\.\d{1,2}\.\d{4})\s*[-–—:]?\s*(.*)$/);
      return {
        date: m ? m[1] : '',
        title: (m ? m[2] : head).trim(),
        body: rest.join('\n').trim(),
      };
    })
    .filter((n) => n.title || n.body)
    .slice(0, 15);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const abs of walk(src)) {
    const out = path.join(dest, path.relative(src, abs));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(abs, out);
    n++;
  }
  return n;
}

(async () => {
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

  for (const e of readJson(path.join(packDir, 'external.json'), [])) {
    if (e.disabled) continue;
    checkPath(e.path, 'external.json');
    if (!e.url || !/^[0-9a-f]{40}$/i.test(e.sha1 || '')) fail(`external.json: brak url/sha1 w ${e.path}`);
    files.push({ path: e.path, url: e.url, sha1: e.sha1.toLowerCase(), size: e.size });
  }

  // Dodatki opcjonalne
  const optional = [];
  for (const g of readJson(path.join(packDir, 'optional.json'), [])) {
    if (g.disabled) continue;
    if (!/^[a-z0-9_-]{1,40}$/i.test(g.id || '')) fail(`optional.json: niepoprawne "id" w "${g.name}" (litery, cyfry, - _)`);
    if (!g.name) fail(`optional.json: brak "name" w ${g.id}`);
    if (!Array.isArray(g.files) || !g.files.length) fail(`optional.json: brak "files" w ${g.id}`);
    const gFiles = [];
    for (const f of g.files) {
      checkPath(f.path, `optional.json (${g.id})`);
      if (!/^https:\/\//.test(f.url || '')) fail(`optional.json (${g.id}): "url" musi zaczynać się od https://`);
      let { sha1, size } = f;
      if (!/^[0-9a-f]{40}$/i.test(sha1 || '')) {
        console.log(`Liczę SHA-1 dla ${f.path}...`);
        ({ sha1, size } = await hashUrl(f.url));
      }
      gFiles.push({ path: f.path, url: f.url, sha1: sha1.toLowerCase(), size });
    }
    optional.push({ id: g.id, name: g.name, description: g.description || '', default: !!g.default, files: gFiles });
  }

  const news = parseNews(path.join(repoDir, 'news.md'));

  const manifest = {
    version: process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : new Date().toISOString(),
    generated: new Date().toISOString(),
    minecraft: pack.minecraft,
    loader: pack.loader,
    java: pack.java || 21,
    server: pack.server,
    managedDirs: pack.managedDirs || ['mods'],
    files,
    optional,
    news,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const site = copyDir(path.join(repoDir, 'site'), outDir);
  console.log(`manifest.json: ${files.length} plików, ${optional.length} dodatków, ${news.length} newsów, strona: ${site} plików, wersja ${manifest.version}`);
})().catch((e) => fail(e.message));
