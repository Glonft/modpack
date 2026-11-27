#!/usr/bin/env node
// Użycie: node tools/generate-manifest.js <folderPaczki> <folderWyjściowy> <bazowyURL>
// Przykład: node tools/generate-manifest.js pack public https://glonft.github.io/modpack
//
// - kopiuje pliki z <folderPaczki> do <folderWyjściowy>/files i liczy SHA-1,
// - dołącza mody z pack/external.json (linki CurseForge/Modrinth; brakujące SHA-1 liczy, pobierając plik;
//   własne mody z folderu own/ publikuje na stronie; pomija wyłączone),
// - przekazuje ogłoszenie i minimalną wersję launchera z pack.json,
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
      const n = {
        date: m ? m[1] : '',
        title: (m ? m[2] : head).trim(),
        body: rest.join('\n').trim(),
      };
      // obrazek newsa z panelu: pierwsza linia treści „![](site/news/news-….jpg)”
      const lines = n.body.split('\n');
      const img = (lines[0] || '').trim().match(/^!\[\]\((site\/news\/news-[0-9a-f]{12}\.(?:jpg|png|webp))\)$/);
      if (img) { n.body = lines.slice(1).join('\n').trim(); n.imageFile = img[1]; }
      return n;
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
    if (e.disabled) continue; // wyłączony – graczom nie wysyłamy
    checkPath(e.path, 'external.json');
    if (e.own) {
      // własny mod wgrany przez panel: plik leży w repo (own/...), publikujemy go na stronie
      checkPath(e.own, 'external.json (own)');
      const src = path.join(repoDir, e.own);
      if (!fs.existsSync(src)) fail(`external.json: brak pliku ${e.own} dla ${e.path}`);
      const data = fs.readFileSync(src);
      const dest = path.join(outDir, 'files', e.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      files.push({
        path: e.path,
        url: `${baseUrl}/files/${e.path.split('/').map(encodeURIComponent).join('/')}`,
        sha1: crypto.createHash('sha1').update(data).digest('hex'),
        size: data.length,
      });
      continue;
    }
    if (!/^https:\/\//.test(e.url || '')) fail(`external.json: brak linku https:// w ${e.path}`);
    let { sha1, size } = e;
    if (!/^[0-9a-f]{40}$/i.test(sha1 || '')) {
      console.log(`Liczę SHA-1 dla ${e.path}...`);
      ({ sha1, size } = await hashUrl(e.url));
    }
    files.push({ path: e.path, url: e.url, sha1: sha1.toLowerCase(), size });
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
      if (f.seed) {
        // duży plik startowy (np. teren Distant Horizons z wydania na GitHubie) – hash SHA-256 z GitHuba
        if (!/^[0-9a-f]{64}$/i.test(f.sha256 || '') && !/^[0-9a-f]{40}$/i.test(f.sha1 || '')) {
          fail(`optional.json (${g.id}): plik ${f.path} wymaga "sha256" (wybierz go w panelu z wydania na GitHubie)`);
        }
        if (!Number(f.size)) fail(`optional.json (${g.id}): plik ${f.path} wymaga "size"`);
        const e = { path: f.path, url: f.url, size: Number(f.size), seed: true };
        if (f.sha256) e.sha256 = f.sha256.toLowerCase(); else e.sha1 = f.sha1.toLowerCase();
        gFiles.push(e);
        continue;
      }
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
  // changelog serwera (z panelu) – launcher pokazuje go w zakładce Changelog → Server
  if (Array.isArray(pack.changelog) && pack.changelog.length) {
    const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
    manifest.changelog = pack.changelog.slice(0, 200).map((e) => ({
      title: str(e.title, 120), date: str(e.date, 40),
      items: (Array.isArray(e.items) ? e.items : []).map((x) => str(x, 400)).filter(Boolean).slice(0, 60),
    }));
  }
  const ann = pack.announcement;
  if (ann && String(ann.text || '').trim()) {
    manifest.announcement = { text: String(ann.text).trim().slice(0, 300), level: ann.level === 'warn' ? 'warn' : 'info' };
  }
  // mody / shadery / paczki tekstur zablokowane przez administrację („Moje mody” w launcherze)
  if (Array.isArray(pack.blockedMods) && pack.blockedMods.length) {
    manifest.blockedMods = pack.blockedMods.map((b, i) => {
      const e = {};
      if (b.projectId) {
        if (!/^[A-Za-z0-9]{4,16}$/.test(b.projectId)) fail(`pack.json: blockedMods[${i}].projectId jest niepoprawne`);
        e.projectId = b.projectId;
      }
      if (b.modId) {
        if (!/^[a-z0-9_.-]{1,64}$/i.test(b.modId)) fail(`pack.json: blockedMods[${i}].modId jest niepoprawne`);
        e.modId = String(b.modId).toLowerCase();
      }
      if (!e.projectId && !e.modId) fail(`pack.json: blockedMods[${i}] potrzebuje projectId albo modId`);
      e.name = String(b.name || e.modId || e.projectId).slice(0, 80);
      if (b.reason) e.reason = String(b.reason).slice(0, 120);
      return e;
    });
  }
  /** Obrazek z site/ → { url, sha1 } (adres na stronie paczki + suma do sprawdzenia w launcherze). */
  const siteImage = (f, what) => {
    const src = path.join(repoDir, f);
    if (!fs.existsSync(src)) fail(`brak pliku ${what}: ${f}`);
    return {
      url: `${baseUrl}/${f.slice('site/'.length).split('/').map(encodeURIComponent).join('/')}`,
      sha1: crypto.createHash('sha1').update(fs.readFileSync(src)).digest('hex'),
    };
  };
  for (const n of news) {
    if (n.imageFile) { n.image = siteImage(n.imageFile, `obrazka newsa „${n.title}”`); }
    delete n.imageFile;
  }
  // wygląd launchera z panelu: kolory, tło (plik w site/launcher/ – trafia na stronę) i układ ekranu Start
  if (pack.appearance && typeof pack.appearance === 'object') {
    const a = pack.appearance;
    const HEX = /^#[0-9a-f]{6}$/i;
    const out = {};
    if (a.colors) {
      for (const k of ['bg', 'card', 'accent', 'second']) if (!HEX.test(a.colors[k] || '')) fail(`pack.json: appearance.colors.${k} musi być kolorem #rrggbb`);
      out.colors = { bg: a.colors.bg, card: a.colors.card, accent: a.colors.accent, second: a.colors.second };
    }
    if (a.background && a.background.file) {
      const f = String(a.background.file);
      if (!/^site\/launcher\/[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i.test(f)) fail('pack.json: appearance.background.file musi leżeć w site/launcher/ (jpg, png albo webp)');
      const src = path.join(repoDir, f);
      if (!fs.existsSync(src)) fail(`pack.json: brak pliku tła ${f}`);
      const data = fs.readFileSync(src);
      out.background = {
        url: `${baseUrl}/${f.slice('site/'.length).split('/').map(encodeURIComponent).join('/')}`,
        sha1: crypto.createHash('sha1').update(data).digest('hex'),
        dim: Math.min(90, Math.max(0, Number(a.background.dim) || 0)),
        blur: Math.min(20, Math.max(0, Number(a.background.blur) || 0)),
      };
    }
    if (a.icon) {
      if (!/^site\/launcher\/icon-[0-9a-f]{12}\.png$/.test(a.icon)) fail('pack.json: appearance.icon musi być PNG w site/launcher/');
      out.icon = siteImage(a.icon, 'ikony');
    }
    const l = a.layout || {};
    out.layout = {
      style: l.style === 'scene' ? 'scene' : 'tiles',
      discordCard: l.discordCard !== false,
      news: ['right', 'left', 'below', 'hidden'].includes(l.news) ? l.news : 'right',
      modsFirst: !!l.modsFirst,
      modsHidden: !!l.modsHidden,
      // pasek boczny: kolejność górnych ikon i ikony ukryte (Start i Ustawienia są zawsze)
      railOrder: (Array.isArray(l.railOrder) ? l.railOrder : []).filter((k, i, arr) => ['players', 'news', 'addons', 'changelog', 'mymods'].includes(k) && arr.indexOf(k) === i),
      railHidden: (Array.isArray(l.railHidden) ? l.railHidden : []).filter((k, i, arr) => ['players', 'news', 'addons', 'changelog', 'mymods', 'discord'].includes(k) && arr.indexOf(k) === i),
      discord: ['card', 'rail', 'both'].includes(l.discord) ? l.discord : undefined,
    };
    manifest.appearance = out;
  }
  // linki (np. zaproszenie na Discord) – ustawiane w panelu, launcher pokazuje ikonę na pasku bocznym
  if (pack.links && pack.links.discord) {
    const d = String(pack.links.discord).trim();
    if (!/^https:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\/[\w-]+\/?$/i.test(d)) fail('pack.json: links.discord musi być linkiem https://discord.gg/… albo https://discord.com/invite/…');
    manifest.links = { discord: d };
  }
  // Application ID aplikacji Discord – status w launcherze (Rich Presence)
  if (pack.links && pack.links.discordAppId) {
    const id = String(pack.links.discordAppId).trim();
    if (!/^\d{15,22}$/.test(id)) fail('pack.json: links.discordAppId musi być samymi cyframi (Application ID z Discord Developer Portal)');
    manifest.links = { ...(manifest.links || {}), discordAppId: id };
  }
  if (pack.minLauncher) {
    if (!/^\d+\.\d+\.\d+$/.test(pack.minLauncher)) fail('pack.json: "minLauncher" musi wyglądać tak: "0.7.0"');
    manifest.minLauncher = pack.minLauncher;
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const site = copyDir(path.join(repoDir, 'site'), outDir);
  console.log(`manifest.json: ${files.length} plików, ${optional.length} dodatków, ${news.length} newsów, strona: ${site} plików, wersja ${manifest.version}`);
})().catch((e) => fail(e.message));
