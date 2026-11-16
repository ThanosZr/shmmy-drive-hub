import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateCatalogue } from '../dist/js/core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const site = path.join(root, 'dist');
const catalogue = validateCatalogue(JSON.parse(await readFile(path.join(site, 'data/drives.json'), 'utf8')));
const html = await readFile(path.join(site, 'index.html'), 'utf8');
for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  const value = match[1];
  if (/^(?:https?:|#|data:)/.test(value)) continue;
  const clean = value.split(/[?#]/)[0];
  const target = path.resolve(site, clean);
  if (!target.startsWith(site + path.sep) && target !== site) throw new Error('Ο σύνδεσμος βγαίνει έξω από το dist: ' + value);
  await access(target);
}
async function walk(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await walk(target));
    else if (item.name.endsWith('.mjs')) result.push(target);
  }
  return result;
}
const modules = [...await walk(path.join(site, 'js')), ...await walk(path.join(root, 'scripts')), ...await walk(path.join(root, 'tests'))];
for (const modulePath of modules) {
  const check = spawnSync(process.execPath, ['--check', modulePath], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(check.stderr || ('Αποτυχία σύνταξης: ' + modulePath));
  const source = await readFile(modulePath, 'utf8');
  for (const match of source.matchAll(/^import .*? from ['"](\.[^'"]+)['"]/gm)) {
    await access(path.resolve(path.dirname(modulePath), match[1]));
  }
}
await access(path.join(site, 'BACKUP-INFO.md'));
await access(path.join(site, '.nojekyll'));
console.log('OK: ' + catalogue.drives.length + ' πραγματικές καταχωρίσεις, ' + modules.length + ' JavaScript modules και τοπικοί σύνδεσμοι.');
