create table if not exists public.wheel_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  is_spinning boolean not null default false,
  spin_started_at timestamptz,
  pending_spin_id uuid,
  pending_winner jsonb,
  pending_mode text,
  updated_at timestamptz not null default now(),
  constraint pending_mode_valid check (pending_mode is null or pending_mode in ('random', 'controlled'))
);

alter table public.wheel_events enable row level security;

revoke all on public.wheel_events from anon, authenticated;
grant select on public.wheel_events to anon, authenticated;
grant insert (owner_id, data) on public.wheel_events to authenticated;
grant update (data, updated_at) on public.wheel_events to authenticated;

drop policy if exists "Anyone can view a shared wheel event" on public.wheel_events;
create policy "Anyone can view a shared wheel event"
  on public.wheel_events for select
  to anon, authenticated
  using (true);

drop policy if exists "Operators can create their own wheel events" on public.wheel_events;
create policy "Operators can create their own wheel events"
  on public.wheel_events for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Operators can update their own wheel events" on public.wheel_events;
create policy "Operators can update their own wheel events"
  on public.wheel_events for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create or replace function public.begin_wheel_spin(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.wheel_events%rowtype;
  v_participants jsonb;
  v_selected jsonb;
  v_mode text := 'random';
  v_override_id text;
  v_total_weight numeric;
  v_roll numeric;
  v_running numeric := 0;
  v_participant jsonb;
  v_spin_id uuid := pg_catalog.gen_random_uuid();
begin
  select * into v_event
  from public.wheel_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Wheel event not found.';
  end if;

  if v_event.is_spinning and v_event.spin_started_at > now() - interval '2 minutes' then
    raise exception 'The wheel is already spinning.';
  end if;

  v_participants := v_event.data -> 'participants';
  if jsonb_typeof(v_participants) <> 'array' or jsonb_array_length(v_participants) = 0 then
    raise exception 'Add participants before spinning the wheel.';
  end if;

  v_override_id := v_event.data ->> 'overrideParticipantId';
  if v_event.data -> 'overrideActivated' = 'true'::jsonb and v_override_id is not null then
    select p.value into v_selected
    from jsonb_array_elements(v_participants) as p(value)
    where p.value ->> 'id' = v_override_id
    limit 1;
    if v_selected is not null then
      v_mode := 'controlled';
    end if;
  end if;

  if v_selected is null then
    select sum((p.value ->> 'weight')::numeric) into v_total_weight
    from jsonb_array_elements(v_participants) as p(value);

    if v_total_weight is null or v_total_weight <= 0 then
      raise exception 'The participant list has invalid weights.';
    end if;

    v_roll := ((('x' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8))::bit(32)::bigint + 0.5)
      / 4294967296.0) * v_total_weight;

    for v_participant in
      select p.value from jsonb_array_elements(v_participants) as p(value)
    loop
      v_running := v_running + (v_participant ->> 'weight')::numeric;
      if v_roll < v_running then
        v_selected := v_participant;
        exit;
      end if;
    end loop;
  end if;

  if v_selected is null then
    raise exception 'Could not select an eligible participant.';
  end if;

  update public.wheel_events
  set is_spinning = true,
      spin_started_at = now(),
      pending_spin_id = v_spin_id,
      pending_winner = v_selected,
      pending_mode = v_mode
  where id = p_event_id;

  return jsonb_build_object(
    'spinId', v_spin_id,
    'participantId', v_selected ->> 'id',
    'mode', v_mode
  );
end;
$$;

drop function if exists public.finish_wheel_spin(uuid);

create or replace function public.finish_wheel_spin(p_event_id uuid, p_spin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.wheel_events%rowtype;
  v_data jsonb;
  v_participants jsonb;
  v_winners jsonb;
  v_record jsonb;
begin
  select * into v_event
  from public.wheel_events
  where id = p_event_id
  for update;

  if not found or not v_event.is_spinning or v_event.pending_winner is null
      or v_event.pending_spin_id <> p_spin_id then
    raise exception 'There is no active spin to finish.';
  end if;

  v_data := v_event.data;
  v_record := jsonb_build_object(
    'participant', v_event.pending_winner,
    'spinNumber', jsonb_array_length(coalesce(v_data -> 'winners', '[]'::jsonb)) + 1,
    'timestamp', now(),
    'mode', v_event.pending_mode
  );

  if coalesce((v_data #>> '{settings,autoRemove}')::boolean, true) then
    select coalesce(jsonb_agg(p.value order by p.ordinality), '[]'::jsonb)
    into v_participants
    from jsonb_array_elements(v_data -> 'participants') with ordinality as p(value, ordinality)
    where p.value ->> 'id' <> v_event.pending_winner ->> 'id';
    v_data := jsonb_set(v_data, '{participants}', v_participants, true);
  end if;

  v_winners := jsonb_build_array(v_record) || coalesce(v_data -> 'winners', '[]'::jsonb);
  v_data := jsonb_set(v_data, '{winners}', v_winners, true);

  if v_event.pending_mode = 'controlled' then
    v_data := jsonb_set(v_data, '{overrideParticipantId}', 'null'::jsonb, true);
    v_data := jsonb_set(v_data, '{overrideActivated}', 'false'::jsonb, true);
  end if;

  update public.wheel_events
  set data = v_data,
      is_spinning = false,
      spin_started_at = null,
      pending_spin_id = null,
      pending_winner = null,
      pending_mode = null,
      updated_at = now()
  where id = p_event_id;

  return v_data;
end;
$$;

revoke all on function public.begin_wheel_spin(uuid) from public;
revoke all on function public.finish_wheel_spin(uuid, uuid) from public;
grant execute on function public.begin_wheel_spin(uuid) to anon, authenticated;
grant execute on function public.finish_wheel_spin(uuid, uuid) to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'wheel_events'
  ) then
    alter publication supabase_realtime add table public.wheel_events;
  end if;
end
$$;
