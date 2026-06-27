"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Coffee,
  Download,
  History,
  ImagePlus,
  LogOut,
  Maximize2,
  Minimize2,
  Package,
  ShieldCheck,
  Ticket,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fullTime, orderNo, shortTime, won } from "@/lib/format";
import { getDeviceSessionId, isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  ActivityLog,
  Backup,
  Cart,
  InventoryLog,
  MenuItem,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Settings,
  Staff,
  StaffRole,
} from "@/lib/types";

type View = "cashier" | "maker" | "admin";
type Notice = { kind: "ok" | "warn"; text: string } | null;

const roleLabel: Record<StaffRole, string> = {
  admin: "관리자",
  cashier: "주문 담당",
  maker: "제조 담당",
};

const actionText: Record<string, string> = {
  staff_requested: "직원 승인 요청",
  staff_admin_login: "관리자 로그인",
  staff_approved: "직원 승인",
  staff_rejected: "직원 거절",
  staff_revoked: "직원 해제",
  staff_role_changed: "역할 변경",
  order_created: "주문 생성",
  order_status_changed: "주문 상태 변경",
  order_canceled: "주문 취소",
  item_prep_changed: "제조 항목 변경",
  payment_changed: "결제 변경",
  menu_created: "메뉴 추가",
  menu_changed: "메뉴 변경",
  inventory_changed: "재고 변경",
  settings_changed: "설정 변경",
  admin_code_changed: "관리자 코드 변경",
  test_data_reset: "테스트 기록 초기화",
  backup_created: "백업 생성",
  export_created: "엑셀 내보내기",
};

const emptySettings: Settings = {
  id: "event",
  event_name: "새누리교회 일일카페 POS",
  admin_code_hash: null,
  next_order_number: 1,
  default_low_stock_threshold: 5,
  bank_account: "",
  bank_qr_note: "",
  show_cash_received: true,
  show_payment_status: true,
  menu_info_click_adds_item: true,
  show_order_timer: true,
  updated_at: new Date().toISOString(),
};

function formatElapsedTime(start: string, end: string | number) {
  const elapsedSeconds = Math.max(0, Math.floor((+new Date(end) - +new Date(start)) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function newest<T extends { created_at: string }>(rows: T[]) {
  return [...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

function stableOrderItems(items: OrderItem[]) {
  return [...items].sort((a, b) => {
    const orderGap = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (orderGap !== 0) return orderGap;
    return a.item_name_snapshot.localeCompare(b.item_name_snapshot, "ko");
  });
}

export default function Home() {
  const [deviceToken, setDeviceToken] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [view, setView] = useState<View | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const seenPendingApprovalCountRef = useRef<number | null>(null);

  const me = useMemo(
    () => staff.find((person) => person.device_token === deviceToken) ?? null,
    [deviceToken, staff],
  );
  const approved = me?.status === "approved" ? me : null;
  const pendingApprovalCount = useMemo(
    () => staff.filter((person) => person.status === "pending").length,
    [staff],
  );

  const reload = useCallback(async () => {
    if (!supabase) return;
    const [
      staffResult,
      menuResult,
      ordersResult,
      itemResult,
      paymentResult,
      logResult,
      inventoryResult,
      backupResult,
      settingsResult,
    ] = await Promise.all([
      supabase.from("staff").select("*"),
      supabase.from("menu_items").select("*"),
      supabase.from("orders").select("*"),
      supabase.from("order_items").select("*"),
      supabase.from("payments").select("*"),
      supabase.from("activity_logs").select("*"),
      supabase.from("inventory_logs").select("*"),
      supabase.from("backups").select("*"),
      supabase.from("settings").select("*").eq("id", "event").maybeSingle(),
    ]);

    const error = [
      staffResult.error,
      menuResult.error,
      ordersResult.error,
      itemResult.error,
      paymentResult.error,
      logResult.error,
      inventoryResult.error,
      backupResult.error,
      settingsResult.error,
    ].find(Boolean);

    if (error) {
      setNotice({ kind: "warn", text: error.message });
    } else {
      setStaff(newest((staffResult.data ?? []) as Staff[]));
      setMenu(newest((menuResult.data ?? []) as MenuItem[]));
      setOrders(newest((ordersResult.data ?? []) as Order[]));
      setOrderItems(stableOrderItems((itemResult.data ?? []) as OrderItem[]));
      setPayments((paymentResult.data ?? []) as Payment[]);
      setLogs(newest((logResult.data ?? []) as ActivityLog[]));
      setInventoryLogs(newest((inventoryResult.data ?? []) as InventoryLog[]));
      setBackups(newest((backupResult.data ?? []) as Backup[]));
      setSettings((settingsResult.data as Settings | null) ?? emptySettings);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => setDeviceToken(getDeviceSessionId()));
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !deviceToken) return;
    void Promise.resolve().then(reload);
    const channel = client.channel("pos-live");
    [
      "staff",
      "menu_items",
      "orders",
      "order_items",
      "payments",
      "activity_logs",
      "inventory_logs",
      "settings",
      "backups",
    ].forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => void reload());
    });
    channel.subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [deviceToken, reload]);

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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (approved?.role !== "admin") {
      seenPendingApprovalCountRef.current = pendingApprovalCount;
      return;
    }

    const previousCount = seenPendingApprovalCountRef.current;
    if (previousCount !== null && pendingApprovalCount > previousCount) {
      setNotice({
        kind: "warn",
        text: `새 직원 승인 요청이 ${pendingApprovalCount - previousCount}건 들어왔습니다.`,
      });
      setView("admin");
    }
    seenPendingApprovalCountRef.current = pendingApprovalCount;
  }, [approved?.role, pendingApprovalCount]);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setNotice({ kind: "warn", text: "이 브라우저에서는 전체화면을 사용할 수 없습니다." });
    }
  };

  const log = async (
    action: string,
    targetType: string,
    targetId: string,
    beforeValue: unknown,
    afterValue: unknown,
  ) => {
    if (!supabase || !approved) return;
    await supabase.from("activity_logs").insert({
      actor_staff_id: approved.id,
      actor_name: approved.name,
      actor_role: approved.role,
      action_type: action,
      target_type: targetType,
      target_id: targetId,
      before_value: beforeValue,
      after_value: afterValue,
    });
  };

  if (!isSupabaseConfigured) return <SetupGate />;
  if (loading) return <Loading />;
  if (!approved) return <AccessScreen current={me} setNotice={setNotice} />;

  const activeOrders = orders.filter((order) => !["픽업 완료", "취소"].includes(order.status));
  const completedOrders = orders.filter((order) => order.status === "픽업 완료");
  const canceledOrders = orders.filter((order) => order.status === "취소");
  const defaultView: View = approved.role === "maker" ? "maker" : "cashier";
  const activeView: View = approved.role !== "admin" && view === "admin" ? "cashier" : (view ?? defaultView);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7f7f4] pb-24 text-stone-950">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#f7f7f4]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black text-emerald-700">새누리교회</p>
            <h1 className="text-lg font-black">일일카페 POS</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-white px-3 py-2 text-xs font-black shadow-sm">
              {approved.name} · {roleLabel[approved.role!]}
            </span>
            <button
              className="grid h-10 w-10 place-items-center rounded-lg border border-stone-200 bg-white"
              title={isFullscreen ? "전체화면 종료" : "전체화면"}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button
              className="grid h-10 w-10 place-items-center rounded-lg border border-stone-200 bg-white"
              title="로그아웃"
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
        <div
          className={`pointer-events-none fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-md rounded-lg px-4 py-3 text-center text-sm font-black shadow-lg ${
            notice.kind === "ok" ? "bg-emerald-700 text-white" : "bg-amber-300 text-stone-950"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="mx-auto grid w-full max-w-7xl min-w-0 gap-4 px-4 py-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="grid min-w-0 grid-cols-3 gap-2 lg:block lg:space-y-2">
          <NavButton active={activeView === "cashier"} onClick={() => setView("cashier")}>
            주문하기
          </NavButton>
          <NavButton active={activeView === "maker"} onClick={() => setView("maker")}>
            제조 화면
          </NavButton>
          {approved.role === "admin" ? (
            <NavButton active={activeView === "admin"} onClick={() => setView("admin")}>
              관리자
            </NavButton>
          ) : null}
        </nav>

        {activeView === "cashier" ? (
          <CashierScreen
            staff={approved}
            menu={menu}
            orders={orders}
            orderItems={orderItems}
            settings={settings}
            setNotice={setNotice}
            refreshData={reload}
          />
        ) : null}

        {activeView === "maker" ? (
          <MakerScreen
            staff={approved}
            orders={activeOrders}
            orderItems={orderItems}
            menu={menu}
            settings={settings}
            setNotice={setNotice}
            log={log}
          />
        ) : null}

        {activeView === "admin" && approved.role === "admin" ? (
          <AdminScreen
            staff={approved}
            staffList={staff}
            menu={menu}
            orders={orders}
            activeOrders={activeOrders}
            completedOrders={completedOrders}
            canceledOrders={canceledOrders}
            orderItems={orderItems}
            payments={payments}
            logs={logs}
            inventoryLogs={inventoryLogs}
            backups={backups}
            settings={settings}
            setNotice={setNotice}
            log={log}
            refreshData={reload}
          />
        ) : null}
      </div>
    </main>
  );
}

function SetupGate() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f4] p-4">
      <section className="max-w-md rounded-lg border border-amber-300 bg-white p-5">
        <h1 className="text-xl font-black">Supabase 설정 필요</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Vercel 환경 변수 또는 `.env.local`에 Supabase URL과 publishable key를 넣어 주세요.
        </p>
      </section>
    </main>
  );
}

function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f4]">
      <div className="rounded-lg bg-white px-5 py-4 text-sm font-black shadow-sm">불러오는 중</div>
    </main>
  );
}

function AccessScreen({
  current,
  setNotice,
}: {
  current: Staff | null;
  setNotice: (notice: Notice) => void;
}) {
  const [mode, setMode] = useState<"request" | "admin">("request");
  const [name, setName] = useState(current?.name ?? "");
  const [role, setRole] = useState<"cashier" | "maker">("cashier");
  const [adminCode, setAdminCode] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!supabase) return;
    setSaving(true);
    const result =
      mode === "admin"
        ? await supabase.rpc("admin_login", {
            p_name: name,
            p_admin_code: adminCode,
            p_device_token: getDeviceSessionId(),
          })
        : await supabase.rpc("request_staff", {
            p_name: name,
            p_requested_role: role,
            p_device_token: getDeviceSessionId(),
          });
    setSaving(false);
    if (result.error) setNotice({ kind: "warn", text: result.error.message });
    else setNotice({ kind: "ok", text: mode === "admin" ? "관리자로 로그인되었습니다." : "승인 요청을 보냈습니다." });
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f4] p-4">
      <section className="w-full max-w-md rounded-lg bg-white p-5 shadow-sm">
        <Coffee className="mb-3 text-emerald-700" size={36} />
        <h1 className="text-2xl font-black">새누리교회 일일카페 POS</h1>
        <p className="mt-2 text-sm text-stone-600">
          직원은 승인 요청을 보내고, 관리자는 관리자 코드로 바로 로그인합니다.
        </p>

        {current?.status === "pending" ? (
          <p className="mt-4 rounded-lg bg-amber-100 p-3 text-sm font-black text-amber-900">
            {current.name}님의 {roleLabel[current.requested_role]} 요청이 승인 대기 중입니다.
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-2 rounded-lg bg-stone-100 p-1">
          <button
            className={`h-11 rounded-md text-sm font-black ${mode === "request" ? "bg-white shadow-sm" : ""}`}
            onClick={() => setMode("request")}
          >
            직원 승인 요청
          </button>
          <button
            className={`h-11 rounded-md text-sm font-black ${mode === "admin" ? "bg-white shadow-sm" : ""}`}
            onClick={() => setMode("admin")}
          >
            관리자 로그인
          </button>
        </div>

        <label className="mt-5 block text-sm font-black">이름</label>
        <input
          className="mt-2 h-12 w-full rounded-lg border border-stone-300 px-3"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="예: 박지후"
        />

        {mode === "request" ? (
          <>
            <label className="mt-4 block text-sm font-black">요청 역할</label>
            <select
              className="mt-2 h-12 w-full rounded-lg border border-stone-300 px-3"
              value={role}
              onChange={(event) => setRole(event.target.value as "cashier" | "maker")}
            >
              <option value="cashier">주문 담당</option>
              <option value="maker">제조 담당</option>
            </select>
          </>
        ) : (
          <>
            <label className="mt-4 block text-sm font-black">관리자 코드</label>
            <input
              className="mt-2 h-12 w-full rounded-lg border border-stone-300 px-3"
              type="password"
              value={adminCode}
              onChange={(event) => setAdminCode(event.target.value)}
              placeholder="기본값 1234"
            />
          </>
        )}

        <button
          className="mt-5 h-14 w-full rounded-lg bg-emerald-700 text-base font-black text-white disabled:opacity-50"
          disabled={saving || name.trim().length < 1 || (mode === "admin" && adminCode.length < 4)}
          onClick={submit}
        >
          {saving ? "처리 중" : mode === "admin" ? "관리자 로그인" : "승인 요청"}
        </button>
      </section>
    </main>
  );
}

function CashierScreen({
  staff,
  menu,
  orders,
  orderItems,
  settings,
  setNotice,
  refreshData,
}: {
  staff: Staff;
  menu: MenuItem[];
  orders: Order[];
  orderItems: OrderItem[];
  settings: Settings;
  setNotice: (notice: Notice) => void;
  refreshData: () => Promise<void>;
}) {
  const [cart, setCart] = useState<Cart>({});
  const [method, setMethod] = useState<PaymentMethod>("현금");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("결제 완료");
  const [received, setReceived] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);

  const availableMenu = menu.filter((item) => !item.is_hidden);
  const lines = Object.entries(cart)
    .map(([id, quantity]) => ({ item: menu.find((entry) => entry.id === id), quantity }))
    .filter((line): line is { item: MenuItem; quantity: number } => Boolean(line.item) && line.quantity > 0);
  const total = lines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const change = Math.max(Number(received || 0) - total, 0);
  const showCashReceived = settings.show_cash_received !== false;
  const showPaymentStatus = settings.show_payment_status !== false;
  const menuInfoClickAddsItem = settings.menu_info_click_adds_item !== false;
  const effectivePaymentStatus = showPaymentStatus ? paymentStatus : "결제 완료";

  const submit = async () => {
    if (!supabase || saving || !lines.length) return;
    setSaving(true);
    const { error } = await supabase.rpc("create_pos_order", {
      p_staff_id: staff.id,
      p_items: lines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
      p_payment_method: method,
      p_payment_status: effectivePaymentStatus,
      p_received_amount: method === "현금" && showCashReceived ? Number(received || total) : null,
      p_memo: memo.trim() || null,
    });
    setSaving(false);
    if (error) {
      setNotice({ kind: "warn", text: error.message });
      return;
    }
    await refreshData();
    setCart({});
    setReceived("");
    setMemo("");
    setPaymentStatus("결제 완료");
    setCartOpen(false);
    setNotice({ kind: "ok", text: "주문이 접수되었습니다." });
  };

  const orderPanel = (
    <Panel title="현재 주문" icon={<Ticket size={20} />}>
      <div className="space-y-2">
        {lines.length ? (
          lines.map((line) => (
            <div key={line.item.id} className="flex items-center justify-between rounded-lg bg-stone-50 p-3">
              <div>
                <div className="font-black">{line.item.name}</div>
                <div className="text-sm text-stone-600">{won(line.item.price)}</div>
              </div>
              <div className="flex items-center gap-2">
                <QtyButton onClick={() => setCart((current) => ({ ...current, [line.item.id]: Math.max(line.quantity - 1, 0) }))}>-</QtyButton>
                <strong className="w-8 text-center">{line.quantity}</strong>
                <QtyButton onClick={() => setCart((current) => ({ ...current, [line.item.id]: line.quantity + 1 }))}>+</QtyButton>
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-lg bg-stone-50 p-4 text-center text-sm font-black text-stone-500">메뉴를 선택해 주세요.</p>
        )}
      </div>

      <div className="my-4 flex items-center justify-between border-t border-stone-200 pt-4">
        <span className="font-black">총액</span>
        <strong className="text-2xl">{won(total)}</strong>
      </div>

      <div className="mb-4">
        <label className="text-sm font-black">메모</label>
        <textarea
          className="mt-2 h-20 w-full resize-none rounded-lg border border-stone-300 px-3 py-2"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="예: 덜 달게, 먼저 가져감"
          maxLength={120}
        />
      </div>

      <Segmented value={method} options={["현금", "계좌이체"]} onChange={(value) => setMethod(value as PaymentMethod)} />

      {method === "현금" && showCashReceived ? (
        <div>
          <label className="text-sm font-black">받은 금액</label>
          <input
            className="mt-2 h-12 w-full rounded-lg border border-stone-300 px-3"
            inputMode="numeric"
            value={received}
            onChange={(event) => setReceived(event.target.value.replace(/\D/g, ""))}
            placeholder={String(total)}
          />
          <div className="mt-2 rounded-lg bg-emerald-50 p-3 text-lg font-black text-emerald-800">
            거스름돈 {won(change)}
          </div>
        </div>
      ) : null}

      {method === "계좌이체" ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4">
          <div className="font-black">계좌이체</div>
          <p className="mt-1 whitespace-pre-line text-sm text-stone-700">
            {settings.bank_account || "관리자가 계좌번호를 입력할 수 있습니다."}
          </p>
          <div className="mt-3 grid aspect-square max-h-56 place-items-center overflow-hidden rounded-lg bg-white text-sm font-black text-stone-400">
            {settings.bank_qr_note ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.bank_qr_note} alt="계좌이체 QR 코드" className="h-full w-full object-contain p-2" />
            ) : (
              "QR 코드 자리"
            )}
          </div>
          <p className="mt-3 rounded-lg bg-white p-3 text-sm font-bold text-stone-600">
            송금 완료 화면을 확인한 뒤 아래 결제 상태를 선택하세요.
          </p>
        </div>
      ) : null}

      {showPaymentStatus ? (
        <>
          <Segmented value={paymentStatus} options={["결제 완료", "미결제"]} onChange={(value) => setPaymentStatus(value as PaymentStatus)} />
          {paymentStatus === "미결제" ? (
            <p className="rounded-lg bg-amber-100 p-3 text-sm font-black text-amber-900">미결제 주문입니다. 주문표에 경고가 표시됩니다.</p>
          ) : null}
        </>
      ) : null}

      <button
        className="mt-4 h-14 w-full rounded-lg bg-stone-950 text-lg font-black text-white disabled:opacity-50"
        disabled={saving || !lines.length}
        onClick={submit}
      >
        {saving ? "접수 중" : "주문 접수"}
      </button>
    </Panel>
  );

  return (
    <section className="relative grid gap-4 md:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Panel title="메뉴" icon={<Coffee size={20} />}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(138px,1fr))] gap-3">
            {availableMenu.map((item) => {
              const soldOut = item.is_sold_out || (!item.stock_unknown && item.stock_quantity === 0);
              const quantity = cart[item.id] ?? 0;
              const itemInfo = (
                <>
                  <div className="text-lg font-black">{item.name}</div>
                  <div className="mt-1 text-sm font-black text-emerald-700">{won(item.price)}</div>
                  <div className="mt-3 text-xs font-black">
                    {soldOut ? "품절" : item.stock_unknown ? "재고 미설정" : `재고 ${item.stock_quantity}`}
                  </div>
                </>
              );
              return (
                <div
                  key={item.id}
                  className={`flex min-h-28 flex-col justify-between rounded-lg border p-3 ${
                    soldOut ? "border-stone-200 bg-stone-100 text-stone-400" : "border-stone-300 bg-white shadow-sm"
                  }`}
                >
                  {menuInfoClickAddsItem ? (
                    <button
                      className="block w-full flex-1 rounded-md text-left active:bg-emerald-50 disabled:cursor-not-allowed"
                      disabled={soldOut}
                      onClick={() => setCart((current) => ({ ...current, [item.id]: (current[item.id] ?? 0) + 1 }))}
                    >
                      {itemInfo}
                    </button>
                  ) : (
                    <div className="text-left">{itemInfo}</div>
                  )}
                  <div className="mt-2 grid grid-cols-[40px_1fr_40px] items-center gap-1">
                    <MenuQtyButton
                      disabled={quantity === 0}
                      onClick={() =>
                        setCart((current) => ({ ...current, [item.id]: Math.max((current[item.id] ?? 0) - 1, 0) }))
                      }
                    >
                      -
                    </MenuQtyButton>
                    <div className={`grid h-10 place-items-center rounded-lg text-2xl font-black ${quantity ? "text-emerald-800" : "text-stone-400"}`}>
                      {quantity}
                    </div>
                    <MenuQtyButton
                      disabled={soldOut}
                      onClick={() => {
                        if (!soldOut) setCart((current) => ({ ...current, [item.id]: (current[item.id] ?? 0) + 1 }));
                      }}
                    >
                      +
                    </MenuQtyButton>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <button
          className="h-12 w-full rounded-lg bg-white text-sm font-black shadow-sm"
          onClick={() => setRecentOpen((current) => !current)}
        >
          {recentOpen ? "최근 주문 닫기" : "최근 주문 보기"}
        </button>

        {recentOpen ? (
          <Panel title="최근 주문" icon={<Ticket size={20} />}>
            <OrderList orders={orders.slice(0, 8)} orderItems={orderItems} />
          </Panel>
        ) : null}
      </div>

      <aside className="hidden md:block">{orderPanel}</aside>

      <button
        className="fixed bottom-4 left-4 right-4 z-30 h-14 rounded-lg bg-emerald-700 text-base font-black text-white shadow-lg md:hidden"
        onClick={() => setCartOpen(true)}
      >
        현재 주문 {lines.reduce((sum, line) => sum + line.quantity, 0)}개 · {won(total)}
      </button>

      {cartOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-stone-950/55" aria-label="현재 주문 닫기" onClick={() => setCartOpen(false)} />
          <div className="absolute bottom-0 right-0 top-0 w-[88vw] max-w-sm overflow-y-auto bg-[#f7f7f4] p-4 shadow-2xl">
            <button
              className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-white shadow-sm"
              aria-label="현재 주문 닫기"
              onClick={() => setCartOpen(false)}
            >
              <X size={20} />
            </button>
            {orderPanel}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MakerScreen({
  staff,
  orders,
  orderItems,
  menu,
  settings,
  setNotice,
  log,
}: {
  staff: Staff;
  orders: Order[];
  orderItems: OrderItem[];
  menu: MenuItem[];
  settings: Settings;
  setNotice: (notice: Notice) => void;
  log: (action: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
}) {
  const [collapsedOrders, setCollapsedOrders] = useState<Record<string, boolean>>({});
  const [areaFilter, setAreaFilter] = useState("전체");
  const [now, setNow] = useState(() => Date.now());
  const showOrderTimer = settings.show_order_timer !== false;
  const prepAreas = useMemo(
    () => ["전체", ...Array.from(new Set(menu.filter((item) => item.prep_required !== false).map((item) => item.prep_area || "기본")))],
    [menu],
  );

  useEffect(() => {
    if (!showOrderTimer) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [showOrderTimer]);

  const toggleCollapsed = (orderId: string) => {
    setCollapsedOrders((current) => ({ ...current, [orderId]: !current[orderId] }));
  };

  const setItemDone = async (order: Order, item: OrderItem, done: boolean) => {
    if (!supabase) return;
    const next = done ? "완료" : "대기";
    const { error } = await supabase.rpc("set_order_item_prep_status", {
      p_staff_id: staff.id,
      p_order_item_id: item.id,
      p_prep_status: next,
    });
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      setNotice({ kind: "ok", text: `${item.item_name_snapshot} ${next}` });
    }
  };

  const pickupOrder = async (order: Order) => {
    if (!supabase) return;
    if (order.payment_status === "미결제" && !confirm("미결제 주문입니다. 픽업 완료로 바꿀까요?")) return;
    const { error } = await supabase.from("orders").update({ status: "픽업 완료" }).eq("id", order.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await log("order_status_changed", "order", order.id, { status: order.status }, { status: "픽업 완료" });
      setNotice({ kind: "ok", text: `#${orderNo(order.order_number)} 픽업 완료` });
    }
  };

  const visibleTickets = orders
    .map((order) => {
      const items = orderItems
        .filter((item) => item.order_id === order.id)
        .filter((item) => {
          const source = menu.find((menuItem) => menuItem.id === item.menu_item_id);
          const prepRequired = source?.prep_required ?? true;
          const prepArea = source?.prep_area || "기본";
          return prepRequired && (areaFilter === "전체" || prepArea === areaFilter);
        });
      return { order, items };
    })
    .filter((ticket) => ticket.items.length > 0);

  return (
    <Panel title="제조 화면" icon={<Ticket size={20} />}>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {prepAreas.map((area) => (
          <button
            key={area}
            className={`h-11 shrink-0 rounded-lg px-4 text-sm font-black ${areaFilter === area ? "bg-emerald-700 text-white" : "bg-white"}`}
            onClick={() => setAreaFilter(area)}
          >
            {area}
          </button>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleTickets.length ? (
          visibleTickets.map(({ order, items }) => (
            <KitchenTicket
              key={order.id}
              order={order}
              items={items}
              disabled={staff.role === "cashier"}
              collapsed={Boolean(collapsedOrders[order.id])}
              showTimer={showOrderTimer}
              now={now}
              areaFilter={areaFilter}
              onToggleCollapsed={() => toggleCollapsed(order.id)}
              onSetItemDone={(item, done) => setItemDone(order, item, done)}
              onPickup={() => pickupOrder(order)}
            />
          ))
        ) : (
          <p className="rounded-lg bg-stone-50 p-6 text-center font-black text-stone-500">진행 중인 주문이 없습니다.</p>
        )}
      </div>
    </Panel>
  );
}

function KitchenTicket({
  order,
  items,
  disabled,
  collapsed,
  showTimer,
  now,
  areaFilter,
  onToggleCollapsed,
  onSetItemDone,
  onPickup,
}: {
  order: Order;
  items: OrderItem[];
  disabled: boolean;
  collapsed: boolean;
  showTimer: boolean;
  now: number;
  areaFilter: string;
  onToggleCollapsed: () => void;
  onSetItemDone: (item: OrderItem, done: boolean) => void;
  onPickup: () => void;
}) {
  const timerEnd = order.status === "제조 완료" ? order.updated_at : now;
  const timerLabel = formatElapsedTime(order.created_at, timerEnd);

  if (collapsed) {
    return (
      <button
        className="flex min-h-24 items-center justify-between gap-3 rounded-lg border-2 border-stone-950 bg-white p-4 text-left shadow-sm"
        onClick={onToggleCollapsed}
      >
        <span className="text-3xl font-black">#{orderNo(order.order_number)}</span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-black">{areaFilter}</span>
          {showTimer ? <TimerBadge elapsed={timerLabel} stopped={order.status === "제조 완료"} /> : null}
          <StatusBadge status={order.status} />
        </span>
      </button>
    );
  }

  return (
    <article className="rounded-lg border-2 border-stone-950 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-3xl font-black">#{orderNo(order.order_number)}</div>
          <div className="mt-1 text-sm font-black text-stone-500">{shortTime(order.created_at)}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-black">{areaFilter}</span>
          {showTimer ? <TimerBadge elapsed={timerLabel} stopped={order.status === "제조 완료"} /> : null}
          <StatusBadge status={order.status} />
          <button className="rounded-lg bg-stone-100 px-3 py-2 text-xs font-black" onClick={onToggleCollapsed}>
            작게
          </button>
        </div>
      </div>
      {order.payment_status === "미결제" ? (
        <div className="mt-3 rounded-lg bg-amber-100 p-3 text-sm font-black text-amber-900">미결제</div>
      ) : null}
      {order.memo ? (
        <div className="mt-3 rounded-lg bg-sky-50 p-3 text-sm font-black text-sky-900">메모: {order.memo}</div>
      ) : null}
      <div className="my-4 space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`grid min-h-28 gap-2 rounded-lg p-3 ${item.prep_status === "완료" ? "bg-emerald-50" : "bg-stone-50"}`}
          >
            <div className="flex justify-between gap-2 text-xl font-black">
              <span>{item.item_name_snapshot}</span>
              <span>x {item.quantity}</span>
            </div>
            {item.prep_status === "완료" ? (
              <div className="grid grid-cols-[1fr_82px] gap-2">
                <div className="grid h-12 place-items-center rounded-lg bg-emerald-700 text-base font-black text-white">
                  완료됨
                </div>
                <button className="h-12 rounded-lg bg-white text-sm font-black text-emerald-800 disabled:opacity-50" disabled={disabled} onClick={() => onSetItemDone(item, false)}>
                  취소
                </button>
              </div>
            ) : (
              <button className="h-12 rounded-lg bg-stone-950 text-base font-black text-white disabled:opacity-50" disabled={disabled} onClick={() => onSetItemDone(item, true)}>
                {item.item_name_snapshot} 완료
              </button>
            )}
          </div>
        ))}
      </div>
      {order.status === "제조 완료" ? (
        <button className="h-14 w-full rounded-lg bg-stone-950 text-lg font-black text-white disabled:bg-stone-300" disabled={disabled} onClick={onPickup}>
          픽업 완료
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
  inventoryLogs: InventoryLog[];
  backups: Backup[];
  settings: Settings;
  setNotice: (notice: Notice) => void;
  log: (action: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
  refreshData: () => Promise<void>;
}) {
  const [tab, setTab] = useState("summary");
  const pendingStaffCount = props.staffList.filter((person) => person.status === "pending").length;
  const paidOrders = props.orders.filter((order) => order.status !== "취소" && order.payment_status === "결제 완료");
  const unpaidOrders = props.orders.filter((order) => order.status !== "취소" && order.payment_status === "미결제");
  const sales = paidOrders.reduce((sum, order) => sum + order.total_amount, 0);

  return (
    <section className="min-w-0 space-y-4">
      <div className="max-h-28 min-w-0 overflow-x-auto overflow-y-auto rounded-lg bg-[#f7f7f4] pb-1">
        <div className="flex w-max min-w-full gap-2">
        {[
          ["summary", "요약"],
          ["orders", "주문"],
          ["staff", "직원"],
          ["menu", "메뉴"],
          ["inventory", "재고"],
          ["history", "기록"],
          ["settings", "설정"],
          ["export", "백업"],
          ["preview", "미리보기"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`flex h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-black ${tab === id ? "bg-emerald-700 text-white" : "bg-white"}`}
            onClick={() => setTab(id)}
          >
            <span>{label}</span>
            {id === "staff" && pendingStaffCount > 0 ? (
              <span className={`rounded-full px-2 py-0.5 text-xs ${tab === id ? "bg-white text-emerald-800" : "bg-amber-300 text-stone-950"}`}>
                {pendingStaffCount}
              </span>
            ) : null}
          </button>
        ))}
        </div>
      </div>

      {tab === "summary" ? (
        <Panel title="오늘 요약" icon={<CheckCircle2 size={20} />}>
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
            <Metric label="총 매출" value={won(sales)} />
            <Metric label="주문 수" value={`${props.orders.filter((o) => o.status !== "취소").length}건`} />
            <Metric label="결제 완료" value={`${paidOrders.length}건`} />
            <Metric label="미결제" value={`${unpaidOrders.length}건`} warning={unpaidOrders.length > 0} />
            <Metric label="진행 중" value={`${props.activeOrders.length}건`} />
            <Metric label="완료" value={`${props.completedOrders.length}건`} />
            <Metric label="취소" value={`${props.canceledOrders.length}건`} />
          </div>
        </Panel>
      ) : null}

      {tab === "orders" ? <OrderAdmin {...props} /> : null}
      {tab === "staff" ? <StaffAdmin {...props} /> : null}
      {tab === "menu" ? <MenuAdmin {...props} /> : null}
      {tab === "inventory" ? <InventoryAdmin {...props} /> : null}
      {tab === "history" ? <HistoryAdmin logs={props.logs} /> : null}
      {tab === "settings" ? <SettingsAdmin key={props.settings.updated_at} {...props} /> : null}
      {tab === "export" ? <ExportAdmin {...props} /> : null}
      {tab === "preview" ? (
        <div className="grid gap-4">
          <CashierScreen staff={props.staff} menu={props.menu} orders={props.orders} orderItems={props.orderItems} settings={props.settings} setNotice={props.setNotice} refreshData={props.refreshData} />
          <MakerScreen staff={props.staff} orders={props.activeOrders} orderItems={props.orderItems} menu={props.menu} settings={props.settings} setNotice={props.setNotice} log={props.log} />
        </div>
      ) : null}
    </section>
  );
}

function StaffAdmin({
  staffList,
  setNotice,
  log,
}: {
  staffList: Staff[];
  setNotice: (notice: Notice) => void;
  log: (action: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
}) {
  const updateStaff = async (person: Staff, patch: Partial<Staff>, action: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("staff").update(patch).eq("id", person.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await log(action, "staff", person.id, person, { ...person, ...patch });
      setNotice({ kind: "ok", text: "직원 정보가 변경되었습니다." });
    }
  };
  const pending = staffList.filter((person) => person.status === "pending");
  const approved = staffList.filter((person) => person.status === "approved");
  return (
    <div className="space-y-4">
      <Panel title="승인 대기" icon={<Users size={20} />}>
        <div className="space-y-2">
          {pending.length ? (
            pending.map((person) => (
              <div key={person.id} className="grid gap-2 rounded-lg bg-white p-3 sm:grid-cols-[1fr_120px_100px_100px]">
                <strong>{person.name}</strong>
                <span className="font-black">{roleLabel[person.requested_role]}</span>
                <button
                  className="h-11 rounded-lg bg-emerald-700 font-black text-white"
                  onClick={() => updateStaff(person, { status: "approved", role: person.requested_role, approved_at: new Date().toISOString() }, "staff_approved")}
                >
                  승인
                </button>
                <button className="h-11 rounded-lg bg-stone-200 font-black" onClick={() => updateStaff(person, { status: "rejected" }, "staff_rejected")}>
                  거절
                </button>
              </div>
            ))
          ) : (
            <p className="rounded-lg bg-stone-50 p-4 text-center text-sm font-black text-stone-500">대기 중인 요청이 없습니다.</p>
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
                onChange={(event) => updateStaff(person, { role: event.target.value as StaffRole }, "staff_role_changed")}
              >
                <option value="admin">관리자</option>
                <option value="cashier">주문 담당</option>
                <option value="maker">제조 담당</option>
              </select>
              <button className="h-11 rounded-lg bg-stone-200 font-black" onClick={() => updateStaff(person, { status: "revoked", revoked_at: new Date().toISOString() }, "staff_revoked")}>
                해제
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function OrderAdmin({
  staff,
  orders,
  activeOrders,
  completedOrders,
  canceledOrders,
  orderItems,
  setNotice,
  log,
}: {
  staff: Staff;
  orders: Order[];
  activeOrders: Order[];
  completedOrders: Order[];
  canceledOrders: Order[];
  orderItems: OrderItem[];
  setNotice: (notice: Notice) => void;
  log: (action: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
}) {
  const cancelOrder = async (order: Order) => {
    if (!supabase || !confirm(`#${orderNo(order.order_number)} 주문을 취소할까요? 재고가 자동 반환됩니다.`)) return;
    const { error } = await supabase.rpc("cancel_pos_order", {
      p_staff_id: staff.id,
      p_order_id: order.id,
      p_reason: "관리자 취소",
    });
    setNotice(error ? { kind: "warn", text: error.message } : { kind: "ok", text: "주문이 취소되었습니다." });
  };
  const changePayment = async (order: Order) => {
    if (!supabase || !confirm("결제 상태를 변경할까요?")) return;
    const next = order.payment_status === "결제 완료" ? "미결제" : "결제 완료";
    const { error } = await supabase.from("orders").update({ payment_status: next }).eq("id", order.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await log("payment_changed", "order", order.id, { payment_status: order.payment_status }, { payment_status: next });
      setNotice({ kind: "ok", text: "결제 상태가 변경되었습니다." });
    }
  };
  return (
    <div className="space-y-4">
      <Panel title="진행 중 주문" icon={<Ticket size={20} />}>
        <AdminOrderRows orders={activeOrders} orderItems={orderItems} onCancel={cancelOrder} onPayment={changePayment} />
      </Panel>
      <Panel title="미결제 주문" icon={<AlertTriangle size={20} />}>
        <AdminOrderRows orders={orders.filter((o) => o.status !== "취소" && o.payment_status === "미결제")} orderItems={orderItems} onCancel={cancelOrder} onPayment={changePayment} />
      </Panel>
      <Panel title="완료 주문" icon={<CheckCircle2 size={20} />}>
        <AdminOrderRows orders={completedOrders} orderItems={orderItems} onCancel={cancelOrder} onPayment={changePayment} />
      </Panel>
      <Panel title="취소 주문" icon={<Trash2 size={20} />}>
        <OrderList orders={canceledOrders} orderItems={orderItems} />
      </Panel>
    </div>
  );
}

function MenuAdmin({
  menu,
  setNotice,
  log,
}: {
  menu: MenuItem[];
  setNotice: (notice: Notice) => void;
  log: (action: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("3000");
  const [prepArea, setPrepArea] = useState("기본");
  const save = async (item: MenuItem, patch: Partial<MenuItem>) => {
    if (!supabase) return;
    const { error } = await supabase.from("menu_items").update(patch).eq("id", item.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else await log("menu_changed", "menu_item", item.id, item, { ...item, ...patch });
  };
  const create = async () => {
    if (!supabase || !name.trim()) return;
    const { data, error } = await supabase.from("menu_items").insert({ name: name.trim(), price: Number(price || 0), stock_unknown: true, prep_area: prepArea.trim() || "기본" }).select().single();
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await log("menu_created", "menu_item", data.id, null, data);
      setName("");
      setPrice("3000");
    }
  };
  return (
    <Panel title="메뉴 관리" icon={<Coffee size={20} />}>
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_140px_140px_110px]">
        <input className="h-12 rounded-lg border border-stone-300 px-3" value={name} onChange={(e) => setName(e.target.value)} placeholder="메뉴 이름" />
        <input className="h-12 rounded-lg border border-stone-300 px-3" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} />
        <input className="h-12 rounded-lg border border-stone-300 px-3" value={prepArea} onChange={(e) => setPrepArea(e.target.value)} placeholder="담당 구역" />
        <button className="h-12 rounded-lg bg-emerald-700 font-black text-white" onClick={create}>
          추가
        </button>
      </div>
      <div className="space-y-2">
        {menu.map((item) => (
          <div key={item.id} className="grid gap-2 rounded-lg bg-white p-3 md:grid-cols-[1fr_110px_130px_110px_90px_90px]">
            <input className="h-11 rounded-lg border border-stone-300 px-3 font-black" defaultValue={item.name} onBlur={(e) => e.target.value !== item.name && save(item, { name: e.target.value })} />
            <input className="h-11 rounded-lg border border-stone-300 px-3" inputMode="numeric" defaultValue={item.price} onBlur={(e) => Number(e.target.value) !== item.price && save(item, { price: Number(e.target.value || 0) })} />
            <input className="h-11 rounded-lg border border-stone-300 px-3" defaultValue={item.prep_area || "기본"} onBlur={(e) => e.target.value !== item.prep_area && save(item, { prep_area: e.target.value.trim() || "기본" })} />
            <button className={`h-11 rounded-lg font-black ${item.prep_required === false ? "bg-stone-200" : "bg-emerald-100 text-emerald-900"}`} onClick={() => save(item, { prep_required: item.prep_required === false })}>
              {item.prep_required === false ? "완제품" : "제조 필요"}
            </button>
            <button className={`h-11 rounded-lg font-black ${item.is_sold_out ? "bg-rose-700 text-white" : "bg-stone-100"}`} onClick={() => save(item, { is_sold_out: !item.is_sold_out })}>
              품절
            </button>
            <button className={`h-11 rounded-lg font-black ${item.is_hidden ? "bg-stone-950 text-white" : "bg-stone-100"}`} onClick={() => save(item, { is_hidden: !item.is_hidden })}>
              숨김
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function InventoryAdmin({
  menu,
  settings,
  setNotice,
  log,
}: {
  menu: MenuItem[];
  settings: Settings;
  setNotice: (notice: Notice) => void;
  log: (action: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
}) {
  const save = async (item: MenuItem, patch: Partial<MenuItem>) => {
    if (!supabase) return;
    const { error } = await supabase.from("menu_items").update(patch).eq("id", item.id);
    if (error) setNotice({ kind: "warn", text: error.message });
    else await log("inventory_changed", "menu_item", item.id, item, { ...item, ...patch });
  };
  return (
    <Panel title="재고 관리" icon={<Package size={20} />}>
      <div className="mb-4 rounded-lg bg-stone-50 p-3 text-sm font-black">기본 부족 기준: {settings.default_low_stock_threshold}개</div>
      <div className="space-y-2">
        {menu.map((item) => {
          const threshold = item.low_stock_threshold ?? settings.default_low_stock_threshold;
          const low = !item.stock_unknown && Number(item.stock_quantity) <= threshold;
          return (
            <div key={item.id} className={`rounded-lg border p-3 ${low ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-white"}`}>
              <div className="flex justify-between gap-3">
                <strong>{item.name}</strong>
                {low ? <span className="text-sm font-black text-amber-900">부족</span> : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_140px_110px]">
                <label className="flex items-center gap-2 text-sm font-black">
                  <input type="checkbox" checked={item.stock_unknown} onChange={(e) => save(item, { stock_unknown: e.target.checked, stock_quantity: e.target.checked ? null : 0 })} />
                  재고 미설정
                </label>
                <input
                  className="h-11 rounded-lg border border-stone-300 px-3"
                  disabled={item.stock_unknown}
                  inputMode="numeric"
                  defaultValue={item.stock_quantity ?? ""}
                  onBlur={(e) => save(item, { stock_unknown: false, stock_quantity: Number(e.target.value || 0), is_sold_out: Number(e.target.value || 0) === 0 })}
                />
                <button className={`h-11 rounded-lg font-black ${item.is_sold_out ? "bg-rose-700 text-white" : "bg-stone-100"}`} onClick={() => save(item, { is_sold_out: !item.is_sold_out })}>
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

function HistoryAdmin({ logs }: { logs: ActivityLog[] }) {
  return (
    <Panel title="기록" icon={<History size={20} />}>
      <div className="space-y-2">
        {logs.slice(0, 150).map((log) => (
          <div key={log.id} className="rounded-lg bg-white p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <strong>{actionText[log.action_type] ?? log.action_type}</strong>
              <span className="text-xs font-black text-stone-500">{fullTime(log.created_at)}</span>
            </div>
            <p className="mt-1 text-stone-600">{log.actor_name} {log.actor_role ? `· ${roleLabel[log.actor_role]}` : ""}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SettingsAdmin({
  staff,
  settings,
  setNotice,
  log,
}: {
  staff: Staff;
  settings: Settings;
  setNotice: (notice: Notice) => void;
  log: (action: string, targetType: string, targetId: string, beforeValue: unknown, afterValue: unknown) => Promise<void>;
}) {
  const [bankAccount, setBankAccount] = useState(settings.bank_account);
  const [qrImage, setQrImage] = useState(settings.bank_qr_note);
  const [showCashReceived, setShowCashReceived] = useState(settings.show_cash_received !== false);
  const [showPaymentStatus, setShowPaymentStatus] = useState(settings.show_payment_status !== false);
  const [menuInfoClickAddsItem, setMenuInfoClickAddsItem] = useState(settings.menu_info_click_adds_item !== false);
  const [showOrderTimer, setShowOrderTimer] = useState(settings.show_order_timer !== false);
  const [currentAdminCode, setCurrentAdminCode] = useState("");
  const [newAdminCode, setNewAdminCode] = useState("");
  const [newAdminCodeConfirm, setNewAdminCodeConfirm] = useState("");
  const [resetCommand, setResetCommand] = useState("");
  const [saving, setSaving] = useState(false);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const save = async () => {
    if (!supabase) return;
    setSaving(true);
    const after = {
      bank_account: bankAccount,
      bank_qr_note: qrImage,
      show_cash_received: showCashReceived,
      show_payment_status: showPaymentStatus,
      menu_info_click_adds_item: menuInfoClickAddsItem,
      show_order_timer: showOrderTimer,
    };
    const { error } = await supabase.from("settings").update(after).eq("id", "event");
    setSaving(false);
    if (error) setNotice({ kind: "warn", text: error.message });
    else {
      await log(
        "settings_changed",
        "settings",
        "event",
        {
          bank_account: settings.bank_account,
          bank_qr_note: settings.bank_qr_note ? "QR 등록됨" : "",
          show_cash_received: settings.show_cash_received,
          show_payment_status: settings.show_payment_status,
          menu_info_click_adds_item: settings.menu_info_click_adds_item,
          show_order_timer: settings.show_order_timer,
        },
        {
          bank_account: bankAccount,
          bank_qr_note: qrImage ? "QR 등록됨" : "",
          show_cash_received: showCashReceived,
          show_payment_status: showPaymentStatus,
          menu_info_click_adds_item: menuInfoClickAddsItem,
          show_order_timer: showOrderTimer,
        },
      );
      setNotice({ kind: "ok", text: "계좌 설정이 저장되었습니다." });
    }
  };

  const uploadQr = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice({ kind: "warn", text: "이미지 파일을 선택해 주세요." });
      return;
    }
    if (file.size > 700_000) {
      setNotice({ kind: "warn", text: "QR 이미지는 700KB 이하로 올려 주세요." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setQrImage(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  };

  const changeAdminCode = async () => {
    if (!supabase || securitySaving) return;
    if (newAdminCode.length < 4) {
      setNotice({ kind: "warn", text: "새 관리자 코드는 4자리 이상으로 입력해 주세요." });
      return;
    }
    if (newAdminCode !== newAdminCodeConfirm) {
      setNotice({ kind: "warn", text: "새 관리자 코드 확인이 맞지 않습니다." });
      return;
    }
    if (!confirm("관리자 코드를 변경할까요? 다음 로그인부터 새 코드가 필요합니다.")) return;
    setSecuritySaving(true);
    const { error } = await supabase.rpc("change_admin_code", {
      p_staff_id: staff.id,
      p_current_code: currentAdminCode,
      p_new_code: newAdminCode,
    });
    setSecuritySaving(false);
    if (error) {
      setNotice({ kind: "warn", text: error.message });
      return;
    }
    setCurrentAdminCode("");
    setNewAdminCode("");
    setNewAdminCodeConfirm("");
    setNotice({ kind: "ok", text: "관리자 코드가 변경되었습니다." });
  };

  const resetTestData = async () => {
    if (!supabase || resetting) return;
    if (resetCommand.trim() !== "테스트초기화") {
      setNotice({ kind: "warn", text: "명령어를 정확히 입력해 주세요: 테스트초기화" });
      return;
    }
    if (!confirm("테스트 주문/결제/기록을 초기화할까요? 주문번호는 1번으로 돌아갑니다.")) return;
    setResetting(true);
    const { error } = await supabase.rpc("reset_event_test_data", {
      p_staff_id: staff.id,
      p_command: resetCommand.trim(),
    });
    setResetting(false);
    if (error) {
      setNotice({ kind: "warn", text: error.message });
      return;
    }
    setResetCommand("");
    setNotice({ kind: "ok", text: "테스트 기록이 초기화되었습니다." });
  };

  return (
    <Panel title="설정" icon={<ImagePlus size={20} />}>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div>
          <label className="text-sm font-black">계좌 안내 문구</label>
          <textarea
            className="mt-2 h-36 w-full rounded-lg border border-stone-300 p-3"
            value={bankAccount}
            onChange={(event) => setBankAccount(event.target.value)}
            placeholder={"은행: \n계좌: \n예금주: "}
          />
          <p className="mt-2 text-xs font-bold text-stone-500">
            주문 담당 화면에서 계좌이체 선택 시 그대로 표시됩니다.
          </p>
        </div>
        <div>
          <label className="text-sm font-black">QR 이미지</label>
          <div className="mt-2 grid aspect-square place-items-center overflow-hidden rounded-lg border border-dashed border-stone-300 bg-white text-sm font-black text-stone-400">
            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImage} alt="업로드한 QR 코드" className="h-full w-full object-contain p-3" />
            ) : (
              "QR 미등록"
            )}
          </div>
          <input
            className="mt-3 block w-full text-sm"
            type="file"
            accept="image/*"
            onChange={(event) => uploadQr(event.target.files?.[0])}
          />
          {qrImage ? (
            <button className="mt-2 h-10 w-full rounded-lg bg-stone-100 text-sm font-black" onClick={() => setQrImage("")}>
              QR 삭제
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 p-4 text-sm font-black">
          <span>받은 금액/거스름돈 사용</span>
          <input
            type="checkbox"
            checked={showCashReceived}
            onChange={(event) => setShowCashReceived(event.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 p-4 text-sm font-black">
          <span>결제 완료/미결제 선택 사용</span>
          <input
            type="checkbox"
            checked={showPaymentStatus}
            onChange={(event) => setShowPaymentStatus(event.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 p-4 text-sm font-black">
          <span>메뉴 이름/가격 터치로 수량 추가</span>
          <input
            type="checkbox"
            checked={menuInfoClickAddsItem}
            onChange={(event) => setMenuInfoClickAddsItem(event.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 p-4 text-sm font-black">
          <span>제조 화면 스톱워치 표시</span>
          <input
            type="checkbox"
            checked={showOrderTimer}
            onChange={(event) => setShowOrderTimer(event.target.checked)}
          />
        </label>
      </div>
      <button
        className="mt-4 h-12 w-full rounded-lg bg-emerald-700 font-black text-white disabled:opacity-50"
        disabled={saving}
        onClick={save}
      >
        {saving ? "저장 중" : "설정 저장"}
      </button>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-4">
          <h3 className="font-black">관리자 코드 변경</h3>
          <div className="mt-3 grid gap-2">
            <input
              className="h-11 rounded-lg border border-stone-300 px-3"
              type="password"
              value={currentAdminCode}
              onChange={(event) => setCurrentAdminCode(event.target.value)}
              placeholder="현재 관리자 코드"
            />
            <input
              className="h-11 rounded-lg border border-stone-300 px-3"
              type="password"
              value={newAdminCode}
              onChange={(event) => setNewAdminCode(event.target.value)}
              placeholder="새 관리자 코드"
            />
            <input
              className="h-11 rounded-lg border border-stone-300 px-3"
              type="password"
              value={newAdminCodeConfirm}
              onChange={(event) => setNewAdminCodeConfirm(event.target.value)}
              placeholder="새 관리자 코드 확인"
            />
            <button className="h-11 rounded-lg bg-stone-950 font-black text-white disabled:opacity-50" disabled={securitySaving} onClick={changeAdminCode}>
              {securitySaving ? "변경 중" : "관리자 코드 변경"}
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <h3 className="font-black text-rose-950">테스트 기록 초기화</h3>
          <p className="mt-2 text-sm font-bold text-rose-900">
            주문, 결제, 백업, 활동 기록을 지우고 주문번호를 1번으로 돌립니다. 메뉴, 설정, 직원 승인은 유지됩니다.
          </p>
          <input
            className="mt-3 h-11 w-full rounded-lg border border-rose-200 px-3"
            value={resetCommand}
            onChange={(event) => setResetCommand(event.target.value)}
            placeholder="테스트초기화"
          />
          <button className="mt-2 h-11 w-full rounded-lg bg-rose-700 font-black text-white disabled:opacity-50" disabled={resetting} onClick={resetTestData}>
            {resetting ? "초기화 중" : "테스트 기록 초기화"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ExportAdmin(props: {
  staff: Staff;
  orders: Order[];
  orderItems: OrderItem[];
  payments: Payment[];
  menu: MenuItem[];
  logs: ActivityLog[];
  inventoryLogs: InventoryLog[];
  backups: Backup[];
  setNotice: (notice: Notice) => void;
}) {
  const backup = async () => {
    if (!supabase) return;
    const { error } = await supabase.rpc("create_backup_snapshot", { p_staff_id: props.staff.id, p_backup_type: "manual" });
    props.setNotice(error ? { kind: "warn", text: error.message } : { kind: "ok", text: "백업을 만들었습니다." });
  };
  const exportExcel = async () => {
    if (!supabase) return;
    const XLSX = await import("xlsx");
    const summary = [{
      총매출: props.orders.filter((o) => o.status !== "취소" && o.payment_status === "결제 완료").reduce((sum, o) => sum + o.total_amount, 0),
      주문수: props.orders.filter((o) => o.status !== "취소").length,
      미결제: props.orders.filter((o) => o.status !== "취소" && o.payment_status === "미결제").length,
      취소: props.orders.filter((o) => o.status === "취소").length,
    }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.orders), "Orders");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.orderItems), "Order Items");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.payments), "Payments");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.menu), "Inventory");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.logs), "Staff Activity Log");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.orders.filter((o) => o.status === "취소")), "Canceled and Edited Orders");
    XLSX.writeFile(wb, `새누리교회_일일카페_POS_${new Date().toISOString().slice(0, 10)}.xlsx`);
    await supabase.from("activity_logs").insert({
      actor_staff_id: props.staff.id,
      actor_name: props.staff.name,
      actor_role: props.staff.role,
      action_type: "export_created",
      target_type: "export",
      after_value: summary[0],
    });
  };
  return (
    <Panel title="백업 / 엑셀 내보내기" icon={<Download size={20} />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button className="h-14 rounded-lg bg-stone-950 font-black text-white" onClick={backup}>수동 백업</button>
        <button className="h-14 rounded-lg bg-emerald-700 font-black text-white" onClick={exportExcel}>엑셀 내보내기</button>
      </div>
      <div className="mt-4 space-y-2">
        {props.backups.slice(0, 8).map((row) => (
          <div key={row.id} className="rounded-lg bg-stone-50 p-3 text-sm font-black">
            {row.backup_type === "manual" ? "수동 백업" : "자동 백업"} · {fullTime(row.created_at)}
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
  onPayment: (order: Order) => void;
}) {
  if (!orders.length) return <Empty text="주문이 없습니다." />;
  return (
    <div className="space-y-2">
      {orders.map((order) => (
        <div key={order.id} className="rounded-lg bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong>#{orderNo(order.order_number)}</strong>
              <p className="mt-1 text-sm text-stone-600">{itemsText(order.id, orderItems)}</p>
              {order.memo ? <p className="mt-2 rounded-lg bg-sky-50 p-2 text-sm font-black text-sky-900">메모: {order.memo}</p> : null}
            </div>
            <StatusBadge status={order.status} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <button className="h-11 rounded-lg bg-stone-100 font-black" onClick={() => onPayment(order)}>{order.payment_status}</button>
            <button className="h-11 rounded-lg bg-stone-100 font-black" onClick={() => onCancel(order)}>취소</button>
            <div className="grid place-items-center rounded-lg bg-stone-50 text-sm font-black">{won(order.total_amount)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrderList({ orders, orderItems }: { orders: Order[]; orderItems: OrderItem[] }) {
  if (!orders.length) return <Empty text="주문이 없습니다." />;
  return (
    <div className="space-y-2">
      {orders.map((order) => (
        <div key={order.id} className="rounded-lg border border-stone-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <strong>#{orderNo(order.order_number)}</strong>
              <div className="text-xs font-black text-stone-500">{shortTime(order.created_at)}</div>
            </div>
            <div className="flex gap-2">
              {order.payment_status === "미결제" ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-black text-amber-900">미결제</span> : null}
              <StatusBadge status={order.status} />
            </div>
          </div>
          <p className="mt-2 text-sm font-black text-stone-700">{itemsText(order.id, orderItems)}</p>
          {order.memo ? <p className="mt-2 rounded-lg bg-sky-50 p-2 text-sm font-black text-sky-900">메모: {order.memo}</p> : null}
          <div className="mt-2 text-right font-black">{won(order.total_amount)}</div>
        </div>
      ))}
    </div>
  );
}

function itemsText(orderId: string, orderItems: OrderItem[]) {
  return stableOrderItems(orderItems.filter((item) => item.order_id === orderId))
    .map((item) => `${item.item_name_snapshot} x${item.quantity}`)
    .join(", ");
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-stone-200 bg-white/70 p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-black">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`h-12 rounded-lg px-3 text-sm font-black lg:w-full ${active ? "bg-stone-950 text-white" : "bg-white"}`} onClick={onClick}>
      {children}
    </button>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="my-4 grid grid-cols-2 rounded-lg bg-stone-100 p-1">
      {options.map((option) => (
        <button key={option} className={`h-11 rounded-md text-sm font-black ${value === option ? "bg-white shadow-sm" : ""}`} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}

function QtyButton({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="h-10 w-10 rounded-lg bg-stone-950 text-xl font-black text-white disabled:bg-stone-300"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MenuQtyButton({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className="grid h-10 w-10 place-items-center rounded-lg text-3xl font-black text-orange-600 disabled:text-stone-300"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-lg p-4 ${warning ? "bg-amber-100 text-amber-950" : "bg-white"}`}>
      <div className="text-xs font-black text-stone-500">{label}</div>
      <div className="mt-2 text-xl font-black">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg bg-stone-50 p-4 text-center text-sm font-black text-stone-500">{text}</p>;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const color =
    status === "접수"
      ? "bg-sky-100 text-sky-900"
      : status === "제조 중"
        ? "bg-orange-100 text-orange-900"
        : status === "제조 완료"
          ? "bg-emerald-100 text-emerald-900"
          : status === "취소"
            ? "bg-rose-100 text-rose-900"
            : "bg-stone-200 text-stone-900";
  return <span className={`rounded-full px-2 py-1 text-xs font-black ${color}`}>{status}</span>;
}

function TimerBadge({ elapsed, stopped }: { elapsed: string; stopped: boolean }) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-black ${stopped ? "bg-stone-200 text-stone-800" : "bg-emerald-700 text-white"}`}>
      {elapsed}
    </span>
  );
}
