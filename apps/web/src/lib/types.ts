export type Role =
  | "owner"
  | "manager"
  | "cashier"
  | "auditor"
  | "pharmacist"
  | "inventory"
  | "accountant";
export interface Session {
  authenticated: boolean;
  csrf_token: string;
  demo_available?: boolean;
  demo?: boolean;
  mfa?: { enabled: boolean; verified: boolean; required: boolean };
  user?: { id: number; name: string; email: string };
  tenant?: { id: string; name: string; currency: string; version: number };
  branches?: { id: string; name: string; address: string; version: number }[];
  memberships?: { branch_id: string | null; role: Role }[];
}
export interface Packaging {
  base_unit: string;
  inner_name: string;
  inner_size: number;
  outer_name: string;
  inners_per_outer: number;
  allow_break_inner: boolean;
  allow_break_outer: boolean;
  inner_price_minor: number | null;
  outer_price_minor: number | null;
}
export interface Product {
  id: string;
  name: string;
  generic: string;
  strength: string;
  form: string;
  manufacturer: string;
  prescription_required: boolean;
  sku: string;
  barcode: string;
  price_minor: number;
  reorder_level: number;
  stock: number;
  active: boolean;
  packaging?: Packaging;
  base_available?: number;
  units?: {
    id: string;
    name: "BOX" | "STRIP" | "PACK" | "CARTON";
    available: number;
    price_minor: number;
    base_units: number;
    active: boolean;
  }[];
}
export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  bin: string;
}
export interface PrintProfile {
  version: number;
  shop_name: string;
  address: string;
  phone: string;
  email: string;
  contact_name: string;
  bin: string;
  drug_license: string;
  logo_data_url: string;
  paper_width: 58 | 80;
  font_size: number;
  show_logo: boolean;
  show_batch: boolean;
  show_staff: boolean;
  show_amount_words: boolean;
  qr_enabled: boolean;
  qr_value: string;
  qr_data_url?: string;
  invoice_terms: string;
  receipt_terms: string;
  default_staff_name: string;
  default_created_by: string;
  show_barcode: boolean;
  signature_name: string;
  invoice_accent: string;
}
export interface Batch {
  loose_quantity: number;
  inner_quantity: number;
  outer_quantity: number;
  inner_name: string;
  outer_name: string;
  base_unit: string;
  id: string;
  product_id: string;
  name: string;
  strength: string;
  number: string;
  expiry: string;
  quantity: number;
  unit_cost_minor: number;
  status: string;
  location: string;
}
export interface SaleSummary {
  id: string;
  receipt_number: string;
  created_at: string;
  cashier: string;
  total_minor: number;
  payment_method: string;
  status: string;
}
export interface SaleQuote {
  settings_version: number;
  subtotal_minor: number;
  discount_minor: number;
  vat_minor: number;
  total_minor: number;
  discount_type: "none" | "fixed" | "percent";
  discount_value: number;
  lines: { product_id: string; subtotal_minor: number; discount_minor: number;
    vat_minor: number; rate_bps: number; mode: "inclusive" | "exclusive";
    treatment: string; total_minor: number }[];
}
export interface Receipt extends SaleSummary {
  subtotal_minor?: number;
  discount_minor?: number;
  vat_minor?: number;
  tax_snapshot?: Partial<SaleQuote>;
  branch: string;
  address: string;
  organization: string;
  tendered_minor: number;
  change_minor: number;
  tax_status: string;
  payment_reference?: string;
  payment_verification?: string;
  staff_name?: string;
  created_by?: string;
  customer_id?: string | null;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_bin?: string;
  customer_type?: string;
  remarks?: string;
  receipt_profile?: Partial<PrintProfile>;
  amount_in_words?: string;
  lines: {
    id: string;
    product_id: string;
    name: string;
    sku?: string;
    quantity: number;
    unit_price_minor: number;
    discount_minor?: number;
    vat_minor?: number;
    vat_rate_bps?: number;
    vat_mode?: string;
    total_minor: number;
    batch: string;
    expiry: string;
    unit_name?: string;
    base_units?: number;
    allocations?: { batch: string; expiry: string; base_quantity: number }[];
  }[];
}
export interface Movement {
  id: string;
  created_at: string;
  name: string;
  batch: string;
  quantity: number;
  kind: string;
  reference: string;
}
export interface Audit {
  id: string;
  created_at: string;
  actor: string;
  action: string;
  entity_id: string;
  detail: Record<string, unknown>;
}
export interface DashboardData {
  as_of: string;
  currency: string;
  revenue_minor: number;
  cost_minor: number;
  previous_revenue_minor: number;
  today_revenue_minor: number;
  today_transactions: number;
  month_transactions: number;
  stock_units: number;
  medicine_count: number;
  low_stock_count: number;
  expiring_count: number;
  expired_count: number;
  trend: { label: string; revenue_minor: number; cost_minor: number }[];
  distribution: { name: string; value: number }[];
  low_stock: Product[];
  expiring: Batch[];
  top_products: {
    id: string;
    name: string;
    units: number;
    revenue_minor: number;
  }[];
}
export interface WorkspaceData {
  products: Product[];
  batches: Batch[];
  sales: SaleSummary[];
  dashboard: DashboardData | null;
}
export type Section =
  | "dashboard"
  | "inventory"
  | "catalog"
  | "pos"
  | "sales"
  | "reports"
  | "ledger"
  | "activity"
  | "team"
  | "security"
  | "printing"
  | "settings";
