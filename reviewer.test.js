import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './reviewer.js'

test('parse claude', () => {
  assert.deepEqual(parse('claude', '{"session_id":"s1","result":"ok"}'), { session: 's1', text: 'ok' })
  assert.throws(() => parse('claude', '{"is_error":true,"result":"boom"}'), /boom/)
})

test('parse codex', () => {
  const out = [
    '{"type":"thread.started","thread_id":"t1"}',
    'not json',
    '{"type":"item.completed","item":{"type":"command_execution"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}',
  ].join('\n')
  assert.deepEqual(parse('codex', out), { session: 't1', text: 'final' })
  assert.throws(() => parse('codex', '{"type":"turn.failed","error":{"message":"nope"}}'), /nope/)
})
