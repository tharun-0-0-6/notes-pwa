import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import './App.css'
import { db, seedDefaultSettings } from './lib/db'
import { isSupabaseConfigured, normaliseSupabaseUser, supabase, type AppUser } from './lib/supabase'
import { saveNoteLocally, syncUserNotes } from './lib/sync'
import type { Notebook, Note } from './types'

const DEMO_USER_ID = 'demo-user'
const DEMO_USER_NAME = 'Demo user'
type ThemeMode = 'light' | 'dark'
type NoteViewMode = 'list' | 'grid'
type NoteMenuState = {
  noteId: string
  x: number
  y: number
}

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

const createEmptyNotebook = (userId: string, name: string): Notebook => ({
  id: crypto.randomUUID(),
  user_id: userId,
  name,
  parent_id: null,
  created_at: new Date().toISOString(),
  sync_status: 'pending',
})

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="trash-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="m6 7 1 13h10l1-13M9 7V4h6v3" />
    </svg>
  )
}

function App() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null)
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [noteViewMode, setNoteViewMode] = useState<NoteViewMode>('list')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [hasFolderOverflow, setHasFolderOverflow] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())
  const [folders, setFolders] = useState<Notebook[]>([])
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderActionError, setFolderActionError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [noteActionError, setNoteActionError] = useState<string | null>(null)
  const [noteMenu, setNoteMenu] = useState<NoteMenuState | null>(null)
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
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
  const longPressTimerRef = useRef<number | null>(null)
  const suppressNoteClickRef = useRef(false)
  const suppressOutsideNoteClickRef = useRef(false)
  const suppressOutsideNoteClickTimerRef = useRef<number | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const settingsMenuRef = useRef<HTMLDetailsElement | null>(null)
  const navigationDrawerRef = useRef<HTMLElement | null>(null)
  const navigationScrollRef = useRef<HTMLDivElement | null>(null)
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const suppressNewNoteClickRef = useRef(false)
  const suppressNewNoteClickTimerRef = useRef<number | null>(null)
  const suppressMenuClickRef = useRef(false)
  const suppressMenuClickTimerRef = useRef<number | null>(null)
  const themeClassName = theme === 'dark' ? 'theme-dark' : 'theme-light'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#080808' : '#ffffff')
  }, [theme])

  const openNoteMenu = (noteId: string, x: number, y: number) => {
    setNoteMenu({
      noteId,
      x: Math.max(8, Math.min(x, window.innerWidth - 188)),
      y: Math.max(8, Math.min(y, window.innerHeight - 108)),
    })
  }

  const handleNotePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    noteId: string,
  ) => {
    suppressNoteClickRef.current = false
    if (event.pointerType !== 'touch') {
      return
    }

    longPressOriginRef.current = { x: event.clientX, y: event.clientY }
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNoteClickRef.current = true
      openNoteMenu(noteId, event.clientX, event.clientY)
      longPressTimerRef.current = null
    }, 550)
  }

  const cancelNoteLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressOriginRef.current = null
  }

  const handleNotePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const origin = longPressOriginRef.current
    if (
      origin &&
      (Math.abs(event.clientX - origin.x) > 12 || Math.abs(event.clientY - origin.y) > 12)
    ) {
      cancelNoteLongPress()
    }
  }

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !contextMenuRef.current?.contains(event.target)) {
        setNoteMenu(null)
      }
      if (event.target instanceof Node && !settingsMenuRef.current?.contains(event.target)) {
        setSettingsOpen(false)
      }
      if (
        event.target instanceof Node &&
        navigationDrawerRef.current?.classList.contains('is-open') &&
        !navigationDrawerRef.current.contains(event.target)
      ) {
        const tappedNote =
          event.target instanceof Element && event.target.closest('.note-item') !== null
        if (tappedNote) {
          cancelNoteLongPress()
          suppressOutsideNoteClickRef.current = true
          if (suppressOutsideNoteClickTimerRef.current !== null) {
            window.clearTimeout(suppressOutsideNoteClickTimerRef.current)
          }
          suppressOutsideNoteClickTimerRef.current = window.setTimeout(() => {
            suppressOutsideNoteClickRef.current = false
            suppressOutsideNoteClickTimerRef.current = null
          }, 800)
        }
        setNavigationOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNoteMenu(null)
        setRenamingNoteId(null)
        setNavigationOpen(false)
        setSettingsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current)
      }
      if (suppressNewNoteClickTimerRef.current !== null) {
        window.clearTimeout(suppressNewNoteClickTimerRef.current)
      }
      if (suppressMenuClickTimerRef.current !== null) {
        window.clearTimeout(suppressMenuClickTimerRef.current)
      }
      if (suppressOutsideNoteClickTimerRef.current !== null) {
        window.clearTimeout(suppressOutsideNoteClickTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadStoredTheme = async () => {
      await seedDefaultSettings()

      const storedTheme = await db.settings.get('ui-theme')
      const nextTheme = storedTheme?.value === 'dark' ? 'dark' : 'light'
      const storedViewMode = await db.settings.get('note-view-mode')
      const nextViewMode = storedViewMode?.value === 'grid' ? 'grid' : 'list'

      if (active) {
        setTheme(nextTheme)
        setNoteViewMode(nextViewMode)
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
      setFolders([])
      setSelectedId(null)
      setSelectedFolderId(null)
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
      const storedNotebooks = (await db.notebooks.toArray())
        .filter((notebook) => notebook.user_id === currentUser.id)
        .sort((a, b) => a.name.localeCompare(b.name))

      setNotes(userNotes)
      setFolders(storedNotebooks)
      setExpandedFolderIds((previous) =>
        new Set([...previous, ...storedNotebooks.map((notebook) => notebook.id)]),
      )

      if (selectedId && !userNotes.some((note) => note.id === selectedId)) {
        setSelectedId(null)
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
          const storedNotebooks = (await db.notebooks.toArray())
            .filter((notebook) => notebook.user_id === currentUser.id)
            .sort((a, b) => a.name.localeCompare(b.name))
          setNotes(userNotes)
          setFolders(storedNotebooks)
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

  useEffect(() => {
    const scrollArea = navigationScrollRef.current
    if (!scrollArea) {
      return
    }

    const updateOverflow = () => {
      setHasFolderOverflow(scrollArea.scrollHeight > scrollArea.clientHeight + 1)
    }
    const animationFrame = window.requestAnimationFrame(updateOverflow)
    const resizeObserver = new ResizeObserver(updateOverflow)
    resizeObserver.observe(scrollArea)
    scrollArea.querySelectorAll(':scope > *').forEach((child) => resizeObserver.observe(child))
    window.addEventListener('resize', updateOverflow)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateOverflow)
    }
  }, [navigationOpen, folders.length, expandedFolderIds, isCreatingFolder, activeNotes.length])

  const visibleNotes = useMemo(
    () => activeNotes.filter((note) => note.notebook_id === selectedFolderId),
    [activeNotes, selectedFolderId],
  )

  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  )

  const notesByFolder = useMemo(() => {
    const grouped = new Map<string, Note[]>()
    for (const note of activeNotes) {
      if (note.notebook_id) {
        grouped.set(note.notebook_id, [...(grouped.get(note.notebook_id) ?? []), note])
      }
    }
    return grouped
  }, [activeNotes])

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

  const handleNoteViewModeChange = async (nextMode: NoteViewMode) => {
    setNoteViewMode(nextMode)
    await db.settings.put({
      key: 'note-view-mode',
      value: nextMode,
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

  const createNote = async (notebookId: string | null = selectedFolderId) => {
    const userId = currentUser?.id ?? DEMO_USER_ID
    const newNote = createEmptyNote(userId)
    const readyNote: Note = {
      ...newNote,
      notebook_id: notebookId,
      sync_status: 'pending',
    }

    setNoteActionError(null)
    try {
      await saveNoteLocally(readyNote, 'create')
    } catch (error) {
      console.error('Unable to save the new note locally', error)
      setNoteActionError(
        error instanceof Error ? error.message : 'Unable to create a note. Please try again.',
      )
      return
    }

    setNotes((previousNotes) => [readyNote, ...previousNotes])
    setSelectedId(readyNote.id)
    setNavigationOpen(false)

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id)
    }
  }

  const handleCreateFolder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = folderName.trim()
    if (!name) {
      setFolderActionError('Enter a folder name.')
      return
    }
    if (folders.some((folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setFolderActionError('A folder with that name already exists.')
      return
    }

    const notebook = createEmptyNotebook(currentUser?.id ?? DEMO_USER_ID, name)
    setFolderActionError(null)
    try {
      await db.notebooks.put(notebook)
    } catch (error) {
      console.error('Unable to save the folder locally', error)
      setFolderActionError(
        error instanceof Error ? error.message : 'Unable to create the folder. Please try again.',
      )
      return
    }

    setFolders((previousFolders) =>
      [...previousFolders, notebook].sort((a, b) => a.name.localeCompare(b.name)),
    )
    setExpandedFolderIds((previous) => new Set(previous).add(notebook.id))
    setSelectedFolderId(notebook.id)
    setSelectedId(null)
    setFolderName('')
    setIsCreatingFolder(false)

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id).then(async () => {
        const savedNotebook = await db.notebooks.get(notebook.id)
        if (savedNotebook) {
          setFolders((previousFolders) =>
            previousFolders.map((folder) =>
              folder.id === savedNotebook.id ? savedNotebook : folder,
            ),
          )
        }
      })
    }
  }

  const handleNewNoteTouchEnd = () => {
    suppressNewNoteClickRef.current = true
    if (suppressNewNoteClickTimerRef.current !== null) {
      window.clearTimeout(suppressNewNoteClickTimerRef.current)
    }
    suppressNewNoteClickTimerRef.current = window.setTimeout(() => {
      suppressNewNoteClickRef.current = false
      suppressNewNoteClickTimerRef.current = null
    }, 800)
    void createNote()
  }

  const handleNewNoteClick = () => {
    if (suppressNewNoteClickRef.current) {
      suppressNewNoteClickRef.current = false
      if (suppressNewNoteClickTimerRef.current !== null) {
        window.clearTimeout(suppressNewNoteClickTimerRef.current)
        suppressNewNoteClickTimerRef.current = null
      }
      return
    }
    void createNote()
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
    const target = notesRef.current.find((note) => note.id === noteId)

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

    try {
      await saveNoteLocally(updatedNote, 'delete')
    } catch (error) {
      console.error('Unable to delete the note locally', error)
      setNoteActionError(
        error instanceof Error ? error.message : 'Unable to delete this note. Please try again.',
      )
      return
    }

    const nextNotes = notesRef.current.filter((note) => note.id !== noteId)
    notesRef.current = nextNotes
    setNotes(nextNotes)

    if (selectedId === noteId) {
      setSelectedId(null)
    }

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id)
    }
  }

  const beginRename = (noteId: string) => {
    const noteToRename = notesRef.current.find((note) => note.id === noteId)
    if (noteToRename) {
      setRenameValue(noteToRename.title)
      setRenamingNoteId(noteToRename.id)
    }
    setNoteMenu(null)
  }

  const activateNoteMenuAction = (action: 'rename' | 'delete', noteId: string) => {
    if (action === 'rename') {
      beginRename(noteId)
    } else {
      void handleDelete(noteId)
      setNoteMenu(null)
    }
  }

  const handleNoteMenuActionTouchEnd = (
    event: React.TouchEvent<HTMLButtonElement>,
    action: 'rename' | 'delete',
    noteId: string,
  ) => {
    event.stopPropagation()
    suppressMenuClickRef.current = true
    if (suppressMenuClickTimerRef.current !== null) {
      window.clearTimeout(suppressMenuClickTimerRef.current)
    }
    suppressMenuClickTimerRef.current = window.setTimeout(() => {
      suppressMenuClickRef.current = false
      suppressMenuClickTimerRef.current = null
    }, 800)
    activateNoteMenuAction(action, noteId)
  }

  const handleNoteMenuActionClick = (action: 'rename' | 'delete', noteId: string) => {
    if (suppressMenuClickRef.current) {
      suppressMenuClickRef.current = false
      if (suppressMenuClickTimerRef.current !== null) {
        window.clearTimeout(suppressMenuClickTimerRef.current)
        suppressMenuClickTimerRef.current = null
      }
      return
    }
    activateNoteMenuAction(action, noteId)
  }

  const handleRename = async (noteId: string, title: string) => {
    const target = notesRef.current.find((note) => note.id === noteId)
    if (!target) {
      return
    }

    const updatedNote: Note = {
      ...target,
      title,
      updated_at: new Date().toISOString(),
      version: target.version + 1,
      sync_status: 'pending',
    }

    try {
      await saveNoteLocally(updatedNote, 'update')
    } catch (error) {
      console.error('Unable to rename the note locally', error)
      setNoteActionError(
        error instanceof Error ? error.message : 'Unable to rename this note. Please try again.',
      )
      return
    }

    const nextNotes = notesRef.current
      .map((note) => note.id === noteId ? updatedNote : note)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    notesRef.current = nextNotes
    setNotes(nextNotes)
    if (selectedId === noteId) {
      setDraftTitle(title)
      pendingDraftRef.current = null
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
    }
    setRenamingNoteId(null)

    if (navigator.onLine && isSupabaseConfigured && currentUser) {
      void syncUserNotes(currentUser.id)
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
      <div className="auth-shell theme-dark">
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
      <div className="auth-shell theme-dark">
        <div className="auth-card compact">
          <p>Loading your notes...</p>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className={`app-shell ${themeClassName} ${selectedNote ? 'mobile-note-open' : ''}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Offline-first notes</p>
          <h1>{selectedFolderId ? folderNameById.get(selectedFolderId) ?? 'General Notes' : 'General Notes'}</h1>
        </div>

        <div className="topbar-actions">
          <label className="view-select-wrap">
            <span className="visually-hidden">Note layout</span>
            <select
              className="view-select"
              aria-label="Note layout"
              value={noteViewMode}
              onChange={(event) =>
                void handleNoteViewModeChange(event.target.value === 'grid' ? 'grid' : 'list')
              }
            >
              <option value="list">☰ List</option>
              <option value="grid">▦ Tiles</option>
            </select>
          </label>
          <button
            type="button"
            className="navigation-toggle"
            aria-label={navigationOpen ? 'Close sidebar' : 'Open sidebar'}
            aria-expanded={navigationOpen}
            aria-controls="navigation-drawer"
            onClick={() => {
              setSettingsOpen(false)
              setNavigationOpen((open) => !open)
            }}
          >
            <span className="hamburger-icon" aria-hidden="true"><i /><i /><i /></span>
          </button>
          <button type="button" className="primary-button" onClick={() => void createNote()}>
            + New note
          </button>
        </div>
      </header>

      {navigationOpen ? (
        <div className="navigation-backdrop" aria-hidden="true" />
      ) : null}
      <aside
        ref={navigationDrawerRef}
        id="navigation-drawer"
        className={`navigation-drawer ${navigationOpen ? 'is-open' : ''}`}
        aria-label="Notes navigation"
        aria-hidden={!navigationOpen}
      >
        <div className="navigation-drawer-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Folders</h2>
          </div>
          <button
            type="button"
            className="navigation-close"
            aria-label="Close sidebar"
            onClick={() => setNavigationOpen(false)}
          >
            ×
          </button>
        </div>
        <div
          ref={navigationScrollRef}
          className={`navigation-scroll-area ${hasFolderOverflow ? 'has-folder-overflow' : ''}`}
        >
          <button
            type="button"
            className={`navigation-general ${selectedFolderId === null ? 'is-selected' : ''}`}
            onClick={() => {
              setSelectedFolderId(null)
              setSelectedId(null)
              setNavigationOpen(false)
            }}
          >
            <span aria-hidden="true">⌂</span>
            <span>General Notes</span>
            <span className="navigation-count">{activeNotes.filter((note) => !note.notebook_id).length}</span>
          </button>
          <div className="navigation-section-title">
            <span>Folders</span>
            <button
              type="button"
              className="navigation-add-folder"
              aria-label="Create folder"
              title="Create folder"
              onClick={() => {
                setFolderActionError(null)
                setIsCreatingFolder(true)
              }}
            >
              +
            </button>
          </div>
          {isCreatingFolder ? (
            <form className="folder-create-form" onSubmit={(event) => void handleCreateFolder(event)}>
              <input
                autoFocus
                aria-label="New folder name"
                placeholder="Folder name"
                value={folderName}
                maxLength={80}
                onChange={(event) => setFolderName(event.target.value)}
              />
              <button type="submit" className="primary-button">Create</button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setIsCreatingFolder(false)
                  setFolderName('')
                  setFolderActionError(null)
                }}
              >
                Cancel
              </button>
            </form>
          ) : null}
          {folderActionError ? <p className="folder-error" role="alert">{folderActionError}</p> : null}
          {folders.length === 0 && !isCreatingFolder ? (
            <p className="navigation-empty">Your folders will appear here.</p>
          ) : null}
          {folders.map((folder) => {
            const folderNotes = notesByFolder.get(folder.id) ?? []
            const isExpanded = expandedFolderIds.has(folder.id)
            return (
              <div className="navigation-folder" key={folder.id}>
                <div className="navigation-folder-row">
                  <button
                    type="button"
                    className={`navigation-folder-select ${selectedFolderId === folder.id ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelectedFolderId(folder.id)
                      setSelectedId(null)
                      setNavigationOpen(false)
                    }}
                  >
                    <span className="navigation-folder-icon" aria-hidden="true">▰</span>
                    <span className="navigation-folder-name">{folder.name}</span>
                    {folder.sync_status === 'error' ? (
                      <span className="folder-sync-error" title="Folder sync needs attention">!</span>
                    ) : null}
                    <span className="navigation-count">{folderNotes.length}</span>
                  </button>
                  <button
                    type="button"
                    className="navigation-folder-action"
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${folder.name}`}
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedFolderIds((previous) => {
                      const next = new Set(previous)
                      if (next.has(folder.id)) {
                        next.delete(folder.id)
                      } else {
                        next.add(folder.id)
                      }
                      return next
                    })}
                  >
                    {isExpanded ? '⌄' : '›'}
                  </button>
                  <button
                    type="button"
                    className="navigation-folder-action"
                    aria-label={`Create note in ${folder.name}`}
                    title={`Create note in ${folder.name}`}
                    onClick={() => void createNote(folder.id)}
                  >
                    +
                  </button>
                </div>
                {isExpanded ? (
                  <div className="navigation-folder-notes">
                    {folderNotes.length === 0 ? (
                      <span className="navigation-empty-note">No notes yet</span>
                    ) : folderNotes.map((note) => (
                      <button
                        type="button"
                        key={note.id}
                        className={`navigation-note ${selectedId === note.id ? 'is-selected' : ''}`}
                        onClick={() => {
                          setSelectedFolderId(folder.id)
                          setSelectedId(note.id)
                          setNavigationOpen(false)
                        }}
                      >
                        <span aria-hidden="true">▤</span>
                        <span>{note.title || 'Untitled note'}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="navigation-settings-footer">
          <details
            ref={settingsMenuRef}
            className="settings-menu navigation-settings"
            open={settingsOpen}
            onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
          >
            <summary
              aria-label="Settings"
              title="Settings"
              onClick={(event) => {
                event.preventDefault()
                setSettingsOpen((open) => !open)
              }}
            >
              <span aria-hidden="true">⚙️</span>
              <span>Settings</span>
              <span className="settings-chevron" aria-hidden="true">⌃</span>
            </summary>
            <div className="settings-panel">
              <div className="settings-row">
                <span>Appearance</span>
                <button
                  type="button"
                  className="secondary-button theme-icon-button"
                  onClick={() => void handleThemeToggle()}
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {theme === 'dark' ? '☀️' : '🌙'}
                </button>
              </div>
              <div className="settings-row">
                <span>Connection</span>
                <span
                  className={`connection-indicator ${online ? 'online' : 'offline'}`}
                  role="status"
                  aria-label={online ? 'Online' : 'Offline'}
                  title={online ? 'Online' : 'Offline'}
                >
                  {online ? '🟢' : '🟠'}
                </span>
              </div>
              <button
                type="button"
                className="secondary-button settings-sign-out"
                onClick={() => {
                  setSettingsOpen(false)
                  setNavigationOpen(false)
                  void handleSignOut()
                }}
              >
                Sign out
              </button>
            </div>
          </details>
        </div>
      </aside>

      {noteActionError ? (
        <p className="app-error" role="alert">{noteActionError}</p>
      ) : null}

      <div
        className={[
          'workspace',
          `view-${noteViewMode}`,
          selectedNote ? 'note-open' : '',
        ].filter(Boolean).join(' ')}
      >
        <aside className="sidebar">
          <div className="sidebar-header">
            <strong>{currentUser?.name ?? DEMO_USER_NAME}</strong>
            <span>{syncLabel}</span>
          </div>

          <div className={`note-list ${noteViewMode === 'grid' ? 'grid-view' : 'list-view'}`}>
            {visibleNotes.length === 0 ? (
              <div className="empty-state">
                <p>No notes yet</p>
                <button type="button" className="secondary-button" onClick={() => void createNote()}>
                  Create one
                </button>
              </div>
            ) : (
              visibleNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={[
                    'note-item',
                    selectedId === note.id ? 'selected' : '',
                    noteMenu?.noteId === note.id ? 'context-open' : '',
                  ].filter(Boolean).join(' ')}
                  onPointerDown={(event) => handleNotePointerDown(event, note.id)}
                  onPointerMove={handleNotePointerMove}
                  onPointerUp={cancelNoteLongPress}
                  onPointerCancel={cancelNoteLongPress}
                  onClickCapture={(event) => {
                    if (suppressOutsideNoteClickRef.current) {
                      suppressOutsideNoteClickRef.current = false
                      if (suppressOutsideNoteClickTimerRef.current !== null) {
                        window.clearTimeout(suppressOutsideNoteClickTimerRef.current)
                        suppressOutsideNoteClickTimerRef.current = null
                      }
                      event.preventDefault()
                      event.stopPropagation()
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openNoteMenu(note.id, event.clientX, event.clientY)
                  }}
                  onClick={(event) => {
                    if (suppressNoteClickRef.current) {
                      suppressNoteClickRef.current = false
                      event.preventDefault()
                      return
                    }
                    setSelectedId(note.id)
                  }}
                >
                  <span className="note-item-title">
                    {note.title || 'Untitled note'}
                  </span>
                  {noteViewMode === 'grid' ? (
                    <span className="note-item-preview">
                      {note.content.trim() || 'No additional text'}
                    </span>
                  ) : null}
                  <span className="note-item-details">
                    <span className="note-item-meta">
                      {new Date(note.updated_at).toLocaleDateString()}
                    </span>
                    <span className="note-item-state">{note.sync_status}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="editor-panel">
          {selectedNote ? (
            <>
              <div className="editor-header">
                <button
                  type="button"
                  className="secondary-button editor-back"
                  onClick={() => setSelectedId(null)}
                >
                  Back to notes
                </button>
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
                  aria-label="Delete note"
                  title="Delete note"
                >
                  <TrashIcon />
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
    {createPortal(
      <>
        {noteMenu ? (
          <div
            ref={contextMenuRef}
            className={`note-context-menu ${themeClassName}`}
            role="menu"
            aria-label="Note options"
            style={{ left: noteMenu.x, top: noteMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              onTouchEnd={(event) =>
                handleNoteMenuActionTouchEnd(event, 'rename', noteMenu.noteId)
              }
              onClick={() => handleNoteMenuActionClick('rename', noteMenu.noteId)}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className="note-context-delete"
              aria-label="Delete note"
              title="Delete note"
              onTouchEnd={(event) =>
                handleNoteMenuActionTouchEnd(event, 'delete', noteMenu.noteId)
              }
              onClick={() => handleNoteMenuActionClick('delete', noteMenu.noteId)}
            >
              <TrashIcon />
            </button>
          </div>
        ) : null}
        {renamingNoteId ? (
          <div
            className="rename-dialog-backdrop"
            onClick={() => setRenamingNoteId(null)}
          >
            <form
              className={`rename-dialog ${themeClassName}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="rename-dialog-title"
              onSubmit={(event) => {
                event.preventDefault()
                void handleRename(renamingNoteId, renameValue)
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="rename-dialog-title">Rename note</h2>
              <label htmlFor="rename-note-input">Note title</label>
              <input
                id="rename-note-input"
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                maxLength={200}
              />
              <div className="rename-dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setRenamingNoteId(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button">Save</button>
              </div>
            </form>
          </div>
        ) : null}
        <button
          type="button"
          className={`mobile-new-note ${themeClassName} ${selectedNote ? 'is-hidden' : ''}`}
          onTouchEnd={handleNewNoteTouchEnd}
          onClick={handleNewNoteClick}
          aria-label="Create a new note"
          title="Create a new note"
        >
          +
        </button>
      </>,
      document.body,
    )}
    </>
  )
}

export default App
