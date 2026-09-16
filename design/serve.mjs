#!/usr/bin/env node
// Serves the Stitch exports so the designed screens can be browsed locally.
// No dependencies and no build step: these are static files, and the design
// folder is exported output, not source we compile.
import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESIGN_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(DESIGN_DIR, 'stitch');
const SCREENS_DIR = join(ROOT, 'screens');
const PORT = Number(process.env.PORT ?? 4321);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** "01-project-overview.html" -> "Project Overview". */
function titleOf(file) {
  return file
    .replace(/\.html$/, '')
    .replace(/^\d+-/, '')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The screen table in design/README.md already says what each screen
 * establishes, so the index reads it from there rather than restating it.
 */
async function readDescriptions() {
  const descriptions = new Map();

  try {
    const readme = await readFile(join(DESIGN_DIR, 'README.md'), 'utf8');
    for (const line of readme.split('\n')) {
      const row = /^\|\s*(\d{2})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(line);
      if (row) descriptions.set(row[1], { name: row[2], summary: row[3] });
    }
  } catch {
    // The index is still useful without the prose.
  }

  return descriptions;
}

async function renderIndex() {
  const files = (await readdir(SCREENS_DIR)).filter((file) => file.endsWith('.html')).sort();
  const descriptions = await readDescriptions();

  const cards = files
    .map((file) => {
      const number = file.slice(0, 2);
      const described = descriptions.get(number);
      const screenshot = `/screenshots/${file.replace(/\.html$/, '.png')}`;

      return `<a class="card" href="/screens/${file}">
        <img alt="" loading="lazy" src="${screenshot}">
        <div class="body">
          <span class="number">${number}</span>
          <h2>${described?.name ?? titleOf(file)}</h2>
          <p>${described?.summary ?? ''}</p>
        </div>
      </a>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Code Quality — design screens</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f8f9ff; color: #0b1c30; font: 400 13px/1.5 Inter, system-ui, sans-serif; }
  header { background: #213145; color: #eaf1ff; padding: 14px 24px; display: flex; align-items: baseline; gap: 12px; }
  header strong { font-size: 15px; font-weight: 600; color: #fff; }
  header span { font-size: 12px; color: #b4c5ff; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .note { background: #fff; border: 1px solid #c3c6d7; border-left: 3px solid #2563eb; border-radius: 4px; padding: 12px 16px; margin-bottom: 24px; }
  .note p { margin: 0 0 6px; }
  .note p:last-child { margin-bottom: 0; color: #434655; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  .card { display: flex; flex-direction: column; background: #fff; border: 1px solid #c3c6d7; border-radius: 4px; overflow: hidden; text-decoration: none; color: inherit; transition: border-color .15s, box-shadow .15s; }
  .card:hover { border-color: #2563eb; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .card img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; background: #e5eeff; border-bottom: 1px solid #c3c6d7; }
  .body { padding: 12px 16px 16px; }
  .number { font-size: 11px; font-weight: 600; color: #737686; letter-spacing: .04em; }
  h2 { font-size: 15px; font-weight: 600; margin: 2px 0 6px; }
  .body p { margin: 0; color: #434655; font-size: 12px; }
</style>
</head>
<body>
<header><strong>Code Quality</strong> <span>Stitch design export — ${files.length} screens</span></header>
<main>
  <div class="note">
    <p>Static mockups: no state, no data, no interactivity. Desktop only, 1280px reference width.</p>
    <p>The dashboard that renders real analysis data is not built yet.</p>
  </div>
  <div class="grid">
${cards}
  </div>
</main>
</body>
</html>
`;
}

/** Keeps requests inside the design folder, whatever the URL claims. */
function resolveWithin(root, pathname) {
  const target = normalize(join(root, decodeURIComponent(pathname)));
  return target === root || target.startsWith(root + sep) ? target : undefined;
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host}`);

  try {
    if (pathname === '/' || pathname === '/index.html') {
      const html = await renderIndex();
      response.writeHead(200, { 'content-type': CONTENT_TYPES['.html'] });
      response.end(html);
      return;
    }

    const file = resolveWithin(ROOT, pathname);
    if (!file || !(await stat(file)).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Design screens on http://localhost:${PORT}`);
});
