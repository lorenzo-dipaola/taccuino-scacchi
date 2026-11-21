-- Taccuino Scacchi: tabella per la sincronizzazione tra dispositivi.
-- Ogni riga è un oggetto dell'utente (partita, esercizio, impostazioni).
-- Row Level Security: ogni utente vede e modifica solo le proprie righe.

create table if not exists public.user_data (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('game', 'puzzle', 'settings')),
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);

create index if not exists user_data_user_updated on public.user_data (user_id, updated_at);

alter table public.user_data enable row level security;

drop policy if exists "own rows" on public.user_data;
create policy "own rows" on public.user_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at is always set by the server clock, so devices with a wrong clock cannot break sync.
create or replace function public.user_data_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
  before insert or update on public.user_data
  for each row execute function public.user_data_touch();
