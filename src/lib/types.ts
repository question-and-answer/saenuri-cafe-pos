export type StaffRole = "admin" | "cashier" | "maker";
export type ApprovalStatus = "pending" | "approved" | "revoked";
export type OrderStatus = "접수" | "제조" | "제조 완료" | "픽업 완료" | "취소";
export type PaymentMethod = "현금" | "계좌이체";
export type PaymentStatus = "결제 완료" | "미결제";

export type Staff = {
  id: string;
  name: string;
  requested_role: StaffRole;
  role: StaffRole | null;
  approval_status: ApprovalStatus;
  device_session_id: string;
  approved_by: string | null;
  approved_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  stock_quantity: number | null;
  stock_unknown: boolean;
  sold_out: boolean;
  hidden: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Order = {
  id: string;
  order_number: number;
  status: OrderStatus;
  total_amount: number;
  paid_status: PaymentStatus;
  payment_method: PaymentMethod;
  received_amount: number | null;
  change_amount: number | null;
  note: string;
  created_by: string | null;
  canceled_at: string | null;
  canceled_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  created_at: string;
};

export type Payment = {
  id: string;
  order_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  received_amount: number | null;
  change_amount: number | null;
  changed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityLog = {
  id: string;
  staff_id: string | null;
  staff_name: string;
  staff_role: StaffRole | null;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  before_value: unknown;
  after_value: unknown;
  created_at: string;
};

export type Settings = {
  id: "event";
  event_name: string;
  next_order_number: number;
  low_stock_threshold: number;
  bank_account: string;
  bank_qr_url: string;
  last_backup_at: string | null;
  last_automatic_backup_at: string | null;
  updated_at: string;
};

export type Backup = {
  id: string;
  backup_type: "automatic" | "manual";
  created_by: string | null;
  snapshot: unknown;
  created_at: string;
};

export type Cart = Record<string, number>;
