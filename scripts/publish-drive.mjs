import { parseSubmissionBody, mergeSubmission } from './drive-submission.mjs';

const NO_CHANGE = { published: false, changed: false, commitSha: '' };
const safeMessage = error => String(error?.message || 'Άγνωστο σφάλμα.').slice(0, 1000).replace(/\x60/g, "'").replace(/@/g, '@\u200b');

export async function publishDrive({ github, context, core }) {
  const repo = context.repo;
  let authorized = false, issueNumber;
  try {
    if (context.eventName === 'issue_comment') {
      if (context.payload.issue?.pull_request || context.payload.comment?.body?.trim() !== '/publish') return NO_CHANGE;
      issueNumber = context.payload.issue.number;
    } else if (context.eventName === 'workflow_dispatch') {
      const value = String(context.payload.inputs?.issue_number || '');
      if (!/^[1-9]\d*$/.test(value)) throw new Error('Χρειάζεται έγκυρος αριθμός issue.');
      issueNumber = Number(value);
    } else return NO_CHANGE;
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('Μη έγκυρος αριθμός issue.');
    const branch = context.payload.repository?.default_branch || 'main';
    if (branch !== 'main' || context.ref !== 'refs/heads/main') throw new Error('Η δημοσίευση εκτελείται μόνο από το main.');
    const username = context.eventName === 'issue_comment' ? context.payload.comment.user.login : context.actor;
    const permission = await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username });
    authorized = ['admin', 'maintain', 'write'].includes(permission.data.permission);
    if (!authorized) { core.notice('Απαιτείται δικαίωμα εγγραφής στο repository.'); return NO_CHANGE; }
    const { data: issue } = await github.rest.issues.get({ ...repo, issue_number: issueNumber });
    if (issue.pull_request) throw new Error('Χρησιμοποίησε issue προσθήκης Drive, όχι pull request.');
    if (issue.state !== 'open') { core.notice('Άνοιξε ξανά το issue για ενημέρωση.'); return NO_CHANGE; }
    if (context.eventName === 'issue_comment' && issue.body !== context.payload.issue.body) {
      throw new Error('Το issue άλλαξε μετά την έγκριση. Έλεγξε τα νέα στοιχεία και γράψε ξανά /publish.');
    }
    const entry = parseSubmissionBody(issue.body);
    const path = 'dist/data/drives.json';
    const { data: file } = await github.rest.repos.getContent({ ...repo, path, ref: branch });
    if (Array.isArray(file) || file.type !== 'file' || file.encoding !== 'base64') throw new Error('Δεν διαβάστηκε ο κατάλογος.');
    const oldText = Buffer.from(file.content, 'base64').toString('utf8');
    const next = mergeSubmission(JSON.parse(oldText), entry, issueNumber);
    const content = JSON.stringify(next, null, 2) + '\n';
    const changed = content !== oldText;
    let commitSha = '';
    if (changed) {
      const saved = await github.rest.repos.createOrUpdateFileContents({
        ...repo, path, branch, sha: file.sha,
        message: 'Publish Drive from issue #' + issueNumber,
        content: Buffer.from(content, 'utf8').toString('base64')
      });
      commitSha = saved.data.commit.sha;
      if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error('Δεν επιβεβαιώθηκε το commit της καταχώρισης.');
    }
    const runUrl = (context.serverUrl || 'https://github.com') + '/' + repo.owner + '/' + repo.repo + '/actions/runs/' + context.runId;
    try {
      await github.rest.issues.createComment({
        ...repo, issue_number: issueNumber,
        body: changed
          ? 'Η καταχώριση εγκρίθηκε και αποθηκεύτηκε στον κατάλογο. Η δημοσίευση της σελίδας συνεχίζεται στο [Publish Drive](' + runUrl + ').'
          : 'Η καταχώριση είναι ήδη ενημερωμένη στον κατάλογο. Δεν χρειάστηκε νέα αλλαγή.'
      });
      await github.rest.issues.update({ ...repo, issue_number: issueNumber, state: 'closed', state_reason: 'completed' });
    } catch (error) { core.warning('Ο κατάλογος αποθηκεύτηκε, αλλά δεν ενημερώθηκε το issue: ' + safeMessage(error)); }
    return { published: true, changed, commitSha };
  } catch (error) {
    const message = safeMessage(error);
    core.setFailed(message);
    if (authorized && issueNumber) {
      try {
        await github.rest.issues.createComment({
          ...repo, issue_number: issueNumber,
          body: 'Δεν έγινε δημοσίευση: ' + message + '\n\nΔιόρθωσε τα πεδία του issue και γράψε ξανά /publish σε νέο σχόλιο.'
        });
      } catch (feedbackError) { core.warning('Δεν ενημερώθηκε το issue: ' + safeMessage(feedbackError)); }
    }
    return NO_CHANGE;
  }
}

