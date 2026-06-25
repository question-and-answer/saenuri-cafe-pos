create extension if not exists pgcrypto;

drop table if exists backups cascade;
drop table if exists inventory_logs cascade;
drop table if exists activity_logs cascade;
drop table if exists payments cascade;
drop table if exists order_items cascade;
drop table if exists orders cascade;
drop table if exists menu_items cascade;
drop table if exists staff cascade;
drop table if exists settings cascade;

create table settings (
  id text primary key default 'event',
  event_name text not null default '새누리교회 일일카페 POS',
  admin_code_hash text not null default crypt('1234', gen_salt('bf')),
  next_order_number integer not null default 1,
  default_low_stock_threshold integer not null default 5,
  bank_account text not null default '',
  bank_qr_note text not null default '',
  updated_at timestamptz not null default now(),
  constraint settings_one_row check (id = 'event')
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  requested_role text not null check (requested_role in ('admin', 'cashier', 'maker')),
  role text check (role in ('admin', 'cashier', 'maker')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
  device_token text not null unique,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  revoked_at timestamptz
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price integer not null check (price >= 0),
  is_sold_out boolean not null default false,
  is_hidden boolean not null default false,
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  stock_unknown boolean not null default true,
  low_stock_threshold integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number integer not null unique,
  status text not null default '접수' check (status in ('접수', '제조 중', '제조 완료', '픽업 완료', '취소')),
  payment_status text not null check (payment_status in ('결제 완료', '미결제')),
  payment_method text not null check (payment_method in ('현금', '계좌이체')),
  total_amount integer not null default 0,
  received_amount integer,
  change_amount integer,
  created_by_staff_id uuid references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  canceled_at timestamptz,
  cancel_reason text
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id),
  item_name_snapshot text not null,
  item_price_snapshot integer not null,
  quantity integer not null check (quantity > 0),
  subtotal integer not null
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  payment_method text not null check (payment_method in ('현금', '계좌이체')),
  payment_status text not null check (payment_status in ('결제 완료', '미결제')),
  amount integer not null,
  received_amount integer,
  change_amount integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid references staff(id),
  actor_name text not null default '시스템',
  actor_role text check (actor_role in ('admin', 'cashier', 'maker')),
  action_type text not null,
  target_type text,
  target_id text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create table inventory_logs (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid references menu_items(id),
  order_id uuid references orders(id),
  change_amount integer not null,
  reason text not null,
  before_quantity integer,
  after_quantity integer,
  actor_staff_id uuid references staff(id),
  created_at timestamptz not null default now()
);

create table backups (
  id uuid primary key default gen_random_uuid(),
  backup_type text not null check (backup_type in ('automatic', 'manual')),
  snapshot jsonb not null,
  created_by_staff_id uuid references staff(id),
  created_at timestamptz not null default now()
);

insert into settings (id) values ('event');

insert into menu_items (name, price, stock_quantity, stock_unknown)
values
  ('아이스티', 3000, null, true),
  ('미숫가루', 3000, null, true),
  ('루이보스', 3000, null, true),
  ('아이스초코', 3000, null, true);

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger settings_updated_at before update on settings
for each row execute function touch_updated_at();

create trigger menu_items_updated_at before update on menu_items
for each row execute function touch_updated_at();

create trigger orders_updated_at before update on orders
for each row execute function touch_updated_at();

create trigger payments_updated_at before update on payments
for each row execute function touch_updated_at();

create or replace function request_staff(
  p_name text,
  p_requested_role text,
  p_device_token text
)
returns staff
language plpgsql
security definer
as $$
declare
  v_staff staff;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception '이름을 2자 이상 입력해 주세요.';
  end if;
  if p_requested_role not in ('cashier', 'maker') then
    raise exception '주문 담당 또는 제조 담당을 선택해 주세요.';
  end if;

  insert into staff (name, requested_role, role, status, device_token)
  values (trim(p_name), p_requested_role, null, 'pending', p_device_token)
  on conflict (device_token) do update
    set name = excluded.name,
        requested_role = excluded.requested_role,
        role = case when staff.status = 'approved' then staff.role else null end,
        status = case when staff.status = 'approved' then staff.status else 'pending' end,
        revoked_at = null
  returning * into v_staff;

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (v_staff.id, v_staff.name, v_staff.role, 'staff_requested', 'staff', v_staff.id::text, to_jsonb(v_staff));

  return v_staff;
end;
$$;

create or replace function admin_login(
  p_name text,
  p_admin_code text,
  p_device_token text
)
returns staff
language plpgsql
security definer
as $$
declare
  v_settings settings;
  v_staff staff;
begin
  select * into v_settings from settings where id = 'event';
  if v_settings.admin_code_hash <> crypt(p_admin_code, v_settings.admin_code_hash) then
    raise exception '관리자 코드가 맞지 않습니다.';
  end if;

  insert into staff (name, requested_role, role, status, device_token, approved_at)
  values (coalesce(nullif(trim(p_name), ''), '관리자'), 'admin', 'admin', 'approved', p_device_token, now())
  on conflict (device_token) do update
    set name = excluded.name,
        requested_role = 'admin',
        role = 'admin',
        status = 'approved',
        approved_at = coalesce(staff.approved_at, now()),
        revoked_at = null
  returning * into v_staff;

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (v_staff.id, v_staff.name, 'admin', 'staff_admin_login', 'staff', v_staff.id::text, to_jsonb(v_staff));

  return v_staff;
end;
$$;

create or replace function create_pos_order(
  p_staff_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_payment_status text,
  p_received_amount integer default null
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
  v_qty integer;
  v_subtotal integer;
  v_before integer;
  v_after integer;
begin
  select * into v_staff from staff where id = p_staff_id and status = 'approved';
  if not found or v_staff.role not in ('admin', 'cashier') then
    raise exception '주문 권한이 없습니다.';
  end if;
  if p_payment_method not in ('현금', '계좌이체') or p_payment_status not in ('결제 완료', '미결제') then
    raise exception '결제 정보가 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception '메뉴를 선택해 주세요.';
  end if;

  select * into v_settings from settings where id = 'event' for update;
  v_order_number := v_settings.next_order_number;
  update settings set next_order_number = next_order_number + 1 where id = 'event';

  -- Create the parent order first so order_items and inventory_logs can safely
  -- reference it while the same database transaction builds the ticket.
  insert into orders (
    id, order_number, status, payment_status, payment_method, total_amount,
    received_amount, change_amount, created_by_staff_id
  )
  values (
    v_order_id, v_order_number, '접수', p_payment_status, p_payment_method, 0,
    p_received_amount, 0, p_staff_id
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    select * into v_menu from menu_items where id = (v_item->>'menuItemId')::uuid for update;
    if not found or v_menu.is_hidden or v_menu.is_sold_out then
      raise exception '주문할 수 없는 메뉴가 있습니다.';
    end if;
    if v_qty < 1 then
      raise exception '수량이 올바르지 않습니다.';
    end if;

    if not v_menu.stock_unknown then
      if coalesce(v_menu.stock_quantity, 0) < v_qty then
        raise exception '% 재고가 부족합니다.', v_menu.name;
      end if;
      v_before := v_menu.stock_quantity;
      v_after := v_menu.stock_quantity - v_qty;
      update menu_items
      set stock_quantity = v_after,
          is_sold_out = case when v_after = 0 then true else is_sold_out end
      where id = v_menu.id;

      insert into inventory_logs (menu_item_id, order_id, change_amount, reason, before_quantity, after_quantity, actor_staff_id)
      values (v_menu.id, v_order_id, -v_qty, 'order_created', v_before, v_after, p_staff_id);
    end if;

    v_subtotal := v_menu.price * v_qty;
    v_total := v_total + v_subtotal;

    insert into order_items (order_id, menu_item_id, item_name_snapshot, item_price_snapshot, quantity, subtotal)
    values (v_order_id, v_menu.id, v_menu.name, v_menu.price, v_qty, v_subtotal);
  end loop;

  update orders
  set total_amount = v_total,
      change_amount = greatest(coalesce(p_received_amount, v_total) - v_total, 0)
  where id = v_order_id;

  insert into payments (order_id, payment_method, payment_status, amount, received_amount, change_amount)
  values (v_order_id, p_payment_method, p_payment_status, v_total, p_received_amount, greatest(coalesce(p_received_amount, v_total) - v_total, 0));

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (
    p_staff_id, v_staff.name, v_staff.role, 'order_created', 'order', v_order_id::text,
    jsonb_build_object('order_number', v_order_number, 'total_amount', v_total, 'payment_status', p_payment_status)
  );

  return v_order_id;
end;
$$;

create or replace function cancel_pos_order(
  p_staff_id uuid,
  p_order_id uuid,
  p_reason text default ''
)
returns void
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_order orders;
  v_row order_items;
  v_menu menu_items;
  v_before integer;
  v_after integer;
begin
  select * into v_staff from staff where id = p_staff_id and status = 'approved';
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

  for v_row in select * from order_items where order_id = p_order_id
  loop
    select * into v_menu from menu_items where id = v_row.menu_item_id for update;
    if found and not v_menu.stock_unknown then
      v_before := v_menu.stock_quantity;
      v_after := coalesce(v_menu.stock_quantity, 0) + v_row.quantity;
      update menu_items set stock_quantity = v_after, is_sold_out = false where id = v_menu.id;
      insert into inventory_logs (menu_item_id, order_id, change_amount, reason, before_quantity, after_quantity, actor_staff_id)
      values (v_menu.id, p_order_id, v_row.quantity, 'order_canceled', v_before, v_after, p_staff_id);
    end if;
  end loop;

  update orders
  set status = '취소', canceled_at = now(), cancel_reason = coalesce(nullif(trim(p_reason), ''), '취소')
  where id = p_order_id;

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, before_value, after_value)
  values (
    p_staff_id, v_staff.name, v_staff.role, 'order_canceled', 'order', p_order_id::text,
    to_jsonb(v_order), jsonb_build_object('status', '취소', 'reason', p_reason)
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
  select * into v_staff from staff where id = p_staff_id and status = 'approved' and role = 'admin';
  if not found then
    raise exception '백업 권한이 없습니다.';
  end if;

  select jsonb_build_object(
    'settings', (select to_jsonb(s) from settings s where id = 'event'),
    'staff', (select coalesce(jsonb_agg(s), '[]'::jsonb) from staff s),
    'menu_items', (select coalesce(jsonb_agg(m), '[]'::jsonb) from menu_items m),
    'orders', (select coalesce(jsonb_agg(o), '[]'::jsonb) from orders o),
    'order_items', (select coalesce(jsonb_agg(oi), '[]'::jsonb) from order_items oi),
    'payments', (select coalesce(jsonb_agg(p), '[]'::jsonb) from payments p),
    'inventory_logs', (select coalesce(jsonb_agg(i), '[]'::jsonb) from inventory_logs i),
    'activity_logs', (select coalesce(jsonb_agg(a), '[]'::jsonb) from activity_logs a)
  ) into v_snapshot;

  insert into backups (backup_type, snapshot, created_by_staff_id)
  values (p_backup_type, v_snapshot, p_staff_id)
  returning id into v_backup_id;

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (p_staff_id, v_staff.name, v_staff.role, 'backup_created', 'backup', v_backup_id::text, jsonb_build_object('backup_type', p_backup_type));

  return v_backup_id;
end;
$$;

alter table staff replica identity full;
alter table menu_items replica identity full;
alter table orders replica identity full;
alter table order_items replica identity full;
alter table payments replica identity full;
alter table activity_logs replica identity full;
alter table inventory_logs replica identity full;
alter table settings replica identity full;
alter table backups replica identity full;

alter publication supabase_realtime add table staff;
alter publication supabase_realtime add table menu_items;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table payments;
alter publication supabase_realtime add table activity_logs;
alter publication supabase_realtime add table inventory_logs;
alter publication supabase_realtime add table settings;
alter publication supabase_realtime add table backups;

alter table staff enable row level security;
alter table settings enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table activity_logs enable row level security;
alter table inventory_logs enable row level security;
alter table backups enable row level security;

create policy "event read staff" on staff for select using (true);
create policy "event write staff" on staff for all using (true) with check (true);
create policy "event read settings" on settings for select using (true);
create policy "event write settings" on settings for all using (true) with check (true);
create policy "event read menu" on menu_items for select using (true);
create policy "event write menu" on menu_items for all using (true) with check (true);
create policy "event read orders" on orders for select using (true);
create policy "event write orders" on orders for all using (true) with check (true);
create policy "event read order items" on order_items for select using (true);
create policy "event write order items" on order_items for all using (true) with check (true);
create policy "event read payments" on payments for select using (true);
create policy "event write payments" on payments for all using (true) with check (true);
create policy "event read logs" on activity_logs for select using (true);
create policy "event write logs" on activity_logs for all using (true) with check (true);
create policy "event read inventory logs" on inventory_logs for select using (true);
create policy "event write inventory logs" on inventory_logs for all using (true) with check (true);
create policy "event read backups" on backups for select using (true);
create policy "event write backups" on backups for all using (true) with check (true);
