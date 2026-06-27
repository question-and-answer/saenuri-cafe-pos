alter table orders
add column if not exists memo text not null default '';

alter table settings
add column if not exists show_cash_received boolean not null default true;

alter table settings
add column if not exists show_payment_status boolean not null default true;

alter table settings
add column if not exists menu_info_click_adds_item boolean not null default true;

alter table settings
add column if not exists show_order_timer boolean not null default true;

alter table menu_items
add column if not exists prep_required boolean not null default true;

alter table menu_items
add column if not exists prep_area text not null default '기본';

alter table order_items
add column if not exists prep_status text not null default '대기';

alter table order_items
add column if not exists sort_order integer not null default 0;

create or replace function staff_login(
  p_name text,
  p_role text,
  p_device_token text
)
returns staff
language plpgsql
security definer
as $$
declare
  v_staff staff;
begin
  if length(trim(coalesce(p_name, ''))) < 1 then
    raise exception '이름을 입력해 주세요.';
  end if;
  if p_role not in ('cashier', 'maker') then
    raise exception '주문 담당 또는 제조 담당을 선택해 주세요.';
  end if;

  insert into staff (name, requested_role, role, status, device_token, approved_at)
  values (trim(p_name), p_role, p_role, 'approved', p_device_token, now())
  on conflict (device_token) do update
    set name = excluded.name,
        requested_role = excluded.requested_role,
        role = excluded.role,
        status = 'approved',
        approved_at = coalesce(staff.approved_at, now()),
        revoked_at = null
  returning * into v_staff;

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (v_staff.id, v_staff.name, v_staff.role, 'staff_login', 'staff', v_staff.id::text, to_jsonb(v_staff));

  return v_staff;
end;
$$;

create or replace function create_pos_order(
  p_staff_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_payment_status text,
  p_received_amount integer default null,
  p_memo text default null
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
  v_has_prep boolean := false;
  v_sort_order integer := 0;
begin
  select * into v_staff from staff where id = p_staff_id and status = 'approved';
  if not found or v_staff.role not in ('admin', 'cashier', 'maker') then
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

  insert into orders (
    id, order_number, status, payment_status, payment_method, total_amount,
    received_amount, change_amount, memo, created_by_staff_id
  )
  values (
    v_order_id, v_order_number, '접수', p_payment_status, p_payment_method, 0,
    p_received_amount, 0, left(coalesce(trim(p_memo), ''), 120), p_staff_id
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_sort_order := v_sort_order + 1;
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

    if v_menu.prep_required then
      v_has_prep := true;
    end if;

    insert into order_items (order_id, menu_item_id, item_name_snapshot, item_price_snapshot, quantity, subtotal, prep_status, sort_order)
    values (v_order_id, v_menu.id, v_menu.name, v_menu.price, v_qty, v_subtotal, case when v_menu.prep_required then '대기' else '완료' end, v_sort_order);
  end loop;

  update orders
  set total_amount = v_total,
      change_amount = greatest(coalesce(p_received_amount, v_total) - v_total, 0),
      status = case when v_has_prep then status else '제조 완료' end
  where id = v_order_id;

  insert into payments (order_id, payment_method, payment_status, amount, received_amount, change_amount)
  values (v_order_id, p_payment_method, p_payment_status, v_total, p_received_amount, greatest(coalesce(p_received_amount, v_total) - v_total, 0));

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (
    p_staff_id, v_staff.name, v_staff.role, 'order_created', 'order', v_order_id::text,
    jsonb_build_object('order_number', v_order_number, 'total_amount', v_total, 'payment_status', p_payment_status, 'memo', left(coalesce(trim(p_memo), ''), 120))
  );

  return v_order_id;
end;
$$;

create or replace function adjust_order_item_quantity(
  p_staff_id uuid,
  p_order_item_id uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_item order_items;
  v_order orders;
  v_menu menu_items;
  v_delta integer;
  v_before integer;
  v_after integer;
  v_total integer;
begin
  select * into v_staff from staff where id = p_staff_id and status = 'approved';
  if not found or v_staff.role not in ('admin', 'cashier') then
    raise exception '주문 수정 권한이 없습니다.';
  end if;
  if p_quantity < 1 then
    raise exception '수량은 1개 이상이어야 합니다.';
  end if;

  select * into v_item from order_items where id = p_order_item_id for update;
  if not found then
    raise exception '주문 항목을 찾을 수 없습니다.';
  end if;

  select * into v_order from orders where id = v_item.order_id for update;
  if not found or v_order.status in ('취소', '픽업 완료') then
    raise exception '수정할 수 없는 주문입니다.';
  end if;

  v_delta := p_quantity - v_item.quantity;

  select * into v_menu from menu_items where id = v_item.menu_item_id for update;
  if found and not v_menu.stock_unknown and v_delta <> 0 then
    if v_delta > 0 and coalesce(v_menu.stock_quantity, 0) < v_delta then
      raise exception '% 재고가 부족합니다.', v_menu.name;
    end if;
    v_before := v_menu.stock_quantity;
    v_after := coalesce(v_menu.stock_quantity, 0) - v_delta;
    update menu_items
    set stock_quantity = v_after,
        is_sold_out = case when v_after = 0 then true else is_sold_out end
    where id = v_menu.id;

    insert into inventory_logs (menu_item_id, order_id, change_amount, reason, before_quantity, after_quantity, actor_staff_id)
    values (v_menu.id, v_item.order_id, -v_delta, 'order_edited', v_before, v_after, p_staff_id);
  end if;

  update order_items
  set quantity = p_quantity,
      subtotal = item_price_snapshot * p_quantity
  where id = p_order_item_id;

  select coalesce(sum(subtotal), 0) into v_total
  from order_items
  where order_id = v_item.order_id;

  update orders
  set total_amount = v_total,
      change_amount = greatest(coalesce(received_amount, v_total) - v_total, 0)
  where id = v_item.order_id;

  update payments
  set amount = v_total,
      change_amount = greatest(coalesce(received_amount, v_total) - v_total, 0)
  where order_id = v_item.order_id;

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, before_value, after_value)
  values (
    p_staff_id, v_staff.name, v_staff.role, 'order_item_quantity_changed', 'order_item', p_order_item_id::text,
    jsonb_build_object('quantity', v_item.quantity),
    jsonb_build_object('quantity', p_quantity, 'order_total', v_total)
  );
end;
$$;

create or replace function set_order_item_prep_status(
  p_staff_id uuid,
  p_order_item_id uuid,
  p_prep_status text
)
returns void
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_item order_items;
  v_order orders;
  v_pending_count integer;
begin
  select * into v_staff from staff where id = p_staff_id and status = 'approved';
  if not found or v_staff.role not in ('admin', 'maker') then
    raise exception '제조 권한이 없습니다.';
  end if;
  if p_prep_status not in ('대기', '완료') then
    raise exception '제조 상태가 올바르지 않습니다.';
  end if;

  select * into v_item from order_items where id = p_order_item_id for update;
  if not found then
    raise exception '주문 항목을 찾을 수 없습니다.';
  end if;

  select * into v_order from orders where id = v_item.order_id for update;
  if not found or v_order.status in ('픽업 완료', '취소') then
    raise exception '변경할 수 없는 주문입니다.';
  end if;

  update order_items
  set prep_status = p_prep_status
  where id = p_order_item_id;

  select count(*) into v_pending_count
  from order_items oi
  join menu_items m on m.id = oi.menu_item_id
  where oi.order_id = v_item.order_id
    and m.prep_required
    and oi.prep_status <> '완료';

  update orders
  set status = case when v_pending_count = 0 then '제조 완료' else '제조 중' end
  where id = v_item.order_id;

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, before_value, after_value)
  values (
    p_staff_id, v_staff.name, v_staff.role, 'item_prep_changed', 'order_item', p_order_item_id::text,
    jsonb_build_object('prep_status', v_item.prep_status),
    jsonb_build_object('prep_status', p_prep_status)
  );
end;
$$;

create or replace function change_admin_code(
  p_staff_id uuid,
  p_current_code text,
  p_new_code text
)
returns void
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_settings settings;
begin
  select * into v_staff from staff where id = p_staff_id and status = 'approved' and role = 'admin';
  if not found then
    raise exception '관리자 권한이 없습니다.';
  end if;

  select * into v_settings from settings where id = 'event' for update;
  if v_settings.admin_code_hash <> crypt(p_current_code, v_settings.admin_code_hash) then
    raise exception '현재 관리자 코드가 맞지 않습니다.';
  end if;
  if length(trim(coalesce(p_new_code, ''))) < 4 then
    raise exception '새 관리자 코드는 4자리 이상이어야 합니다.';
  end if;

  update settings
  set admin_code_hash = crypt(trim(p_new_code), gen_salt('bf'))
  where id = 'event';

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (p_staff_id, v_staff.name, v_staff.role, 'admin_code_changed', 'settings', 'event', jsonb_build_object('changed', true));
end;
$$;

create or replace function reset_event_test_data(
  p_staff_id uuid,
  p_command text
)
returns void
language plpgsql
security definer
as $$
declare
  v_staff staff;
  v_row record;
begin
  select * into v_staff from staff where id = p_staff_id and status = 'approved' and role = 'admin';
  if not found then
    raise exception '관리자 권한이 없습니다.';
  end if;
  if trim(coalesce(p_command, '')) <> '테스트초기화' then
    raise exception '초기화 명령어가 맞지 않습니다.';
  end if;

  for v_row in
    select oi.menu_item_id, sum(oi.quantity)::integer as quantity
    from order_items oi
    join orders o on o.id = oi.order_id
    join menu_items m on m.id = oi.menu_item_id
    where o.status <> '취소'
      and oi.menu_item_id is not null
      and not m.stock_unknown
    group by oi.menu_item_id
  loop
    update menu_items
    set stock_quantity = coalesce(stock_quantity, 0) + v_row.quantity,
        is_sold_out = false
    where id = v_row.menu_item_id;
  end loop;

  delete from backups where true;
  delete from inventory_logs where true;
  delete from payments where true;
  delete from order_items where true;
  delete from orders where true;
  delete from activity_logs where true;

  update settings
  set next_order_number = 1
  where id = 'event';

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (p_staff_id, v_staff.name, v_staff.role, 'test_data_reset', 'settings', 'event', jsonb_build_object('next_order_number', 1));
end;
$$;
