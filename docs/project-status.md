# Project Status and Resume Notes

## Current status
This project is now in the implementation baseline phase. The app foundation has been created, the PWA structure is configured, and the local offline note model is in place.

### Recent update
- React + TypeScript project scaffolded in the workspace
- required frontend dependencies installed
- Vite PWA configuration added for installable web app behavior
- mobile-first note interface created
- IndexedDB-based offline note storage introduced
- typed note and queue models created for future sync expansion
- Supabase client setup created with persistent session config
- local Supabase environment config present and the notes REST endpoint responded successfully to a no-data connectivity check
- Supabase auth session restore now reports failures and correctly cleans up its auth-state subscription
- sign-up explains when email confirmation is required, and sign-out errors are surfaced
- auth-ready login screen added for cloud and demo mode fallback
- user-scoped note loading logic added to prepare for multi-account behavior
- Supabase schema SQL prepared for profiles, notes, notebooks, tags, reminders, attachments, and sync queue
- note editing flow debugged and fixed to prevent stale queued saves from overwriting live typing text
- stale draft/version guard implemented so older save snapshots no longer replace newer note content
- note writes and sync-queue entries are saved in one IndexedDB transaction
- authenticated sync pulls remote notes, uploads the latest local note per queue, and retries failed writes on the next sync
- timestamp/version conflict resolution and per-user sync serialization are implemented
- sync status reflects pending and failed uploads instead of claiming they already reached the cloud
- app build verified successfully after the final sync stability fix
- local dev server started for testing
- manual browser check confirmed the app loads and the notes editor remains stable while typing
- persistent dark/light theme toggle added and verified in the browser
- production deployment checklist added, covering Vercel configuration, Supabase environment variables, RLS inspection, account-isolation testing, and post-deployment checks
- offline note creation and editing verified in a browser with networking disabled; the note remained in IndexedDB after reload
- production PWA service worker verified to serve the app shell after an offline reload
- dedicated Supabase test account used to verify sign-in persistence across reloads
- authenticated cloud round trip verified: a test note was uploaded, restored after clearing local IndexedDB, edited offline, synced after reconnect, and restored from cloud again
- temporary test notes were soft-deleted, a fresh cloud pull showed no active test notes, and the test account was signed out
- existing Vercel production deployment confirmed Ready at `https://notes-pwa-bice.vercel.app/`, sourced from the `main` branch
- deployed HTTPS app shell verified at desktop and mobile viewport sizes; the production service worker served the app after an offline reload
- production login layout checked at 360px, 390px, 768px, and 1366px viewport widths with no horizontal overflow; deployed PWA manifest and service worker endpoints returned successfully
- production app, manifest, service-worker, and icon endpoints returned successfully; physical iOS/Android installation is still pending because this environment has no connected mobile device or ADB bridge
- mobile app navigation now starts on the notes home and opens a full-screen editor only after selecting a note; a back control returns home
- persistent List/Tiles layout preference added for desktop and mobile, with responsive note previews in tile mode
- tile cards have a consistent minimum height and keep date/sync status pinned to the bottom even when note content is empty
- refreshed dark mode with black surfaces and orange accents across app controls, menus, editor, and PWA browser chrome; light mode now uses white surfaces, with mobile scrollbars hidden while preserving scrolling
- dark neutral surfaces now use neutral borders (orange fill remains on primary action buttons); delete actions are red trash-can controls, and the Settings panel closes when leaving its menu area or interacting elsewhere
- added a hamburger navigation drawer with General Notes and folder-specific note hierarchies; Settings stays pinned below the independently scrollable, gradient-faded folder list
- folders are saved locally for offline use and synced through the existing Supabase notebooks table; folder-created notes retain their notebook assignment
- browser checks verified folder creation, creating notes inside a folder, selecting a nested note, Settings placement/auto-close, and full-height mobile drawer sizing
- the drawer gradient now appears only when the folder list overflows; mobile Settings spans the drawer width, and outside taps pass through to the underlying control while closing the drawer
- taps on note cards outside an open drawer now dismiss the drawer without also opening the note; the following tap opens it normally
- verified on a mobile viewport: tapping the exposed part of a note card closes the drawer without opening the editor, and the next tap opens the note
- Settings remains open while moving between its button and options; Appearance toggles the theme without dismissing the menu, while outside clicks still close it
- delete actions use a red trash-can icon inside a compact outlined button; the List/Tiles chevron is vertically centered, and the login/loading screen defaults to dark without changing saved app appearance
- dark mode is now the default app theme, including a one-time migration from the prior default-light setting; folders can be deleted after confirmation, which soft-deletes their notes and syncs folder removal when online
- new notes focus the title field immediately, and a persisted sort selector supports modified date, creation date, title A-Z, and title Z-A
- browser checks verified the dark default, title focus, alphabetical sorting, and confirmed deletion of a folder with its note; temporary validation notes were removed
- compact Settings menu added with sign-out and emoji theme control; connection state uses accessible green online/orange offline indicators in the menu on desktop and mobile
- mobile toolbar now uses an emoji-only Settings control and a List/Tiles dropdown; New Note is a floating action button, and the document background follows the active theme
- new notes open immediately after local persistence while cloud sync continues in the background; mobile title, layout selector, and Settings control share one header row
- removed the theme toggle from the sign-in screen; elevated the mobile New Note button above page content and verified it opens the editor at a phone-sized viewport
- note cards support touch-and-hold actions on phones and right-click actions on desktop for rename/delete in List and Tiles modes; the mobile New Note button is portaled to the document layer
- mobile New Note now creates on touch pointer-up as well as click, uses a high-priority safe-area-aware document-layer target, and note actions animate/highlight without allowing browser text selection
- added explicit iOS touchend handling for New Note, Rename, and Delete with click deduplication; touch-event browser emulation verified all three, while the production deployment still needs updating before a physical iPhone receives these changes
- added folder-scoped Pinned Notes sections with Pin/Unpin note actions and a brief bubble animation when notes move between sections
- added per-account note lock password setup/change and login-password recovery; password verifiers use salted PBKDF2 and are stored locally, not as plaintext
- locked notes hide tile previews, show locked/unlocked indicators, and require the note password before opening; unlocked state lasts only for the current app session
- note locking is a visual privacy feature only; note content remains readable in local storage and cloud data and is not encrypted
- standalone runtime validation passed the production build, lint, and development-server HTTP checks; interactive account flows still need verification with a signed-in test account
- Git repository and origin remote are configured; GitHub CLI is not authenticated in the current environment, and Vercel CLI is unavailable

### Confirmed direction
- Build as a PWA website, not a native app
- Mobile-first experience with desktop compatibility
- Offline-first architecture
- Local IndexedDB storage for immediate offline note saving
- Cloud sync using Supabase when internet is available
- Persistent login sessions for each user
- User-scoped notes to prevent mixing across accounts
- Free or low-cost managed hosting using Vercel + Supabase

### Architecture chosen
- Frontend: React + Vite + TypeScript
- Offline storage: IndexedDB + Dexie
- App shell caching: Service Worker / Workbox
- Auth: Supabase Auth
- Database: Supabase Postgres
- Hosting: Vercel

### Core design decisions
- Cloud database is the source of truth
- Local browser database is an offline cache and local working copy
- Each note has a stable ID and user_id
- Notes are synced through a queue when online
- The schema supports future additions like folders, tags, reminders, attachments, etc.

---

## Current milestone
### Completed
- requirement discussion
- product goals clarified
- architecture chosen
- offline-first concept approved
- sync model defined
- user model defined
- future feature growth plan defined
- project blueprint document written
- project status document created and updated
- React app scaffolded
- frontend dependencies installed
- PWA foundation added
- local IndexedDB note model implemented
- app-level note model and type definitions created
- Supabase client initialized for future auth/database integration
- Supabase notes endpoint reachability checked without reading note data
- pending note sync scoped to the signed-in user and failed writes remain queued for retry
- auth session lifecycle cleanup and email-confirmation feedback implemented
- local queue upload and remote pull wired into startup, note changes, and reconnect flows
- offline queue retries and conflict resolution implemented
- initial mobile-first notes editor UI built
- auth-ready login flow and demo fallback added
- Supabase schema design created for real cloud tables
- stale-draft overwrite bug fixed in the note editor
- version/timestamp guard added to prevent background saves from replacing newer content
- build verification passed after final stability fix
- dev server launched successfully and app checked in browser
- persistent dark/light theme toggle implemented and browser-checked
- production deployment checklist documented in `docs/deployment-checklist.md`
- offline local note persistence and PWA offline app-shell reload verified in a browser
- authenticated Supabase session persistence, remote note pull/upload, and offline reconnect sync verified with a dedicated test account
- existing Vercel production deployment and offline app-shell behavior verified; mobile viewport smoke check passed
- deployed login page and PWA metadata checked at common phone, tablet, and desktop viewport sizes
- physical iOS/Android PWA installation and offline/reconnect checks remain for device owners; exact manual steps are in `docs/deployment-checklist.md`
- responsive home/detail navigation and saved list/tile preference verified in mobile and desktop browser viewports
- Settings menu, theme emoji toggle, and online/offline indicator verified at mobile and desktop viewport sizes
- mobile toolbar compacting, floating New Note button, dropdown layout selector, and theme-aware document background implemented; build and lint pass

### Not started yet
- confirmation that production Row Level Security policies are enabled and correct in the live Supabase project
- cross-account isolation verification against two authorized test accounts
- hands-on installation and offline/reconnect testing on physical iOS and Android devices
- Preview deployment verification for a new code revision
- final feature roadmap implementation
- note sharing and collaboration features

---

## Important project rules to preserve
1. Keep the app as a PWA website, not a native app.
2. Every note must be tied to a user_id.
3. Local storage is only for offline/local working data.
4. Cloud is the source of truth.
5. Use a sync queue for unsynced notes.
6. Keep the note schema extensible.
7. Avoid building with a fragile one-table-only design.
8. Do not depend on the laptop being always online.
9. Persistent login should be enabled.
10. The app must work on iPhone, Android, and Windows.

---

## Recommended next implementation steps
### Step 1: initialize project
- create React + Vite + TypeScript app
- install required dependencies
- set up app routing and basic layout

### Step 2: configure PWA
- add manifest file
- add service worker
- enable installability on mobile/desktop

### Step 3: set up Supabase
- create project
- configure auth
- create database tables
- configure Row Level Security

### Step 4: implement local database
- create IndexedDB schema
- create Dexie models
- add note CRUD local operations

### Step 5: implement auth session persistence
- persist user session
- restore on app open
- silent refresh behavior

### Step 6: implement sync engine
- queue unsynced actions
- upload when online
- retry on reconnect
- resolve conflicts

### Step 7: build note UI
- notes list
- editor
- create/edit/delete flows
- offline indicator
- mobile-first layout

### Step 8: test and polish
- offline create and edit
- reconnect sync
- reinstall / re-login flow
- cross-browser testing

---

## Data model snapshot
### User table
- id
- email
- display_name
- created_at

### Note table
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

### Sync queue table
- id
- user_id
- note_id
- action
- payload
- created_at
- processed_at

---

## Resume guidance
When resuming this project later, continue from the architecture stage and build in the following order:
1. scaffold app
2. set up PWA and service worker
3. set up Supabase auth and database
4. add IndexedDB local model
5. add note sync engine
6. build note UI
7. test on mobile and desktop

This is the correct path so the app stays consistent with the design decisions already made.

---

## Open questions / to decide later
- Should notebooks/folders be included from the first release or added after MVP?
- Do we need markdown support in v1 or v2?
- Should we allow note deletion to be soft-deleted first?
- Do we need note tags from the beginning?
- Should reminders be included in v1 or moved to v2?

---

## Final note
The project has an implemented local-first sync path: local note changes and queue records are persisted atomically, authenticated sync pulls and uploads user-scoped notes, failed uploads remain queued, and timestamp/version comparisons resolve conflicts. Production build passes. A real authenticated offline/reconnect test on two devices is still needed to verify the complete cloud round trip.

This document should be treated as the active project state file and updated whenever the project progresses.
