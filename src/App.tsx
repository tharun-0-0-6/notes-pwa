import { useEffect, useMemo, useRef, useState } from 'react'

import './App.css'
import { db, seedDefaultSettings } from './lib/db'
import { isSupabaseConfigured, normaliseSupabaseUser, supabase, type AppUser } from './lib/supabase'
import { saveNoteLocally, syncUserNotes } from './lib/sync'
import type { Note } from './types'

const DEMO_USER_ID = 'demo-user'
const DEMO_USER_NAME = 'Demo user'
type ThemeMode = 'light' | 'dark'

const createEmptyNote = (userId: string): Note => {
  const now = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    user_id: userId,
    title: 'Untitled note',
    content: '',
    content_type: 'text',
    created_at: now,
    updated_at: now,
    version: 1,
    deleted_at: null,
    is_archived: false,
    is_pinned: false,
    notebook_id: null,
    color: '#f7f7f7',
    metadata_json: {},
    sync_status: 'pending',
  }
}

function App() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null)
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [isHydrating, setIsHydrating] = useState(true)
  const saveTimeoutRef = useRef<number | null>(null)
  const notesRef = useRef<Note[]>([])
  const pendingDraftRef = useRef<Note | null>(null)
  const themeClassName = theme === 'dark' ? 'theme-dark' : 'theme-light'

  useEffect(() => {
    let active = true

    const loadStoredTheme = async () => {
      await seedDefaultSettings()

      const storedTheme = await db.settings.get('ui-theme')
      const nextTheme = storedTheme?.value === 'dark' ? 'dark' : 'light'

      if (active) {
        setTheme(nextTheme)
      }
    }

    void loadStoredTheme()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const authClient = supabase

    if (!isSupabaseConfigured || !authClient) {
      setCurrentUser({
        id: DEMO_USER_ID,
        email: 'demo@local',
        name: DEMO_USER_NAME,
      })
      setIsHydrating(false)
      return () => {
        active = false
      }
    }

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setCurrentUser(normaliseSupabaseUser(session?.user ?? null))
      }
    })

    const restoreSession = async () => {
      try {
        const {
          data: { session },
          error,
        } = await authClient.auth.getSession()

        if (error) {
          throw error
        }

        if (active) {
          setCurrentUser(normaliseSupabaseUser(session?.user ?? null))
        }
      } catch (error) {
        if (active) {
          setAuthError(
            error instanceof Error ? error.message : 'Unable to restore your session.',
          )
        }
      } finally {
        if (active) {
          setIsHydrating(false)
        }
      }
    }

    void restoreSession()

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!currentUser) {
      setNotes([])
      setSelectedId(null)
      return
    }

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) {
      setNotes([])
      setSelectedId(null)
      return
    }

    const loadNotes = async () => {
      await seedDefaultSettings()

      if (navigator.onLine && isSupabaseConfigured) {
        await syncUserNotes(currentUser.id)
      }

      const storedNotes = await db.notes.toArray()
      const userNotes = storedNotes
        .filter((note) => note.user_id === currentUser.id)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

      setNotes(userNotes)

      if (userNotes.length > 0 && !selectedId) {
        setSelectedId(userNotes[0].id)
      }

      if (selectedId && !userNotes.some((note) => note.id === selectedId)) {
        setSelectedId(userNotes[0]?.id ?? null)
      }
    }

    void loadNotes()
  }, [currentUser, selectedId])

  useEffect(() => {
    const handleOnlineStatus = () => {
      setOnline(navigator.onLine)
      if (navigator.onLine && currentUser) {
        void syncUserNotes(currentUser.id).then(async () => {
          const storedNotes = await db.notes.toArray()
          const userNotes = storedNotes
            .filter((note) => note.user_id === currentUser.id)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          setNotes(userNotes)
        })
      }
    }

    window.addEventListener('online', handleOnlineStatus)
    window.addEventListener('offline', handleOnlineStatus)

    if (navigator.onLine && currentUser) {
      handleOnlineStatus()
    }

    return () => {
      window.removeEventListener('online', handleOnlineStatus)
      window.removeEventListener('offline', handleOnlineStatus)
    }
  }, [currentUser])

  const activeNotes = useMemo(
    () => notes.filter((note) => !note.deleted_at),
    [notes],
  )

  const selectedNote = useMemo(
    () => activeNotes.find((note) => note.id === selectedId) ?? null,
    [activeNotes, selectedId],
  )

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  useEffect(() => {
    if (!selectedId) {
      setDraftTitle('')
      setDraftContent('')
      return
    }

    if (selectedNote) {
      setDraftTitle(selectedNote.title)
      setDraftContent(selectedNote.content)
    } else {
      setDraftTitle('')
      setDraftContent('')
    }
  }, [selectedId])

  const syncLabel = !online
    ? 'Offline mode active'
    : isSupabaseConfigured
      ? notes.some((note) => note.sync_status === 'error')
        ? 'Sync needs attention'
        : notes.some((note) => note.sync_status === 'pending')
          ? 'Changes waiting to sync'
          : 'Synced to cloud'
      : 'Demo mode / cloud pending'

  const handleThemeToggle = async () => {
    const nextTheme: ThemeMode = theme === 'light' ? 'dark' : 'light'

    setTheme(nextTheme)
    await db.settings.put({
      key: 'ui-theme',
      value: nextTheme,
      updated_at: new Date().toISOString(),
    })
  }

  const saveNote = async (nextNote: Note) => {
    const latestStored = notesRef.current.find((note) => note.id === nextNote.id)

    if (
      latestStored &&
      (latestStored.version > nextNote.version ||
        (latestStored.version === nextNote.version && latestStored.updated_at > nextNote.updated_at))
    ) {
      return
    }

    const updatedNote: Note = {
      ...nextNote,
      updated_at: new Date().toISOString(),
      sync_status: 'pending',
    }

    await saveNoteLocally(updatedNote, 'update')

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      await syncUserNotes(currentUser.id)
    }

    const savedNote = (await db.notes.get(updatedNote.id)) ?? updatedNote
    setNotes((previousNotes) => {
      const current = previousNotes.find((note) => note.id === savedNote.id)

      if (
        current &&
        (current.version > savedNote.version ||
          (current.version === savedNote.version && current.updated_at > savedNote.updated_at))
      ) {
        return previousNotes
      }

      const nextNotes = previousNotes
        .map((note) => (note.id === savedNote.id ? savedNote : note))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

      notesRef.current = nextNotes
      return nextNotes
    })
  }

  const createNote = async () => {
    const userId = currentUser?.id ?? DEMO_USER_ID
    const newNote = createEmptyNote(userId)
    const readyNote: Note = {
      ...newNote,
      sync_status: 'pending',
    }

    await saveNoteLocally(readyNote, 'create')

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      await syncUserNotes(currentUser.id)
    }

    const savedNote = (await db.notes.get(readyNote.id)) ?? readyNote
    setNotes((previousNotes) => [savedNote, ...previousNotes])
    setSelectedId(readyNote.id)
  }

  const persistNoteChange = (nextNote: Note) => {
    pendingDraftRef.current = nextNote

    notesRef.current = notesRef.current.map((note) =>
      note.id === nextNote.id ? nextNote : note,
    )

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      const latestDraft = pendingDraftRef.current
      if (!latestDraft) {
        return
      }

      const currentStored = notesRef.current.find((note) => note.id === latestDraft.id)
      if (currentStored && currentStored.version > latestDraft.version) {
        pendingDraftRef.current = null
        return
      }

      pendingDraftRef.current = null
      void saveNote(latestDraft)
    }, 180)
  }

  const handleTitleChange = (value: string) => {
    if (!selectedId) {
      return
    }

    const currentNote = notesRef.current.find((note) => note.id === selectedId)

    if (!currentNote) {
      return
    }

    const updatedNote: Note = {
      ...currentNote,
      title: value,
      updated_at: new Date().toISOString(),
      version: currentNote.version + 1,
      sync_status: 'pending',
    }

    setDraftTitle(value)
    persistNoteChange(updatedNote)
  }

  const handleContentChange = (value: string) => {
    if (!selectedId) {
      return
    }

    const currentNote = notesRef.current.find((note) => note.id === selectedId)

    if (!currentNote) {
      return
    }

    const updatedNote: Note = {
      ...currentNote,
      content: value,
      updated_at: new Date().toISOString(),
      version: currentNote.version + 1,
      sync_status: 'pending',
    }

    setDraftContent(value)
    persistNoteChange(updatedNote)
  }

  const handleDelete = async (noteId: string) => {
    const target = notes.find((note) => note.id === noteId)

    if (!target) {
      return
    }

    const updatedNote: Note = {
      ...target,
      deleted_at: new Date().toISOString(),
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
      version: target.version + 1,
    }

    await saveNoteLocally(updatedNote, 'delete')

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      await syncUserNotes(currentUser.id)
    }

    const nextNotes = notes
      .map((note) => (note.id === noteId ? updatedNote : note))
      .filter((note) => !note.deleted_at)

    setNotes(nextNotes)

    if (selectedId === noteId) {
      setSelectedId(nextNotes[0]?.id ?? null)
    }
  }

  const handleCloudSignIn = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setCurrentUser({
        id: DEMO_USER_ID,
        email: 'demo@local',
        name: DEMO_USER_NAME,
      })
      setAuthError(null)
      return
    }

    setAuthLoading(true)
    setAuthError(null)
    setAuthNotice(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        throw error
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Unable to sign in right now.',
      )
    } finally {
      setAuthLoading(false)
    }
  }

  const handleCloudSignUp = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setCurrentUser({
        id: DEMO_USER_ID,
        email: 'demo@local',
        name: DEMO_USER_NAME,
      })
      setAuthError(null)
      return
    }

    setAuthLoading(true)
    setAuthError(null)
    setAuthNotice(null)

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      })

      if (error) {
        throw error
      }

      if (!data.session) {
        setAuthNotice('Account created. Check your email to confirm your address, then sign in.')
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Unable to create account right now.',
      )
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSignOut = async () => {
    if (supabase && isSupabaseConfigured) {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setAuthError(error.message)
        return
      }
    }

    setCurrentUser(null)
    setEmail('')
    setPassword('')
    setAuthError(null)
    setAuthNotice(null)
  }

  if (!currentUser && !isHydrating) {
    return (
      <div className={`auth-shell ${themeClassName}`}>
        <div className="auth-card">
          <p className="eyebrow">Persistent session ready</p>
          <h1>Welcome back</h1>

          <p className="auth-note">
            {isSupabaseConfigured
              ? 'Sign in to restore your synced notes.'
              : 'Cloud is not configured yet, so we are using the local demo mode.'}
          </p>

          <label className="field-label">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="field-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>

          {authError ? <p className="auth-error">{authError}</p> : null}
          {authNotice ? <p className="auth-note" role="status">{authNotice}</p> : null}

          <div className="auth-actions">
            <button type="button" className="secondary-button" onClick={() => void handleThemeToggle()}>
              {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            </button>
            <button type="button" className="primary-button" onClick={handleCloudSignIn} disabled={authLoading}>
              {authLoading ? 'Please wait...' : 'Sign in'}
            </button>
            <button type="button" className="secondary-button" onClick={handleCloudSignUp} disabled={authLoading}>
              Create account
            </button>
            {!isSupabaseConfigured ? (
              <button type="button" className="secondary-button" onClick={() => setCurrentUser({
                id: DEMO_USER_ID,
                email: 'demo@local',
                name: DEMO_USER_NAME,
              })}>
                Continue in demo mode
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (isHydrating) {
    return (
      <div className={`auth-shell ${themeClassName}`}>
        <div className="auth-card compact">
          <p>Loading your notes...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`app-shell ${themeClassName}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Offline-first notes</p>
          <h1>Notes</h1>
        </div>

        <div className="topbar-actions">
          <button type="button" className="secondary-button" onClick={() => void handleThemeToggle()}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <span className={`status-pill ${online ? 'online' : 'offline'}`}>
            {online ? 'Online' : 'Offline'}
          </span>
          <button type="button" className="secondary-button" onClick={handleSignOut}>
            Sign out
          </button>
          <button type="button" className="primary-button" onClick={createNote}>
            + New note
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <strong>{currentUser?.name ?? DEMO_USER_NAME}</strong>
            <span>{syncLabel}</span>
          </div>

          <div className="note-list">
            {activeNotes.length === 0 ? (
              <div className="empty-state">
                <p>No notes yet</p>
                <button type="button" className="secondary-button" onClick={createNote}>
                  Create one
                </button>
              </div>
            ) : (
              activeNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={`note-item ${selectedId === note.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(note.id)}
                >
                  <span className="note-item-title">
                    {note.title || 'Untitled note'}
                  </span>
                  <span className="note-item-meta">
                    {new Date(note.updated_at).toLocaleDateString()}
                  </span>
                  <span className="note-item-state">{note.sync_status}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="editor-panel">
          {selectedNote ? (
            <>
              <div className="editor-header">
                <input
                  aria-label="Note title"
                  value={draftTitle}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  placeholder="Untitled note"
                />

                <button
                  type="button"
                  className="danger-button"
                  onClick={() => handleDelete(selectedNote.id)}
                >
                  Delete
                </button>
              </div>

              <textarea
                aria-label="Note content"
                value={draftContent}
                onChange={(event) => handleContentChange(event.target.value)}
                placeholder="Write your note..."
              />

              <div className="editor-footer">
                <span className="meta-label">User:</span>
                <span>{currentUser?.name ?? DEMO_USER_NAME}</span>
                <span className="meta-label">Updated:</span>
                <span>{new Date(selectedNote.updated_at).toLocaleString()}</span>
                <span className="meta-label">Sync:</span>
                <span>{selectedNote.sync_status}</span>
              </div>
            </>
          ) : (
            <div className="empty-editor">
              <h2>Select a note</h2>
              <p>Your notes will appear here once they are created.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
