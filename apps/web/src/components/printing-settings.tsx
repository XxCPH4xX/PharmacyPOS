"use client";
import { AppSelect } from "./select";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import type { PrintProfile, Receipt, Session } from "@/lib/types";
import { Button, Field } from "./ui";
import {
  defaultPrintProfile,
  InvoiceCopy,
  PrintActions,
  ThermalReceipt,
} from "./print-documents";

export function PrintingSettings({
  branch,
  session,
}: {
  branch: string;
  session: Session;
}) {
  const [draft, setDraft] = useState<PrintProfile | null>(null),
    [saved, setSaved] = useState<PrintProfile | null>(null);
  const [format, setFormat] = useState<"thermal" | "invoice">("thermal"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api<PrintProfile>("settings/printing/", {}, branch)
      .then((value) => {
        if (active) {
          setDraft(value);
          setSaved(value);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [branch]);
  function change<K extends keyof PrintProfile>(
    key: K,
    value: PrintProfile[K],
  ) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setMessage("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const { qr_data_url, ...payload } = draft;
      void qr_data_url;
      const result = await api<PrintProfile>(
        "settings/printing/",
        { method: "PUT", body: JSON.stringify(payload) },
        branch,
      );
      setDraft(result);
      setSaved(result);
      setMessage(
        "Print settings saved. New sales will use this branding; posted invoices keep their original details.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 1000000) {
      setError("Choose an image under 1 MB.");
      return;
    }
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      change("logo_data_url", content);
      setError("");
    } catch {
      setError("The logo could not be read.");
    }
  }
  if (!draft)
    return (
      <section className="panel operation-panel">
        {error || "Loading print settings…"}
      </section>
    );
  const profile = {
    ...defaultPrintProfile,
    ...draft,
    qr_data_url: draft.qr_value === saved?.qr_value ? saved.qr_data_url : "",
  };
  const sample: Receipt = {
    id: "preview",
    receipt_number: "PC-PREVIEW-0001",
    created_at: new Date().toISOString(),
    cashier: session.user?.name || "Cashier",
    staff_name: draft.default_staff_name || session.user?.name || "Cashier",
    created_by: draft.default_created_by || session.user?.name || "Cashier",
    total_minor: 250000,
    tendered_minor: 250000,
    change_minor: 0,
    payment_method: "bkash",
    payment_reference: "SAMPLE1234",
    payment_verification: "staff_confirmed",
    status: "completed",
    branch:
      session.branches?.find((b) => b.id === branch)?.name || "Main branch",
    address: session.branches?.find((b) => b.id === branch)?.address || "",
    organization: session.tenant?.name || "Your pharmacy",
    tax_status: "not_calculated",
    customer_name: "Sample customer",
    customer_phone: "01700 000000",
    customer_type: "Retail",
    amount_in_words: "Two Thousand Five Hundred Taka Only",
    receipt_profile: profile,
    lines: [
      {
        id: "sample",
        product_id: "sample",
        name: "Sample medicine 500 mg",
        sku: "MED-500",
        quantity: 2,
        unit_name: "BOX",
        base_units: 100,
        unit_price_minor: 125000,
        total_minor: 250000,
        batch: "SAMPLE-BATCH",
        expiry: "2030-12-31",
        allocations: [
          { batch: "SAMPLE-BATCH", expiry: "2030-12-31", base_quantity: 200 },
        ],
      },
    ],
  };
  return (
    <div className="print-settings-layout">
      <section className="panel operation-panel">
        <h2>Your shop, on every receipt</h2>
        <p>
          Set the thermal layout and A4 invoice branding. Preview uses sample
          data.
        </p>
        <form onSubmit={save}>
          <Field
            label="Shop name"
            hint="Leave blank to use the organization name."
          >
            <input
              value={draft.shop_name}
              onChange={(e) => change("shop_name", e.target.value)}
              maxLength={150}
            />
          </Field>
          <Field
            label="Shop address"
            hint="Leave blank to use the selected branch address."
          >
            <textarea
              value={draft.address}
              onChange={(e) => change("address", e.target.value)}
              maxLength={250}
            />
          </Field>
          <div className="form-grid">
            <Field label="Shop phone">
              <input
                value={draft.phone}
                onChange={(e) => change("phone", e.target.value)}
                maxLength={60}
              />
            </Field>
            <Field label="Shop email">
              <input
                type="email"
                value={draft.email}
                onChange={(e) => change("email", e.target.value)}
                maxLength={150}
              />
            </Field>
            <Field label="Contact name">
              <input
                value={draft.contact_name}
                onChange={(e) => change("contact_name", e.target.value)}
                maxLength={100}
              />
            </Field>
            <Field label="BIN (optional)">
              <input
                value={draft.bin}
                onChange={(e) => change("bin", e.target.value)}
                pattern="[0-9]{13}"
                maxLength={13}
              />
            </Field>
            <Field label="Drug licence number (optional)">
              <input
                value={draft.drug_license}
                onChange={(e) => change("drug_license", e.target.value)}
                maxLength={80}
              />
            </Field>
            <Field label="Authorized signatory (A4)">
              <input
                value={draft.signature_name}
                onChange={(e) => change("signature_name", e.target.value)}
                maxLength={100}
              />
            </Field>
          </div>
          <Field
            label="Shop logo"
            hint="PNG, JPEG or WebP, under 1 MB. Uploaded logos are sanitized by the server."
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </Field>
          {draft.logo_data_url && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => change("logo_data_url", "")}
            >
              Remove logo
            </Button>
          )}
          <h3>Names on the receipt</h3>
          <div className="form-grid">
            <Field
              label="Default staff name"
              hint="Leave blank to use the signed-in staff member. Can be changed at checkout."
            >
              <input
                value={draft.default_staff_name}
                maxLength={100}
                onChange={(e) => change("default_staff_name", e.target.value)}
              />
            </Field>
            <Field
              label="Default created by"
              hint="Printed name only. The audit log always records the signed-in user."
            >
              <input
                value={draft.default_created_by}
                maxLength={100}
                onChange={(e) => change("default_created_by", e.target.value)}
              />
            </Field>
          </div>
          <h3>Thermal paper</h3>
          <div className="form-grid">
            <Field label="Paper width">
              <AppSelect
                value={draft.paper_width}
                onValueChange={(value) =>
                  change("paper_width", Number(value) as 58 | 80)
                }
                options={[80, 58].map((value) => ({
                  value,
                  label: `${value} mm`,
                }))}
              />
            </Field>
            <Field label="Receipt font size">
              <AppSelect
                value={draft.font_size}
                onValueChange={(value) => change("font_size", Number(value))}
                options={[9, 10, 11, 12, 13, 14].map((value) => ({
                  value,
                  label: `${value} px`,
                }))}
              />
            </Field>
            <Field label="Invoice accent">
              <input
                type="color"
                value={draft.invoice_accent}
                onChange={(e) => change("invoice_accent", e.target.value)}
              />
            </Field>
          </div>
          {(
            [
              ["show_logo", "Show shop logo"],
              ["show_batch", "Show batch and expiry details"],
              ["show_staff", "Show staff name and created by"],
              ["show_barcode", "Show receipt barcode"],
              ["show_amount_words", "Show amount in words"],
              ["qr_enabled", "Enable Scan to Pay QR"],
            ] as const
          ).map(([key, label]) => (
            <label className="checkbox-field" key={key}>
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(e) => change(key, e.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
          {draft.qr_enabled && (
            <Field
              label="Merchant QR payload or payment URL"
              hint="Use the exact payload issued by your merchant provider. Printing a QR does not verify a payment. Save to generate the preview."
            >
              <textarea
                value={draft.qr_value}
                required
                maxLength={500}
                onChange={(e) => change("qr_value", e.target.value)}
              />
            </Field>
          )}
          <Field
            label="Thermal receipt footer"
            hint="Optional policy or message below the barcode. Use your shop’s own terms."
          >
            <textarea
              value={draft.receipt_terms}
              maxLength={1500}
              onChange={(e) => change("receipt_terms", e.target.value)}
            />
          </Field>
          <Field
            label="Invoice terms (A4 only)"
            hint="Optional terms for the A4 customer copy."
          >
            <textarea
              value={draft.invoice_terms}
              maxLength={1000}
              onChange={(e) => change("invoice_terms", e.target.value)}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <Button type="submit" busy={busy}>
            Save print settings
          </Button>
        </form>
      </section>
      <section className="panel print-preview-panel">
        <div className="panel-heading">
          <div>
            <h2>Live preview</h2>
            <p>
              Sample data ·{" "}
              {format === "thermal"
                ? `${draft.paper_width} mm thermal`
                : "A4 customer copy"}
            </p>
          </div>
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
            A4 invoice
          </button>
        </div>
        <div className="document-preview">
          {format === "thermal" ? (
            <ThermalReceipt receipt={sample} />
          ) : (
            <InvoiceCopy receipt={sample} />
          )}
        </div>
        <div className="preview-print-actions">
          <PrintActions receipt={sample} />
        </div>
      </section>
    </div>
  );
}
