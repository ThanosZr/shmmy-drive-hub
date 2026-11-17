import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmissionBody, mergeSubmission } from '../scripts/drive-submission.mjs';
import { publishDrive } from '../scripts/publish-drive.mjs';
import { validateCatalogue } from '../dist/js/core.mjs';

const BODY = [
 '### Δημόσιο όνομα αντιγράφου', '', 'Αντίγραφο μαθημάτων', '',
 '### Σύνδεσμος φακέλου Google Drive', '', 'https://drive.google.com/drive/folders/abcdefghijklm?usp=sharing&resourcekey=0-abc', '',
 '### Μαθήματα και περιεχόμενα', '', '- Βάσεις Δεδομένων', '- Ηλεκτρονική ΙΙ', '',
 '### Ημερομηνία ολοκλήρωσης λήψης', '', '2026-11-16', '',
 '### Κάλυψη πηγής έως', '', 'Άγνωστη', '',
 '### Ημερομηνία ολοκλήρωσης ανάρτησης στο Drive', '', '2026-11-17', '',
 '### Περιγραφή, μέγεθος και γνωστές ελλείψεις', '', '_No response_'
].join('\n');

function harness(options = {}) {
 const state = { writes: [], comments: [], closed: [], notices: [], warnings: [], failures: [], reads: 0, issueReads: 0 };
 const context = {
  repo: { owner: 'owner', repo: 'repo' }, eventName: 'issue_comment', ref: 'refs/heads/main', actor: 'maintainer', runId: 1,
  payload: { repository: { default_branch: 'main' }, issue: { number: 3, body: BODY }, comment: { body: '/publish', user: { login: 'maintainer' } } }
 };
 const core = { notice: x => state.notices.push(x), warning: x => state.warnings.push(x), setFailed: x => state.failures.push(x) };
 const github = { rest: {
  repos: {
   getCollaboratorPermissionLevel: async () => ({ data: { permission: options.permission || 'write' } }),
   getContent: async () => { state.reads++; return { data: { type: 'file', encoding: 'base64', sha: 'a'.repeat(40), content: Buffer.from(JSON.stringify(options.catalogue || { schemaVersion: 1, drives: [] }, null, 2) + '\n').toString('base64') } }; },
   createOrUpdateFileContents: async args => { if(options.conflict) throw new Error('Conflict'); state.writes.push(args); return { data: { commit: { sha: 'b'.repeat(40) } } }; }
  },
  issues: {
   get: async () => { state.issueReads++; return { data: { body: options.body ?? BODY, state: options.closed ? 'closed' : 'open', ...(options.pr ? { pull_request: {} } : {}) } }; },
   createComment: async args => { if(options.feedbackFails) throw new Error('Feedback unavailable'); state.comments.push(args); return { data: { id: 1 } }; },
   update: async args => { state.closed.push(args); return { data: {} }; }
  }
 } };
 return { github, context, core, state };
}

test('parses the form and preserves unknown dates and Drive resourcekey', () => {
 const entry = parseSubmissionBody(BODY);
 assert.deepEqual(entry.courses, ['Βάσεις Δεδομένων', 'Ηλεκτρονική ΙΙ']);
 assert.equal(entry.sourceThrough, null);
 assert.equal(entry.description, '');
 assert.equal(entry.url, 'https://drive.google.com/drive/folders/abcdefghijklm?resourcekey=0-abc');
 assert.equal('id' in entry, false);
 assert.doesNotThrow(() => validateCatalogue({ schemaVersion: 1, drives: [entry] }));
});
test('rejects dates pasted in courses, missing data, duplicate headings, unsafe URLs, and inconsistent dates', () => {
 for(const body of [
  BODY.replace('- Βάσεις Δεδομένων\n- Ηλεκτρονική ΙΙ', '2026-11-17'),
  BODY.replace('- Βάσεις Δεδομένων\n- Ηλεκτρονική ΙΙ', '_No response_'),
  BODY + '\n### Δημόσιο όνομα αντιγράφου\n\nΆλλο',
  BODY.replace('https://drive.google.com/', 'https://evil.test/'),
  BODY.replace('Άγνωστη', '2026-11-17')
 ]) assert.throws(() => parseSubmissionBody(body));
});
test('updates the same issue without duplication or mutating the input even when its folder changes', () => {
 const entry = parseSubmissionBody(BODY);
 const first = mergeSubmission({ schemaVersion: 1, drives: [] }, entry, 3);
 const next = mergeSubmission(first, { ...entry, name: 'Νεότερο', url: entry.url.replace('abcdefghijklm', 'otherfolder123') }, 3);
 assert.equal(next.drives.length, 1);
 assert.equal(first.drives[0].name, entry.name);
 assert.equal(next.drives[0].name, 'Νεότερο');
 assert.equal(next.drives[0].url.includes('otherfolder123'), true);
 assert.equal(next.drives[0].issueNumber, 3);
 assert.doesNotThrow(() => validateCatalogue(next));
});

test('a new issue for the same folder is independent and repeated approval is idempotent', () => {
 const entry = parseSubmissionBody(BODY);
 const first = mergeSubmission({ schemaVersion: 1, drives: [] }, entry, 3);
 const second = mergeSubmission(first, { ...entry, name: 'Δεύτερο αντίγραφο' }, 5);
 assert.deepEqual(second.drives.map(item => item.name), [entry.name, 'Δεύτερο αντίγραφο']);
 assert.deepEqual(second.drives.map(item => item.issueNumber), [3, 5]);
 assert.deepEqual(mergeSubmission(second, { ...entry, name: 'Δεύτερο αντίγραφο' }, 5), second);
 const updated = mergeSubmission(second, { ...entry, name: 'Ενημέρωση πρώτου' }, 3);
 assert.equal(updated.drives.length, 2);
 assert.equal(updated.drives[1].name, 'Δεύτερο αντίγραφο');
 assert.equal(second.drives[0].name, entry.name);
});

test('new approvals preserve manual entries and require a valid issue identity', () => {
 const entry = parseSubmissionBody(BODY);
 const original = { schemaVersion: 1, drives: [entry] };
 const result = mergeSubmission(original, { ...entry, name: 'Ξεχωριστή υποβολή' }, 5);
 assert.equal(result.drives.length, 2);
 assert.deepEqual(result.drives[0], original.drives[0]);
 for (const number of [undefined, null, 0, -1, 1.5, '5']) assert.throws(() => mergeSubmission(original, entry, number));
});
test('read-only users cannot read issue data, publish, close, or comment', async () => {
 const h = harness({ permission: 'read' });
 assert.equal((await publishDrive(h)).published, false);
 assert.equal(h.state.issueReads + h.state.writes.length + h.state.comments.length + h.state.closed.length, 0);
});
test('ignores PR comments and commands with extra text', async () => {
 for(const mode of ['pr','extra']) {
  const h = harness();
  if(mode === 'pr') h.context.payload.issue.pull_request = {};
  else h.context.payload.comment.body = '/publish extra';
  assert.equal((await publishDrive(h)).published, false);
  assert.equal(h.state.issueReads + h.state.writes.length + h.state.comments.length, 0);
 }
});
test('publishes using the current catalogue SHA and returns the new commit for Pages', async () => {
 const h = harness({ permission: 'maintain' });
 const result = await publishDrive(h);
 assert.equal(result.published, true);
 assert.equal(result.changed, true);
 assert.equal(result.commitSha, 'b'.repeat(40));
 assert.equal(h.state.writes[0].branch, 'main');
 assert.equal(h.state.writes[0].path, 'dist/data/drives.json');
 assert.equal(h.state.writes[0].sha, 'a'.repeat(40));
 const data = JSON.parse(Buffer.from(h.state.writes[0].content, 'base64').toString('utf8'));
 assert.equal(validateCatalogue(data).drives.length, 1);
 assert.equal(data.drives[0].issueNumber, 3);
 assert.equal(h.state.closed[0].state, 'closed');
});

test('publishing a second issue with the same Drive saves both entries', async () => {
 const first = { issueNumber: 3, ...parseSubmissionBody(BODY) };
 const body = BODY.replace('Αντίγραφο μαθημάτων', 'Δεύτερη καταχώριση');
 const h = harness({ catalogue: { schemaVersion: 1, drives: [first] }, body });
 h.context.payload.issue = { number: 5, body };
 const result = await publishDrive(h);
 assert.equal(result.published, true);
 const data = JSON.parse(Buffer.from(h.state.writes[0].content, 'base64').toString('utf8'));
 assert.deepEqual(data.drives.map(item => item.issueNumber), [3, 5]);
 assert.deepEqual(data.drives.map(item => item.name), ['Αντίγραφο μαθημάτων', 'Δεύτερη καταχώριση']);
 assert.equal(h.state.closed[0].issue_number, 5);
});
test('rejects an issue changed after the approval comment', async () => {
 const h = harness({ body: BODY.replace('Αντίγραφο μαθημάτων', 'Changed') });
 assert.equal((await publishDrive(h)).published, false);
 assert.equal(h.state.reads + h.state.writes.length, 0);
 assert.match(h.state.failures[0], /άλλαξε μετά την έγκριση/);
});
test('invalid metadata leaves the issue open and explains the problem', async () => {
 const body = BODY.replace('- Βάσεις Δεδομένων\n- Ηλεκτρονική ΙΙ', '2026-11-17');
 const h = harness({ body }); h.context.payload.issue.body = body;
 assert.equal((await publishDrive(h)).published, false);
 assert.equal(h.state.writes.length + h.state.closed.length, 0);
 assert.match(h.state.comments[0].body, /όχι ημερομηνία/);
});
test('unchanged data does not create another commit', async () => {
 const h = harness({ catalogue: { schemaVersion: 1, drives: [{ issueNumber: 3, ...parseSubmissionBody(BODY) }] } });
 const result = await publishDrive(h);
 assert.equal(result.published, true);
 assert.equal(result.changed, false);
 assert.equal(h.state.writes.length, 0);
});
test('a concurrent catalogue update fails without closing the issue', async () => {
 const h = harness({ conflict: true });
 assert.equal((await publishDrive(h)).published, false);
 assert.equal(h.state.writes.length + h.state.closed.length, 0);
 assert.match(h.state.failures[0], /Conflict/);
});
test('feedback failure after saving still allows Pages deployment', async () => {
 const h = harness({ feedbackFails: true });
 const result = await publishDrive(h);
 assert.equal(result.commitSha, 'b'.repeat(40));
 assert.equal(result.changed, true);
 assert.equal(h.state.failures.length, 0);
 assert.equal(h.state.warnings.length, 1);
});
test('manual Publish uses the supplied issue number and checks permissions', async () => {
 const h = harness(); h.context.eventName = 'workflow_dispatch'; h.context.payload.inputs = { issue_number: '3' };
 assert.equal((await publishDrive(h)).published, true);
 assert.equal(h.state.writes.length, 1);
});
test('rejects publication from another branch', async () => {
 const h = harness(); h.context.ref = 'refs/heads/feature/untrusted';
 assert.equal((await publishDrive(h)).published, false);
 assert.equal(h.state.writes.length + h.state.comments.length, 0);
});

