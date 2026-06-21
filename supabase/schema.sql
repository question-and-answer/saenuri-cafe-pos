create extension if not exists pgcrypto;

do $$ begin
  create type staff_role as enum ('admin', 'cashier', 'maker');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type approval_status as enum ('pending', 'approved', 'revoked');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type order_status as enum ('접수', '제조', '제조 완료', '픽업 완료', '취소');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type payment_method as enum ('현금', '계좌이체');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type payment_status as enum ('결제 완료', '미결제');
exception when duplicate_object then null;
end $$;

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  requested_role staff_role not null,
  role staff_role,
  approval_status approval_status not null default 'pending',
  device_session_id text not null unique,
  approved_by uuid references staff(id),
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settings (
  id text primary key default 'event',
  event_name text not null default '새누리교회 일일카페 POS',
  next_order_number integer not null default 1,
  low_stock_threshold integer not null default 5,
  bank_account text not null default '',
  bank_qr_url text not null default '',
  last_backup_at timestamptz,
  last_automatic_backup_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = 'event')
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price integer not null check (price >= 0),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  stock_unknown boolean not null default true,
  sold_out boolean not null default false,
  hidden boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number integer not null unique,
  status order_status not null default '접수',
  total_amount integer not null default 0,
  paid_status payment_status not null default '미결제',
  payment_method payment_method not null default '현금',
  received_amount integer,
  change_amount integer,
  note text not null default '',
  created_by uuid references staff(id),
  canceled_at timestamptz,
  canceled_by uuid references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id),
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),
  subtotal integer not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  method payment_method not null,
  status payment_status not null,
  amount integer not null default 0,
  received_amount integer,
  change_amount integer,
  changed_by uuid references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_logs (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid references menu_items(id),
  order_id uuid references orders(id),
  staff_id uuid references staff(id),
  change_quantity integer not null,
  before_quantity integer,
  after_quantity integer,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff(id),
  staff_name text not null default '시스템',
  staff_role staff_role,
  action_type text not null,
  target_type text,
  target_id text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create table if not exists backups (
  id uuid primary key default gen_random_uuid(),
  backup_type text not null check (backup_type in ('automatic', 'manual')),
  created_by uuid references staff(id),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table staff replica identity full;
alter table settings replica identity full;
alter table menu_items replica identity full;
alter table orders replica identity full;
alter table order_items replica identity full;
alter table payments replica identity full;
alter table inventory_logs replica identity full;
alter table activity_logs replica identity full;
alter table backups replica identity full;

insert into settings (id) values ('event') on conflict (id) do nothing;

insert into menu_items (name, price, stock_quantity, stock_unknown)
select seed.name, seed.price, null, true
from (
  values
    ('아이스티', 3000),
    ('미숫가루', 3000),
    ('루이보스', 3000),
    ('아이스초코', 3000)
) as seed(name, price)
where not exists (select 1 from menu_items);

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists staff_touch_updated_at on staff;
create trigger staff_touch_updated_at before update on staff
for each row execute function touch_updated_at();

drop trigger if exists settings_touch_updated_at on settings;
create trigger settings_touch_updated_at before update on settings
for each row execute function touch_updated_at();

drop trigger if exists menu_items_touch_updated_at on menu_items;
create trigger menu_items_touch_updated_at before update on menu_items
for each row execute function touch_updated_at();

drop trigger if exists orders_touch_updated_at on orders;
create trigger orders_touch_updated_at before update on orders
for each row execute function touch_updated_at();

create or replace function create_staff_request(
  p_name text,
  p_requested_role staff_role,
  p_device_session_id text
)
returns staff
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_staff_count integer;
begin
  select count(*) into v_staff_count from staff;

  insert into staff (
    name,
    requested_role,
    role,
    approval_status,
    device_session_id,
    approved_at
  )
  values (
    nullif(trim(p_name), ''),
    p_requested_role,
    case when v_staff_count = 0 and p_requested_role = 'admin' then 'admin'::staff_role else null end,
    case when v_staff_count = 0 and p_requested_role = 'admin' then 'approved'::approval_status else 'pending'::approval_status end,
    p_device_session_id,
    case when v_staff_count = 0 and p_requested_role = 'admin' then now() else null end
  )
  on conflict (device_session_id) do update
    set name = excluded.name,
        requested_role = excluded.requested_role,
        updated_at = now()
  returning * into v_staff;

  insert into activity_logs (staff_id, staff_name, staff_role, action_type, target_type, target_id, after_value)
  values (
    v_staff.id,
    v_staff.name,
    v_staff.role,
    case when v_staff.approval_status = 'approved' then 'staff_approved' else 'staff_requested' end,
    'staff',
    v_staff.id::text,
    to_jsonb(v_staff)
  );

  return v_staff;
end;
$$;

create or replace function create_pos_order(
  p_staff_id uuid,
  p_items jsonb,
  p_payment_method payment_method,
  p_paid_status payment_status,
  p_received_amount integer default null,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_settings settings;
  v_order_id uuid := gen_random_uuid();
  v_order_number integer;
  v_total integer := 0;
  v_item jsonb;
  v_menu menu_items;
  v_quantity integer;
  v_subtotal integer;
  v_before integer;
  v_after integer;
begin
  select * into v_staff from staff where id = p_staff_id and approval_status = 'approved';
  if not found or v_staff.role not in ('admin', 'cashier') then
    raise exception '주문 권한이 없습니다.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception '메뉴를 선택해 주세요.';
  end if;

  select * into v_settings from settings where id = 'event' for update;
  v_order_number := v_settings.next_order_number;
  update settings set next_order_number = next_order_number + 1 where id = 'event';

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 then
      raise exception '수량이 올바르지 않습니다.';
    end if;

    select * into v_menu from menu_items
    where id = (v_item->>'menuItemId')::uuid
    for update;

    if not found or v_menu.hidden or v_menu.deleted_at is not null or v_menu.sold_out then
      raise exception '주문할 수 없는 메뉴가 포함되어 있습니다.';
    end if;

    if not v_menu.stock_unknown then
      if coalesce(v_menu.stock_quantity, 0) < v_quantity then
        raise exception '% 재고가 부족합니다.', v_menu.name;
      end if;
      v_before := v_menu.stock_quantity;
      v_after := v_menu.stock_quantity - v_quantity;
      update menu_items
      set stock_quantity = v_after,
          sold_out = case when v_after = 0 then true else sold_out end
      where id = v_menu.id;

      insert into inventory_logs (menu_item_id, order_id, staff_id, change_quantity, before_quantity, after_quantity, reason)
      values (v_menu.id, v_order_id, p_staff_id, -v_quantity, v_before, v_after, 'order_created');
    end if;

    v_subtotal := v_menu.price * v_quantity;
    v_total := v_total + v_subtotal;

    insert into order_items (order_id, menu_item_id, name, quantity, unit_price, subtotal)
    values (v_order_id, v_menu.id, v_menu.name, v_quantity, v_menu.price, v_subtotal);
  end loop;

  insert into orders (
    id,
    order_number,
    status,
    total_amount,
    paid_status,
    payment_method,
    received_amount,
    change_amount,
    note,
    created_by
  )
  values (
    v_order_id,
    v_order_number,
    '접수',
    v_total,
    p_paid_status,
    p_payment_method,
    p_received_amount,
    greatest(coalesce(p_received_amount, v_total) - v_total, 0),
    coalesce(p_note, ''),
    p_staff_id
  );

  insert into payments (order_id, method, status, amount, received_amount, change_amount, changed_by)
  values (
    v_order_id,
    p_payment_method,
    p_paid_status,
    v_total,
    p_received_amount,
    greatest(coalesce(p_received_amount, v_total) - v_total, 0),
    p_staff_id
  );

  insert into activity_logs (staff_id, staff_name, staff_role, action_type, target_type, target_id, after_value)
  values (
    p_staff_id,
    v_staff.name,
    v_staff.role,
    'order_created',
    'order',
    v_order_id::text,
    jsonb_build_object('order_number', v_order_number, 'total_amount', v_total, 'paid_status', p_paid_status)
  );

  return v_order_id;
end;
$$;

create or replace function cancel_pos_order(
  p_staff_id uuid,
  p_order_id uuid
)
returns void
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_order orders;
  v_item order_items;
  v_menu menu_items;
  v_before integer;
  v_after integer;
begin
  select * into v_staff from staff where id = p_staff_id and approval_status = 'approved';
  if not found or v_staff.role not in ('admin', 'cashier') then
    raise exception '취소 권한이 없습니다.';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception '주문을 찾을 수 없습니다.';
  end if;
  if v_order.status = '취소' then
    return;
  end if;
  if v_order.status = '픽업 완료' and v_staff.role <> 'admin' then
    raise exception '픽업 완료 주문은 관리자만 취소할 수 있습니다.';
  end if;

  for v_item in select * from order_items where order_id = p_order_id
  loop
    select * into v_menu from menu_items where id = v_item.menu_item_id for update;
    if found and not v_menu.stock_unknown then
      v_before := v_menu.stock_quantity;
      v_after := coalesce(v_menu.stock_quantity, 0) + v_item.quantity;
      update menu_items
      set stock_quantity = v_after,
          sold_out = false
      where id = v_menu.id;

      insert into inventory_logs (menu_item_id, order_id, staff_id, change_quantity, before_quantity, after_quantity, reason)
      values (v_menu.id, p_order_id, p_staff_id, v_item.quantity, v_before, v_after, 'order_canceled');
    end if;
  end loop;

  update orders
  set status = '취소',
      canceled_at = now(),
      canceled_by = p_staff_id
  where id = p_order_id;

  insert into activity_logs (staff_id, staff_name, staff_role, action_type, target_type, target_id, before_value, after_value)
  values (
    p_staff_id,
    v_staff.name,
    v_staff.role,
    'order_canceled',
    'order',
    p_order_id::text,
    to_jsonb(v_order),
    jsonb_build_object('status', '취소')
  );
end;
$$;

create or replace function create_backup_snapshot(
  p_staff_id uuid,
  p_backup_type text
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_backup_id uuid;
  v_snapshot jsonb;
begin
  select * into v_staff from staff where id = p_staff_id and approval_status = 'approved';
  if not found or v_staff.role <> 'admin' then
    raise exception '백업 권한이 없습니다.';
  end if;

  select jsonb_build_object(
    'orders', (select coalesce(jsonb_agg(o), '[]'::jsonb) from orders o),
    'order_items', (select coalesce(jsonb_agg(oi), '[]'::jsonb) from order_items oi),
    'payments', (select coalesce(jsonb_agg(p), '[]'::jsonb) from payments p),
    'menu_items', (select coalesce(jsonb_agg(m), '[]'::jsonb) from menu_items m),
    'staff', (select coalesce(jsonb_agg(s), '[]'::jsonb) from staff s),
    'settings', (select to_jsonb(st) from settings st where id = 'event'),
    'activity_logs', (select coalesce(jsonb_agg(a), '[]'::jsonb) from activity_logs a)
  ) into v_snapshot;

  insert into backups (backup_type, created_by, snapshot)
  values (p_backup_type, p_staff_id, v_snapshot)
  returning id into v_backup_id;

  update settings
  set last_backup_at = now(),
      last_automatic_backup_at = case when p_backup_type = 'automatic' then now() else last_automatic_backup_at end
  where id = 'event';

  insert into activity_logs (staff_id, staff_name, staff_role, action_type, target_type, target_id, after_value)
  values (
    p_staff_id,
    v_staff.name,
    v_staff.role,
    case when p_backup_type = 'automatic' then 'backup_created' else 'backup_created' end,
    'backup',
    v_backup_id::text,
    jsonb_build_object('backup_type', p_backup_type)
  );

  return v_backup_id;
end;
$$;

do $$ begin
  alter publication supabase_realtime add table staff;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table settings;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table menu_items;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table orders;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table order_items;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table payments;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table activity_logs;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table backups;
exception when duplicate_object then null;
end $$;

alter table staff enable row level security;
alter table settings enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table inventory_logs enable row level security;
alter table activity_logs enable row level security;
alter table backups enable row level security;

drop policy if exists "event anon read staff" on staff;
create policy "event anon read staff" on staff for select using (true);
drop policy if exists "event anon write staff" on staff;
create policy "event anon write staff" on staff for all using (true) with check (true);

drop policy if exists "event anon read settings" on settings;
create policy "event anon read settings" on settings for select using (true);
drop policy if exists "event anon write settings" on settings;
create policy "event anon write settings" on settings for all using (true) with check (true);

drop policy if exists "event anon read menu" on menu_items;
create policy "event anon read menu" on menu_items for select using (true);
drop policy if exists "event anon write menu" on menu_items;
create policy "event anon write menu" on menu_items for all using (true) with check (true);

drop policy if exists "event anon read orders" on orders;
create policy "event anon read orders" on orders for select using (true);
drop policy if exists "event anon write orders" on orders;
create policy "event anon write orders" on orders for all using (true) with check (true);

drop policy if exists "event anon read order_items" on order_items;
create policy "event anon read order_items" on order_items for select using (true);
drop policy if exists "event anon write order_items" on order_items;
create policy "event anon write order_items" on order_items for all using (true) with check (true);

drop policy if exists "event anon read payments" on payments;
create policy "event anon read payments" on payments for select using (true);
drop policy if exists "event anon write payments" on payments;
create policy "event anon write payments" on payments for all using (true) with check (true);

drop policy if exists "event anon read inventory_logs" on inventory_logs;
create policy "event anon read inventory_logs" on inventory_logs for select using (true);
drop policy if exists "event anon write inventory_logs" on inventory_logs;
create policy "event anon write inventory_logs" on inventory_logs for all using (true) with check (true);

drop policy if exists "event anon read activity_logs" on activity_logs;
create policy "event anon read activity_logs" on activity_logs for select using (true);
drop policy if exists "event anon write activity_logs" on activity_logs;
create policy "event anon write activity_logs" on activity_logs for all using (true) with check (true);

drop policy if exists "event anon read backups" on backups;
create policy "event anon read backups" on backups for select using (true);
drop policy if exists "event anon write backups" on backups;
create policy "event anon write backups" on backups for all using (true) with check (true);
