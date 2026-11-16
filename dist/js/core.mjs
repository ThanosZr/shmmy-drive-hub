const DRIVE_FIELDS = new Set(['name', 'url', 'description', 'courses', 'backupDate', 'sourceThrough', 'uploadedDate', 'sizeBytes']);

export function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('el').replace(/ς/g, 'σ').trim();
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseDriveFolder(value) {
  if (typeof value !== 'string') throw new Error('Χρειάζεται σύνδεσμος φακέλου Google Drive.');
  const match = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,200})\/?(?:\?([^#\s]*))?(?:#[^\s]*)?$/i.exec(value.trim());
  if (!match) throw new Error('Χρησιμοποίησε HTTPS σύνδεσμο drive.google.com/drive/folders/… για φάκελο.');
  let resourceKey = '';
  let resourceKeySeen = false;
  for (const part of (match[2] || '').split('&').filter(Boolean)) {
    const separator = part.indexOf('=');
    const key = separator < 0 ? part : part.slice(0, separator);
    const rawValue = separator < 0 ? '' : part.slice(separator + 1);
    let decodedKey, decodedValue;
    try {
      decodedKey = decodeURIComponent(key.replace(/\+/g, ' ')).toLowerCase();
      decodedValue = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      throw new Error('Ο σύνδεσμος περιέχει μη έγκυρη κωδικοποίηση.');
    }
    if (decodedKey !== 'resourcekey') continue;
    if (resourceKeySeen || !/^[A-Za-z0-9_-]{1,200}$/.test(decodedValue)) {
      throw new Error('Το resourcekey του φακέλου δεν είναι έγκυρο.');
    }
    resourceKeySeen = true;
    resourceKey = decodedValue;
  }
  return {
    id: match[1],
    url: 'https://drive.google.com/drive/folders/' + match[1] + (resourceKey ? '?resourcekey=' + encodeURIComponent(resourceKey) : '')
  };
}

function textField(value, label, maximum, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new Error(label + ': χρειάζεται κείμενο.');
    return '';
  }
  if (typeof value !== 'string') throw new Error(label + ': χρειάζεται κείμενο.');
  const text = value.trim();
  if ((required && text.length < 2) || text.length > maximum) throw new Error(label + ': μη έγκυρο μήκος κειμένου.');
  return text;
}

function dateField(value, label) {
  if (value === undefined || value === null) return null;
  if (!isDate(value)) throw new Error(label + ': βάλε ημερομηνία YYYY-MM-DD ή null αν είναι άγνωστη.');
  return value;
}

export function validateCatalogue(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schemaVersion !== 1 || !Array.isArray(input.drives)) {
    throw new Error('Ο κατάλογος πρέπει να έχει schemaVersion: 1 και λίστα drives.');
  }
  if (Object.keys(input).some(key => !['schemaVersion', 'drives'].includes(key))) throw new Error('Άγνωστο πεδίο στον κατάλογο.');
  if (input.drives.length > 500) throw new Error('Ο κατάλογος υπερβαίνει τα 500 Drive.');
  const seen = new Set();
  const drives = input.drives.map((entry, index) => {
    const label = 'Drive ' + (index + 1);
    try {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Χρειάζεται αντικείμενο JSON.');
      const unknown = Object.keys(entry).filter(key => !DRIVE_FIELDS.has(key));
      if (unknown.length) throw new Error('Άγνωστα πεδία: ' + unknown.join(', '));
      const folder = parseDriveFolder(entry.url);
      if (seen.has(folder.id)) throw new Error('Ο ίδιος φάκελος υπάρχει ήδη στον κατάλογο.');
      seen.add(folder.id);
      const name = textField(entry.name, 'name', 120, true);
      const description = textField(entry.description, 'description', 2000);
      const rawCourses = entry.courses === undefined ? [] : entry.courses;
      if (!Array.isArray(rawCourses) || rawCourses.length > 1000) throw new Error('courses: χρειάζεται λίστα μαθημάτων.');
      const courseNames = new Set();
      const courses = [];
      for (const value of rawCourses) {
        const course = textField(value, 'courses', 200, true);
        const key = normalize(course);
        if (!courseNames.has(key)) { courseNames.add(key); courses.push(course); }
      }
      const backupDate = dateField(entry.backupDate, 'backupDate');
      const sourceThrough = dateField(entry.sourceThrough, 'sourceThrough');
      const uploadedDate = dateField(entry.uploadedDate, 'uploadedDate');
      if (backupDate && sourceThrough && sourceThrough > backupDate) throw new Error('sourceThrough: δεν μπορεί να είναι μετά την ημερομηνία λήψης.');
      if (backupDate && uploadedDate && uploadedDate < backupDate) throw new Error('uploadedDate: δεν μπορεί να είναι πριν από την ημερομηνία λήψης.');
      const sizeBytes = entry.sizeBytes ?? null;
      if (sizeBytes !== null && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)) throw new Error('sizeBytes: χρειάζεται μη αρνητικός ακέραιος ή null.');
      return { id: folder.id, name, url: folder.url, description, courses, backupDate, sourceThrough, uploadedDate, sizeBytes };
    } catch (error) {
      throw new Error(label + ': ' + error.message);
    }
  });
  return { schemaVersion: 1, drives };
}

export function matchesQuery(value, query) {
  const text = normalize(value);
  return normalize(query).split(/\s+/).filter(Boolean).every(token => text.includes(token));
}

export function selectDrives(drives, query = '', order = 'recent') {
  const selected = drives.filter(drive => matchesQuery([drive.name, drive.description, ...drive.courses].join(' '), query));
  return selected.sort((a, b) => {
    if (order === 'recent') {
      if (a.backupDate && !b.backupDate) return -1;
      if (!a.backupDate && b.backupDate) return 1;
      if (a.backupDate !== b.backupDate) return (b.backupDate || '').localeCompare(a.backupDate || '');
    }
    return a.name.localeCompare(b.name, 'el', { sensitivity: 'base' });
  });
}

export function uniqueCourseCount(drives) {
  return new Set(drives.flatMap(drive => drive.courses.map(normalize))).size;
}

export function formatDate(value) {
  return value ? value.split('-').reverse().join('/') : 'Δεν δηλώθηκε';
}

export function formatBytes(value) {
  if (value === null || value === undefined) return 'Δεν δηλώθηκε';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1000))));
  return new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1 }).format(value / 1000 ** unit) + ' ' + units[unit];
}
