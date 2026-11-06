import Dexie, { type Table } from 'dexie'

import type { AppSettings, Notebook, Note, SyncQueueItem } from '../types'

class NotesDatabase extends Dexie {
  notes!: Table<Note, string>
  notebooks!: Table<Notebook, string>
  syncQueue!: Table<SyncQueueItem, string>
  settings!: Table<AppSettings, string>

  constructor() {
    super('notes-website-db')

    this.version(1).stores({
      notes:
        '&id, user_id, updated_at, sync_status, deleted_at, is_archived, is_pinned, notebook_id',
      syncQueue: '&queue_id, note_id, user_id, created_at',
      settings: '&key, updated_at',
    })

    this.version(2).stores({
      notes:
        '&id, user_id, updated_at, sync_status, deleted_at, is_archived, is_pinned, notebook_id',
      notebooks: '&id, user_id, parent_id, created_at, sync_status',
      syncQueue: '&queue_id, note_id, user_id, created_at',
      settings: '&key, updated_at',
    })
  }
}

export const db = new NotesDatabase()

export async function seedDefaultSettings() {
  await db.transaction('rw', db.settings, async () => {
    const savedTheme = await db.settings.get('ui-theme')
    const defaultMigration = await db.settings.get('ui-theme-night-default-migrated')
    const now = new Date().toISOString()

    if (!defaultMigration) {
      if (!savedTheme || savedTheme.value === 'light') {
        await db.settings.put({
          key: 'ui-theme',
          value: 'dark',
          updated_at: now,
        })
      }

      await db.settings.put({
        key: 'ui-theme-night-default-migrated',
        value: true,
        updated_at: now,
      })
    } else if (!savedTheme) {
      await db.settings.put({
        key: 'ui-theme',
        value: 'dark',
        updated_at: now,
      })
    }
  })
}
