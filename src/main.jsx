import { Fragment, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightRows, langOf } from './highlight.js'
import CheckIcon from '@mui/icons-material/Check'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import NotificationsIcon from '@mui/icons-material/Notifications'
import {
  Alert, AppBar, Avatar, Badge, Box, Button, ButtonGroup, Card, CardActionArea, Checkbox, Chip, CircularProgress, Container, CssBaseline, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, Drawer, FormControlLabel, IconButton, LinearProgress, List, ListItem, ListItemButton, ListItemText, Paper, Popover, Stack, Tab, Tabs, TextField,
  ThemeProvider, Toolbar, Typography, createTheme,
} from '@mui/material'

const theme = createTheme({ colorSchemes: { dark: true } })

const BOARDS = {
  reviewing: { label: 'Reviewing', columns: ['To review', 'AI reviewed', 'Needs re-review', 'Waiting on author', 'Approved'] },
  mine: { label: 'My MRs', columns: ['Draft', 'In review', 'Has feedback', 'Ready to merge'] },
}
const ALERT = new Set(['Needs re-review', 'Has feedback'])
// columns drawn in orange; Needs re-review still counts in the badge, it just is not coloured
const COLOURED = new Set(['Has feedback'])

const when = iso => new Date(iso).toLocaleString()

// No raw HTML (react-markdown default), links open in the browser.
// ponytail: GitLab upload images use relative, logged-in URLs, so they do not load here.
function Md({ children }) {
  return (
    <Box sx={{ '& p': { my: 1 }, '& img': { maxWidth: '100%' }, '& pre': { p: 1, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 1 }, '& code': { fontSize: '0.85em' } }}>
      <Markdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}>
        {children}
      </Markdown>
    </Box>
  )
}

function Person({ user, size = 20, children }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Avatar src={user.avatar} alt={user.name} sx={{ width: size, height: size }} />
      <Typography variant="caption" color="text.secondary">{children ?? user.name}</Typography>
    </Stack>
  )
}

function ApproveButton({ mr, onError }) {
  const [approving, setApproving] = useState(false)
  // approvedByMe is only set on Reviewing cards; "My MRs" cards leave it undefined (you cannot approve your own MR)
  if (mr.approvedByMe !== false) return null
  const approve = () => {
    setApproving(true)
    window.api.approveMr(mr).catch(e => onError(`Approve failed: ${e.message.split('Error: ').pop()}`)).finally(() => setApproving(false))
  }
  return (
    <Button size="small" variant="contained" color="success" onClick={approve} disabled={approving}>
      {approving ? 'Approving…' : 'Approve'}
    </Button>
  )
}

function ReviewButtons({ mr, review, onError, onStarted }) {
  const start = provider => window.api.startReview(mr, provider).then(onStarted, e => onError(`AI review failed: ${e.message.split('Error: ').pop()}`))
  return (
    <ButtonGroup size="small" disabled={!!review?.busy}>
      <Button onClick={() => start('claude')}>AI review: Claude</Button>
      <Button onClick={() => start('codex')}>Codex</Button>
    </ButtonGroup>
  )
}

function ReviewChat({ mr, review }) {
  const [question, setQuestion] = useState('')
  if (!review) return null
  const send = e => {
    e.preventDefault()
    window.api.askReview(mr, question)
    setQuestion('')
  }
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h6">AI review ({review.provider})</Typography>
          {review.busy && <CircularProgress size={18} />}
        </Stack>
        {review.messages.map((m, i) => m.role === 'user'
          ? <Box key={i} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', alignSelf: 'flex-end' }}><Typography variant="body2">{m.text}</Typography></Box>
          : <Md key={i}>{m.text}</Md>)}
        {review.busy && <Typography variant="body2" color="text.secondary">{review.messages.length ? 'Thinking…' : 'Reviewing… this can take a few minutes.'}</Typography>}
        {review.error && <Alert severity="error">{review.error}</Alert>}
        {review.session && (
          <form onSubmit={send}>
            <TextField fullWidth size="small" placeholder="Ask about the review" value={question}
              onChange={e => setQuestion(e.target.value)} disabled={review.busy} />
          </form>
        )}
      </Stack>
    </Paper>
  )
}

function Reviewers({ mr, details }) {
  if (!mr.reviewers.length) return <Typography variant="body2" color="text.secondary">No reviewers</Typography>
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {mr.reviewers.map(r => {
        const approved = details?.approvedBy?.includes(r.id)
        return (
          <Chip key={r.id} size="small" avatar={<Avatar src={r.avatar} alt={r.name} />}
            label={approved ? `✓ ${r.name}` : r.name} color={approved ? 'success' : 'default'} />
        )
      })}
    </Stack>
  )
}

function MrCard({ mr, onSelect, review }) {
  return (
    <Card variant="outlined" draggable onDragStart={e => e.dataTransfer.setData('text/plain', String(mr.id))}>
      <CardActionArea onClick={() => onSelect(mr.id)} sx={{ p: 1.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">{mr.ref}</Typography>
          {review?.busy
            ? <CircularProgress size={14} titleAccess="AI review running" />
            : review?.messages.length > 0 && (
              <Box title="AI reviewed" sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: 'success.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckIcon sx={{ fontSize: 14, color: 'common.white' }} />
              </Box>
            )}
        </Stack>
        <Typography variant="body2" sx={{ my: 0.5 }}>{mr.title}</Typography>
        <Person user={mr.author}>{mr.author.name} · {when(mr.updatedAt)}</Person>
      </CardActionArea>
    </Card>
  )
}

// "To review" splits in two: an MR you ran an AI review on, but have not commented on in GitLab yet, gets its own column.
// Once you comment, GitLab status moves it on as usual.
const column = (mr, review) => mr.status === 'To review' && review?.messages.length > 0 ? 'AI reviewed' : mr.status

// Drag a card to another column when the computed status is wrong. It stays there until the MR has new activity.
function Board({ columns, cards, onSelect, reviews, onError }) {
  const [over, setOver] = useState(null)
  const drop = (e, col) => {
    setOver(null)
    const id = Number(e.dataTransfer.getData('text/plain'))
    if (cards.some(c => c.id === id)) window.api.move(id, col).catch(e => onError(`Move failed: ${errText(e)}`))
  }
  return (
    <Box sx={{ display: 'flex', gap: 2, p: 2, overflowX: 'auto', flex: 1, alignItems: 'flex-start' }}>
      {columns.map(col => {
        const items = cards.filter(c => column(c, reviews[c.id]) === col)
        return (
          <Paper key={col} sx={{ width: 300, flexShrink: 0, p: 1.5, bgcolor: COLOURED.has(col) ? 'warning.main' : undefined, outline: over === col ? 2 : 0, outlineColor: 'primary.main' }}
            {...(col !== 'AI reviewed' && { onDragOver: e => (e.preventDefault(), setOver(col)), onDragLeave: () => setOver(null), onDrop: e => drop(e, col) })}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2">{col}</Typography>
              <Chip size="small" label={items.length} />
            </Stack>
            <Stack spacing={1}>{items.map(mr => <MrCard key={mr.id} mr={mr} onSelect={onSelect} review={reviews[mr.id]} />)}</Stack>
          </Paper>
        )
      })}
    </Box>
  )
}

function Activity({ details }) {
  if (!details) return <Typography variant="body2" color="text.secondary">Loading…</Typography>
  if (details.error) return <Alert severity="error">{details.error}</Alert>
  const comments = details.threads.reduce((n, t) => n + t.notes.length, 0)
  const open = details.threads.filter(t => t.resolvable && !t.resolved).length
  return <Typography variant="body2">{comments} comments · {open} open threads</Typography>
}

function Sidebar({ mr, details, review, onClose, onFull, onError }) {
  return (
    <Drawer anchor="right" open={!!mr} onClose={onClose}>
      {mr && (
        <Stack spacing={2} sx={{ width: 380, p: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">{mr.ref}</Typography>
            <Typography variant="h6">{mr.title}</Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip size="small" label={column(mr, review)} color={COLOURED.has(mr.status) ? 'warning' : 'default'} />
            <Person user={mr.author} />
          </Stack>
          <Box>
            <Typography variant="subtitle2" gutterBottom>Reviewers</Typography>
            <Reviewers mr={mr} details={details} />
          </Box>
          <Activity details={details} />
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={onFull}>Full view</Button>
            <Button size="small" onClick={() => window.open(mr.url)}>Open in browser</Button>
            <ApproveButton mr={mr} onError={onError} />
          </Stack>
          <ReviewButtons mr={mr} review={review} onError={onError} onStarted={onFull} />
        </Stack>
      )}
    </Drawer>
  )
}

function Thread({ thread, inline, children }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      {((!inline && thread.file) || thread.resolvable) && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          {!inline && thread.file && <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{thread.file}</Typography>}
          {thread.resolvable && <Chip size="small" label={thread.resolved ? 'Resolved' : 'Open'} color={thread.resolved ? 'success' : 'warning'} />}
        </Stack>
      )}
      {inline && thread.position?.lineRange && (
        <Typography variant="caption" color="text.secondary">Comment on lines {thread.position.lineRange.join(' to ')}</Typography>
      )}
      <Stack divider={<Divider />} spacing={1}>
        {thread.notes.map(n => (
          <Box key={n.id}>
            <Person user={n.author}>{n.author.name} · {when(n.createdAt)}</Person>
            <Md>{n.body}</Md>
          </Box>
        ))}
      </Stack>
      {children}
    </Paper>
  )
}

const errText = e => e.message.split('Error: ').pop()

// Text box for a new comment or a reply. Cmd+Enter sends, like GitHub.
function Composer({ submit, onDone, onCancel, onError, label = 'Comment', placeholder = 'Leave a comment' }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const send = () => {
    if (!body.trim() || busy) return
    setBusy(true)
    submit(body).then(() => { setBody(''); onDone() }, e => onError(`Comment failed: ${errText(e)}`)).finally(() => setBusy(false))
  }
  return (
    <Stack spacing={1}>
      <TextField multiline minRows={onCancel ? 3 : 1} size="small" fullWidth placeholder={placeholder} value={body} autoFocus={!!onCancel}
        onChange={e => setBody(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && send()} />
      {(onCancel || body) && (
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button size="small" onClick={() => (setBody(''), onCancel?.())}>Cancel</Button>
          <Button size="small" variant="contained" onClick={send} disabled={!body.trim() || busy}>{busy ? 'Sending…' : label}</Button>
        </Stack>
      )}
    </Stack>
  )
}

function InlineThread({ mr, thread, onChanged, onError, inline = true }) {
  const [busy, setBusy] = useState(false)
  const toggle = () => {
    setBusy(true)
    window.api.resolve(mr, thread.id, !thread.resolved).then(onChanged, e => onError(`Resolve failed: ${errText(e)}`)).finally(() => setBusy(false))
  }
  return (
    <Thread thread={thread} inline={inline}>
      <Stack spacing={1} sx={{ mt: 1 }}>
        <Composer label="Reply" placeholder="Reply…" submit={body => window.api.reply(mr, thread.id, body)} onDone={onChanged} onError={onError} />
        {thread.resolvable && (
          <Box><Button size="small" onClick={toggle} disabled={busy}>{thread.resolved ? 'Unresolve conversation' : 'Resolve conversation'}</Button></Box>
        )}
      </Stack>
    </Thread>
  )
}

// GitHub-style colors; the alpha works on both light and dark backgrounds
const ROW_BG = { add: 'rgba(46,160,67,0.15)', del: 'rgba(248,81,73,0.15)', hunk: 'rgba(56,139,253,0.1)' }
const NUM_BG = { add: 'rgba(46,160,67,0.3)', del: 'rgba(248,81,73,0.3)' }
const SIGN = { add: '+', del: '-', ctx: ' ' }

// GitHub's syntax colors for highlight.js classes
const tokenColors = c => ({
  '& .hljs-keyword, & .hljs-doctag, & .hljs-template-tag, & .hljs-type, & .hljs-variable.language_': { color: c.keyword },
  '& .hljs-title, & .hljs-title.class_, & .hljs-title.function_': { color: c.title },
  '& .hljs-attr, & .hljs-attribute, & .hljs-literal, & .hljs-meta, & .hljs-number, & .hljs-operator, & .hljs-variable, & .hljs-selector-attr, & .hljs-selector-class, & .hljs-selector-id': { color: c.constant },
  '& .hljs-regexp, & .hljs-string, & .hljs-meta .hljs-string': { color: c.string },
  '& .hljs-built_in, & .hljs-symbol': { color: c.builtin },
  '& .hljs-comment, & .hljs-code, & .hljs-formula': { color: c.comment },
  '& .hljs-name, & .hljs-quote, & .hljs-selector-tag, & .hljs-selector-pseudo, & .hljs-section': { color: c.tag },
})
const LIGHT_TOKENS = tokenColors({ keyword: '#cf222e', title: '#8250df', constant: '#0550ae', string: '#0a3069', builtin: '#953800', comment: '#6e7781', tag: '#116329' })
const DARK_TOKENS = tokenColors({ keyword: '#ff7b72', title: '#d2a8ff', constant: '#79c0ff', string: '#a5d6ff', builtin: '#ffa657', comment: '#8b949e', tag: '#7ee787' })
const rowKey = r => r.type === 'del' ? `o${r.old}` : `n${r.new}`
const lineLabel = r => r.type === 'del' ? `L${r.old}` : `R${r.new}` // GitHub's names: L = old side, R = new side
const SELECTED_BG = 'rgba(187,128,9,0.25)'
const threadKey = p => p.newLine ? `n${p.newLine}` : `o${p.oldLine}`
const diffStat = f => ({ add: f.rows.filter(r => r.type === 'add').length, del: f.rows.filter(r => r.type === 'del').length })

function DiffStat({ file }) {
  const { add, del } = diffStat(file)
  return (
    <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
      <Box component="span" sx={{ color: 'success.main' }}>+{add}</Box> <Box component="span" sx={{ color: 'error.main' }}>−{del}</Box>
    </Typography>
  )
}

const numCell = type => ({ width: '1%', minWidth: 48, px: 1, textAlign: 'right', color: 'text.secondary', userSelect: 'none', bgcolor: NUM_BG[type] })

function FileDiff({ id, mr, refs, file, threads, viewed, onViewed, onChanged, onError }) {
  const [open, setOpen] = useState(!viewed)
  // selected rows for a new comment: a = row where you started, b = row where you stopped. Drag the + or shift-click to make a range.
  const [draft, setDraft] = useState(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) return
    const up = () => setDragging(false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [dragging])
  // a range must stay inside one hunk; GitLab cannot place it across hidden lines
  const extend = i => setDraft(d => d && !file.rows.slice(Math.min(d.a, i), Math.max(d.a, i) + 1).some(r => r.type === 'hunk') ? { ...d, b: i } : d)
  const pick = (i, e) => {
    e.preventDefault() // no text selection while dragging
    if (e.shiftKey && draft) return extend(i)
    setDraft({ a: i, b: i })
    setDragging(true)
  }
  const html = useMemo(() => highlightRows(file.rows, langOf(file.newPath)), [file])
  const lo = draft && Math.min(draft.a, draft.b)
  const hi = draft && Math.max(draft.a, draft.b)
  useEffect(() => setOpen(!viewed), [viewed]) // marking a file viewed folds it, like GitHub
  // a thread made on an older push may point at lines that moved; show it above the diff as outdated
  const current = threads.filter(t => t.position.headSha === refs.head_sha)
  const outdated = threads.filter(t => t.position.headSha !== refs.head_sha)
  const byRow = Object.groupBy(current, t => threadKey(t.position))
  const thread = props => <InlineThread mr={mr} onChanged={onChanged} onError={onError} {...props} />
  return (
    <Paper variant="outlined" id={id} sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ position: 'sticky', top: 0, zIndex: 2, alignItems: 'center', px: 1, py: 0.5, bgcolor: 'background.paper', borderBottom: open ? 1 : 0, borderColor: 'divider' }}>
        <IconButton size="small" onClick={() => setOpen(!open)}>{open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}</IconButton>
        <DiffStat file={file} />
        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>
          {file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : file.newPath}
        </Typography>
        {file.status !== 'modified' && <Chip size="small" variant="outlined" label={file.status} />}
        {threads.length > 0 && <Chip size="small" label={`${threads.length} 💬`} />}
        <FormControlLabel sx={{ mr: 0 }} label={<Typography variant="body2">Viewed</Typography>}
          control={<Checkbox size="small" checked={viewed} onChange={e => onViewed(e.target.checked)} />} />
      </Stack>
      {open && (
        <>
          {outdated.length > 0 && <Stack spacing={1} sx={{ p: 1 }}>{outdated.map(t => (
            <Box key={t.id}><Chip size="small" label={`Outdated · line ${t.position.newLine ?? t.position.oldLine}`} sx={{ mb: 0.5 }} />{thread({ thread: t })}</Box>
          ))}</Stack>}
          {file.tooLarge || !file.rows.length ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              {file.tooLarge ? 'This diff is too large to show.' : 'No text changes (binary, empty or mode change only).'}
            </Typography>
          ) : (
            <Box component="table" sx={theme => ({ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 12, lineHeight: '20px', '& td': { p: 0, verticalAlign: 'top' }, ...LIGHT_TOKENS, ...theme.applyStyles('dark', DARK_TOKENS) })}>
              <tbody>
                {file.rows.map((r, i) => r.type === 'hunk' ? (
                  <Box component="tr" key={i} sx={{ bgcolor: ROW_BG.hunk, color: 'text.secondary' }}>
                    <Box component="td" colSpan={3} sx={{ px: 1, py: 0.5 }}>{r.text}</Box>
                  </Box>
                ) : (
                  <Fragment key={i}>
                    <Box component="tr" onMouseEnter={() => dragging && extend(i)}
                      sx={{ bgcolor: draft && i >= lo && i <= hi ? SELECTED_BG : ROW_BG[r.type], '&:hover .add-comment': { visibility: 'visible' } }}>
                      <Box component="td" sx={{ ...numCell(r.type), cursor: 'pointer' }} onMouseDown={e => pick(i, e)}>{r.old}</Box>
                      <Box component="td" sx={{ ...numCell(r.type), cursor: 'pointer' }} onMouseDown={e => pick(i, e)}>{r.new}</Box>
                      <Box component="td" sx={{ position: 'relative', pl: 3, pr: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        <IconButton className="add-comment" title="Add a comment on this line. Drag to select more lines; shift-click to extend." onMouseDown={e => pick(i, e)}
                          sx={{ visibility: 'hidden', position: 'absolute', left: 0, top: 0, width: 20, height: 20, borderRadius: 1, fontSize: 14, color: 'common.white', bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } }}>+</IconButton>
                        <Box component="span" sx={{ userSelect: 'none', mr: 1 }}>{SIGN[r.type]}</Box>
                        {/* hljs escapes the code and adds only <span class> tags, so this HTML is safe */}
                        {html[i] !== undefined ? <span dangerouslySetInnerHTML={{ __html: html[i] }} /> : r.text}
                      </Box>
                    </Box>
                    {(byRow[rowKey(r)] || (i === hi && !dragging)) && (
                      <tr>
                        <Box component="td" colSpan={3} sx={{ typography: 'body2', p: '8px !important', borderTop: 1, borderBottom: 1, borderColor: 'divider' }}>
                          <Stack spacing={1} sx={{ maxWidth: 900 }}>
                            {byRow[rowKey(r)]?.map(t => <Fragment key={t.id}>{thread({ thread: t })}</Fragment>)}
                            {i === hi && !dragging && (
                              <Paper variant="outlined" sx={{ p: 1.5 }}>
                                {lo !== hi && (
                                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                                    Commenting on lines {lineLabel(file.rows[lo])} to {lineLabel(r)}
                                  </Typography>
                                )}
                                <Composer label="Add comment" onCancel={() => setDraft(null)} onError={onError}
                                  submit={body => window.api.comment(mr, { refs, oldPath: file.oldPath, newPath: file.newPath, start: file.rows[lo], end: r, body })}
                                  onDone={() => { setDraft(null); onChanged() }} />
                              </Paper>
                            )}
                          </Stack>
                        </Box>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Box>
          )}
        </>
      )}
    </Paper>
  )
}

// "Viewed" marks live in this browser only, keyed by MR. A file's mark holds its diff hash, so a new change to the file clears it.
// ponytail: entries for merged MRs are never cleaned up; they are tiny.
function useViewed(mrId) {
  const key = `viewed:${mrId}`
  const [viewed, setViewed] = useState(() => { try { return JSON.parse(localStorage.getItem(key)) ?? {} } catch { return {} } })
  const set = (path, hash) => setViewed(old => {
    const next = { ...old, [path]: hash }
    if (!hash) delete next[path]
    try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
    return next
  })
  return [viewed, set]
}

function Changes({ mr, details, onChanged, onError }) {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('')
  const [viewed, setViewed] = useViewed(mr.id)
  useEffect(() => {
    let current = true
    window.api.changes(mr).then(d => current && setData(d), e => current && setData({ error: errText(e) }))
    return () => { current = false }
  }, [mr.id, mr.updatedAt])
  if (!data) return <LinearProgress />
  if (data.error) return <Alert severity="error">{data.error}</Alert>

  const threadsFor = f => details?.threads?.filter(t => t.position?.path === f.newPath) ?? []
  const isViewed = f => viewed[f.newPath] === f.hash
  const total = data.files.reduce((s, f) => { const d = diffStat(f); return { add: s.add + d.add, del: s.del + d.del } }, { add: 0, del: 0 })
  const shown = data.files.map((f, i) => ({ f, i })).filter(({ f }) => f.newPath.toLowerCase().includes(filter.toLowerCase()))
  return (
    <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <Box sx={{ width: 300, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ p: 1 }}>
          <TextField size="small" fullWidth placeholder="Filter changed files" value={filter} onChange={e => setFilter(e.target.value)} />
          <Typography variant="caption" color="text.secondary">
            {data.files.filter(isViewed).length} / {data.files.length} files viewed
          </Typography>
        </Box>
        <List dense sx={{ overflow: 'auto', flex: 1 }}>
          {shown.map(({ f, i }) => {
            const slash = f.newPath.lastIndexOf('/')
            return (
              <ListItemButton key={f.newPath} onClick={() => document.getElementById(`file-${i}`)?.scrollIntoView()} sx={{ opacity: isViewed(f) ? 0.5 : 1 }}>
                <ListItemText primary={f.newPath.slice(slash + 1)} secondary={f.newPath.slice(0, slash + 1) || null}
                  slotProps={{ primary: { sx: { fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' } }, secondary: { sx: { wordBreak: 'break-all' } } }} />
                {isViewed(f) && <CheckIcon fontSize="small" color="success" />}
              </ListItemButton>
            )
          })}
        </List>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {data.files.length} files changed, <Box component="span" sx={{ color: 'success.main' }}>+{total.add}</Box> <Box component="span" sx={{ color: 'error.main' }}>−{total.del}</Box>
        </Typography>
        {shown.map(({ f, i }) => (
          <FileDiff key={f.newPath} id={`file-${i}`} mr={mr} refs={data.refs} file={f} threads={threadsFor(f)}
            viewed={isViewed(f)} onViewed={on => setViewed(f.newPath, on && f.hash)} onChanged={onChanged} onError={onError} />
        ))}
      </Box>
    </Box>
  )
}

function FullView({ mr, details, review, onError, onChanged }) {
  const [tab, setTab] = useState('overview')
  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ flex: 1 }}>
          <Tab value="overview" label="Overview" />
          <Tab value="files" label="Files changed" />
        </Tabs>
        <ApproveButton mr={mr} onError={onError} />
      </Stack>
      {tab === 'files' ? <Changes mr={mr} details={details} onChanged={onChanged} onError={onError} /> : <Overview mr={mr} details={details} review={review} onChanged={onChanged} onError={onError} />}
    </Box>
  )
}

function Overview({ mr, details, review, onChanged, onError }) {
  return (
    <Box sx={{ flex: 1, overflow: 'auto' }}>
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="caption" color="text.secondary">{mr.ref}</Typography>
            <Typography variant="h5" gutterBottom>{mr.title}</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip size="small" label={column(mr, review)} color={COLOURED.has(mr.status) ? 'warning' : 'default'} />
              <Person user={mr.author} />
              <Box sx={{ flex: 1 }} />
              {review?.busy && <CircularProgress size={18} titleAccess="AI review running" />}
              <ReviewButtons mr={mr} review={review} onError={onError} />
            </Stack>
          </Box>
          <ReviewChat mr={mr} review={review} />
          <Box>
            <Typography variant="subtitle2" gutterBottom>Reviewers</Typography>
            <Reviewers mr={mr} details={details} />
          </Box>
          <Paper variant="outlined" sx={{ p: 2 }}>
            {mr.description ? <Md>{mr.description}</Md> : <Typography color="text.secondary">No description.</Typography>}
          </Paper>
          <Box>
            <Typography variant="h6" gutterBottom>Comments</Typography>
            {details?.threads ? (
              <Stack spacing={2}>
                {details.threads.length ? details.threads.map(t => <InlineThread key={t.id} mr={mr} thread={t} inline={false} onChanged={onChanged} onError={onError} />) : <Typography color="text.secondary">No comments.</Typography>}
                <Composer submit={body => window.api.note(mr, body)} onDone={onChanged} onError={onError} />
              </Stack>
            ) : <Activity details={details} />}
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

function Settings({ open, onClose }) {
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => { if (open) window.api.getConfig().then(c => setHost(c.host)) }, [open])
  const save = () => window.api.saveConfig({ host, token }).then(() => { setToken(''); setError(null); onClose() }, e => setError(e.message))
  return (
    <Dialog open={open} onClose={onClose} fullWidth>
      <DialogTitle>GitLab connection</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="GitLab URL" value={host} onChange={e => setHost(e.target.value)} />
          <TextField label="Personal access token" type="password" value={token} onChange={e => setToken(e.target.value)}
            helperText="Needs the api scope to approve (read_api can only view). It is stored encrypted on this computer." />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}

function Notifications({ onOpen }) {
  const [items, setItems] = useState([])
  const [anchor, setAnchor] = useState(null)
  useEffect(() => { window.api.onNotifications(setItems); window.api.getNotifications().then(setItems) }, [])
  const open = n => { setAnchor(null); onOpen(n.mrId) }
  return (
    <>
      <IconButton color="inherit" onClick={e => setAnchor(e.currentTarget)} title="Notifications">
        <Badge color="warning" badgeContent={items.length}><NotificationsIcon /></Badge>
      </IconButton>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ width: 380, maxHeight: 500, display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1 }}>
            <Typography variant="subtitle2">Notifications</Typography>
            <Button size="small" onClick={() => window.api.clearNotifications()} disabled={!items.length}>Clear all</Button>
          </Stack>
          <Divider />
          {items.length ? (
            <List dense sx={{ overflow: 'auto' }}>
              {items.map(n => (
                <ListItem key={n.id} disablePadding secondaryAction={
                  <IconButton edge="end" size="small" title="Clear" onClick={() => window.api.clearNotifications(n.id)}><CloseIcon fontSize="small" /></IconButton>
                }>
                  <ListItemButton onClick={() => open(n)}>
                    <ListItemText primary={n.title} secondary={<>{n.body.split('\n')[0]}<br />{when(n.at)}</>} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          ) : <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No notifications.</Typography>}
        </Box>
      </Popover>
    </>
  )
}

function App() {
  const [state, setState] = useState({})
  const [tab, setTab] = useState('reviewing')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [full, setFull] = useState(false)
  const [details, setDetails] = useState(null)
  const [reviews, setReviews] = useState({})
  const [detailsTick, setDetailsTick] = useState(0) // bump to reload threads after you comment

  const refresh = () => { setLoading(true); window.api.refresh().then(setState).finally(() => setLoading(false)) }
  const select = id => { setDetails(null); setFull(false); setSelectedId(id) }
  const openFull = id => { select(id); setFull(true) }
  const close = () => { setSelectedId(null); setFull(false) }
  useEffect(() => { window.api.onState(setState); window.api.onSelect(openFull); window.api.onReviews(setReviews); window.api.getReviews().then(setReviews); refresh() }, [])

  // Back/forward: each change of tab, open card or full view is a history entry; mouse buttons 4/5 walk it.
  useEffect(() => {
    const nav = { tab, selectedId, full }
    const cur = history.state
    if (!cur) history.replaceState(nav, '')
    else if (cur.tab !== tab || cur.selectedId !== selectedId || cur.full !== full) history.pushState(nav, '')
  }, [tab, selectedId, full])
  useEffect(() => {
    const onPop = e => {
      if (!e.state) return
      if (e.state.selectedId !== selectedId) setDetails(null)
      setTab(e.state.tab); setSelectedId(e.state.selectedId); setFull(e.state.full)
    }
    const onMouse = e => { if (e.button === 3) history.back(); else if (e.button === 4) history.forward() }
    window.addEventListener('popstate', onPop)
    window.addEventListener('mouseup', onMouse)
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('mouseup', onMouse) }
  }, [selectedId])

  const board = state.board
  // look the card up on every render so it follows the board (status changes, merged MRs disappear)
  const mr = board && [...board.reviewing, ...board.mine].find(c => c.id === selectedId)

  // reload threads and approvals when a card opens and after each board refresh
  useEffect(() => {
    if (!mr) return
    let current = true
    window.api.details(mr).then(d => current && setDetails(d), e => current && setDetails({ error: e.message.split('Error: ').pop() }))
    return () => { current = false }
  }, [mr?.id, state.fetchedAt, detailsTick])

  const alertCount = key => board?.[key].filter(c => ALERT.has(c.status)).length ?? 0
  const showFull = full && mr

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static">
        <Toolbar>
          {showFull ? (
            <>
              <Button color="inherit" onClick={close}>← Board</Button>
              <Typography variant="subtitle1" noWrap sx={{ flex: 1, mx: 2 }}>{mr.title}</Typography>
              <Button color="inherit" onClick={() => window.open(mr.url)}>Open in browser</Button>
            </>
          ) : (
            <>
              <Tabs value={tab} onChange={(_e, v) => setTab(v)} textColor="inherit" sx={{ flex: 1 }}>
                {Object.entries(BOARDS).map(([key, b]) => (
                  <Tab key={key} value={key} label={<Badge color="warning" badgeContent={alertCount(key)} sx={{ pr: 1.5 }}>{b.label}</Badge>} />
                ))}
              </Tabs>
              {state.fetchedAt && <Typography variant="caption" sx={{ mr: 2 }}>Updated {new Date(state.fetchedAt).toLocaleTimeString()}</Typography>}
              <Button color="inherit" onClick={refresh} disabled={loading}>Refresh</Button>
              <Button color="inherit" onClick={() => setSettingsOpen(true)}>Settings</Button>
            </>
          )}
          <Notifications onOpen={openFull} />
        </Toolbar>
      </AppBar>
      {loading && <LinearProgress />}
      {state.error && <Alert severity="error">{state.error}</Alert>}
      {actionError && <Alert severity="error" onClose={() => setActionError(null)}>{actionError}</Alert>}
      {showFull
        ? <FullView key={mr.id} mr={mr} details={details} review={reviews[mr.id]} onError={setActionError} onChanged={() => setDetailsTick(t => t + 1)} />
        : board && <Board columns={BOARDS[tab].columns} cards={board[tab]} onSelect={select} reviews={reviews} onError={setActionError} />}
      <Sidebar mr={showFull ? null : mr} details={details} review={mr && reviews[mr.id]} onClose={close} onFull={() => setFull(true)} onError={setActionError} />
      <Settings open={settingsOpen || !!state.needsConfig} onClose={() => setSettingsOpen(false)} />
    </Box>
  )
}

createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>
)
