-- Add metadata required for news-triggered event generation/dedupe.
-- This preserves existing rows by defaulting current events to "manual".

alter table public.events
  add column if not exists source text not null default 'manual',
  add column if not exists source_region text,
  add column if not exists source_fingerprint text;

alter table public.events
  drop constraint if exists events_source_valid_chk;

alter table public.events
  add constraint events_source_valid_chk
  check (source in ('manual', 'news', 'system'));

alter table public.events
  drop constraint if exists events_source_fingerprint_len_chk;

alter table public.events
  add constraint events_source_fingerprint_len_chk
  check (
    source_fingerprint is null
    or char_length(trim(source_fingerprint)) between 12 and 128
  );

create unique index if not exists events_source_fingerprint_uidx
  on public.events (source_fingerprint)
  where source_fingerprint is not null;

create index if not exists events_source_idx
  on public.events (source);

create index if not exists events_source_region_idx
  on public.events (source_region);

comment on column public.events.source is 'Event origin: manual | news | system';
comment on column public.events.source_region is 'Optional region tag for source-specific grouping (e.g., HAITI, GLOBAL).';
comment on column public.events.source_fingerprint is 'Stable dedupe key for auto-generated events (e.g., hashed article URL).';
