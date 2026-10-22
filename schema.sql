-- ============================================================
-- 線上服飾購物情境實驗平台：資料庫結構 + 權限（Row Level Security）
-- 使用方式：Supabase 後台 > SQL Editor > New query > 整段貼上 > Run
-- 可重複執行（已存在的物件會略過或覆蓋函式）
-- ============================================================

-- ---------- 1. 資料表 ----------

-- 角色表：只有出現在這裡且 role = 'researcher' 的帳號才是研究者
-- 填答者使用匿名登入，不會出現在此表 → 預設就是填答者
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'participant' check (role in ('researcher','participant')),
  created_at timestamptz not null default now()
);

-- 每一筆受試者紀錄（一個 ID = 一列）
create table if not exists public.participants (
  pid            text primary key,                 -- 參與者 ID，例：P0001-3FA9
  auth_uid       uuid,                             -- 目前使用此 ID 的登入身分
  grp            text check (grp in ('A','B','C','D')),   -- 組別（登入時才分派）
  gap            text check (gap in ('low','high')),      -- 虛實落差
  nudge          text check (nudge in ('none','green')),  -- 綠色數位輕推
  step           text not null default 'login',    -- 目前進度
  dwell_arrival  int,                              -- 到貨頁停留秒數
  dwell_decision int,                              -- 退貨決策頁停留秒數
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  claimed_at     timestamptz,                      -- 首次登入時間
  completed_at   timestamptz                       -- 完成時間
);
create index if not exists participants_auth_uid_idx on public.participants(auth_uid);

create sequence if not exists public.pid_seq start 1;

-- ---------- 2. 角色判斷函式 ----------
create or replace function public.is_researcher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where user_id = auth.uid() and role = 'researcher');
$$;

-- ---------- 3. 列級權限（RLS）----------
alter table public.profiles     enable row level security;
alter table public.participants enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (user_id = auth.uid() or public.is_researcher());

-- participants：填答者只能讀自己那一列；研究者可讀全部
drop policy if exists "participants_select" on public.participants;
create policy "participants_select" on public.participants
  for select using (auth_uid = auth.uid() or public.is_researcher());

-- 只有研究者可刪除「尚未使用」的 ID
drop policy if exists "participants_delete" on public.participants;
create policy "participants_delete" on public.participants
  for delete using (public.is_researcher() and claimed_at is null);

-- 沒有 insert / update 的 policy：所有寫入都只能透過下面的函式，
-- 填答者無法自行改組別、改 ID 或改別人的資料。

-- ---------- 4. 研究者：批次產生 ID ----------
create or replace function public.create_ids(n int, prefix text default 'P')
returns setof text language plpgsql security definer set search_path = public as $$
declare
  i int; v text;
  pre text := upper(regexp_replace(coalesce(prefix,'P'), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_researcher() then raise exception 'forbidden'; end if;
  if n < 1 or n > 1000 then raise exception 'n_out_of_range'; end if;
  for i in 1..n loop
    v := pre || lpad(nextval('public.pid_seq')::text, 4, '0') || '-' ||
         upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    insert into public.participants(pid) values (v);
    return next v;
  end loop;
end $$;

-- ---------- 5. 填答者：用 ID 登入並由伺服器做「平衡隨機分派」----------
-- 每次選目前人數最少的組別（同數時隨機），四組人數會自動維持均衡
create or replace function public.claim_participant(p_pid text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.participants;
  v_grp text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.is_researcher() then raise exception 'researcher_cannot_participate'; end if;

  perform pg_advisory_xact_lock(424242);

  select * into r from public.participants
   where pid = upper(trim(p_pid)) for update;
  if not found then raise exception 'invalid_id'; end if;
  if r.completed_at is not null then raise exception 'already_completed'; end if;

  -- 同一個登入身分只綁定一個 ID
  update public.participants set auth_uid = null
   where auth_uid = auth.uid() and pid <> r.pid;

  if r.grp is null then
    select k into v_grp from (
      select x.k, count(p.pid) as c
        from unnest(array['A','B','C','D']) as x(k)
        left join public.participants p on p.grp = x.k
       group by x.k
    ) t order by c, random() limit 1;

    update public.participants set
      grp = v_grp,
      gap   = case when v_grp in ('A','B') then 'low'   else 'high' end,
      nudge = case when v_grp in ('B','D') then 'green' else 'none' end,
      step = 'intro', claimed_at = now(), auth_uid = auth.uid()
     where pid = r.pid returning * into r;
  else
    -- 已登入過、尚未完成：允許用同一 ID 換裝置 / 重新整理後接續作答
    update public.participants set auth_uid = auth.uid()
     where pid = r.pid returning * into r;
  end if;

  return to_jsonb(r) - 'auth_uid' - 'created_by';
end $$;

-- ---------- 6. 填答者：讀取自己的紀錄（重新整理後接續）----------
create or replace function public.get_my_participant()
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'auth_uid' - 'created_by'
    from public.participants p
   where p.auth_uid = auth.uid()
   order by p.claimed_at desc nulls last limit 1;
$$;

-- ---------- 7. 填答者：回報進度 ----------
create or replace function public.update_progress(
  p_step text, p_dwell_arrival int default null, p_dwell_decision int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_step not in ('intro','product','tryon','shipping','arrival','form_post',
                    'return_steps','form_effort','decision','form_final','done') then
    raise exception 'bad_step';
  end if;
  update public.participants set
    step = p_step,
    dwell_arrival  = coalesce(p_dwell_arrival,  dwell_arrival),
    dwell_decision = coalesce(p_dwell_decision, dwell_decision),
    completed_at = case when p_step = 'done' then coalesce(completed_at, now()) else completed_at end
   where auth_uid = auth.uid() and completed_at is null;
end $$;

-- ---------- 8. 函式執行權限 ----------
revoke all on function public.create_ids(int, text)            from public, anon;
revoke all on function public.claim_participant(text)          from public, anon;
revoke all on function public.get_my_participant()             from public, anon;
revoke all on function public.update_progress(text, int, int)  from public, anon;
grant execute on function public.create_ids(int, text)           to authenticated;
grant execute on function public.claim_participant(text)         to authenticated;
grant execute on function public.get_my_participant()            to authenticated;
grant execute on function public.update_progress(text, int, int) to authenticated;
grant execute on function public.is_researcher()                 to anon, authenticated;

-- ============================================================
-- 建立研究者帳號後，執行下面這段（把 Email 換成您的）：
--
-- insert into public.profiles (user_id, role)
-- select id, 'researcher' from auth.users where email = 'you@example.com'
-- on conflict (user_id) do update set role = 'researcher';
-- ============================================================

