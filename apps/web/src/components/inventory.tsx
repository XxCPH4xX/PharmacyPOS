"use client";
import { AppSelect } from "./select";

import {
  Boxes,
  Check,
  ChevronDown,
  Package,
  Plus,
  ScanBarcode,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  api,
  ApiError,
  date,
  daysUntil,
  money,
  number,
  toMinor,
} from "@/lib/api";
import type { Batch, Product } from "@/lib/types";
import { Badge, Button, Empty, Field, Modal, Pagination } from "./ui";
import {
  ProductUnits,
  PackagingFields,
  packagingFromForm,
} from "./product-units";

import { RemoveMedicine } from "./maintenance";

export function AddMedicine({
  open,
  onClose,
  branch,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  branch: string;
  onSaved: () => void;
}) {
  const [dosageForm, setDosageForm] = useState("Tablets");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const body = Object.fromEntries(
        [...form].filter(([key]) => !key.startsWith("pack_")),
      );
      await api(
        "catalog/",
        {
          method: "POST",
          body: JSON.stringify({
            ...body,
            packaging: packagingFromForm(form),
            price_minor: toMinor(String(form.get("price"))),
            price: undefined,
            reorder_level: Number(form.get("reorder_level")),
            prescription_required: form.get("prescription_required") === "on",
          }),
        },
        branch,
      );
      onSaved();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) {
          setError("");
          onClose();
        }
      }}
      title="Add a medicine"
      description="Create its catalog record, then receive a batch to add stock."
      wide
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Brand / medicine name">
            <input
              name="name"
              placeholder="e.g. Napa"
              maxLength={120}
              required
            />
          </Field>
          <Field label="Generic name">
            <input
              name="generic"
              placeholder="e.g. Paracetamol"
              maxLength={150}
              required
            />
          </Field>
          <Field label="Strength">
            <input
              name="strength"
              placeholder="e.g. 500 mg"
              maxLength={60}
              required
            />
          </Field>
          <Field label="Dosage form">
            <AppSelect
              name="form"
              value={dosageForm}
              onValueChange={setDosageForm}
              options={[
                "Tablets",
                "Capsules",
                "Syrups",
                "Injections",
                "Supplies",
                "Creams",
                "Powders",
              ].map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label="Manufacturer">
            <input
              name="manufacturer"
              maxLength={120}
              required
              placeholder="Manufacturer name"
            />
          </Field>
          <Field label="SKU">
            <input
              name="sku"
              maxLength={40}
              required
              pattern="[a-zA-Z0-9_\-]+"
              placeholder="MED-0001"
            />
          </Field>
          <Field label="Barcode">
            <input
              name="barcode"
              maxLength={64}
              required
              pattern="[a-zA-Z0-9_\-]+"
              placeholder="Scan or type barcode"
            />
          </Field>
          <Field label="Selling price (৳ / unit)">
            <input
              name="price"
              type="text"
              inputMode="decimal"
              required
              pattern="\d+(\.\d{1,2})?"
              placeholder="0.00"
            />
          </Field>
          <Field label="Reorder level (units)">
            <input
              name="reorder_level"
              type="number"
              min={0}
              max={100000}
              required
              defaultValue={30}
            />
          </Field>
        </div>
        <PackagingFields key={dosageForm} form={dosageForm} />
        <label className="checkbox-field">
          <input name="prescription_required" type="checkbox" />
          <div>
            <strong>Prescription required</strong>
            <small>
              Sales are blocked until a verified dispensing workflow is
              available.
            </small>
          </div>
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            <Plus size={16} />
            Add medicine
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type ReceivePayload = {
  unit_id?: string;
  expected_base_units?: number;
  product_id: string;
  batch_number: string;
  expiry: string;
  quantity: number;
  unit_cost_minor: number;
  supplier: string;
  reference: string;
  location: string;
};
type PendingReceipt = { key: string; body: ReceivePayload };

export function ReceiveStock({
  open,
  onClose,
  branch,
  products,
  selected,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  branch: string;
  products: Product[];
  selected?: string;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingReceipt | null>(null);
  const [productId, setProductId] = useState(selected || "");
  const [unitId, setUnitId] = useState("");
  const selectedProduct = products.find((p) => p.id === productId);
  const selectedUnit = selectedProduct?.units?.find((u) => u.id === unitId);
  const storageKey = `pharmacore:receiving:${branch}`;
  useEffect(() => {
    if (open) {
      const saved = sessionStorage.getItem(storageKey);
      const operation = saved ? JSON.parse(saved) : null;
      setPending(operation);
      setProductId(operation?.body.product_id || selected || "");
      setUnitId(operation?.body.unit_id || "");
      setError("");
    }
  }, [open, storageKey, selected]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const operation: PendingReceipt = pending || {
        key: crypto.randomUUID(),
        body: {
          product_id: String(form.get("product_id")),
          unit_id: unitId || undefined,
          expected_base_units: selectedUnit?.base_units || 1,
          batch_number: String(form.get("batch_number")),
          expiry: String(form.get("expiry")),
          quantity: Number(form.get("quantity")),
          unit_cost_minor: toMinor(String(form.get("cost"))),
          supplier: String(form.get("supplier")),
          reference: String(form.get("reference")),
          location: String(form.get("location")),
        },
      };
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
      setPending(operation);
      await api(
        "inventory/receive/",
        {
          method: "POST",
          headers: { "Idempotency-Key": operation.key },
          body: JSON.stringify(operation.body),
        },
        branch,
      );
      sessionStorage.removeItem(storageKey);
      setPending(null);
      onSaved();
      onClose();
    } catch (error) {
      const known =
        error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (known) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(
        (error as Error).message +
          (!known && pending ? " Retry to confirm this same receipt." : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
      title="Receive stock"
      description="Record a delivery, its batch details, and a traceable stock movement."
      wide
    >
      <form onSubmit={submit}>
        {pending && (
          <div className="notice">
            <ShieldCheck size={18} />
            <span>
              This receiving request is saved. Retry to confirm it without
              posting twice.
            </span>
          </div>
        )}
        <fieldset disabled={busy || !!pending} key={pending?.key || "new"}>
          <Field label="Medicine">
            <AppSelect
              name="product_id"
              required
              disabled={busy || !!pending}
              value={productId}
              onValueChange={(value) => {
                setProductId(value);
                setUnitId("");
              }}
              options={[
                { value: "", label: "Select a medicine", disabled: true },
                ...products.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.strength}`,
                })),
              ]}
            />
          </Field>
          <Field
            label="Receiving unit"
            hint="Select the sealed packaging actually delivered. Loose stock cannot be sold as a sealed box."
          >
            <AppSelect
              value={unitId}
              onValueChange={setUnitId}
              disabled={busy || !!pending}
              options={[
                {
                  value: "",
                  label: `Loose ${selectedProduct?.packaging?.base_unit || "UNIT"}`,
                },
                ...(selectedProduct?.units || [])
                  .filter((u) => u.active)
                  .map((u) => ({
                    value: u.id,
                    label: `Sealed ${u.name} · ${u.base_units} base units`,
                  })),
              ]}
            />
          </Field>
          <div className="form-grid">
            <Field label="Batch / lot number">
              <input
                name="batch_number"
                required
                maxLength={80}
                placeholder="BT-2026-001"
                defaultValue={pending?.body.batch_number}
              />
            </Field>
            <Field label="Expiry date">
              <input
                name="expiry"
                type="date"
                required
                defaultValue={pending?.body.expiry}
              />
            </Field>
            <Field
              label={
                selectedUnit
                  ? `Quantity (${selectedUnit.name})`
                  : "Quantity (individual units)"
              }
            >
              <input
                name="quantity"
                type="number"
                min={1}
                max={1000000}
                required
                placeholder="100"
                defaultValue={pending?.body.quantity}
              />
            </Field>
            <Field
              label="Purchase cost (৳ / unit)"
              hint={`Cost per individual ${selectedProduct?.packaging?.base_unit.toLowerCase() || "unit"}, including when receiving packs.`}
            >
              <input
                name="cost"
                type="text"
                inputMode="decimal"
                required
                pattern="\d+(\.\d{1,2})?"
                placeholder="0.00"
                defaultValue={
                  pending ? (pending.body.unit_cost_minor / 100).toFixed(2) : ""
                }
              />
            </Field>
            <Field label="Supplier">
              <input
                name="supplier"
                maxLength={120}
                required
                placeholder="Supplier name"
                defaultValue={pending?.body.supplier}
              />
            </Field>
            <Field
              label="Delivery reference"
              hint="Unique for this branch and delivery line."
            >
              <input
                name="reference"
                maxLength={80}
                required
                placeholder="INV-1042 / line 1"
                defaultValue={pending?.body.reference}
              />
            </Field>
            <Field label="Rack / location">
              <input
                name="location"
                maxLength={40}
                required
                defaultValue={pending?.body.location || "A-01"}
              />
            </Field>
          </div>
        </fieldset>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </Button>
          <Button type="submit" busy={busy}>
            <Check size={16} />
            {pending ? "Confirm receiving" : "Receive stock"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function Inventory({
  products,
  batches,
  catalog = false,
  canManage,
  canRemove,
  demo,
  onAdd,
  onReceive,
  branch,
  onChanged,
}: {
  products: Product[];
  batches: Batch[];
  catalog?: boolean;
  canManage: boolean;
  canRemove: boolean;
  demo: boolean;
  onAdd: () => void;
  onReceive: (id?: string) => void;
  branch: string;
  onChanged: () => void;
}) {
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("medicines");
  const [page, setPage] = useState(0);
  const [removal, setRemoval] = useState<Product | null>(null);
  const [detail, setDetail] = useState<Product | null>(null);
  const [unitProduct, setUnitProduct] = useState<Product | null>(null);
  useEffect(() => {
    setSearch(params.get("search") || "");
    setPage(0);
  }, [params]);
  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          `${p.name} ${p.generic} ${p.strength} ${p.form} ${p.barcode} ${p.sku}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (filter === "all" ||
            (filter === "low" && p.stock <= p.reorder_level) ||
            (filter === "rx" && p.prescription_required) ||
            (filter === "stock" && p.stock > p.reorder_level)),
      ),
    [products, search, filter],
  );
  const filteredBatches = useMemo(
    () =>
      batches.filter(
        (b) =>
          `${b.name} ${b.number} ${b.location}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (filter === "all" ||
            (filter === "expiry" &&
              daysUntil(b.expiry) > 0 &&
              daysUntil(b.expiry) <= 90) ||
            (filter === "expired" && daysUntil(b.expiry) <= 0)),
      ),
    [batches, search, filter],
  );
  const batchView = !catalog && tab === "batches";
  const rows = batchView ? filteredBatches : filtered;
  const size = 8;
  return (
    <>
      <div className="summary-strip">
        <div>
          <span className="summary-icon teal">
            <Package size={21} />
          </span>
          <span>
            <small>Catalog medicines</small>
            <strong>{number(products.length)}</strong>
          </span>
        </div>
        <div>
          <span className="summary-icon blue">
            <Boxes size={21} />
          </span>
          <span>
            <small>Available units</small>
            <strong>
              {number(products.reduce((sum, p) => sum + p.stock, 0))}
            </strong>
          </span>
        </div>
        <div>
          <span className="summary-icon amber">
            <Package size={21} />
          </span>
          <span>
            <small>Need reordering</small>
            <strong>
              {products.filter((p) => p.stock <= p.reorder_level).length}
            </strong>
          </span>
        </div>
        <div>
          <span className="summary-icon red">
            <ShieldCheck size={21} />
          </span>
          <span>
            <small>Prescription required</small>
            <strong>
              {products.filter((p) => p.prescription_required).length}
            </strong>
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{catalog ? "Medicine catalog" : "Your inventory"}</h2>
            <p>
              {catalog
                ? "The medicines and essentials behind your daily care."
                : "The right stock, in the right place, at the right time."}
            </p>
          </div>
          {canManage && (
            <Button onClick={catalog ? onAdd : () => onReceive()}>
              <Plus size={16} />
              {catalog ? "Add medicine" : "Receive stock"}
            </Button>
          )}
        </div>
        {!catalog && (
          <div className="tab-line">
            <button
              className={tab === "medicines" ? "active" : ""}
              onClick={() => {
                setTab("medicines");
                setFilter("all");
                setPage(0);
              }}
            >
              Stock summary
            </button>
            <button
              className={tab === "batches" ? "active" : ""}
              onClick={() => {
                setTab("batches");
                setFilter("all");
                setPage(0);
              }}
            >
              Batch inventory<span>{batches.length}</span>
            </button>
          </div>
        )}
        <div className="table-toolbar">
          <label className="search-box">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder={
                batchView
                  ? "Search medicine, batch or rack…"
                  : "Search name, generic, SKU or barcode…"
              }
              aria-label="Search inventory"
            />
            <ScanBarcode size={18} />
          </label>
          <div className="select-wrap">
            <AppSelect
              aria-label="Filter inventory"
              value={filter}
              onValueChange={(value) => {
                setFilter(value);
                setPage(0);
              }}
              options={[
                {
                  value: "all",
                  label: `All ${batchView ? "batches" : "medicines"}`,
                },
                ...(batchView
                  ? [
                      { value: "expiry", label: "Expiring in 90 days" },
                      { value: "expired", label: "Expired" },
                    ]
                  : [
                      { value: "stock", label: "In stock" },
                      { value: "low", label: "Low stock" },
                      { value: "rx", label: "Prescription required" },
                    ]),
              ]}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Medicine</th>
                {batchView ? (
                  <>
                    <th>Batch number</th>
                    <th>Expiry date</th>
                    <th>Location</th>
                    <th>Quantity</th>
                    <th>Status</th>
                  </>
                ) : (
                  <>
                    <th>{catalog ? "SKU / Barcode" : "Manufacturer"}</th>
                    <th>Form</th>
                    <th>Unit price</th>
                    <th>Available</th>
                    <th>Status</th>
                    <th />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {batchView
                ? filteredBatches
                    .slice(page * size, (page + 1) * size)
                    .map((batch) => (
                      <tr key={batch.id}>
                        <td>
                          <div className="medicine-cell">
                            <span className="medicine-mini">
                              <Package size={18} />
                            </span>
                            <div>
                              <strong>{batch.name}</strong>
                              <small>{batch.strength}</small>
                            </div>
                          </div>
                        </td>
                        <td className="mono">{batch.number}</td>
                        <td>{date(batch.expiry)}</td>
                        <td>
                          <span className="rack-label">{batch.location}</span>
                        </td>
                        <td className="amount">
                          {number(batch.quantity)}
                          <small className="physical-stock">
                            {batch.loose_quantity} loose
                            {batch.inner_quantity
                              ? ` · ${batch.inner_quantity} ${batch.inner_name}`
                              : ""}
                            {batch.outer_quantity
                              ? ` · ${batch.outer_quantity} ${batch.outer_name}`
                              : ""}
                          </small>
                        </td>
                        <td>
                          <Badge
                            tone={
                              daysUntil(batch.expiry) <= 0
                                ? "red"
                                : daysUntil(batch.expiry) <= 90
                                  ? "amber"
                                  : "teal"
                            }
                          >
                            {daysUntil(batch.expiry) <= 0
                              ? "Expired"
                              : batch.status !== "available"
                                ? batch.status
                                : daysUntil(batch.expiry) <= 90
                                  ? `${daysUntil(batch.expiry)} days left`
                                  : "Available"}
                          </Badge>
                        </td>
                      </tr>
                    ))
                : filtered
                    .slice(page * size, (page + 1) * size)
                    .map((product) => (
                      <tr key={product.id}>
                        <td>
                          <button
                            className="medicine-cell cell-button"
                            onClick={() => setDetail(product)}
                          >
                            <span className="medicine-mini">
                              <Package size={18} />
                            </span>
                            <div>
                              <strong>
                                {product.name}{" "}
                                <span className="strength">
                                  {product.strength}
                                </span>
                              </strong>
                              <small>{product.generic}</small>
                            </div>
                          </button>
                        </td>
                        <td>
                          {catalog ? (
                            <div className="stacked">
                              <span className="mono">{product.sku}</span>
                              <small>{product.barcode}</small>
                            </div>
                          ) : (
                            product.manufacturer
                          )}
                        </td>
                        <td>{product.form}</td>
                        <td className="amount">{money(product.price_minor)}</td>
                        <td>
                          <strong>{number(product.stock)}</strong>
                          <span className="muted"> units</span>
                        </td>
                        <td>
                          <Badge
                            tone={
                              product.stock === 0
                                ? "red"
                                : product.stock <= product.reorder_level
                                  ? "amber"
                                  : "teal"
                            }
                          >
                            {product.stock === 0
                              ? "Out of stock"
                              : product.stock <= product.reorder_level
                                ? "Low stock"
                                : "In stock"}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`View ${product.name}`}
                            onClick={() => setDetail(product)}
                          >
                            <ChevronDown size={16} />
                          </button>
                          {canRemove && (
                            <button
                              className="icon-button remove-medicine-button"
                              aria-label={`Remove ${product.name} from catalog`}
                              title="Remove medicine from workspace"
                              onClick={() => setRemoval(product)}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty
            title={
              products.length
                ? "No matching medicines"
                : "Make room for your first medicine"
            }
            description={
              products.length
                ? "Try another name, barcode, or filter."
                : "Add a medicine to your catalog, then receive its first batch."
            }
            action={
              canManage && !products.length ? (
                <Button onClick={onAdd}>Add medicine</Button>
              ) : undefined
            }
          />
        )}
        <Pagination
          page={page}
          size={size}
          total={rows.length}
          onChange={setPage}
        />
      </section>
      <div className="page-note">
        <ShieldCheck size={16} />
        Stock availability excludes expired, recalled, and quarantined batches.
        Every movement is recorded.
      </div>
      <Modal
        open={!!detail}
        onOpenChange={(value) => {
          if (!value) setDetail(null);
        }}
        title={
          detail ? `${detail.name} ${detail.strength}` : "Medicine details"
        }
        description="Catalog identity and current branch availability."
      >
        {detail && (
          <>
            <div className="detail-grid">
              {[
                ["Generic", detail.generic],
                ["Manufacturer", detail.manufacturer],
                ["Form", detail.form],
                ["SKU", detail.sku],
                ["Barcode", detail.barcode],
                ["Unit price", money(detail.price_minor)],
                ["Available", `${number(detail.stock)} units`],
                ["Reorder at", `${detail.reorder_level} units`],
              ].map(([label, value]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {detail.prescription_required && (
              <div className="notice amber">
                <ShieldCheck size={18} />
                Prescription verification required. Checkout is currently
                blocked.
              </div>
            )}
            <div className="modal-actions">
              {canManage && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setUnitProduct(detail);
                    setDetail(null);
                  }}
                >
                  Configure boxes / strips
                </Button>
              )}
              <Button variant="secondary" onClick={() => setDetail(null)}>
                Close
              </Button>
              {canManage && (
                <Button
                  onClick={() => {
                    onReceive(detail.id);
                    setDetail(null);
                  }}
                >
                  <Plus size={16} />
                  Receive this medicine
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>
      <RemoveMedicine
        product={removal}
        branch={branch}
        demo={demo}
        onClose={() => setRemoval(null)}
        onRemoved={() => {
          setDetail(null);
          onChanged();
        }}
      />
      <ProductUnits
        product={unitProduct}
        branch={branch}
        onClose={() => setUnitProduct(null)}
        onSaved={onChanged}
      />
    </>
  );
}
