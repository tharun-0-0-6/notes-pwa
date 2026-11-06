export type SyncStatus = 'synced' | 'pending' | 'error'

export type Note = {
  id: string
  user_id: string
  title: string
  content: string
  content_type: 'text'
  created_at: string
  updated_at: string
  version: number
  deleted_at: string | null
  is_archived: boolean
  is_pinned: boolean
  notebook_id: string | null
  color: string
  metadata_json: Record<string, unknown>
  sync_status: SyncStatus
}

export type Notebook = {
  id: string
  user_id: string
  name: string
  parent_id: string | null
  created_at: string
  sync_status: SyncStatus
}

export type SyncQueueItem = {
  queue_id: string
  user_id: string
  note_id: string
  action: 'create' | 'update' | 'delete' | 'restore'
  payload: Record<string, unknown>
  created_at: string
  processed_at: string | null
  retry_count: number
}

export type AppSettings = {
  key: string
  value: string | number | boolean | null
  updated_at: string
}
