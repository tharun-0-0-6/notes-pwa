# Notes Website Project Blueprint

## 1. Project goal
Build a mobile-first notes website that behaves like a lightweight Apple Notes / Google Keep experience, but as a progressive web app (PWA), not a native app.

The app must:
- work smoothly on mobile phones
- also work on laptops and desktops
- support offline note creation and editing
- automatically sync to cloud when online
- allow multiple users with separate note data
- avoid requiring a permanently running personal laptop for hosting
- remain low-cost or free to run
- be easy to extend with future features

---

## 2. Product direction
### Core experience
- Create, open, edit, delete notes quickly
- Works with a single-finger touch interface
- Fast enough to feel smooth on low-end mobile devices
- Offline-first: note updates are stored locally immediately
- Cloud sync happens automatically when internet is available
- Users should not have to log in every time they reopen the app

### Non-goals for v1
- real-time collaborative editing
- team sharing by default
- complex note formatting engine
- advanced AI features
- large attachments system

---

## 3. Key constraints
- Only 4 users at most for initial production usage
- Budget should stay near zero or very low
- No self-hosted laptop/server should be required
- Hosting must be fully managed by cloud services
- The app should support offline behavior on mobile browsers
- It must be installable as a PWA and usable like an app without requiring an App Store

---

## 4. Recommended architecture
### Frontend
- React
- Vite
- TypeScript
- Mobile-first UI
- PWA features

### Offline local storage
- IndexedDB for note storage
- Dexie for ergonomic IndexedDB access
- Service Worker for caching app shell and offline runtime

### Cloud backend
- Supabase Auth
- Supabase Postgres database
- Supabase Row Level Security (RLS)

### Frontend hosting
- Vercel

### Why this stack
This is a good fit because:
- small team / small user count
- no laptop required for backend
- easy free-tier setup
- mobile and desktop compatibility
- PWA support is strong
- quick to extend later

---

## 5. Core system design
### Concept
This app is an offline-first system with a local working copy and a cloud source of truth.

### Rule
- Browser local storage is not the final source of truth
- The cloud database is the source of truth
- Local IndexedDB stores recent notes and unsynced data for offline use
- Sync happens when the network is available

### Data flow
1. User edits a note
2. App saves in IndexedDB immediately
3. App marks note as pending sync
4. Device connects to internet
5. App uploads pending notes to cloud
6. Cloud saves the latest version
7. App clears pending status
8. If conflict exists, resolve by version or newest updated_at

---

## 6. User model
The app must be user-scoped from the beginning.

### User record
- user_id
- email or username
- display_name
- created_at
- last_login_at
- status

### Important rule
Every note must belong to exactly one user.

### Why
This prevents cross-user note overlap and ensures reinstallation restores only the correct user’s notes.

### Authentication behavior
- persistent session using refresh tokens
- no repeated login prompt every time the app opens
- auto session restore on app startup
- silent token refresh if valid

---

## 7. Local storage design
Use IndexedDB instead of localStorage for the actual notes.

### Local store: notes
Each note in IndexedDB should contain:
- id
- user_id
- title
- content
- content_type
- created_at
- updated_at
- version
- deleted_at
- is_archived
- is_pinned
- sync_status
- dirty

### Local store: sync_queue
Each sync record should contain:
- queue_id
- user_id
- note_id
- action
- payload
- created_at
- retry_count
- processed_at

### Local store: settings
- theme
- sort mode
- preview mode
- last opened note

### Why this is needed
- local data remains available offline
- updates are instant
- sync is retried automatically after reconnect

---

## 8. Cloud database design
The cloud database is the real source of truth.

### Users / profiles
- id
- email
- display_name
- created_at

### Notes table
- id
- user_id
- title
- content
- content_type
- created_at
- updated_at
- version
- deleted_at
- is_archived
- is_pinned
- notebook_id
- color
- metadata_json

### Folder / notebook table
- id
- user_id
- name
- parent_id
- created_at

### Tags table
- id
- note_id
- tag_name
- created_at

### Reminders table
- id
- note_id
- remind_at
- is_done
- created_at

### Attachments table
- id
- note_id
- file_name
- storage_path
- mime_type
- created_at

### Sync queue table
- id
- user_id
- note_id
- action
- payload
- created_at
- processed_at

---

## 9. Note schema design for future growth
The app should be built with extensibility in mind.

### Base schema should remain clean and stable
Base fields:
- id
- user_id
- title
- content
- content_type
- created_at
- updated_at
- version
- deleted_at
- is_archived
- is_pinned

### Optional features should be separate or metadata-based
Examples:
- colors
- tags
- reminders
- attachments
- custom folders
- labels
- pinned notes
- search indexing

### Rule for future features
Keep the base note table lean.
Add extra data in separate tables or in optional JSON metadata when appropriate.

This prevents the note table from becoming unmanageable as new features are added.

---

## 10. Sync and conflict strategy
### Preferred approach for small app
- each note has a version number
- each update increments version
- compare version and updated_at during sync
- if local and cloud versions conflict, use newest updated_at

### Why this works
For a small usage group, this is simple and reliable.

### More advanced option later
Use a more formal conflict resolution model if collaboration becomes more complex.

---

## 11. Offline behavior details
### Browser close behavior
Normally, IndexedDB data remains stored after browser close unless the user clears site data.
This is usually enough for “offline note persistence” on mobile and desktop.

### Reinstall behavior
When the user re-adds the PWA after uninstalling:
1. app loads
2. restores session from auth provider
3. asks cloud for notes for current user
4. merges with any local data if still available
5. syncs any remaining pending local changes

### Important design rule
The app should never trust local browser data as the only backup.
Cloud data is the real durable backup.

---

## 12. PWA behavior across devices
### iPhone / iPad
- use Safari to install as home screen PWA
- service worker and IndexedDB work for local storage
- offline app should behave similarly to native app

### Android
- Chrome home screen install works well
- best PWA support among mobile browsers

### Windows
- install from Edge/Chrome as app
- works offline and syncs online

### Important note
The data is per browser profile and per site origin. The user should stay on one browser profile or use the same site identity for continuity.

---

## 13. Hosting model
### Do not self-host on a laptop
This is not reliable for a production-style notes app.

### Use managed services instead
- Frontend hosting: Vercel
- Auth + database: Supabase

### Why
- no need for always-on laptop
- no separate server storage required
- easy to maintain
- free or low-cost for a limited user group

---

## 14. Future feature roadmap
### v1 (MVP)
- user login with persistent session
- create note
- edit note
- delete note
- search notes
- offline save
- cloud sync when online
- installable PWA

### v2
- folders / notebooks
- pin notes
- archive notes
- dark mode
- tags
- note sorting

### v3
- reminders
- attachments
- markdown support
- notebook filters
- improved search

### v4
- collaboration features
- shared notes
- multi-user edit handling
- richer sync conflict resolution

---

## 15. Implementation rules for future AI agents
When continuing this project, follow these rules:

1. Do not replace the architecture with native app logic.
2. Keep the app as a PWA web app.
3. Always use user_id on every note-related record.
4. Treat local IndexedDB as offline cache only.
5. Treat Supabase as the source of truth.
6. Use a sync queue for pending edits.
7. Keep the note schema extensible and clean.
8. Prefer separate tables for new advanced features instead of bloating the notes table.
9. Keep auto-login session behavior persistent.
10. Test across iPhone, Android, and Windows browsers.

---

## 16. Recommended project principle
This project should be designed like a durable data system, not just a UI.

The product is not only a note list; it is:
- offline note capture
- safe local persistence
- cloud recovery
- multi-device continuity
- user-bound data protection
- future extensibility

---

## 17. Final recommendation
The best first implementation is:
- React + Vite + TypeScript PWA
- IndexedDB for offline local writes
- Supabase for auth and data
- Vercel for web hosting
- user-based note ownership
- sync queue + versioning
- extensible schema from the beginning

This approach matches the requirement for a free, mobile-first, smooth, offline-capable notes website that can evolve over time.
