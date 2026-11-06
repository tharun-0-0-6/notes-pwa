import { db } from './db'
import { isSupabaseConfigured, supabase } from './supabase'
import type { Note, SyncQueueItem } from '../types'

const activeSyncs = new Map<string, Promise<void>>()

export async function saveNoteLocally(
  note: Note,
  action: SyncQueueItem['action'],
) {
  const queueItem: SyncQueueItem = {
    queue_id: crypto.randomUUID(),
    user_id: note.user_id,
    note_id: note.id,
    action,
    payload: { ...note },
    created_at: new Date().toISOString(),
    processed_at: null,
    retry_count: 0,
  }

  await db.transaction('rw', db.notes, db.syncQueue, async () => {
    await db.notes.put(note)
    await db.syncQueue.put(queueItem)
  })
}

export async function deleteNotebookLocally(
  notebookId: string,
  userId: string,
  notes: Note[],
) {
  const deletedAt = new Date().toISOString()
  const deletedNotes = notes.map((note) => ({
    ...note,
    deleted_at: deletedAt,
    updated_at: deletedAt,
    version: note.version + 1,
    sync_status: 'pending' as const,
  }))

  await db.transaction(
    'rw',
    db.notes,
    db.syncQueue,
    db.notebooks,
    db.settings,
    async () => {
      for (const note of deletedNotes) {
        const queueItem: SyncQueueItem = {
          queue_id: crypto.randomUUID(),
          user_id: userId,
          note_id: note.id,
          action: 'delete',
          payload: { ...note },
          created_at: deletedAt,
          processed_at: null,
          retry_count: 0,
        }
        await db.notes.put(note)
        await db.syncQueue.put(queueItem)
      }

      await db.notebooks.delete(notebookId)
      await db.settings.put({
        key: `deleted-notebook:${notebookId}`,
        value: userId,
        updated_at: deletedAt,
      })
    },
  )

  return deletedNotes
}

async function uploadPendingNotes(userId: string) {
  if (!supabase) {
    return
  }

  const pendingItems = await db.syncQueue
    .where('user_id')
    .equals(userId)
    .filter((item) => item.processed_at === null)
    .sortBy('created_at')

  const itemsByNote = new Map<string, SyncQueueItem[]>()
  for (const item of pendingItems) {
    const noteItems = itemsByNote.get(item.note_id) ?? []
    noteItems.push(item)
    itemsByNote.set(item.note_id, noteItems)
  }

  for (const [noteId, queuedItems] of itemsByNote) {
    const note = await db.notes.get(noteId)
    if (!note || note.user_id !== userId) {
      const error = new Error('Queued note is missing locally or belongs to another user.')
      await Promise.all(
        queuedItems.map((item) =>
          db.syncQueue.update(item.queue_id, { retry_count: item.retry_count + 1 }),
        ),
      )
      console.error('Cannot sync queued note', { noteId, error })
      continue
    }

    try {
      const { error } = await supabase.from('notes').upsert(
        {
          id: note.id,
          user_id: note.user_id,
          title: note.title,
          content: note.content,
          content_type: note.content_type,
          created_at: note.created_at,
          updated_at: note.updated_at,
          version: note.version,
          deleted_at: note.deleted_at,
          is_archived: note.is_archived,
          is_pinned: note.is_pinned,
          notebook_id: note.notebook_id,
          color: note.color,
          metadata_json: note.metadata_json,
        },
        { onConflict: 'id' },
      )

      if (error) {
        throw error
      }

      await db.transaction('rw', db.notes, db.syncQueue, async () => {
        const latestNote = await db.notes.get(noteId)
        if (
          latestNote &&
          latestNote.version === note.version &&
          latestNote.updated_at === note.updated_at
        ) {
          await db.notes.update(noteId, { sync_status: 'synced' })
        }

        for (const item of queuedItems) {
          await db.syncQueue.update(item.queue_id, {
            processed_at: new Date().toISOString(),
          })
        }
      })
    } catch (error) {
      await db.transaction('rw', db.notes, db.syncQueue, async () => {
        const latestNote = await db.notes.get(noteId)
        if (
          latestNote &&
          latestNote.version === note.version &&
          latestNote.updated_at === note.updated_at
        ) {
          await db.notes.update(noteId, { sync_status: 'error' })
        }

        for (const item of queuedItems) {
          await db.syncQueue.update(item.queue_id, {
            retry_count: item.retry_count + 1,
          })
        }
      })
      console.error('Failed to sync note', { noteId, error })
    }
  }
}

async function pullRemoteNotes(userId: string) {
  if (!supabase) {
    return
  }

  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    throw error
  }

  const remoteNotes = (data ?? []) as Omit<Note, 'sync_status'>[]

  for (const remoteNote of remoteNotes) {
    await db.transaction('rw', db.notes, db.syncQueue, async () => {
      const localNote = await db.notes.get(remoteNote.id)
      if (localNote && localNote.user_id !== userId) {
        return
      }

      const localTime = localNote ? Date.parse(localNote.updated_at) : -1
      const remoteTime = Date.parse(remoteNote.updated_at)
      const localIsNewer =
        localNote !== undefined &&
        (localTime > remoteTime ||
          (localTime === remoteTime && localNote.version > remoteNote.version))

      if (localIsNewer) {
        return
      }

      await db.notes.put({
        ...remoteNote,
        sync_status: 'synced',
      })

      const queuedItems = await db.syncQueue
        .where('note_id')
        .equals(remoteNote.id)
        .filter((item) => item.user_id === userId && item.processed_at === null)
        .toArray()

      for (const item of queuedItems) {
        await db.syncQueue.update(item.queue_id, {
          processed_at: new Date().toISOString(),
        })
      }
    })
  }
}

async function pullRemoteNotebooks(userId: string) {
  if (!supabase) {
    return
  }

  const { data, error } = await supabase
    .from('notebooks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  const deletedNotebookSettings = (await db.settings.toArray()).filter(
    (setting) =>
      setting.key.startsWith('deleted-notebook:') &&
      setting.value === userId,
  )
  const deletedNotebookIds = new Set(
    deletedNotebookSettings.map((setting) => setting.key.slice('deleted-notebook:'.length)),
  )
  const remoteNotebookIds = new Set((data ?? []).map((notebook) => notebook.id))

  for (const remoteNotebook of data ?? []) {
    if (deletedNotebookIds.has(remoteNotebook.id)) {
      continue
    }

    const localNotebook = await db.notebooks.get(remoteNotebook.id)
    if (
      (localNotebook && localNotebook.user_id !== userId) ||
      localNotebook?.sync_status === 'pending' ||
      localNotebook?.sync_status === 'error'
    ) {
      continue
    }

    await db.notebooks.put({
      ...remoteNotebook,
      sync_status: 'synced',
    })
  }

  const localNotebooks = await db.notebooks
    .where('user_id')
    .equals(userId)
    .filter((notebook) => notebook.sync_status === 'synced')
    .toArray()
  await Promise.all(
    localNotebooks
      .filter(
        (notebook) =>
          !remoteNotebookIds.has(notebook.id) || deletedNotebookIds.has(notebook.id),
      )
      .map((notebook) => db.notebooks.delete(notebook.id)),
  )
}

async function uploadDeletedNotebooks(userId: string) {
  if (!supabase) {
    return
  }

  const pendingDeletes = (await db.settings.toArray()).filter(
    (setting) =>
      setting.key.startsWith('deleted-notebook:') &&
      setting.value === userId,
  )

  for (const deletion of pendingDeletes) {
    const notebookId = deletion.key.slice('deleted-notebook:'.length)
    try {
      const { error } = await supabase
        .from('notebooks')
        .delete()
        .eq('id', notebookId)
        .eq('user_id', userId)

      if (error) {
        throw error
      }

      await db.settings.delete(deletion.key)
    } catch (error) {
      console.error('Failed to sync notebook deletion', { notebookId, error })
    }
  }
}

async function uploadPendingNotebooks(userId: string) {
  if (!supabase) {
    return
  }

  const pendingNotebooks = await db.notebooks
    .where('user_id')
    .equals(userId)
    .filter((notebook) => notebook.sync_status !== 'synced')
    .toArray()

  for (const notebook of pendingNotebooks) {
    try {
      const { error } = await supabase.from('notebooks').upsert(
        {
          id: notebook.id,
          user_id: notebook.user_id,
          name: notebook.name,
          parent_id: notebook.parent_id,
          created_at: notebook.created_at,
        },
        { onConflict: 'id' },
      )

      if (error) {
        throw error
      }

      const latestNotebook = await db.notebooks.get(notebook.id)
      if (
        latestNotebook &&
        latestNotebook.name === notebook.name &&
        latestNotebook.parent_id === notebook.parent_id
      ) {
        await db.notebooks.update(notebook.id, { sync_status: 'synced' })
      }
    } catch (error) {
      await db.notebooks.update(notebook.id, { sync_status: 'error' })
      console.error('Failed to sync notebook', { notebookId: notebook.id, error })
    }
  }
}

async function runUserSync(userId: string) {
  if (!isSupabaseConfigured || !supabase) {
    return
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) {
    throw error
  }

  if (session?.user.id !== userId) {
    console.error('Cannot sync notes without a matching authenticated user.')
    return
  }

  await pullRemoteNotebooks(userId)
  await uploadDeletedNotebooks(userId)
  await pullRemoteNotebooks(userId)
  await uploadPendingNotebooks(userId)
  await pullRemoteNotebooks(userId)
  await pullRemoteNotes(userId)
  await uploadPendingNotes(userId)
  await pullRemoteNotes(userId)
}

export function syncUserNotes(userId: string) {
  const activeSync = activeSyncs.get(userId)
  if (activeSync) {
    return activeSync
  }

  const sync = runUserSync(userId)
    .catch((error: unknown) => {
      console.error('Failed to sync notes for the signed-in user', error)
    })
    .finally(() => {
      if (activeSyncs.get(userId) === sync) {
        activeSyncs.delete(userId)
      }
    })

  activeSyncs.set(userId, sync)
  return sync
}
