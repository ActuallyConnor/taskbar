import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMoves, reviewStatus, myStatus, parseDiff, lineCode } from './gitlab.js'

const me = { id: 1, username: 'me' }
const author = { id: 2 }
const mr = { author, draft: false }
const note = (who, body, system = false) => ({ author: who, body, system })

test('reviewStatus', () => {
  assert.equal(reviewStatus(mr, [], me), 'To review')
  assert.equal(reviewStatus(mr, [note(me, 'nit')], me), 'Waiting on author')
  assert.equal(reviewStatus(mr, [note(author, 'added 2 commits\n\n<ul>', true), note(me, 'nit')], me), 'Needs re-review')
  assert.equal(reviewStatus(mr, [note(author, 'requested review from @me', true), note(me, 'nit')], me), 'Needs re-review')
  assert.equal(reviewStatus(mr, [note(author, 'fixed'), note(me, 'nit')], me), 'Needs re-review')
  assert.equal(reviewStatus(mr, [note({ id: 3 }, '+1'), note(me, 'nit')], me), 'Waiting on author')
  assert.equal(reviewStatus(mr, [note(me, 'approved this merge request', true)], me, true), 'Approved')
  // approved: commits and replies do not pull it back
  const approval = note(me, 'approved this merge request', true)
  assert.equal(reviewStatus(mr, [note(author, 'added 3 commits', true), note(author, 'thanks'), approval], me, true), 'Approved')
  // approved: explicit re-request does
  assert.equal(reviewStatus(mr, [note(author, 'requested review from @me', true), approval], me, true), 'Needs re-review')
  assert.equal(reviewStatus(mr, [note(author, 'requested review from @bob and @me', true), approval], me, true), 'Needs re-review')
  assert.equal(reviewStatus(mr, [note(author, 'requested review from @meow', true), approval], me, true), 'Approved')
  // re-request before my approval is old news
  assert.equal(reviewStatus(mr, [approval, note(author, 'requested review from @me', true)], me, true), 'Approved')
  // approval reset by push → no longer approved → new commits mean re-review
  assert.equal(reviewStatus(mr, [note(author, 'added 1 commit', true), approval], me, false), 'Needs re-review')
})

test('myStatus', () => {
  assert.equal(myStatus({ ...mr, draft: true }, [], me), 'Draft')
  assert.equal(myStatus(mr, [], me), 'In review')
  assert.equal(myStatus(mr, [note(author, 'why?'), note(me, 'added 1 commit', true)], me), 'Has feedback')
  assert.equal(myStatus(mr, [note(me, 'done'), note(author, 'why?')], me), 'In review')
  assert.equal(myStatus({ ...mr, detailed_merge_status: 'mergeable' }, [], me), 'Ready to merge')
})

test('parseDiff', () => {
  const rows = parseDiff('@@ -10,3 +10,3 @@ fn\n a\n-b\n+c\n \n\\ No newline at end of file\n')
  assert.deepEqual(rows, [
    { type: 'hunk', text: '@@ -10,3 +10,3 @@ fn' },
    { type: 'ctx', old: 10, new: 10, text: 'a' },
    { type: 'del', old: 11, pos: [11, 11], text: 'b' },
    { type: 'add', new: 11, pos: [12, 11], text: 'c' },
    { type: 'ctx', old: 12, new: 12, text: '' },
  ])
  assert.deepEqual(parseDiff('@@ -0,0 +1 @@\n+x'), [{ type: 'hunk', text: '@@ -0,0 +1 @@' }, { type: 'add', new: 1, pos: [0, 1], text: 'x' }])
  assert.match(lineCode('a.js', rows[3]), /^[0-9a-f]{40}_12_11$/)
  assert.match(lineCode('a.js', rows[1]), /_10_10$/)
})

test('a moved card keeps its column until the MR has new activity', () => {
  const cards = [{ id: 1, status: 'Needs re-review', updatedAt: 't1' }, { id: 2, status: 'Needs re-review', updatedAt: 't3' }]
  const moves = new Map([[1, { status: 'Waiting on author', updatedAt: 't1' }], [2, { status: 'Waiting on author', updatedAt: 't2' }]])
  assert.deepEqual(applyMoves(cards, moves), [2])
  assert.equal(cards[0].status, 'Waiting on author')
  assert.equal(cards[1].status, 'Needs re-review')
})
