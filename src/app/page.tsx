"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Coffee,
  Download,
  History,
  LogOut,
  Package,
  Save,
  ShieldCheck,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fullTime, orderNo, shortTime, won } from "@/lib/format";
import { getDeviceSessionId, isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  ActivityLog,
  Backup,
  Cart,
  MenuItem,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  Payment,
  PaymentStatus,
  Settings,
  Staff,
  StaffRole,
} from "@/lib/types";

type TableName =
  | "staff"
  | "settings"
  | "menu_items"
  | "orders"
  | "order_items"
  | "payments"
  | "activity_logs"
  | "backups";

type Notice = { kind: "ok" | "warn"; text: string } | null;

const roleLabel: Record<StaffRole, string> = {
  admin: "관리자",
  cashier: "계산",
  maker: "제조",
};

const nextStatus: Record<OrderStatus, OrderStatus | null> = {
  접수: "제조",
  제조: "제조 완료",
  "제조 완료": "픽업 완료",
  "픽업 완료": null,
  취소: null,
};

const nextAction: Partial<Record<OrderStatus, string>> = {
  접수: "제조 시작",
  제조: "제조 완료",
  "제조 완료": "픽업 완료",
};

const actionLabel: Record<string, string> = {
  order_created: "주문 생성",
  order_canceled: "주문 취소",
  payment_changed: "결제 변경",
  status_changed: "상태 변경",
  menu_created: "메뉴 추가",
  menu_updated: "메뉴 수정",
  menu_deleted: "메뉴 삭제",
  menu_sold_out_changed: "품절 변경",
  inventory_changed: "재고 변경",
  staff_requested: "승인 요청",
  staff_approved: "직원 승인",
  staff_role_changed: "역할 변경",
  staff_revoked: "승인 해제",
  settings_updated: "설정 변경",
  backup_created: "백업 생성",
  export_created: "엑셀 내보내기",
};

const emptySettings: Settings = {
  id: "event",
  event_name: "새누리교회 일일카페 POS",
  next_order_number: 1,
  low_stock_threshold: 5,
  bank_account: "",
  bank_qr_url: "",
  last_backup_at: null,
  last_automatic_backup_at: null,
  updated_at: new Date().toISOString(),
};

function sortNewest<T extends { created_at: string }>(items: T[]) {
  return [...items].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export default function Home() {
  const [deviceId, setDeviceId] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [activeView, setActiveView] = useState<"cashier" | "maker" | "admin">("cashier");

  const currentStaff = useMemo(
    () => staff.find((entry) => entry.device_session_id === deviceId) ?? null,
    [deviceId, staff],
  );

  const approved = currentStaff?.approval_status === "approved" ? currentStaff : null;

  const reload = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [
      staffResult,
      settingsResult,
      menuResult,
      ordersResult,
      itemsResult,
      paymentsResult,
      logsResult,
      backupsResult,
    ] = await Promise.all([
      supabase.from("staff").select("*"),
      supabase.from("settings").select("*").eq("id", "event").maybeSingle(),
      supabase.from("menu_items").select("*"),
      supabase.from("orders").select("*"),
      supabase.from("order_items").select("*"),
      supabase.from("payments").select("*"),
      supabase.from("activity_logs").select("*"),
      supabase.from("backups").select("*"),
    ]);

    const errors = [
      staffResult.error,
      settingsResult.error,
      menuResult.error,
      ordersResult.error,
      itemsResult.error,
      paymentsResult.error,
      logsResult.error,
      backupsResult.error,
    ].filter(Boolean);

    if (errors.length) {
      setNotice({ kind: "warn", text: errors[0]?.message ?? "데이터를 불러오지 못했습니다." });
    } else {
      setStaff((staffResult.data ?? []) as Staff[]);
      setSettings(((settingsResult.data as Settings | null) ?? emptySettings) as Settings);
      setMenu(sortNewest((menuResult.data ?? []) as MenuItem[]));
      setOrders(sortNewest((ordersResult.data ?? []) as Order[]));
      setOrderItems((itemsResult.data ?? []) as OrderItem[]);
      setPayments((paymentsResult.data ?? []) as Payment[]);
      setLogs(sortNewest((logsResult.data ?? []) as ActivityLog[]));
      setBackups(sortNewest((backupsResult.data ?? []) as Backup[]));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const loadDeviceId = async () => {
      setDeviceId(getDeviceSessionId());
    };
    void loadDeviceId();
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !deviceId) return;
    const load = async () => {
      await reload();
    };
    void load();
    const channel = client.channel("pos-realtime");
    const tables: TableName[] = [
      "staff",
      "settings",
      "menu_items",
      "orders",
      "order_items",
      "payments",
      "activity_logs",
      "backups",
    ];
    tables.forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void reload(),
      );
    });
    channel.subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [deviceId, reload]);

  useEffect(() => {
    const client = supabase;
    if (!client || approved?.role !== "admin") return;
    const timer = window.setInterval(() => {
      void client.rpc("create_backup_snapshot", {
        p_staff_id: approved.id,
        p_backup_type: "automatic",
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [approved]);

  const logAction = async (
    actionType: string,
    targetType: string,
    targetId: string,
    beforeValue: unknown,
    afterValue: unknown,
  ) => {
    if (!supabase || !approved) return;
    await supabase.from("activity_logs").insert({
      staff_id: approved.id,
      staff_name: approved.name,
      staff_role: approved.role,
      action_type: actionType,
      target_type: targetType,
      target_id: targetId,
      before_value: beforeValue,
      after_value: afterValue,
    });
  };

  if (!isSupabaseConfigured) return <ConfigScreen />;
  if (loading && !staff.length) return <Splash text="데이터를 불러오는 중" />;

  if (!approved) {
    return (
      <AccessScreen
        currentStaff={currentStaff}
        hasAnyStaff={staff.length > 0}
        setNotice={setNotice}
      />
    );
  }

  const visibleMenu = menu.filter((item) => !item.deleted_at);
  const activeOrders = orders.filter((order) => !["픽업 완료", "취소"].includes(order.status));
  const completedOrders = orders.filter((order) => order.status === "픽업 완료");
  const canceledOrders = orders.filter((order) => order.status === "취소");

  const displayedView =
    activeView === "admin" && approved.role !== "admin"
      ? approved.role === "maker"
        ? "maker"
        : "cashier"
      : activeView;

  return (
    <main className="min-h-screen bg-[#f7f7f4] pb-24 text-[#1f2523]">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#f7f7f4]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-emerald-700">새누리교회</p>
            <h1 className="text-lg font-black leading-tight">일일카페 POS</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold shadow-sm">
              {approved.name} · {roleLabel[approved.role!]}
            </span>
            <button
              aria-label="로그아웃"
              title="로그아웃"
              className="grid h-10 w-10 place-items-center rounded-lg border border-stone-200 bg-white"
              onClick={() => {
                localStorage.removeItem("saenuri-cafe-device-session");
                location.reload();
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {notice ? (
        <button
          className={`fixed left-4 right-4 top-20 z-30 rounded-lg px-4 py-3 text-left text-sm font-bold shadow-lg ${
            notice.kind === "ok" ? "bg-emerald-700 text-white" : "bg-amber-300 text-stone-950"
          }`}
          onClick={() => setNotice(null)}
        >
          {notice.text}
        </button>
      ) : null}

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[260px_1fr]">
        <nav className="grid grid-cols-3 gap-2 lg:sticky lg:top-20 lg:block lg:h-fit lg:space-y-2">
          <NavButton active={displayedView === "cashier"} onClick={() => setActiveView("cashier")}>
            주문하기
          </NavButton>
          <NavButton active={displayedView === "maker"} onClick={() => setActiveView("maker")}>
            제조 화면
          </NavButton>
          {approved.role === "admin" ? (
            <NavButton active={displayedView === "admin"} onClick={() => setActiveView("admin")}>
              관리자
            </NavButton>
          ) : null}
        </nav>

        {displayedView === "cashier" && ["admin", "cashier"].includes(approved.role!) ? (
          <CashierScreen
            staff={approved}
            menu={visibleMenu}
            orders={orders}
            orderItems={orderItems}
            settings={settings}
            setNotice={setNotice}
          />
        ) : null}

        {displayedView === "maker" ? (
          <MakerScreen
            staff={approved}
            orders={activeOrders}
            orderItems={orderItems}
            onLog={logAction}
            setNotice={setNotice}
          />
        ) : null}

        {displayedView === "admin" && approved.role === "admin" ? (
          <AdminScreen
            staff={approved}
            staffList={staff}
            menu={visibleMenu}
            orders={orders}
            activeOrders={activeOrders}
            completedOrders={completedOrders}
            canceledOrders={canceledOrders}
            orderItems={orderItems}
            payments={payments}
            logs={logs}
            backups={backups}
            settings={settings}
            onLog={logAction}
            setNotice={setNotice}
          />
        ) : null}
      </div>
    </main>
  );
}

function ConfigScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f4] p-5">
      <section className="w-full max-w-xl rounded-lg border border-amber-300 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-amber-700">
          <AlertTriangle />
          <h1 className="text-xl font-black">Supabase 설정 필요</h1>
        </div>
        <p className="text-sm leading-6 text-stone-700">
          `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_ANON_KEY`를
          입력한 뒤 다시 실행해 주세요. Supabase SQL 편집기에는 `supabase/schema.sql`을
          먼저 실행하면 됩니다.
        </p>
      </section>
    </main>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f4]">
      <div className="rounded-lg bg-white px-5 py-4 text-sm font-bold shadow-sm">{text}</div>
    </main>
  );
}

function AccessScreen({
  currentStaff,
  hasAnyStaff,
  setNotice,
}: {
  currentStaff: Staff | null;
  hasAnyStaff: boolean;
  setNotice: (notice: Notice) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>(hasAnyStaff ? "cashier" : "admin");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.rpc("create_staff_request", {
      p_name: name,
      p_requested_role: role,
      p_device_session_id: getDeviceSessionId(),
    });
    setSaving(false);
    if (error) setNotice({ kind: "warn", text: error.message });
    else setNotice({ kind: "ok", text: hasAnyStaff ? "승인 요청을 보냈습니다." : "첫 관리자로 시작합니다." });
  };

  if (currentStaff?.approval_status === "pending") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f7f4] p-4">
        <section className="w-full max-w-md rounded-lg bg-white p-5 text-center shadow-sm">
          <ShieldCheck className="mx-auto mb-3 text-emerald-700" size={40} />
          <h1 className="text-xl font-black">관리자 승인 대기 중</h1>
          <p className="mt-2 text-sm text-stone-600">
            {currentStaff.name}님의 {roleLabel[currentStaff.requested_role]} 권한 요청이 접수되었습니다.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f4] p-4">
      <section className="w-full max-w-md rounded-lg bg-white p-5 shadow-sm">
        <Coffee className="mb-3 text-emerald-700" size={36} />
        <h1 className="text-2xl font-black">새누리교회 일일카페 POS</h1>
        <p className="mt-2 text-sm text-stone-600">
          이름과 역할을 입력해 주세요. 승인 후 이 기기는 새로고침해도 유지됩니다.
        </p>
        {!hasAnyStaff ? (
          <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
            첫 접속자는 관리자 계정으로 자동 승인됩니다.
          </p>
        ) : null}
        <label className="mt-5 block text-sm font-bold">이름</label>
        <input
          className="mt-2 h-12 w-full rounded-lg border border-stone-300 px-3"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="예: 김새누리"
        />
        <label className="mt-4 block text-sm font-bold">요청 역할</label>
        <select
          className="mt-2 h-12 w-full rounded-lg border border-stone-300 px-3"
          value={role}
          onChange={(event) => setRole(event.target.value as StaffRole)}
        >
          <option value="admin">관리자</option>
          <option value="cashier">계산</option>
          <option value="maker">제조</option>
        </select>
        <button
          className="mt-5 h-14 w-full rounded-lg bg-emerald-700 text-base font-black text-white disabled:opacity-50"
          disabled={saving || name.trim().length < 2}
          onClick={submit}
        >
          {saving ? "요청 중" : "승인 요청"}
        </button>
      </section>
    </main>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`h-12 rounded-lg px-3 text-sm font-black lg:w-full ${
        active ? "bg-stone-950 text-white" : "border border-stone-200 bg-white text-stone-800"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CashierScreen({
  staff,
  menu,
  orders,
  orderItems,
  settings,
  setNotice,
}: {
  staff: Staff;
  menu: MenuItem[];
  orders: Order[];
  orderItems: OrderItem[];
  settings: Settings;
  setNotice: (notice: Notice) => void;
}) {
  const [cart, setCart] = useState<Cart>({});
  const [method, setMethod] = useState<PaymentMethod>("현금");
  const [paidStatus, setPaidStatus] = useState<PaymentStatus>("결제 완료");
  const [received, setReceived] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({ item: menu.find((entry) => entry.id === id), quantity }))
        .filter((entry): entry is { item: MenuItem; quantity: number } => Boolean(entry.item) && entry.quantity > 0),
    [cart, menu],
  );
  const total = selectedItems.reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0);
  const change = Math.max(Number(received || 0) - total, 0);

  const submit = async () => {
    if (!supabase || !selectedItems.length || submitting) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("create_pos_order", {
      p_staff_id: staff.id,
      p_items: selectedItems.map((entry) => ({
        menuItemId: entry.item.id,
        quantity: entry.quantity,
      })),
      p_payment_method: method,
      p_paid_status: paidStatus,
      p_received_amount: method === "현금" ? Number(received || total) : null,
      p_note: note,
    });
    setSubmitting(false);
    if (error) {
      setNotice({ kind: "warn", text: error.message });
      return;
    }
    setCart({});
    setReceived("");
    setNote("");
    setPaidStatus("결제 완료");
    setNotice({ kind: "ok", text: "주문이 접수되었습니다." });
  };

  const recent = orders.slice(0, 8);

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Panel title="메뉴" icon={<Coffee size={20} />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {menu
              .filter((item) => !item.hidden)
              .map((item) => {
                const disabled = item.sold_out || (!item.stock_unknown && item.stock_quantity === 0);
                return (
                  <button
                    key={item.id}
                    disabled={disabled}
                    className={`min-h-28 rounded-lg border p-3 text-left ${
                      disabled
                        ? "border-stone-200 bg-stone-100 text-stone-400"
                        : "border-stone-300 bg-white shadow-sm active:scale-[0.99]"
                    }`}
                    onClick={() => setCart((current) => ({ ...current, [item.id]: (current[item.id] ?? 0) + 1 }))}
                  >
                    <div className="text-lg font-black">{item.name}</div>
                    <div className="mt-1 text-sm font-bold text-emerald-700">{won(item.price)}</div>
                    <div className="mt-3 text-xs font-bold">
                      {disabled ? "품절" : item.stock_unknown ? "재고 미정" : `재고 ${item.stock_quantity}`}
                    </div>
                  </button>
                );
              })}
          </div>
        </Panel>

        <Panel title="최근 주문" icon={<Ticket size={20} />}>
          <OrderList
            orders={recent}
            orderItems={orderItems}
            emptyText="최근 주문이 없습니다."
            compact
          />
        </Panel>
      </div>

      <aside className="space-y-4">
        <Panel title="주문하기" icon={<Ticket size={20} />}>
          <div className="space-y-3">
            {selectedItems.length ? (
              selectedItems.map(({ item, quantity }) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-stone-50 p-3">
                  <div>
                    <div className="font-black">{item.name}</div>
                    <div className="text-sm text-stone-600">{won(item.price)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <QtyButton onClick={() => setCart((current) => ({ ...current, [item.id]: Math.max(quantity - 1, 0) }))}>
                      -
                    </QtyButton>
                    <span className="w-8 text-center text-lg font-black">{quantity}</span>
                    <QtyButton onClick={() => setCart((current) => ({ ...current, [item.id]: quantity + 1 }))}>
                      +
                    </QtyButton>
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-lg bg-stone-50 p-4 text-center text-sm font-bold text-stone-500">
                메뉴를 눌러 주문을 담아 주세요.
              </p>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-4">
            <span className="text-sm font-bold">총액</span>
            <strong className="text-2xl">{won(total)}</strong>
          </div>

          <Segmented
            value={method}
            options={["현금", "계좌이체"]}
            onChange={(value) => setMethod(value as PaymentMethod)}
          />
          {method === "현금" ? (
            <div>
              <label className="text-sm font-bold">받은 금액</label>
              <input
                className="mt-2 h-12 w-full rounded-lg border border-stone-300 px-3"
                inputMode="numeric"
                value={received}
                onChange={(event) => setReceived(event.target.value.replace(/\D/g, ""))}
                placeholder={String(total)}
              />
              <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-lg font-black text-emerald-800">
                거스름돈 {won(change)}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4">
              <div className="text-sm font-bold">계좌이체</div>
              <p className="mt-1 text-sm text-stone-600">
                {settings.bank_account || "관리자 설정에서 계좌번호를 입력해 주세요."}
              </p>
              <div className="mt-3 grid aspect-square place-items-center rounded-lg bg-white text-center text-xs font-bold text-stone-400">
                {settings.bank_qr_url ? "QR 이미지 등록됨" : "QR 코드 영역"}
              </div>
            </div>
          )}
          <Segmented
            value={paidStatus}
            options={["결제 완료", "미결제"]}
            onChange={(value) => setPaidStatus(value as PaymentStatus)}
          />
          {paidStatus === "미결제" ? (
            <p className="rounded-lg bg-amber-100 p-3 text-sm font-black text-amber-900">미결제 주문으로 표시됩니다.</p>
          ) : null}
          <textarea
            className="h-20 w-full rounded-lg border border-stone-300 p-3"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="메모"
          />
          <button
            className="h-14 w-full rounded-lg bg-emerald-700 text-lg font-black text-white disabled:opacity-50"
            disabled={!selectedItems.length || submitting}
            onClick={submit}
          >
            {submitting ? "접수 중" : "주문 접수"}
          </button>
        </Panel>
      </aside>
    </section>
  );
}

function MakerScreen({
  staff,
  orders,
  orderItems,
  onLog,
  setNotice,
}: {
  staff: Staff;
  orders: Order[];
  orderItems: OrderItem[];
  onLog: (actionType: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const advance = async (order: Order) => {
    if (!supabase) return;
    const to = nextStatus[order.status];
    if (!to) return;
    if (to === "픽업 완료" && order.paid_status === "미결제" && !confirm("미결제 주문입니다. 픽업 완료로 변경할까요?")) return;
    const { error } = await supabase.from("orders").update({ status: to }).eq("id", order.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await onLog("status_changed", "order", order.id, { status: order.status }, { status: to });
      setNotice({ kind: "ok", text: `#${orderNo(order.order_number)} ${to}` });
    }
  };

  return (
    <section className="space-y-4">
      <Panel title="제조 화면" icon={<Ticket size={20} />}>
        <div className="grid gap-3 lg:grid-cols-2">
          {orders.length ? (
            orders.map((order) => (
              <KitchenTicket
                key={order.id}
                order={order}
                items={orderItems.filter((item) => item.order_id === order.id)}
                actionDisabled={staff.role === "cashier"}
                onAdvance={() => advance(order)}
              />
            ))
          ) : (
            <p className="rounded-lg bg-stone-50 p-6 text-center font-bold text-stone-500">진행 중인 주문이 없습니다.</p>
          )}
        </div>
      </Panel>
    </section>
  );
}

function KitchenTicket({
  order,
  items,
  actionDisabled,
  onAdvance,
}: {
  order: Order;
  items: OrderItem[];
  actionDisabled: boolean;
  onAdvance: () => void;
}) {
  return (
    <article className="rounded-lg border-2 border-stone-900 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-3xl font-black">#{orderNo(order.order_number)}</div>
          <div className="mt-1 text-sm font-bold text-stone-500">{shortTime(order.created_at)}</div>
        </div>
        <StatusBadge status={order.status} />
      </div>
      {order.paid_status === "미결제" ? (
        <div className="mt-3 rounded-lg bg-amber-100 p-3 text-sm font-black text-amber-900">미결제</div>
      ) : null}
      <div className="my-4 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex justify-between text-xl font-black">
            <span>{item.name}</span>
            <span>x {item.quantity}</span>
          </div>
        ))}
      </div>
      {order.note ? <p className="mb-3 rounded-lg bg-stone-100 p-3 text-sm font-bold">{order.note}</p> : null}
      {nextAction[order.status] ? (
        <button
          className="h-14 w-full rounded-lg bg-stone-950 text-lg font-black text-white disabled:bg-stone-300"
          disabled={actionDisabled}
          onClick={onAdvance}
        >
          {nextAction[order.status]}
        </button>
      ) : null}
    </article>
  );
}

function AdminScreen(props: {
  staff: Staff;
  staffList: Staff[];
  menu: MenuItem[];
  orders: Order[];
  activeOrders: Order[];
  completedOrders: Order[];
  canceledOrders: Order[];
  orderItems: OrderItem[];
  payments: Payment[];
  logs: ActivityLog[];
  backups: Backup[];
  settings: Settings;
  onLog: (actionType: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [section, setSection] = useState("summary");
  const paid = props.orders.filter((order) => order.paid_status === "결제 완료" && order.status !== "취소");
  const unpaid = props.orders.filter((order) => order.paid_status === "미결제" && order.status !== "취소");
  const totalSales = paid.reduce((sum, order) => sum + order.total_amount, 0);

  return (
    <section className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          ["summary", "요약"],
          ["menu", "메뉴"],
          ["inventory", "재고"],
          ["orders", "주문"],
          ["staff", "직원"],
          ["history", "기록"],
          ["export", "백업"],
          ["preview", "화면 미리보기"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`h-11 shrink-0 rounded-lg px-4 text-sm font-black ${
              section === id ? "bg-emerald-700 text-white" : "bg-white"
            }`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "summary" ? (
        <Panel title="오늘 요약" icon={<CheckCircle2 size={20} />}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Metric label="총 매출" value={won(totalSales)} />
            <Metric label="주문 수" value={`${props.orders.filter((o) => o.status !== "취소").length}건`} />
            <Metric label="결제 완료" value={`${paid.length}건`} />
            <Metric label="미결제" value={`${unpaid.length}건`} warning={unpaid.length > 0} />
            <Metric label="진행 중" value={`${props.activeOrders.length}건`} />
            <Metric label="완료" value={`${props.completedOrders.length}건`} />
          </div>
        </Panel>
      ) : null}

      {section === "menu" ? (
        <MenuAdmin {...props} />
      ) : null}

      {section === "inventory" ? (
        <InventoryAdmin {...props} />
      ) : null}

      {section === "orders" ? (
        <OrdersAdmin {...props} />
      ) : null}

      {section === "staff" ? (
        <StaffAdmin {...props} />
      ) : null}

      {section === "history" ? (
        <Panel title="기록" icon={<History size={20} />}>
          <LogList logs={props.logs} />
        </Panel>
      ) : null}

      {section === "export" ? (
        <ExportAdmin {...props} />
      ) : null}

      {section === "preview" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <CashierScreen
            staff={props.staff}
            menu={props.menu}
            orders={props.orders}
            orderItems={props.orderItems}
            settings={props.settings}
            setNotice={props.setNotice}
          />
          <MakerScreen
            staff={props.staff}
            orders={props.activeOrders}
            orderItems={props.orderItems}
            onLog={props.onLog}
            setNotice={props.setNotice}
          />
        </div>
      ) : null}
    </section>
  );
}

function MenuAdmin({
  menu,
  onLog,
  setNotice,
}: {
  menu: MenuItem[];
  onLog: (actionType: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const [draft, setDraft] = useState({ name: "", price: "3000" });

  const save = async (item: MenuItem, patch: Partial<MenuItem>) => {
    if (!supabase) return;
    const after = { ...item, ...patch };
    const { error } = await supabase.from("menu_items").update(patch).eq("id", item.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await onLog("menu_updated", "menu_item", item.id, item, after);
      setNotice({ kind: "ok", text: "메뉴가 저장되었습니다." });
    }
  };

  const create = async () => {
    if (!supabase || !draft.name.trim()) return;
    const { data, error } = await supabase
      .from("menu_items")
      .insert({ name: draft.name.trim(), price: Number(draft.price || 0), stock_unknown: true })
      .select()
      .single();
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await onLog("menu_created", "menu_item", (data as MenuItem).id, null, data);
      setDraft({ name: "", price: "3000" });
    }
  };

  return (
    <Panel title="메뉴 관리" icon={<Coffee size={20} />}>
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_140px_120px]">
        <input
          className="h-12 rounded-lg border border-stone-300 px-3"
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder="메뉴 이름"
        />
        <input
          className="h-12 rounded-lg border border-stone-300 px-3"
          inputMode="numeric"
          value={draft.price}
          onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value.replace(/\D/g, "") }))}
          placeholder="가격"
        />
        <button className="h-12 rounded-lg bg-emerald-700 font-black text-white" onClick={create}>
          추가
        </button>
      </div>
      <div className="space-y-3">
        {menu.map((item) => (
          <div key={item.id} className="grid gap-2 rounded-lg border border-stone-200 bg-white p-3 md:grid-cols-[1fr_130px_repeat(4,90px)]">
            <input
              className="h-11 rounded-lg border border-stone-300 px-3 font-bold"
              defaultValue={item.name}
              onBlur={(event) => event.target.value !== item.name && save(item, { name: event.target.value })}
            />
            <input
              className="h-11 rounded-lg border border-stone-300 px-3"
              defaultValue={item.price}
              inputMode="numeric"
              onBlur={(event) => Number(event.target.value) !== item.price && save(item, { price: Number(event.target.value || 0) })}
            />
            <IconButton title="품절" active={item.sold_out} onClick={() => save(item, { sold_out: !item.sold_out })}>
              품절
            </IconButton>
            <IconButton title="숨김" active={item.hidden} onClick={() => save(item, { hidden: !item.hidden })}>
              숨김
            </IconButton>
            <IconButton title="저장" onClick={() => setNotice({ kind: "ok", text: "현재 값은 자동 저장됩니다." })}>
              <Save size={18} />
            </IconButton>
            <IconButton
              title="삭제"
              onClick={async () => {
                if (!supabase || !confirm(`${item.name} 메뉴를 삭제 처리할까요?`)) return;
                await supabase.from("menu_items").update({ deleted_at: new Date().toISOString() }).eq("id", item.id);
                await onLog("menu_deleted", "menu_item", item.id, item, { deleted_at: new Date().toISOString() });
              }}
            >
              <Trash2 size={18} />
            </IconButton>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function InventoryAdmin({
  menu,
  settings,
  onLog,
  setNotice,
}: {
  menu: MenuItem[];
  settings: Settings;
  onLog: (actionType: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const updateItem = async (item: MenuItem, patch: Partial<MenuItem>) => {
    if (!supabase) return;
    const { error } = await supabase.from("menu_items").update(patch).eq("id", item.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else await onLog("inventory_changed", "menu_item", item.id, item, { ...item, ...patch });
  };

  return (
    <Panel title="재고" icon={<Package size={20} />}>
      <div className="mb-4 grid gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-[1fr_160px]">
        <label className="font-bold">부족 경고 기준</label>
        <input
          className="h-11 rounded-lg border border-stone-300 px-3"
          inputMode="numeric"
          defaultValue={settings.low_stock_threshold}
          onBlur={async (event) => {
            if (!supabase) return;
            const next = Number(event.target.value || 0);
            await supabase.from("settings").update({ low_stock_threshold: next }).eq("id", "event");
          }}
        />
      </div>
      <div className="space-y-3">
        {menu.map((item) => {
          const low = !item.stock_unknown && Number(item.stock_quantity) <= settings.low_stock_threshold;
          return (
            <div key={item.id} className={`rounded-lg border p-3 ${low ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-white"}`}>
              <div className="flex items-center justify-between gap-3">
                <strong>{item.name}</strong>
                {low ? <span className="text-sm font-black text-amber-800">재고 부족</span> : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_130px_100px]">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={item.stock_unknown}
                    onChange={(event) => updateItem(item, { stock_unknown: event.target.checked, stock_quantity: event.target.checked ? null : 0 })}
                  />
                  재고 미정
                </label>
                <input
                  className="h-11 rounded-lg border border-stone-300 px-3"
                  disabled={item.stock_unknown}
                  defaultValue={item.stock_quantity ?? ""}
                  inputMode="numeric"
                  onBlur={(event) =>
                    updateItem(item, {
                      stock_quantity: Number(event.target.value || 0),
                      stock_unknown: false,
                      sold_out: Number(event.target.value || 0) === 0,
                    })
                  }
                />
                <button
                  className={`h-11 rounded-lg font-black ${item.sold_out ? "bg-rose-700 text-white" : "bg-stone-100"}`}
                  onClick={() => updateItem(item, { sold_out: !item.sold_out })}
                >
                  품절
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function OrdersAdmin({
  orders,
  activeOrders,
  completedOrders,
  canceledOrders,
  orderItems,
  staff,
  onLog,
  setNotice,
}: {
  orders: Order[];
  activeOrders: Order[];
  completedOrders: Order[];
  canceledOrders: Order[];
  orderItems: OrderItem[];
  staff: Staff;
  onLog: (actionType: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const cancel = async (order: Order) => {
    if (!supabase || !confirm(`#${orderNo(order.order_number)} 주문을 취소할까요? 재고가 자동 반환됩니다.`)) return;
    const { error } = await supabase.rpc("cancel_pos_order", { p_staff_id: staff.id, p_order_id: order.id });
    if (error) setNotice({ kind: "warn", text: error.message });
    else setNotice({ kind: "ok", text: "주문이 취소되었습니다." });
  };

  const changePayment = async (order: Order, status: PaymentStatus) => {
    if (!supabase || !confirm("결제 상태를 변경할까요?")) return;
    const { error } = await supabase.from("orders").update({ paid_status: status }).eq("id", order.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await onLog("payment_changed", "order", order.id, { paid_status: order.paid_status }, { paid_status: status });
      setNotice({ kind: "ok", text: "결제 상태가 변경되었습니다." });
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="진행 중 주문" icon={<Ticket size={20} />}>
        <AdminOrderRows orders={activeOrders} orderItems={orderItems} onCancel={cancel} onPayment={changePayment} />
      </Panel>
      <Panel title="미결제 주문" icon={<AlertTriangle size={20} />}>
        <AdminOrderRows orders={orders.filter((order) => order.paid_status === "미결제" && order.status !== "취소")} orderItems={orderItems} onCancel={cancel} onPayment={changePayment} />
      </Panel>
      <Panel title="완료 주문" icon={<CheckCircle2 size={20} />}>
        <AdminOrderRows orders={completedOrders} orderItems={orderItems} onCancel={cancel} onPayment={changePayment} />
      </Panel>
      <Panel title="취소 주문" icon={<Trash2 size={20} />}>
        <OrderList orders={canceledOrders} orderItems={orderItems} emptyText="취소 주문이 없습니다." />
      </Panel>
    </div>
  );
}

function StaffAdmin({
  staffList,
  staff,
  onLog,
  setNotice,
}: {
  staffList: Staff[];
  staff: Staff;
  onLog: (actionType: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
  setNotice: (notice: Notice) => void;
}) {
  const update = async (person: Staff, patch: Partial<Staff>, action: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("staff").update(patch).eq("id", person.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await onLog(action, "staff", person.id, person, { ...person, ...patch });
      setNotice({ kind: "ok", text: "직원 정보가 변경되었습니다." });
    }
  };

  const pending = staffList.filter((person) => person.approval_status === "pending");
  const approved = staffList.filter((person) => person.approval_status === "approved");

  return (
    <div className="space-y-4">
      <Panel title="승인 대기" icon={<Users size={20} />}>
        <div className="space-y-2">
          {pending.length ? (
            pending.map((person) => (
              <div key={person.id} className="grid gap-2 rounded-lg bg-white p-3 sm:grid-cols-[1fr_130px_110px_110px]">
                <strong>{person.name}</strong>
                <span>{roleLabel[person.requested_role]}</span>
                <button
                  className="h-11 rounded-lg bg-emerald-700 font-black text-white"
                  onClick={() =>
                    update(
                      person,
                      {
                        approval_status: "approved",
                        role: person.requested_role,
                        approved_by: staff.id,
                        approved_at: new Date().toISOString(),
                      },
                      "staff_approved",
                    )
                  }
                >
                  승인
                </button>
                <button className="h-11 rounded-lg bg-stone-200 font-black" onClick={() => update(person, { approval_status: "revoked" }, "staff_revoked")}>
                  거절
                </button>
              </div>
            ))
          ) : (
            <p className="rounded-lg bg-stone-50 p-4 text-center text-sm font-bold text-stone-500">대기 중인 요청이 없습니다.</p>
          )}
        </div>
      </Panel>
      <Panel title="승인된 직원" icon={<ShieldCheck size={20} />}>
        <div className="space-y-2">
          {approved.map((person) => (
            <div key={person.id} className="grid gap-2 rounded-lg bg-white p-3 sm:grid-cols-[1fr_150px_100px]">
              <strong>{person.name}</strong>
              <select
                className="h-11 rounded-lg border border-stone-300 px-3"
                value={person.role ?? person.requested_role}
                onChange={(event) => update(person, { role: event.target.value as StaffRole }, "staff_role_changed")}
              >
                <option value="admin">관리자</option>
                <option value="cashier">계산</option>
                <option value="maker">제조</option>
              </select>
              <button className="h-11 rounded-lg bg-stone-200 font-black" onClick={() => update(person, { approval_status: "revoked", revoked_at: new Date().toISOString() }, "staff_revoked")}>
                해제
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ExportAdmin(props: {
  staff: Staff;
  menu: MenuItem[];
  orders: Order[];
  orderItems: OrderItem[];
  payments: Payment[];
  logs: ActivityLog[];
  backups: Backup[];
  settings: Settings;
  setNotice: (notice: Notice) => void;
}) {
  const manualBackup = async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("create_backup_snapshot", {
      p_staff_id: props.staff.id,
      p_backup_type: "manual",
    });
    props.setNotice(error ? { kind: "warn", text: error.message } : { kind: "ok", text: "백업을 만들었습니다." });
  };

  const exportExcel = async () => {
    if (!supabase) return;
    const XLSX = await import("xlsx");
    const summary = [
      {
        총매출: props.orders.filter((o) => o.paid_status === "결제 완료" && o.status !== "취소").reduce((sum, o) => sum + o.total_amount, 0),
        주문수: props.orders.filter((o) => o.status !== "취소").length,
        결제완료: props.orders.filter((o) => o.paid_status === "결제 완료").length,
        미결제: props.orders.filter((o) => o.paid_status === "미결제").length,
        진행중: props.orders.filter((o) => !["픽업 완료", "취소"].includes(o.status)).length,
        완료: props.orders.filter((o) => o.status === "픽업 완료").length,
      },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.orders), "Orders");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.orderItems), "Order items");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.payments), "Payments");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.menu), "Inventory");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.logs), "Staff activity log");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(props.orders.filter((order) => order.status === "취소" || props.logs.some((log) => log.target_id === order.id && ["payment_changed", "status_changed", "order_canceled"].includes(log.action_type)))),
      "Canceled edited orders",
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
    XLSX.writeFile(wb, `새누리교회_일일카페_POS_${new Date().toISOString().slice(0, 10)}.xlsx`);
    await supabase.from("activity_logs").insert({
      staff_id: props.staff.id,
      staff_name: props.staff.name,
      staff_role: props.staff.role,
      action_type: "export_created",
      target_type: "export",
      after_value: summary[0],
    });
  };

  return (
    <Panel title="백업 / 엑셀 내보내기" icon={<Download size={20} />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button className="h-14 rounded-lg bg-stone-950 font-black text-white" onClick={manualBackup}>
          수동 백업
        </button>
        <button className="h-14 rounded-lg bg-emerald-700 font-black text-white" onClick={exportExcel}>
          엑셀 내보내기
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {props.backups.slice(0, 10).map((backup) => (
          <div key={backup.id} className="rounded-lg bg-stone-50 p-3 text-sm font-bold">
            {backup.backup_type === "automatic" ? "자동 백업" : "수동 백업"} · {fullTime(backup.created_at)}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AdminOrderRows({
  orders,
  orderItems,
  onCancel,
  onPayment,
}: {
  orders: Order[];
  orderItems: OrderItem[];
  onCancel: (order: Order) => void;
  onPayment: (order: Order, status: PaymentStatus) => void;
}) {
  if (!orders.length) return <p className="rounded-lg bg-stone-50 p-4 text-center text-sm font-bold text-stone-500">주문이 없습니다.</p>;
  return (
    <div className="space-y-2">
      {orders.map((order) => (
        <div key={order.id} className="rounded-lg bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong>#{orderNo(order.order_number)}</strong>
              <div className="mt-1 text-sm text-stone-600">
                {orderItems
                  .filter((item) => item.order_id === order.id)
                  .map((item) => `${item.name} x${item.quantity}`)
                  .join(", ")}
              </div>
            </div>
            <StatusBadge status={order.status} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <button className="h-11 rounded-lg bg-stone-100 font-black" onClick={() => onPayment(order, order.paid_status === "결제 완료" ? "미결제" : "결제 완료")}>
              {order.paid_status}
            </button>
            <button className="h-11 rounded-lg bg-stone-100 font-black" onClick={() => onCancel(order)}>
              주문 취소
            </button>
            <div className="grid place-items-center rounded-lg bg-stone-50 text-sm font-black">{won(order.total_amount)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrderList({
  orders,
  orderItems,
  emptyText,
  compact = false,
}: {
  orders: Order[];
  orderItems: OrderItem[];
  emptyText: string;
  compact?: boolean;
}) {
  if (!orders.length) return <p className="rounded-lg bg-stone-50 p-4 text-center text-sm font-bold text-stone-500">{emptyText}</p>;
  return (
    <div className="space-y-2">
      {orders.map((order) => (
        <div key={order.id} className="rounded-lg border border-stone-200 bg-white p-3">
          <div className="flex items-start justify-between">
            <div>
              <strong className={compact ? "text-base" : "text-lg"}>#{orderNo(order.order_number)}</strong>
              <div className="text-xs font-bold text-stone-500">{shortTime(order.created_at)}</div>
            </div>
            <div className="flex gap-2">
              {order.paid_status === "미결제" ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-black text-amber-900">미결제</span> : null}
              <StatusBadge status={order.status} />
            </div>
          </div>
          <div className="mt-2 text-sm font-bold text-stone-700">
            {orderItems
              .filter((item) => item.order_id === order.id)
              .map((item) => `${item.name} x${item.quantity}`)
              .join(", ")}
          </div>
          <div className="mt-2 text-right font-black">{won(order.total_amount)}</div>
        </div>
      ))}
    </div>
  );
}

function LogList({ logs }: { logs: ActivityLog[] }) {
  if (!logs.length) return <p className="rounded-lg bg-stone-50 p-4 text-center text-sm font-bold text-stone-500">기록이 없습니다.</p>;
  return (
    <div className="space-y-2">
      {logs.slice(0, 120).map((log) => (
        <div key={log.id} className="rounded-lg bg-white p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <strong>{actionLabel[log.action_type] ?? log.action_type}</strong>
            <span className="text-xs font-bold text-stone-500">{fullTime(log.created_at)}</span>
          </div>
          <p className="mt-1 text-stone-600">
            {log.staff_name} {log.staff_role ? `· ${roleLabel[log.staff_role]}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white/70 p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-black">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-lg p-4 ${warning ? "bg-amber-100 text-amber-950" : "bg-white"}`}>
      <div className="text-xs font-bold text-stone-500">{label}</div>
      <div className="mt-2 text-xl font-black">{value}</div>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="my-4 grid grid-cols-2 rounded-lg bg-stone-100 p-1">
      {options.map((option) => (
        <button
          key={option}
          className={`h-11 rounded-md text-sm font-black ${value === option ? "bg-white shadow-sm" : ""}`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function QtyButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="h-10 w-10 rounded-lg bg-stone-900 text-xl font-black text-white" onClick={onClick}>
      {children}
    </button>
  );
}

function IconButton({
  title,
  active = false,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`grid h-11 place-items-center rounded-lg text-sm font-black ${
        active ? "bg-stone-950 text-white" : "bg-stone-100 text-stone-900"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const color =
    status === "접수"
      ? "bg-sky-100 text-sky-900"
      : status === "제조"
        ? "bg-orange-100 text-orange-900"
        : status === "제조 완료"
          ? "bg-emerald-100 text-emerald-900"
          : status === "취소"
            ? "bg-rose-100 text-rose-900"
            : "bg-stone-200 text-stone-900";
  return <span className={`rounded-full px-2 py-1 text-xs font-black ${color}`}>{status}</span>;
}
