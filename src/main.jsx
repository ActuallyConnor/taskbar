import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Alert, AppBar, Avatar, Badge, Box, Button, Card, CardActionArea, Chip, Container, CssBaseline, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, Drawer, LinearProgress, Paper, Stack, Tab, Tabs, TextField,
  ThemeProvider, Toolbar, Typography, createTheme,
} from '@mui/material'

const theme = createTheme({ colorSchemes: { dark: true } })

const BOARDS = {
  reviewing: { label: 'Reviewing', columns: ['To review', 'Needs re-review', 'Waiting on author', 'Approved'] },
  mine: { label: 'My MRs', columns: ['Draft', 'In review', 'Has feedback', 'Ready to merge'] },
}
const ALERT = new Set(['Needs re-review', 'Has feedback'])

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
  if (mr.status !== 'Needs re-review') return null
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

function MrCard({ mr, onSelect }) {
  return (
    <Card variant="outlined">
      <CardActionArea onClick={() => onSelect(mr.id)} sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">{mr.ref}</Typography>
        <Typography variant="body2" sx={{ my: 0.5 }}>{mr.title}</Typography>
        <Person user={mr.author}>{mr.author.name} · {when(mr.updatedAt)}</Person>
      </CardActionArea>
    </Card>
  )
}

function Board({ columns, cards, onSelect }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, p: 2, overflowX: 'auto', flex: 1, alignItems: 'flex-start' }}>
      {columns.map(col => {
        const items = cards.filter(c => c.status === col)
        return (
          <Paper key={col} sx={{ width: 300, flexShrink: 0, p: 1.5, bgcolor: ALERT.has(col) ? 'warning.main' : undefined }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2">{col}</Typography>
              <Chip size="small" label={items.length} />
            </Stack>
            <Stack spacing={1}>{items.map(mr => <MrCard key={mr.id} mr={mr} onSelect={onSelect} />)}</Stack>
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

function Sidebar({ mr, details, onClose, onFull, onError }) {
  return (
    <Drawer anchor="right" open={!!mr} onClose={onClose}>
      {mr && (
        <Stack spacing={2} sx={{ width: 380, p: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">{mr.ref}</Typography>
            <Typography variant="h6">{mr.title}</Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip size="small" label={mr.status} color={ALERT.has(mr.status) ? 'warning' : 'default'} />
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
        </Stack>
      )}
    </Drawer>
  )
}

function Thread({ thread }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      {(thread.file || thread.resolvable) && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          {thread.file && <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{thread.file}</Typography>}
          {thread.resolvable && <Chip size="small" label={thread.resolved ? 'Resolved' : 'Open'} color={thread.resolved ? 'success' : 'warning'} />}
        </Stack>
      )}
      <Stack divider={<Divider />} spacing={1}>
        {thread.notes.map(n => (
          <Box key={n.id}>
            <Person user={n.author}>{n.author.name} · {when(n.createdAt)}</Person>
            <Md>{n.body}</Md>
          </Box>
        ))}
      </Stack>
    </Paper>
  )
}

function FullView({ mr, details, onError }) {
  return (
    <Box sx={{ flex: 1, overflow: 'auto' }}>
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="caption" color="text.secondary">{mr.ref}</Typography>
            <Typography variant="h5" gutterBottom>{mr.title}</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip size="small" label={mr.status} color={ALERT.has(mr.status) ? 'warning' : 'default'} />
              <Person user={mr.author} />
              <Box sx={{ flex: 1 }} />
              <ApproveButton mr={mr} onError={onError} />
            </Stack>
          </Box>
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
                {details.threads.length ? details.threads.map(t => <Thread key={t.id} thread={t} />) : <Typography color="text.secondary">No comments.</Typography>}
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

function App() {
  const [state, setState] = useState({})
  const [tab, setTab] = useState('reviewing')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [full, setFull] = useState(false)
  const [details, setDetails] = useState(null)

  const refresh = () => { setLoading(true); window.api.refresh().then(setState).finally(() => setLoading(false)) }
  const select = id => { setDetails(null); setFull(false); setSelectedId(id) }
  const close = () => { setSelectedId(null); setFull(false) }
  useEffect(() => { window.api.onState(setState); window.api.onSelect(select); refresh() }, [])

  const board = state.board
  // look the card up on every render so it follows the board (status changes, merged MRs disappear)
  const mr = board && [...board.reviewing, ...board.mine].find(c => c.id === selectedId)

  // reload threads and approvals when a card opens and after each board refresh
  useEffect(() => {
    if (!mr) return
    let current = true
    window.api.details(mr).then(d => current && setDetails(d), e => current && setDetails({ error: e.message.split('Error: ').pop() }))
    return () => { current = false }
  }, [mr?.id, state.fetchedAt])

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
        </Toolbar>
      </AppBar>
      {loading && <LinearProgress />}
      {state.error && <Alert severity="error">{state.error}</Alert>}
      {actionError && <Alert severity="error" onClose={() => setActionError(null)}>{actionError}</Alert>}
      {showFull
        ? <FullView mr={mr} details={details} onError={setActionError} />
        : board && <Board columns={BOARDS[tab].columns} cards={board[tab]} onSelect={select} />}
      <Sidebar mr={showFull ? null : mr} details={details} onClose={close} onFull={() => setFull(true)} onError={setActionError} />
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
