"use client";
import { AppSelect } from "./select";

import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Minus,
  Package,
  Plus,
  ScanBarcode,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, money, number, toMinor } from "@/lib/api";
import type { Product, Receipt } from "@/lib/types";
import { Badge, Button, Empty, Field, Modal } from "./ui";
import { CustomerPicker } from "./customer-picker";
import { CheckoutDialog } from "./checkout-dialog";

import {
  InvoiceCopy,
  PrintActions,
  ThermalReceipt,
  paymentNames,
} from "./print-documents";

type Cart = { product: Product; quantity: number; unitId?: string }[];
const sellingUnit = (line: Cart[number]) =>
  line.product.units?.find((u) => u.id === line.unitId);
const multiplier = (line: Cart[number]) => sellingUnit(line)?.base_units || 1;
const maxQuantity = (line: Cart[number]) =>
  Math.min(
    sellingUnit(line)?.available ??
      line.product.base_available ??
      line.product.stock,
    10000,
  );
const unitPrice = (line: Cart[number]) =>
  sellingUnit(line)?.price_minor ?? line.product.price_minor;
type CheckoutPayload = {
  lines: {
    product_id: string;
    quantity: number;
    expected_price_minor: number;
    expected_unit_price_minor?: number;
    unit_id?: string;
    expected_base_units?: number;
  }[];
  tendered_minor: number;
  payment_method?: string;
  payment_reference?: string;
  payment_confirmed?: boolean;
  staff_name?: string;
  created_by?: string;
  customer_name?: string;
  customer_id?: string | null;
  customer_phone?: string;
  customer_address?: string;
  customer_bin?: string;
  customer_type?: string;
  remarks?: string;
};
type PendingSale = { key: string; body: CheckoutPayload; cart?: Cart };

export function ReceiptDialog({
  receipt,
  onClose,
}: {
  receipt: Receipt | null;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<"thermal" | "invoice">("thermal");
  return (
    <Modal
      open={!!receipt}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Sale complete"
      description="Payment and stock movements have been recorded together."
      wide={format === "invoice"}
      className="receipt-dialog"
    >
      {receipt && (
        <>
          <div className="receipt-success">
            <CheckCircle2 size={22} />
            <span>
              {paymentNames[receipt.payment_method] || receipt.payment_method}{" "}
              payment recorded
            </span>
          </div>
          <div className="document-tabs">
            <button
              className={format === "thermal" ? "active" : ""}
              onClick={() => setFormat("thermal")}
            >
              Thermal receipt
            </button>
            <button
              className={format === "invoice" ? "active" : ""}
              onClick={() => setFormat("invoice")}
            >
              Invoice copy
            </button>
          </div>
          <div className="document-preview">
            {format === "thermal" ? (
              <ThermalReceipt receipt={receipt} />
            ) : (
              <InvoiceCopy receipt={receipt} />
            )}
          </div>
          <div className="modal-actions receipt-footer-actions">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
            <PrintActions receipt={receipt} />
          </div>
        </>
      )}
    </Modal>
  );
}

export function POS({
  identity,
  products,
  branch,
  onCompleted,
  notify,
}: {
  identity: string;
  products: Product[];
  branch: string;
  onCompleted: () => void;
  notify: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All medicines");
  const [cart, setCart] = useState<Cart>([]);
  const [tender, setTender] = useState("");
  const [method, setMethod] = useState("cash"),
    [paymentReference, setPaymentReference] = useState(""),
    [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [customer, setCustomer] = useState({
    customer_id: null as string | null,
    staff_name: "",
    created_by: "",
    customer_name: "",
    customer_phone: "",
    customer_address: "",
    customer_bin: "",
    customer_type: "Retail",
    remarks: "",
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewNeeded, setReviewNeeded] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState<PendingSale | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [mobilePanel, setMobilePanel] = useState("medicines");
  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
  }, [search, category]);
  const storageKey = `pharmacore:checkout:${identity}:${branch}`;
  const draftKey = `pharmacore:draft:${identity}:${branch}`;
  useEffect(() => {
    const stored = sessionStorage.getItem(storageKey);
    const operation: PendingSale | null = stored ? JSON.parse(stored) : null;
    setPending(operation);
    setPaymentOpen(!!operation);
    setCustomerPickerOpen(false);
    if (operation) {
      setCart(
        operation.cart ||
          operation.body.lines.map((line) => ({
            product: products.find((p) => p.id === line.product_id) || {
              id: line.product_id,
              name: "Pending medicine",
              strength: "",
              price_minor: line.expected_price_minor,
              stock: line.quantity,
              form: "",
              generic: "",
              barcode: "",
              manufacturer: "",
              sku: "",
              prescription_required: false,
              reorder_level: 0,
              active: true,
            },
            quantity: line.quantity,
            unitId: line.unit_id,
          })),
      );
      setTender((operation.body.tendered_minor / 100).toFixed(2));
      setMethod(operation.body.payment_method || "cash");
      setPaymentReference(operation.body.payment_reference || "");
      setPaymentConfirmed(operation.body.payment_confirmed || false);
      setCustomer({
        customer_id: operation.body.customer_id || null,
        staff_name: operation.body.staff_name || "",
        created_by: operation.body.created_by || "",
        customer_name: operation.body.customer_name || "",
        customer_phone: operation.body.customer_phone || "",
        customer_address: operation.body.customer_address || "",
        customer_bin: operation.body.customer_bin || "",
        customer_type: operation.body.customer_type || "Retail",
        remarks: operation.body.remarks || "",
      });
    } else {
      setCart([]);
      setTender("");
      setCustomer({
        customer_id: null,
        staff_name: "",
        created_by: "",
        customer_name: "",
        customer_phone: "",
        customer_address: "",
        customer_bin: "",
        customer_type: "Retail",
        remarks: "",
      });
    }
    if (!operation) {
      try {
        const draft = JSON.parse(sessionStorage.getItem(draftKey) || "null");
        if (draft) {
          setCart(draft.cart || []);
          setCustomer(draft.customer);
          setTender(draft.tender || "");
          setMethod(draft.method || "cash");
        }
      } catch {
        sessionStorage.removeItem(draftKey);
      }
    }
    setDraftReady(true);
    // The cart is a price snapshot. Refreshing stock must not silently reprice it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (draftReady && !pending)
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ cart, customer, tender, method }),
      );
  }, [cart, customer, tender, method, draftReady, pending, draftKey]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const total = cart.reduce(
    (sum, line) => sum + unitPrice(line) * line.quantity,
    0,
  );
  const filtered = products.filter(
    (p) =>
      p.active &&
      (category === "All medicines" || p.form === category) &&
      `${p.name} ${p.generic} ${p.strength} ${p.form} ${p.barcode} ${p.sku}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function add(product: Product) {
    if (busy || pending) return;
    if (product.prescription_required) {
      notify(
        "Prescription verification is required. This medicine cannot be dispensed yet.",
      );
      return;
    }
    const existing = cart.find((item) => item.product.id === product.id);
    const defaultUnit =
      (product.base_available ?? product.stock) > 0
        ? undefined
        : product.units?.find((u) => u.active && u.available > 0)?.id;
    const quantity = existing?.quantity || 0;
    if (
      quantity >=
      maxQuantity(existing || { product, quantity: 1, unitId: defaultUnit })
    ) {
      notify("There are no more eligible units available.");
      return;
    }
    setCart((current) =>
      current.some((item) => item.product.id === product.id)
        ? current.map((item) =>
            item.product.id === product.id
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          )
        : [...current, { product, quantity: 1, unitId: defaultUnit }],
    );
    setError("");
  }
  function setQuantity(id: string, quantity: number) {
    if (busy || pending) return;
    setCart((current) =>
      current.map((item) =>
        item.product.id === id
          ? {
              ...item,
              quantity: Math.max(1, Math.min(quantity || 1, maxQuantity(item))),
            }
          : item,
      ),
    );
  }
  async function pay() {
    if (busy || (!cart.length && !pending)) return;
    setBusy(true);
    setError("");
    try {
      const operation = pending || {
        key: crypto.randomUUID(),
        cart,
        body: {
          lines: cart.map((line) => ({
            product_id: line.product.id,
            quantity: line.quantity,
            expected_price_minor: line.product.price_minor,
            unit_id: line.unitId,
            expected_base_units: multiplier(line),
            expected_unit_price_minor: unitPrice(line),
          })),
          tendered_minor: method === "cash" && tender ? toMinor(tender) : total,
          payment_method: method,
          payment_reference: method === "cash" ? "" : paymentReference,
          payment_confirmed: paymentConfirmed,
          ...customer,
        },
      };
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
      setPending(operation);
      const result = await api<Receipt>(
        "sales/checkout/",
        {
          method: "POST",
          headers: { "Idempotency-Key": operation.key },
          body: JSON.stringify(operation.body),
        },
        branch,
      );
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setCart([]);
      setTender("");
      setPaymentOpen(false);
      setReceipt(result);
      setPaymentReference("");
      setPaymentConfirmed(false);
      setMethod("cash");
      setCustomer({
        customer_id: null,
        staff_name: "",
        created_by: "",
        customer_name: "",
        customer_phone: "",
        customer_address: "",
        customer_bin: "",
        customer_type: "Retail",
        remarks: "",
      });
      onCompleted();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        if (
          [
            "price_changed",
            "insufficient_stock",
            "unit_changed",
            "unit_not_found",
          ].includes(error.code)
        ) {
          setReviewNeeded(true);
          setPaymentOpen(false);
          onCompleted();
        }
        setError(error.message);
      } else {
        setError(
          `${(error as Error).message} Retry this same checkout to confirm its status.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="pos-mobile-tabs" aria-label="POS workspace view">
        <button
          aria-pressed={mobilePanel === "medicines"}
          onClick={() => setMobilePanel("medicines")}
        >
          Medicines
        </button>
        <button
          aria-pressed={mobilePanel === "cart"}
          onClick={() => setMobilePanel("cart")}
        >
          Current sale ({cart.length}) · {money(total)}
        </button>
      </div>
      <div className={`pos-layout pos-view-${mobilePanel}`}>
        <section className="pos-products">
          <div className="panel pos-search-panel">
            <label className="search-box pos-search">
              <ScanBarcode size={22} />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Scan or search medicine"
                placeholder="Scan a barcode or search for a medicine…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const match = products.find(
                      (p) =>
                        p.barcode === search ||
                        p.sku.toLowerCase() === search.toLowerCase(),
                    );
                    if (match) {
                      add(match);
                      setSearch("");
                    }
                  }
                }}
              />
              <kbd>F2</kbd>
            </label>
          </div>
          <div className="category-tabs">
            {[
              "All medicines",
              "Tablets",
              "Capsules",
              "Syrups",
              "Supplies",
              "Injections",
            ].map((item) => (
              <button
                className={item === category ? "active" : ""}
                key={item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div
            ref={gridRef}
            className="catalog-scroll"
            aria-label="Medicine catalog"
            tabIndex={0}
          >
            <div className="pos-grid">
              {filtered.map((product) => (
                <button
                  className={`product-card ${product.prescription_required ? "rx-product" : ""}`}
                  key={product.id}
                  onClick={() => add(product)}
                  disabled={
                    busy ||
                    !!pending ||
                    !(
                      (product.base_available ?? product.stock) ||
                      product.units?.some((u) => u.active && u.available)
                    ) ||
                    product.prescription_required
                  }
                  aria-label={`Add ${product.name} to cart`}
                >
                  <div className="product-card-top">
                    <span
                      className={`product-illustration form-${product.form.toLowerCase()}`}
                    >
                      <Package size={30} strokeWidth={1.3} />
                    </span>
                    {product.prescription_required ? (
                      <Badge tone="muted">Rx required</Badge>
                    ) : (
                      <span
                        className={
                          product.stock <= product.reorder_level
                            ? "stock-label low"
                            : "stock-label"
                        }
                      >
                        <i />
                        {number(product.stock)} available
                      </span>
                    )}
                  </div>
                  <strong>
                    {product.name}
                    <span>{product.strength}</span>
                  </strong>
                  <p>{product.generic}</p>
                  <small>
                    {product.manufacturer} · {product.form}
                  </small>
                  <div className="product-card-bottom">
                    <span>
                      {money(product.price_minor)}
                      <small>
                        {" "}
                        / {product.packaging?.base_unit.toLowerCase() || "unit"}
                      </small>
                    </span>
                    <span className="add-product">
                      <Plus size={17} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {!filtered.length && (
              <Empty
                title="No medicines found"
                description="Try a brand name, generic, SKU, or barcode."
              />
            )}
            <div className="page-note">
              <ShieldCheck size={16} />
              The earliest eligible expiry is allocated automatically at
              checkout.
            </div>
          </div>
        </section>
        <aside className="panel cart-panel">
          <div className="cart-heading">
            <div>
              <ShoppingBag size={19} />
              <h2>Current sale</h2>
              <span className="count-bubble">
                {cart.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Clear cart"
              disabled={!cart.length || busy || !!pending}
              onClick={() => {
                setCart([]);
                setTender("");
                setError("");
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
          <button
            type="button"
            className="walk-in customer-trigger"
            aria-label={`Choose customer: ${customer.customer_name || "Walk-in customer"}`}
            aria-haspopup="dialog"
            disabled={busy || !!pending}
            onClick={() => setCustomerPickerOpen(true)}
          >
            <span className="customer-icon">
              <UserRound size={18} />
            </span>
            <div>
              <strong>{customer.customer_name || "Walk-in customer"}</strong>
              <small>
                {customer.customer_phone ||
                  (customer.customer_id
                    ? "Saved customer · Change"
                    : "Select existing or add new")}
              </small>
            </div>
            <Badge tone="muted">{customer.customer_type}</Badge>
            <ChevronRight size={16} />
          </button>
          <button
            className="customer-details-trigger"
            onClick={() => setDetailsOpen(true)}
          >
            Customer & invoice details <ChevronRight size={16} />
          </button>
          {pending && (
            <div className="notice amber">
              <ShieldCheck size={18} />
              <span>
                A checkout is awaiting confirmation. Retry safely using the
                button below.
              </span>
            </div>
          )}
          <div className="cart-lines">
            {cart.length ? (
              cart.map((line) => (
                <div className="cart-line" key={line.product.id}>
                  <div className="cart-item-top">
                    <div>
                      <strong>{line.product.name}</strong>
                      <small>
                        {line.product.strength} ·{" "}
                        {money(line.product.price_minor)} / unit
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${line.product.name}`}
                      disabled={busy || !!pending}
                      onClick={() =>
                        setCart((current) =>
                          current.filter(
                            (item) => item.product.id !== line.product.id,
                          ),
                        )
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {!!line.product.units?.some((u) => u.active) && (
                    <Field label={`Selling unit for ${line.product.name}`}>
                      <AppSelect
                        value={line.unitId || ""}
                        disabled={busy || !!pending}
                        onValueChange={(value) => {
                          const unitId = value || undefined;
                          setCart((items) =>
                            items.map((item) =>
                              item.product.id === line.product.id
                                ? { ...item, unitId, quantity: 1 }
                                : item,
                            ),
                          );
                        }}
                        options={[
                          {
                            value: "",
                            label: `${line.product.packaging?.base_unit || "UNIT"} · ${money(line.product.price_minor)}`,
                            disabled:
                              (line.product.base_available ??
                                line.product.stock) === 0,
                          },
                          ...line.product.units
                            .filter((u) => u.active)
                            .map((unit) => ({
                              value: unit.id,
                              label: `${unit.name} · ${unit.base_units} units · ${money(unit.price_minor)}`,
                              disabled: unit.available === 0,
                            })),
                        ]}
                      />
                    </Field>
                  )}
                  {(!line.product.active ||
                    line.quantity > maxQuantity(line)) && (
                    <p className="form-error">
                      Only {maxQuantity(line)} available in this selling unit.
                      Adjust the quantity or remove this item.
                    </p>
                  )}
                  <div className="cart-item-bottom">
                    <div className="quantity-control">
                      <button
                        aria-label={`Decrease ${line.product.name}`}
                        disabled={busy || !!pending || line.quantity <= 1}
                        onClick={() =>
                          setQuantity(line.product.id, line.quantity - 1)
                        }
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        aria-label={`Quantity of ${line.product.name}`}
                        type="number"
                        min={1}
                        max={maxQuantity(line)}
                        value={line.quantity}
                        disabled={busy || !!pending}
                        onChange={(e) =>
                          setQuantity(line.product.id, Number(e.target.value))
                        }
                      />
                      <button
                        aria-label={`Increase ${line.product.name}`}
                        disabled={
                          busy ||
                          !!pending ||
                          line.quantity >= maxQuantity(line)
                        }
                        onClick={() =>
                          setQuantity(line.product.id, line.quantity + 1)
                        }
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <strong>{money(line.quantity * unitPrice(line))}</strong>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-cart">
                <ShoppingBag size={42} strokeWidth={1} />
                <h3>A fresh start.</h3>
                <p>
                  Scan or select a medicine
                  <br />
                  to begin this sale.
                </p>
                <span>
                  <ScanBarcode size={14} />
                  Barcode scanners welcome
                </span>
              </div>
            )}
          </div>
          <div className="cart-checkout">
            <div className="cart-subtotal">
              <span>Subtotal</span>
              <span>{money(total)}</span>
            </div>
            <div className="cart-tax">
              <span>Tax</span>
              <span>Not configured</span>
            </div>
            <div className="cart-total">
              <strong>Total payable</strong>
              <strong>{money(total)}</strong>
            </div>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {reviewNeeded && (
              <Button
                variant="secondary"
                className="full-width"
                onClick={() => {
                  setCart((items) =>
                    items.map((line) => {
                      const product = products.find(
                        (p) => p.id === line.product.id,
                      );
                      if (!product)
                        return {
                          ...line,
                          product: {
                            ...line.product,
                            active: false,
                            stock: 0,
                            base_available: 0,
                            units: [],
                          },
                        };
                      const unitId = product.units?.some(
                        (u) => u.id === line.unitId && u.active,
                      )
                        ? line.unitId
                        : undefined;
                      return { ...line, product, unitId };
                    }),
                  );
                  setReviewNeeded(false);
                  setError("");
                }}
              >
                Review updated prices & stock
              </Button>
            )}
            <Button
              className="full-width charge-button"
              disabled={
                !cart.length ||
                busy ||
                reviewNeeded ||
                cart.some(
                  (line) =>
                    !line.product.active || line.quantity > maxQuantity(line),
                )
              }
              onClick={() => setPaymentOpen(true)}
            >
              {pending
                ? "Review pending sale"
                : `Review payment · ${money(total)}`}
              <ArrowRight size={18} />
            </Button>
            <small className="checkout-note">
              <ShieldCheck size={12} />
              Prices and stock verified before completion
            </small>
          </div>
        </aside>
      </div>
      <Modal
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Customer & invoice details"
        description="Set customer information and the names printed on this sale."
      >
        {customer.customer_id && (
          <p className="customer-saved-hint">
            Customer details are filled from the saved record. Use the customer
            selector above to choose someone else or walk-in.
          </p>
        )}
        {(
          [
            ["staff_name", "Staff name"],
            ["created_by", "Created by"],
            ["customer_name", "Customer name"],
            ["customer_phone", "Customer phone"],
            ["customer_address", "Customer address"],
            ["customer_bin", "Customer BIN"],
            ["remarks", "Invoice remarks"],
          ] as const
        ).map(([key, label]) => (
          <Field
            label={label}
            key={key}
            hint={
              key === "staff_name" || key === "created_by"
                ? "Printed name. Leave blank to use your receipt settings or signed-in name."
                : undefined
            }
          >
            <input
              value={customer[key]}
              disabled={
                busy ||
                !!pending ||
                (!!customer.customer_id && key.startsWith("customer_"))
              }
              maxLength={
                key === "remarks"
                  ? 500
                  : key === "customer_address"
                    ? 250
                    : key === "customer_bin"
                      ? 13
                      : key === "customer_phone"
                        ? 25
                        : 100
              }
              onChange={(e) =>
                setCustomer((c) => ({ ...c, [key]: e.target.value }))
              }
            />
          </Field>
        ))}
        <Field label="Customer type">
          <AppSelect
            value={customer.customer_type}
            disabled={busy || !!pending}
            onValueChange={(value) =>
              setCustomer((c) => ({ ...c, customer_type: value }))
            }
            options={["Retail", "Delivery", "Collection"].map((value) => ({
              value,
              label: value,
            }))}
          />
        </Field>
        <div className="modal-actions">
          <Button onClick={() => setDetailsOpen(false)}>Done</Button>
        </div>
      </Modal>

      <CheckoutDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        lines={cart.map((line) => ({
          id: line.product.id,
          name: line.product.name,
          quantity: line.quantity,
          unit:
            sellingUnit(line)?.name ||
            line.product.packaging?.base_unit ||
            "UNIT",
          total: line.quantity * unitPrice(line),
        }))}
        total={total}
        customer={`${customer.customer_name || "Walk-in customer"} · ${customer.customer_type}`}
        method={method}
        onMethod={(value) => {
          setMethod(value);
          setPaymentConfirmed(false);
          setPaymentReference("");
        }}
        tender={tender}
        onTender={setTender}
        reference={paymentReference}
        onReference={setPaymentReference}
        confirmed={paymentConfirmed}
        onConfirmed={setPaymentConfirmed}
        pending={!!pending}
        busy={busy}
        error={error}
        onPay={pay}
      />
      {customerPickerOpen && (
        <CustomerPicker
          key={branch}
          branch={branch}
          onClose={() => setCustomerPickerOpen(false)}
          onSelect={(record) => {
            setCustomer((current) => ({
              ...current,
              customer_id: record?.id || null,
              customer_name: record?.name || "",
              customer_phone: record?.phone || "",
              customer_address: record?.address || "",
              customer_bin: record?.bin || "",
            }));
            setCustomerPickerOpen(false);
          }}
        />
      )}
      <ReceiptDialog
        receipt={receipt}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
      />
    </>
  );
}
