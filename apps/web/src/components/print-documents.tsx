"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";
import { Fragment } from "react";
import { Printer, FileDown } from "lucide-react";
import type { PrintProfile, Receipt } from "@/lib/types";
import { date, money } from "@/lib/api";
import { Button } from "./ui";
import { vatRateLabel } from "./vat-label";

export const paymentNames: Record<string, string> = {
  cash: "Cash",
  bkash: "bKash",
  nagad: "Nagad",
};
export const defaultPrintProfile: PrintProfile = {
  version: 0,
  shop_name: "",
  address: "",
  phone: "",
  email: "",
  contact_name: "",
  bin: "",
  drug_license: "",
  logo_data_url: "",
  paper_width: 80,
  font_size: 11,
  show_logo: true,
  show_batch: true,
  show_staff: true,
  show_amount_words: true,
  qr_enabled: false,
  qr_value: "",
  invoice_terms: "",
  receipt_terms: "Please keep this receipt for your records.",
  default_staff_name: "",
  default_created_by: "",
  show_barcode: true,
  signature_name: "",
  invoice_accent: "#344151",
};
export function printProfile(receipt: Receipt): PrintProfile {
  return {
    ...defaultPrintProfile,
    ...receipt.receipt_profile,
    shop_name: receipt.receipt_profile?.shop_name || receipt.organization,
    address: receipt.receipt_profile?.address || receipt.address,
  };
}
function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={`document-row ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
function paymentQr(profile: PrintProfile) {
  return profile.qr_enabled && profile.qr_data_url ? (
    <div className="document-qr">
      <img src={profile.qr_data_url} alt="Merchant payment QR code" />
      <strong>SCAN TO PAY</strong>
    </div>
  ) : null;
}
function BillTo({ receipt }: { receipt: Receipt }) {
  return (
    <>
      <h3 className="document-subtitle">Billing to</h3>
      <Row label="Name:" value={receipt.customer_name || "Walk-in customer"} />
      {receipt.customer_phone && (
        <Row label="Contact no.:" value={receipt.customer_phone} />
      )}{" "}
      {receipt.customer_address && (
        <Row label="Address:" value={receipt.customer_address} />
      )}{" "}
      {receipt.customer_bin && (
        <Row label="Buyer BIN:" value={receipt.customer_bin} />
      )}
    </>
  );
}
function BatchDetails({ line }: { line: Receipt["lines"][number] }) {
  return (
    <>
      {(line.allocations?.length
        ? line.allocations
        : [
            {
              batch: line.batch,
              expiry: line.expiry,
              base_quantity: line.quantity,
            },
          ]
      ).map((a, index) => (
        <small key={index}>
          Batch: {a.batch}
          {a.expiry ? ` · Exp: ${date(a.expiry)}` : ""}
        </small>
      ))}
    </>
  );
}
function Totals({ receipt }: { receipt: Receipt }) {
  return (
    <>
      <Row label="Item total:" value={money(receipt.subtotal_minor ?? receipt.total_minor)} />
      <Row label="Subtotal:" value={money(receipt.subtotal_minor ?? receipt.total_minor)} />
      <Row label="Discount:" value={`−${money(receipt.discount_minor ?? 0)}`} />
      <Row label={`${vatRateLabel(receipt.tax_snapshot?.lines)}:`} value={receipt.tax_status === "calculated" ? money(receipt.vat_minor ?? 0) : "Not calculated"} />
      <Row label="Grand total:" value={money(receipt.total_minor)} strong />
      <Row label="Paid amount:" value={money(receipt.total_minor)} />
      {receipt.payment_method === "cash" && (
        <>
          <Row label="Cash received:" value={money(receipt.tendered_minor)} />
          <Row label="Change:" value={money(receipt.change_minor)} />
        </>
      )}
      <Row
        label="Payment method:"
        value={paymentNames[receipt.payment_method] || receipt.payment_method}
      />
      {receipt.payment_reference && (
        <Row label="Transaction ID:" value={receipt.payment_reference} />
      )}
      <Row label="Bill status:" value="PAID" />
    </>
  );
}

function ReceiptBarcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current)
      JsBarcode(ref.current, value, {
        format: "CODE128",
        width: 1.2,
        height: 34,
        margin: 10,
        displayValue: false,
        background: "#ffffff",
        lineColor: "#000000",
      });
  }, [value]);
  return (
    <div className="receipt-barcode">
      <svg ref={ref} role="img" aria-label={`Receipt barcode ${value}`} />
      <span>{value}</span>
    </div>
  );
}

export function ThermalReceipt({ receipt }: { receipt: Receipt }) {
  const profile = printProfile(receipt);
  const longestWord = Math.max(
    1,
    ...profile.shop_name.split(/\s+/).map((word) => word.length),
  );
  const headingSize = Math.max(
    1.1,
    Math.min(
      3.9,
      ((profile.paper_width - 6) * 3.7795) /
        (profile.font_size * longestWord * 0.94),
    ),
  );
  const amount = (minor: number) =>
    (minor / 100).toLocaleString("en-BD", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(receipt.created_at));
  return (
    <article
      className="thermal-document"
      style={{
        width: `${profile.paper_width - 6}mm`,
        fontSize: `${profile.font_size}px`,
      }}
      aria-label="Thermal receipt"
    >
      <header className="retail-header">
        {profile.show_logo && profile.logo_data_url ? (
          <img
            className="retail-logo"
            src={profile.logo_data_url}
            alt={`${profile.shop_name} logo`}
          />
        ) : null}
        <h2 style={{ fontSize: `${headingSize}em` }}>{profile.shop_name}</h2>
        <p>{receipt.branch}</p>
        <p>{profile.address}</p>
        {profile.phone && <p>Tel {profile.phone}</p>}
        {profile.email && <p>{profile.email}</p>}
        {profile.contact_name && <p>Contact: {profile.contact_name}</p>}
        {profile.bin && <p>BIN: {profile.bin}</p>}
        {profile.drug_license && <p>Drug licence: {profile.drug_license}</p>}
      </header>
      <section className="retail-meta">
        <p className="receipt-transaction">
          <span>Trans #:</span> <b>{receipt.receipt_number}</b>
        </p>
        <div className="retail-meta-pair">
          <p>Date: {date(receipt.created_at)}</p>
          <p>Time: {time}</p>
        </div>
        <div className="retail-meta-pair">
          <p>Type: {receipt.customer_type || "Retail"}</p>
          <p>Status: COMPLETED</p>
        </div>
        {profile.show_staff && (
          <>
            <p>Staff name: {receipt.staff_name || receipt.cashier}</p>
            <p>Created by: {receipt.created_by || receipt.cashier}</p>
          </>
        )}
        <p>Customer: {receipt.customer_name || "Walk-in customer"}</p>
        {receipt.customer_phone && <p>Contact: {receipt.customer_phone}</p>}
        {receipt.customer_address && <p>Address: {receipt.customer_address}</p>}
        {receipt.customer_bin && <p>Buyer BIN: {receipt.customer_bin}</p>}
      </section>
      <table className="retail-items">
        <thead>
          <tr>
            <th>ITEM</th>
            <th>QTY.</th>
            <th>PRICE</th>
            <th>AMOUNT BDT</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            <Fragment key={line.id}>
              <tr className="retail-item-values">
                <td>{line.sku || `ITEM ${index + 1}`}</td>
                <td>
                  {line.quantity} {line.unit_name || "UNIT"}
                </td>
                <td>{amount(line.unit_price_minor)}</td>
                <td>{amount(line.total_minor)}</td>
              </tr>
              <tr className="retail-item-description">
                <td colSpan={4}>
                  <span>{line.name}</span>
                  {(line.base_units || 1) > 1 && (
                    <small>
                      1 {line.unit_name} = {line.base_units} individual units
                    </small>
                  )}
                  {profile.show_batch && <BatchDetails line={line} />}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <section className="retail-subtotals">
        <Row label="Subtotal" value={amount(receipt.subtotal_minor ?? receipt.total_minor)} />
        <Row label="Discount" value={`−${amount(receipt.discount_minor ?? 0)}`} />
        <Row label={vatRateLabel(receipt.tax_snapshot?.lines)} value={receipt.tax_status === "calculated" ? amount(receipt.vat_minor ?? 0) : "Not calculated"} />
      </section>
      <section className="retail-total">
        <Row label="Total (BDT)" value={amount(receipt.total_minor)} strong />
      </section>
      <section className="retail-payment">
        <Row
          label="Payment method"
          value={paymentNames[receipt.payment_method] || receipt.payment_method}
        />
        <Row label="Paid amount" value={amount(receipt.total_minor)} />
        <Row
          label={
            receipt.payment_method === "cash"
              ? "Cash received"
              : `${paymentNames[receipt.payment_method]} received`
          }
          value={amount(receipt.tendered_minor)}
        />
        {receipt.payment_reference && (
          <Row label="Transaction ID" value={receipt.payment_reference} />
        )}
        <Row label="Payment status" value="PAID" />
      </section>
      <section className="retail-change">
        <Row label="Change" value={amount(receipt.change_minor)} />
      </section>
      <section className="retail-sale-summary">
        <p>
          SOLD ITEM COUNT ={" "}
          {receipt.lines.reduce((sum, line) => sum + line.quantity, 0)}
        </p>
        <p>
          INDIVIDUAL UNITS ={" "}
          {receipt.lines.reduce(
            (sum, line) => sum + line.quantity * (line.base_units || 1),
            0,
          )}
        </p>
        <div className="retail-tax">
          <p>Sales tax information</p>
          <Row label={vatRateLabel(receipt.tax_snapshot?.lines)} value={receipt.tax_status === "calculated" ? money(receipt.vat_minor ?? 0) : "Not configured"} />
        </div>
        {profile.show_amount_words && receipt.amount_in_words && (
          <p className="retail-words">{receipt.amount_in_words}</p>
        )}
      </section>
      {profile.show_barcode && (
        <ReceiptBarcode value={receipt.receipt_number} />
      )}
      {profile.receipt_terms && (
        <p className="retail-policy">{profile.receipt_terms}</p>
      )}
      {receipt.remarks && <p className="retail-policy">{receipt.remarks}</p>}
      {paymentQr(profile)}
      <footer className="retail-copy">Original Copy</footer>
    </article>
  );
}

export function InvoiceCopy({ receipt }: { receipt: Receipt }) {
  const profile = printProfile(receipt);
  return (
    <article
      className="invoice-document"
      style={{ "--invoice-accent": profile.invoice_accent } as CSSProperties}
      aria-label="A4 invoice copy"
    >
      <header className="invoice-header">
        <div>
          <h1>{profile.shop_name}</h1>
          <p>{profile.address}</p>
          <div className="invoice-contact">
            {profile.phone && (
              <p>
                <b>Phone:</b> {profile.phone}
              </p>
            )}
            {profile.email && (
              <p>
                <b>Email:</b> {profile.email}
              </p>
            )}
            {profile.bin && (
              <p>
                <b>BIN:</b> {profile.bin}
              </p>
            )}
            {profile.drug_license && (
              <p>
                <b>Drug licence:</b> {profile.drug_license}
              </p>
            )}
          </div>
        </div>
        {profile.show_logo && profile.logo_data_url && (
          <img src={profile.logo_data_url} alt={`${profile.shop_name} logo`} />
        )}
      </header>
      <h2 className="invoice-band">Sales Invoice · Customer Copy</h2>
      <div className="invoice-parties">
        <section>
          <Row label="Invoice no." value={receipt.receipt_number} />
          <Row label="Date & time" value={date(receipt.created_at, true)} />
          <Row label="Branch" value={receipt.branch} />
          <Row
            label="Customer type"
            value={receipt.customer_type || "Retail"}
          />
          <Row label="Order status" value="COMPLETED" />
          <Row
            label="Payment"
            value={`${paymentNames[receipt.payment_method]} · PAID`}
          />
          {profile.show_staff && (
            <>
              <Row
                label="Staff name"
                value={receipt.staff_name || receipt.cashier}
              />
              <Row
                label="Created by"
                value={receipt.created_by || receipt.cashier}
              />
            </>
          )}
        </section>
        <section>
          <BillTo receipt={receipt} />
        </section>
      </div>
      <table className="invoice-items">
        <thead>
          <tr>
            <th>#</th>
            <th>Medicine / item</th>
            <th>Price / unit</th>
            <th>Quantity</th>
            <th>Amount (BDT)</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            <tr key={line.id}>
              <td>{index + 1}</td>
              <td>
                <strong>{line.name}</strong>
                {(line.base_units || 1) > 1 && (
                  <small>
                    1 {line.unit_name} = {line.base_units} units
                  </small>
                )}
                {profile.show_batch && <BatchDetails line={line} />}
              </td>
              <td>{money(line.unit_price_minor)}</td>
              <td>
                {line.quantity} {line.unit_name || "UNIT"}
              </td>
              <td>{money(line.total_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="invoice-item-count">
        <strong>Total line items: {receipt.lines.length}</strong>
        <strong>Item total: {money(receipt.total_minor)}</strong>
      </div>
      <div className="invoice-bottom">
        <section className="invoice-notes">
          {paymentQr(profile)}
          {profile.invoice_terms && (
            <>
              <h3 className="invoice-band">Terms & conditions</h3>
              <p>{profile.invoice_terms}</p>
            </>
          )}
          {receipt.remarks && (
            <>
              <h3 className="invoice-band">Remarks</h3>
              <p>{receipt.remarks}</p>
            </>
          )}
          <p className="invoice-tax-note">
            Sales invoice. {receipt.tax_status === "calculated"
              ? "VAT calculated using the configured product rules. This document is not certified as a Mushak 6.3 VAT invoice."
              : "VAT has not been calculated. This document is not a Mushak 6.3 VAT invoice."}
          </p>
        </section>
        <section className="invoice-summary">
          <Totals receipt={receipt} />
          {profile.show_amount_words && receipt.amount_in_words && (
            <p className="invoice-words">
              <strong>Amount in words:</strong>
              <br />
              {receipt.amount_in_words}
            </p>
          )}
          <div className="invoice-signature">
            <strong>For {profile.shop_name}</strong>
            <span>{profile.signature_name || "Authorized signatory"}</span>
          </div>
        </section>
      </div>
      <footer className="invoice-band">Thank you for shopping with us.</footer>
    </article>
  );
}

export function PrintActions({ receipt }: { receipt: Receipt }) {
  const [job, setJob] = useState<"thermal" | "a4" | null>(null),
    [pageRule, setPageRule] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const after = () => setJob(null);
    window.addEventListener("afterprint", after);
    void (async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(ref.current?.querySelectorAll("img") || []).map((image) =>
          image.decode().catch(() => undefined),
        ),
      );
      if (cancelled) return;
      const profile = printProfile(receipt);
      const height =
        Math.ceil(((ref.current?.scrollHeight || 800) * 25.4) / 96) + 8;
      setPageRule(
        job === "a4"
          ? "@page{size:A4;margin:10mm}"
          : `@page{size:${profile.paper_width}mm ${height}mm;margin:3mm}`,
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) window.print();
        }),
      );
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", after);
    };
  }, [job, receipt]);
  return (
    <>
      <Button variant="secondary" onClick={() => setJob("thermal")}>
        <Printer size={16} />
        Print thermal receipt
      </Button>
      <Button onClick={() => setJob("a4")}>
        <FileDown size={16} />
        Print / Save invoice PDF
      </Button>
      {job &&
        createPortal(
          <div className={`print-surface print-${job}`} ref={ref}>
            <style media="print">{pageRule}</style>
            {job === "a4" ? (
              <InvoiceCopy receipt={receipt} />
            ) : (
              <ThermalReceipt receipt={receipt} />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
