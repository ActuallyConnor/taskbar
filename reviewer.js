import { spawn } from 'node:child_process'
import os from 'node:os'

export const reviewPrompt = url => `Act as a senior software engineer conducting a thorough, pragmatic code review.
Analyze the provided code changes and focus strictly on:
1. Potential bugs, logic errors, or null/boundary dereferences
2. Security vulnerabilities (e.g., injection, auth flaws, unsafe data handling)
3. Performance bottlenecks or scalability risks
4. Architectural drift or improper state management

For each finding, use this structure:
- **Severity**: [Critical / Major / Minor]
- **Issue**: Clear explanation of what is wrong and why it matters
- **Fix**: A concrete code snippet or structural suggestion to resolve it

Rules:
- Ignore stylistic nitpicks, variable naming preferences, or formatting unless they directly impair readability or correctness.
- Before you review, read every existing discussion on the merge request (\`glab api --paginate projects/<url-encoded project path>/merge_requests/<iid>/discussions\`), including resolved threads and comments from bots such as Axiom.
- Do not report a finding that a person or bot already raised in a discussion, even if they used different words. If you have something new to add to an existing point, say which thread it belongs to.
- If no critical or major issues are found, explicitly state that the code is clean and safe to merge.
- Conclude with a 3-bullet summary: What changed, core risk level, and main recommendation.
${url}
Use the gl api (the \`glab api\` command) to read the merge request and its diff. Only read; do not change anything in GitLab.`

export const postPrompt = `Turn your findings into inline comments for the merge request. Do not post anything yourself; the app posts them.
Include only findings on a line that is in the MR diff. Reply with only a JSON array in a \`\`\`json code block, no other text:
[{"path": "file path in the new version", "line": 42, "side": "new", "body": "the comment, in markdown"}]
"side" is "new" for an added or unchanged line (line number in the new file), or "old" for a removed line (line number in the old file).`

// The JSON array from the post reply. Throws when the AI did not give one.
export function parseComments(text) {
  // first [ to last ]: a comment body can hold its own ``` code block, so do not cut at the first fence
  const from = text.indexOf('[', Math.max(0, text.indexOf('```json')))
  const json = text.slice(from, text.lastIndexOf(']') + 1)
  let list
  try { list = JSON.parse(json) } catch { throw new Error('The AI did not reply with a list of comments. Try again.') }
  if (!Array.isArray(list)) throw new Error('The AI did not reply with a list of comments. Try again.')
  return list.filter(c => typeof c?.path === 'string' && Number.isInteger(c.line) && typeof c.body === 'string' && c.body.trim())
}

// ponytail: Claude can only run `glab api`; Codex gets a sandbox with network so glab works. Both can still be steered by MR text (prompt injection).
const CODEX_OPTS = ['--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true']

const CLI = {
  claude: session => ['claude', ['-p', '--output-format', 'json', ...(session ? ['--resume', session] : []), '--allowedTools', 'Bash(glab api:*)']],
  codex: session => ['codex', session ? ['exec', 'resume', ...CODEX_OPTS, session, '-'] : ['exec', ...CODEX_OPTS, '-']],
}

export function parse(provider, out) {
  if (provider === 'claude') {
    const r = JSON.parse(out)
    if (r.is_error) throw new Error(r.result || 'Claude failed')
    return { session: r.session_id, text: r.result }
  }
  let session, text
  for (const line of out.split('\n')) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'thread.started') session = e.thread_id
    if (e.type === 'item.completed' && e.item.type === 'agent_message') text = e.item.text
    if (e.type === 'error' || e.type === 'turn.failed') throw new Error(e.message ?? e.error?.message ?? 'Codex failed')
  }
  if (!text) throw new Error('Codex gave no answer')
  return { session, text }
}

// Runs one turn. The prompt goes on stdin. Pass the session from the last turn to continue the chat.
// Pass an AbortSignal to kill the CLI part way through.
export function ask(provider, prompt, session, signal) {
  const [cmd, args] = CLI[provider](session)
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: os.tmpdir(), signal })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', e => reject(e.name === 'AbortError' ? e : new Error(`Cannot start ${cmd}: ${e.message}`)))
    p.on('close', code => {
      try {
        const r = parse(provider, out)
        resolve({ ...r, session: r.session ?? session })
      } catch (e) {
        reject(new Error(code ? `${cmd} exited ${code}: ${err.trim().split('\n').pop() || e.message}` : e.message))
      }
    })
    p.stdin.end(prompt)
  })
}
