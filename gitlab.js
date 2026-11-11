import { createHash } from 'node:crypto'

// Notes come newest-first. ponytail: only the last 100 notes per MR are read;
// on very long MRs your last activity can fall outside that window → shows as "To review".
const NOTES = 'sort=desc&order_by=created_at&per_page=100'

const isMine = me => n => n.author.id === me.id
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const reRequested = me => n => n.system && new RegExp(`requested review from .*@${escape(me.username)}(?![\\w.-])`).test(n.body)

// approved = your approval is currently active (from the approvals API, so a reset on push counts as not approved)
export function reviewStatus(mr, notes, me, approved = false) {
  const i = notes.findIndex(isMine(me))
  if (i === -1 && !approved) return 'To review'
  const since = i === -1 ? notes : notes.slice(0, i)
  if (approved) return since.some(reRequested(me)) ? 'Needs re-review' : 'Approved'
  const updated = since.some(n =>
    n.system ? /^added \d+ (new )?commits?/.test(n.body) || reRequested(me)(n) : n.author.id === mr.author.id
  )
  return updated ? 'Needs re-review' : 'Waiting on author'
}

export function myStatus(mr, notes, me) {
  if (mr.draft) return 'Draft'
  const i = notes.findIndex(isMine(me))
  const since = i === -1 ? notes : notes.slice(0, i)
  if (since.some(n => !n.system && n.author.id !== me.id)) return 'Has feedback'
  if (mr.detailed_merge_status === 'mergeable') return 'Ready to merge'
  return 'In review'
}

const user = u => ({ id: u.id, name: u.name, avatar: u.avatar_url })

const card = (mr, status) => ({
  id: mr.id,
  projectId: mr.project_id,
  iid: mr.iid,
  title: mr.title,
  url: mr.web_url,
  ref: mr.references.full,
  author: user(mr.author),
  reviewers: mr.reviewers.map(user),
  description: mr.description ?? '',
  updatedAt: mr.updated_at,
  status,
})

const client = ({ host, token }) => async (path, method = 'GET', body) => {
  const res = await fetch(`${host}/api/v4${path}`, {
    method,
    headers: { 'PRIVATE-TOKEN': token, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  })
  if (res.status === 403 && method !== 'GET') throw new Error('Your token cannot do this. Make a token with the api scope.')
  if (!res.ok) throw new Error(`GitLab returned ${res.status} for ${path.split('?')[0]}`)
  return res.json()
}

export const approve = (config, projectId, iid) => client(config)(`/projects/${projectId}/merge_requests/${iid}/approve`, 'POST')

const where = p => p && `${p.new_path ?? p.old_path}:${p.new_line ?? p.old_line ?? ''}`

// Comment threads (system notes dropped) and who has approved, for the sidebar and full view.
export async function details(config, projectId, iid) {
  const api = client(config)
  const p = `/projects/${projectId}/merge_requests/${iid}`
  // ponytail: first 100 threads only; paginate if MRs get that busy
  const [approvals, discussions] = await Promise.all([api(`${p}/approvals`), api(`${p}/discussions?per_page=100`)])
  const threads = discussions
    .map(d => ({
      id: d.id,
      file: where(d.notes[0].position),
      position: d.notes[0].position && (p => ({ path: p.new_path, oldLine: p.old_line, newLine: p.new_line, headSha: p.head_sha }))(d.notes[0].position),
      resolvable: d.notes.some(n => n.resolvable),
      resolved: d.notes.every(n => !n.resolvable || n.resolved),
      notes: d.notes.filter(n => !n.system).map(n => ({ id: n.id, author: user(n.author), body: n.body, createdAt: n.created_at })),
    }))
    .filter(t => t.notes.length)
  return { approvedBy: approvals.approved_by.map(a => a.user.id), threads }
}

// Unified diff text → rows. Each row has old and/or new line number, like GitHub's two number columns.
export function parseDiff(diff) {
  const rows = []
  let o = 0, n = 0
  for (const raw of diff.split('\n')) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (h) { o = +h[1]; n = +h[2]; rows.push({ type: 'hunk', text: raw }); continue }
    const text = raw.slice(1)
    if (raw[0] === '+') rows.push({ type: 'add', new: n++, text })
    else if (raw[0] === '-') rows.push({ type: 'del', old: o++, text })
    else if (raw[0] === ' ') rows.push({ type: 'ctx', old: o++, new: n++, text })
    // '\ No newline at end of file' and the trailing empty string are dropped
  }
  return rows
}

const fileStatus = d => d.new_file ? 'added' : d.deleted_file ? 'deleted' : d.renamed_file ? 'renamed' : 'modified'

export async function changes(config, projectId, iid) {
  const api = client(config)
  const p = `/projects/${projectId}/merge_requests/${iid}`
  // ponytail: first 100 files only; paginate if MRs get that big. /diffs needs GitLab 15.7+.
  const [mr, diffs] = await Promise.all([api(p), api(`${p}/diffs?per_page=100`)])
  return {
    refs: mr.diff_refs,
    files: diffs.map(d => ({
      oldPath: d.old_path,
      newPath: d.new_path,
      status: fileStatus(d),
      tooLarge: !!(d.too_large || d.collapsed), // GitLab sends no diff text for either
      // changes when the file's diff changes, so "Viewed" resets like on GitHub
      hash: createHash('sha1').update(d.diff).digest('hex').slice(0, 12),
      rows: parseDiff(d.diff),
    })),
  }
}

// New thread on one diff line. Added line: newLine only. Removed line: oldLine only. Context line: both.
export const comment = (config, projectId, iid, { refs, oldPath, newPath, oldLine, newLine, body }) =>
  client(config)(`/projects/${projectId}/merge_requests/${iid}/discussions`, 'POST', {
    body,
    position: {
      position_type: 'text', base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha,
      old_path: oldPath, new_path: newPath, old_line: oldLine, new_line: newLine,
    },
  })

export const reply = (config, projectId, iid, discussionId, body) =>
  client(config)(`/projects/${projectId}/merge_requests/${iid}/discussions/${discussionId}/notes`, 'POST', { body })

export const resolve = (config, projectId, iid, discussionId, resolved) =>
  client(config)(`/projects/${projectId}/merge_requests/${iid}/discussions/${discussionId}?resolved=${!!resolved}`, 'PUT')

export async function fetchBoard(config) {
  const api = client(config)
  const me = await api('/user')
  const q = 'state=opened&scope=all&per_page=100'
  const [mine, reviewer, assignee] = await Promise.all([
    api(`/merge_requests?${q}&author_id=${me.id}`),
    api(`/merge_requests?${q}&reviewer_id=${me.id}`),
    api(`/merge_requests?${q}&assignee_id=${me.id}`),
  ])
  const others = [...new Map([...reviewer, ...assignee].filter(mr => mr.author.id !== me.id).map(mr => [mr.id, mr])).values()]

  // ponytail: 1–2 requests per MR, all in parallel. Fine for tens of MRs; batch or use GraphQL if it hits rate limits.
  const mrPath = mr => `/projects/${mr.project_id}/merge_requests/${mr.iid}`
  const notesOf = mr => api(`${mrPath(mr)}/notes?${NOTES}`)
  const approvedByMe = async mr => (await api(`${mrPath(mr)}/approvals`)).approved_by.some(a => a.user.id === me.id)

  const [mineCards, reviewingCards] = await Promise.all([
    Promise.all(mine.map(async mr => card(mr, myStatus(mr, await notesOf(mr), me)))),
    Promise.all(others.map(async mr => {
      const [notes, approved] = await Promise.all([notesOf(mr), approvedByMe(mr)])
      return card(mr, reviewStatus(mr, notes, me, approved))
    })),
  ])
  return { me: { username: me.username }, mine: mineCards, reviewing: reviewingCards }
}
