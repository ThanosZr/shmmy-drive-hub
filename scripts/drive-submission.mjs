import { validateCatalogue, normalize, isDate } from '../dist/js/core.mjs';

const FIELDS = {
  name: 'Δημόσιο όνομα αντιγράφου',
  url: 'Σύνδεσμος φακέλου Google Drive',
  courses: 'Μαθήματα και περιεχόμενα',
  backupDate: 'Ημερομηνία ολοκλήρωσης λήψης',
  sourceThrough: 'Κάλυψη πηγής έως',
  uploadedDate: 'Ημερομηνία ολοκλήρωσης ανάρτησης στο Drive',
  description: 'Περιγραφή, μέγεθος και γνωστές ελλείψεις'
};

function dateOrUnknown(value) {
  const text = (value || '').trim();
  return !text || ['αγνωστη', 'αγνωστο', 'unknown', 'δεν δηλωθηκε', '-', '—'].includes(normalize(text)) ? null : text;
}

export function parseSubmissionBody(body) {
  if (typeof body !== 'string' || !body.trim() || body.length > 65000) throw new Error('Χρειάζεται συμπληρωμένη φόρμα προσθήκης Drive.');
  const text = body.replace(/\r\n?/g, '\n');
  const headers = [...text.matchAll(/^### ([^\n]+)\n/gm)];
  const known = new Set(Object.values(FIELDS));
  const fields = new Map();
  headers.forEach((header, index) => {
    const title = header[1].trim();
    if (!known.has(title)) return;
    if (fields.has(title)) throw new Error('Διπλό πεδίο στη φόρμα: ' + title);
    let value = text.slice(header.index + header[0].length, headers[index + 1]?.index ?? text.length).trim();
    if (value === '_No response_' || value === 'No response') value = '';
    fields.set(title, value);
  });
  for (const key of ['name', 'url', 'courses']) {
    if (!fields.get(FIELDS[key])) throw new Error('Συμπλήρωσε το πεδίο «' + FIELDS[key] + '».');
  }
  const courses = fields.get(FIELDS.courses).split('\n').map(line => line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean);
  if (!courses.length || courses.some(value => isDate(value) || /^\d{1,2}[/.]\d{1,2}[/.]\d{4}$/.test(value))) {
    throw new Error('Στο «Μαθήματα και περιεχόμενα» γράψε μαθήματα ή περιγραφή του υλικού, όχι ημερομηνία.');
  }
  const entry = {
    name: fields.get(FIELDS.name), url: fields.get(FIELDS.url), courses,
    description: fields.get(FIELDS.description) || '',
    backupDate: dateOrUnknown(fields.get(FIELDS.backupDate)),
    sourceThrough: dateOrUnknown(fields.get(FIELDS.sourceThrough)),
    uploadedDate: dateOrUnknown(fields.get(FIELDS.uploadedDate)),
    sizeBytes: null
  };
  const { id, ...validated } = validateCatalogue({ schemaVersion: 1, drives: [entry] }).drives[0];
  return validated;
}

export function mergeSubmission(catalogue, entry, issueNumber) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('Χρειάζεται έγκυρος αριθμός issue για την καταχώριση.');
  const current = validateCatalogue(catalogue);
  const { id, ...validated } = validateCatalogue({ schemaVersion: 1, drives: [{ ...entry, issueNumber }] }).drives[0];
  const index = current.drives.findIndex(drive => drive.issueNumber === issueNumber);
  const drives = catalogue.drives.map(drive => ({ ...drive, ...(drive.courses ? { courses: [...drive.courses] } : {}) }));
  if (index < 0) drives.push(validated); else drives[index] = validated;
  const next = { schemaVersion: 1, drives };
  validateCatalogue(next);
  return next;
}

