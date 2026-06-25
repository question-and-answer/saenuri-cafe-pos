export type StaffRole = "admin" | "cashier" | "maker";
export type StaffStatus = "pending" | "approved" | "rejected" | "revoked";
export type OrderStatus = "접수" | "제조 중" | "제조 완료" | "픽업 완료" | "취소";
export type PaymentMethod = "현금" | "계좌이체";
export type PaymentStatus = "결제 완료" | "미결제";
export type BackupType = "automatic" | "manual";

export type Staff = {
  id: string;
  name: string;
  requested_role: StaffRole;
  role: StaffRole | null;
  status: StaffStatus;
  device_token: string;
  created_at: string;
  approved_at: string | null;
  revoked_at: string | null;
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  is_sold_out: boolean;
  is_hidden: boolean;
  stock_quantity: number | null;
  stock_unknown: boolean;
  low_stock_threshold: number | null;
  created_at: string;
  updated_at: string;
};

export type Order = {
  id: string;
  order_number: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  total_amount: number;
  received_amount: number | null;
  change_amount: number | null;
  created_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
  cancel_reason: string | null;
};

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  item_name_snapshot: string;
  item_price_snapshot: number;
  quantity: number;
  subtotal: number;
};

export type Payment = {
  id: string;
  order_id: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  amount: number;
  received_amount: number | null;
  change_amount: number | null;
  created_at: string;
  updated_at: string;
};

export type ActivityLog = {
  id: string;
  actor_staff_id: string | null;
  actor_name: string;
  actor_role: StaffRole | null;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  before_value: unknown;
  after_value: unknown;
  created_at: string;
};

export type InventoryLog = {
  id: string;
  menu_item_id: string | null;
  order_id: string | null;
  change_amount: number;
  reason: string;
  before_quantity: number | null;
  after_quantity: number | null;
  actor_staff_id: string | null;
  created_at: string;
};

export type Settings = {
  id: string;
  event_name: string;
  admin_code_hash: string | null;
  next_order_number: number;
  default_low_stock_threshold: number;
  bank_account: string;
  bank_qr_note: string;
  show_cash_received: boolean;
  show_payment_status: boolean;
  menu_info_click_adds_item: boolean;
  show_order_timer: boolean;
  updated_at: string;
};

export type Backup = {
  id: string;
  backup_type: BackupType;
  snapshot: unknown;
  created_by_staff_id: string | null;
  created_at: string;
};

export type Cart = Record<string, number>;
