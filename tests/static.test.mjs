import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateCatalogue } from '../dist/js/core.mjs';

test('serves site assets, catalogue, and Markdown under a GitHub project path', async t => {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const prefix = '/shmmy-drive-hub/';
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const relative = pathname.slice(prefix.length) || 'index.html';
    const target = path.resolve(root, relative);
    if (!target.startsWith(root)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(target);
      response.writeHead(200, { 'Content-Type': target.endsWith('.mjs') ? 'text/javascript' : target.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port + prefix;
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const match of html.matchAll(/\b(?:src|href)="(\.\/[^"]+)"/g)) {
    const asset = await fetch(new URL(match[1], base));
    assert.equal(asset.status, 200, match[1]);
    await asset.arrayBuffer();
  }
  const scriptUrl = new URL('./js/app.mjs', base);
  const script = await (await fetch(scriptUrl)).text();
  assert.match(script, /new URL\('\.\.\/data\/drives\.json', import\.meta\.url\)/);
  const catalogue = await (await fetch(new URL('../data/drives.json', scriptUrl))).json();
  assert.doesNotThrow(() => validateCatalogue(catalogue));
  const markdown = await (await fetch(new URL('BACKUP-INFO.md', base))).text();
  assert.match(markdown, /Λήψη ολοκληρώθηκε/);
  assert.match(markdown, /Κάλυψη πηγής έως/);
});
