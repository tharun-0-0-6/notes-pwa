-- Notes Website schema for Supabase
-- This allows the app to keep notes user-scoped and ready for future feature expansion.

create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.notes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text default 'Untitled note' not null,
  content text default '' not null,
  content_type text default 'text' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  version integer default 1 not null,
  deleted_at timestamptz,
  is_archived boolean default false not null,
  is_pinned boolean default false not null,
  notebook_id uuid,
  color text default '#f7f7f7',
  metadata_json jsonb default '{}'::jsonb not null
);

create table if not exists public.notebooks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  parent_id uuid,
  created_at timestamptz default now() not null
);

create table if not exists public.note_tags (
  id uuid primary key default uuid_generate_v4(),
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_name text not null,
  created_at timestamptz default now() not null
);

create table if not exists public.reminders (
  id uuid primary key default uuid_generate_v4(),
  note_id uuid not null references public.notes(id) on delete cascade,
  remind_at timestamptz not null,
  is_done boolean default false not null,
  created_at timestamptz default now() not null
);

create table if not exists public.attachments (
  id uuid primary key default uuid_generate_v4(),
  note_id uuid not null references public.notes(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  created_at timestamptz default now() not null
);

create table if not exists public.sync_queue (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  note_id uuid references public.notes(id) on delete set null,
  action text not null check (action in ('create', 'update', 'delete', 'restore')),
  payload jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  processed_at timestamptz,
  retry_count integer default 0 not null
);

create index if not exists idx_notes_user_updated
  on public.notes (user_id, updated_at desc);

create index if not exists idx_notes_user_deleted
  on public.notes (user_id, deleted_at);

create index if not exists idx_sync_queue_user
  on public.sync_queue (user_id, processed_at);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.notes enable row level security;
alter table public.notebooks enable row level security;
alter table public.note_tags enable row level security;
alter table public.reminders enable row level security;
alter table public.attachments enable row level security;
alter table public.sync_queue enable row level security;

create policy "Users can view own profile"
on public.profiles
for select
using (auth.uid() = id);

create policy "Users can update own profile"
on public.profiles
for update
using (auth.uid() = id);

create policy "Users can manage own notes"
on public.notes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can manage own notebooks"
on public.notebooks
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can manage own tags"
on public.note_tags
for all
using (exists (
  select 1 from public.notes n
  where n.id = note_tags.note_id and n.user_id = auth.uid()
))
with check (exists (
  select 1 from public.notes n
  where n.id = note_tags.note_id and n.user_id = auth.uid()
));

create policy "Users can manage own reminders"
on public.reminders
for all
using (exists (
  select 1 from public.notes n
  where n.id = reminders.note_id and n.user_id = auth.uid()
))
with check (exists (
  select 1 from public.notes n
  where n.id = reminders.note_id and n.user_id = auth.uid()
));

create policy "Users can manage own attachments"
on public.attachments
for all
using (exists (
  select 1 from public.notes n
  where n.id = attachments.note_id and n.user_id = auth.uid()
))
with check (exists (
  select 1 from public.notes n
  where n.id = attachments.note_id and n.user_id = auth.uid()
));

create policy "Users can manage own sync queue"
on public.sync_queue
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
