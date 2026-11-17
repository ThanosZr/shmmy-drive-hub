import { validateCatalogue, selectDrives, matchesQuery, uniqueCourseCount, formatDate, formatBytes } from './core.mjs?v=2.1.1';

const byId = id => document.getElementById(id);
const list = byId('drive-list');
const search = byId('search');
const sort = byId('sort');
let drives = [];
let loading = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metadata(label, value, type = 'date') {
  const row = element('div', 'meta-row');
  row.append(element('dt', '', label));
  const definition = element('dd', value === null ? 'unknown' : '');
  if (type === 'date' && value) {
    const time = element('time', '', formatDate(value));
    time.dateTime = value;
    definition.append(time);
  } else {
    definition.textContent = type === 'size' ? formatBytes(value) : (value ? formatDate(value) : 'Δεν δηλώθηκε');
  }
  row.append(definition);
  return row;
}

function card(drive, query) {
  const item = element('li');
  const article = element('article', 'drive-card');
  const top = element('div', 'card-top');
  const icon = element('span', 'folder-mark');
  icon.append(byId('folder-icon').content.cloneNode(true));
  top.append(icon, element('span', 'card-badge', 'Google Drive'));
  article.append(top, element('h3', '', drive.name));
  if (drive.description) article.append(element('p', 'card-description', drive.description));

  const courseBlock = element('div', 'course-block');
  courseBlock.append(element('span', 'course-label', 'ΜΑΘΗΜΑΤΑ / ΠΕΡΙΕΧΟΜΕΝΑ'));
  if (!drive.courses.length) {
    courseBlock.append(element('p', 'course-empty', 'Δεν έχει δηλωθεί λίστα μαθημάτων.'));
  } else {
    const matches = query ? drive.courses.filter(course => matchesQuery(course, query)) : [];
    const preferred = matches.length ? [...matches, ...drive.courses.filter(course => !matches.includes(course))] : drive.courses;
    const tags = element('ul', 'course-tags');
    tags.setAttribute('aria-label', 'Μαθήματα που περιλαμβάνονται');
    for (const course of preferred.slice(0, 6)) tags.append(element('li', '', course));
    courseBlock.append(tags);
    if (drive.courses.length > 6) {
      const details = element('details', 'course-details');
      details.append(element('summary', '', 'Όλα τα μαθήματα (' + drive.courses.length + ')'));
      const fullList = element('ul', 'full-course-list');
      for (const course of drive.courses) fullList.append(element('li', '', course));
      details.append(fullList);
      courseBlock.append(details);
    }
  }
  article.append(courseBlock);

  const meta = element('dl', 'backup-meta');
  meta.append(metadata('Λήψη αντιγράφου', drive.backupDate));
  meta.append(metadata('Κάλυψη πηγής έως', drive.sourceThrough));
  if (drive.uploadedDate) meta.append(metadata('Ανάρτηση στο Drive', drive.uploadedDate));
  if (drive.sizeBytes !== null) meta.append(metadata('Δηλωμένο μέγεθος', drive.sizeBytes, 'size'));
  article.append(meta);

  const link = element('a', 'button button-primary', 'Άνοιγμα Drive');
  link.href = drive.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Άνοιγμα Drive: ' + drive.name + ' (νέα καρτέλα)');
  link.append(element('span', '', '↗'));
  link.lastChild.setAttribute('aria-hidden', 'true');
  article.append(link);
  item.append(article);
  return item;
}

function render() {
  const query = search.value.trim();
  const selected = selectDrives(drives, query, sort.value);
  const fragment = document.createDocumentFragment();
  for (const drive of selected) fragment.append(card(drive, query));
  list.replaceChildren(fragment);
  byId('empty-state').hidden = selected.length > 0;
  byId('clear-search').hidden = !query || drives.length === 0;
  if (!drives.length) {
    byId('empty-title').textContent = 'Ο κατάλογος ετοιμάζεται';
    byId('empty-description').textContent = 'Δεν έχει προστεθεί δημόσιος φάκελος ακόμη. Οι διαθέσιμοι σύνδεσμοι θα εμφανιστούν εδώ.';
    byId('status').textContent = '0 καταχωρίσεις';
  } else if (!selected.length) {
    byId('empty-title').textContent = 'Δεν βρέθηκε Drive';
    byId('empty-description').textContent = 'Δοκίμασε ένα άλλο όνομα μαθήματος ή καθάρισε την αναζήτηση.';
    byId('status').textContent = 'Κανένα αποτέλεσμα για την αναζήτησή σου.';
  } else {
    byId('status').textContent = selected.length + ' από ' + drives.length + ' καταχωρίσεις';
  }
}

function renderTotals() {
  const totals = byId('totals');
  totals.replaceChildren();
  const driveCount = element('span', 'total-chip');
  driveCount.append(element('strong', '', String(drives.length)), document.createTextNode('καταχωρίσεις'));
  const courseCount = uniqueCourseCount(drives);
  totals.append(driveCount);
  if (courseCount) {
    const courseChip = element('span', 'total-chip');
    courseChip.append(element('strong', '', String(courseCount)), document.createTextNode(courseCount === 1 ? 'μάθημα' : 'διαφορετικά μαθήματα'));
    totals.append(courseChip);
  }
  totals.hidden = drives.length === 0;
}

async function loadCatalogue() {
  if (loading) return;
  loading = true;
  byId('catalogue').setAttribute('aria-busy', 'true');
  byId('error-state').hidden = true;
  byId('empty-state').hidden = true;
  byId('toolbar').hidden = true;
  search.disabled = true;
  sort.disabled = true;
  byId('status').textContent = 'Φόρτωση καταλόγου…';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(new URL('../data/drives.json', import.meta.url), { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    drives = validateCatalogue(await response.json()).drives;
    renderTotals();
    render();
    byId('toolbar').hidden = drives.length === 0;
    search.disabled = false;
    sort.disabled = false;
  } catch (error) {
    list.replaceChildren();
    byId('totals').hidden = true;
    byId('status').textContent = '';
    byId('error-state').hidden = false;
    console.error('Δεν φορτώθηκε ο κατάλογος Drive:', error);
  } finally {
    window.clearTimeout(timeout);
    byId('catalogue').removeAttribute('aria-busy');
    loading = false;
  }
}

search.addEventListener('input', render);
sort.addEventListener('change', render);
byId('clear-search').addEventListener('click', () => {
  search.value = '';
  render();
  search.focus();
});
byId('retry').addEventListener('click', loadCatalogue);
loadCatalogue();

