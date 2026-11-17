import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalogue, parseDriveFolder, isDate, selectDrives, uniqueCourseCount, formatDate } from '../dist/js/core.mjs';

const folder = 'https://drive.google.com/drive/folders/abcdefghijklm';
const drive = (extra = {}) => ({ name: 'Αντίγραφο Α', url: folder, ...extra });

test('accepts actual folder URL formats and preserves resourcekey', () => {
  assert.deepEqual(parseDriveFolder(folder + '?usp=sharing&resourcekey=0-ab_c#list'), { id: 'abcdefghijklm', url: folder + '?resourcekey=0-ab_c' });
  assert.equal(parseDriveFolder('https://drive.google.com/drive/u/2/folders/abcdefghijklm/').url, folder);
});

test('rejects file links, other origins, credentials, and insecure URLs', () => {
  for (const value of [
    'javascript:alert(1)',
    'https://drive.google.com.evil.test/drive/folders/abcdefghijklm',
    'https://evil.test/drive/folders/abcdefghijklm',
    'https://drive.google.com@evil.test/drive/folders/abcdefghijklm',
    'https://drive.google.com/file/d/abcdefghijklm/view',
    'http://drive.google.com/drive/folders/abcdefghijklm',
    folder + '?resourcekey=a&resourcekey=b',
    folder + '?resourcekey=%XX',
    folder + '?resourcekey=a%20b'
  ]) assert.throws(() => parseDriveFolder(value), undefined, value);
});

test('validates calendar dates including leap years', () => {
  assert.equal(isDate('2024-02-29'), true);
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '17/11/2026', '', '2026-11-17T00:00:00Z']) assert.equal(isDate(value), false, value);
});

test('unknown dates remain unknown and minimum entry needs only name and URL', () => {
  const item = validateCatalogue({ schemaVersion: 1, drives: [drive()] }).drives[0];
  assert.equal(item.backupDate, null);
  assert.equal(item.sourceThrough, null);
  assert.equal(item.uploadedDate, null);
  assert.equal(item.sizeBytes, null);
  assert.deepEqual(item.courses, []);
  assert.equal(formatDate(item.backupDate), 'Δεν δηλώθηκε');
});

test('rejects contradictory chronology and invalid sizes', () => {
  for (const extra of [
    { backupDate: '2026-02-29' },
    { backupDate: '2026-11-16', sourceThrough: '2026-11-17' },
    { backupDate: '2026-11-16', uploadedDate: '2026-11-15' },
    { sizeBytes: -1 },
    { sizeBytes: 1.5 },
    { sizeBytes: '1000' }
  ]) assert.throws(() => validateCatalogue({ schemaVersion: 1, drives: [drive(extra)] }));
});

test('detects duplicate folders even when sharing query differs', () => {
  assert.throws(() => validateCatalogue({ schemaVersion: 1, drives: [drive(), drive({ url: folder + '?usp=sharing' })] }), /ίδιος φάκελος/);
});

test('distinct issues can refer to the same folder without losing either entry', () => {
  const result = validateCatalogue({ schemaVersion: 1, drives: [
    drive({ issueNumber: 3, name: 'Πρώτο αντίγραφο' }),
    drive({ issueNumber: 5, name: 'Δεύτερο αντίγραφο', url: folder + '?usp=sharing' })
  ] });
  assert.deepEqual(result.drives.map(item => item.issueNumber), [3, 5]);
  assert.equal(result.drives[0].url, result.drives[1].url);
  assert.equal(selectDrives(result.drives, 'δευτερο').length, 1);
});

test('rejects duplicate issue identities even with different folders and invalid issue numbers', () => {
  assert.throws(() => validateCatalogue({ schemaVersion: 1, drives: [
    drive({ issueNumber: 3 }), drive({ issueNumber: 3, url: folder + '2' })
  ] }), /issue #3/);
  for (const issueNumber of [null, 0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateCatalogue({ schemaVersion: 1, drives: [drive({ issueNumber })] }), /issueNumber/);
  }
});

test('validates catalogue and field types without inventing data', () => {
  assert.deepEqual(validateCatalogue({ schemaVersion: 1, drives: [] }), { schemaVersion: 1, drives: [] });
  assert.throws(() => validateCatalogue({ schemaVersion: 2, drives: [] }));
  for (const entry of [drive({ name: '' }), drive({ courses: 'all' }), drive({ courses: [null] }), drive({ key: 'unexpected' })]) {
    assert.throws(() => validateCatalogue({ schemaVersion: 1, drives: [entry] }));
  }
});

test('Greek course search ignores accents, case, and final sigma', () => {
  const data = validateCatalogue({ schemaVersion: 1, drives: [drive({ courses: ['Βάσεις Δεδομένων', 'ΒΑΣΕΙΣ ΔΕΔΟΜΕΝΩΝ'], description: 'Σημειώσεις και παλιά θέματα' })] }).drives;
  assert.equal(data[0].courses.length, 1);
  assert.equal(selectDrives(data, 'βασεισ δεδομενων').length, 1);
  assert.equal(selectDrives(data, 'παλια θεματα').length, 1);
  assert.equal(selectDrives(data, 'βάσεις άσχετο').length, 0);
  assert.equal(uniqueCourseCount(data), 1);
});

test('sorts known backup dates before unknown dates and leaves input untouched', () => {
  const data = validateCatalogue({ schemaVersion: 1, drives: [
    drive({ name: 'Άγνωστο' }),
    drive({ name: 'Παλαιό', url: folder + '2', backupDate: '2026-10-01' }),
    drive({ name: 'Νέο', url: folder + '3', backupDate: '2026-11-16' })
  ] }).drives;
  assert.deepEqual(selectDrives(data).map(item => item.name), ['Νέο', 'Παλαιό', 'Άγνωστο']);
  assert.deepEqual(data.map(item => item.name), ['Άγνωστο', 'Παλαιό', 'Νέο']);
});

