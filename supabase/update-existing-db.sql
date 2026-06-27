alter table orders
add column if not exists memo text not null default '';

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
    jsonb_build_object('order_number', v_order_number, 'total_amount', v_total, 'payment_status', p_payment_status, 'memo', left(coalesce(trim(p_memo), ''), 120))
  );

  return v_order_id;
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

  delete from backups;
  delete from inventory_logs;
  delete from payments;
  delete from order_items;
  delete from orders;
  delete from activity_logs;

  update settings
  set next_order_number = 1
  where id = 'event';

  insert into activity_logs (actor_staff_id, actor_name, actor_role, action_type, target_type, target_id, after_value)
  values (p_staff_id, v_staff.name, v_staff.role, 'test_data_reset', 'settings', 'event', jsonb_build_object('next_order_number', 1));
end;
$$;
