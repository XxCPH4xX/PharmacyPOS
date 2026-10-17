"use client";

import { Banknote, Delete, Smartphone } from "lucide-react";
import { useEffect, useRef } from "react";
import { money, toMinor } from "@/lib/api";
import { Button, Field, Modal } from "./ui";
import { paymentNames } from "./print-documents";
import { vatRateLabel, type VatRateLine } from "./vat-label";

export function CheckoutDialog({
  open,
  onClose,
  lines,
  total,
  subtotal,
  discount,
  vat,
  vatRates,
  customer,
  method,
  onMethod,
  tender,
  onTender,
  reference,
  onReference,
  confirmed,
  onConfirmed,
  pending,
  busy,
  error,
  onPay,
}: {
  open: boolean;
  onClose: () => void;
  lines: {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    total: number;
  }[];
  total: number;
  subtotal: number;
  discount: number;
  vat: number;
  vatRates?: readonly VatRateLine[];
  customer: string;
  method: string;
  onMethod: (value: string) => void;
  tender: string;
  onTender: (value: string) => void;
  reference: string;
  onReference: (value: string) => void;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
  pending: boolean;
  busy: boolean;
  error: string;
  onPay: () => void;
}) {
  const cashInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    if (!open || method !== "cash" || busy || pending) return;

    const focusInput = () => {
      cashInputRef.current?.focus();
      cashInputRef.current?.select();
    };

    const frame = requestAnimationFrame(focusInput);

    return () => cancelAnimationFrame(frame);
  }, [open, method, busy, pending]);

  useEffect(() => {
    if (!open || method !== "cash") return;

    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable)
      ) {
        return;
      }

      if (busy || pending) return;

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        key(event.key);
        cashInputRef.current?.focus();
      } else if (event.key === ".") {
        event.preventDefault();
        key(".");
        cashInputRef.current?.focus();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        key("delete");
        cashInputRef.current?.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();

        if (!event.repeat && lines.length && validCash) {
          onPay();
        }
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  let received = 0,
    validCash = false;
  try {
    received = toMinor(tender);
    validCash = received >= total;
  } catch { }
  const locked = busy || pending;
  const shortcuts = [
    ...new Set(
      [5000, 10000, 50000, 100000].map(
        (step) => Math.ceil((total + 1) / step) * step,
      ),
    ),
  ].slice(0, 2);
  const valid =
    method === "cash"
      ? validCash
      : confirmed && /^[A-Za-z0-9_-]{4,80}$/.test(reference);
  function key(value: string) {
    if (locked) return;
    if (value === "delete") {
      onTender(tender.slice(0, -1));
      return;
    }
    const next =
      value === "."
        ? tender.includes(".")
          ? tender
          : `${tender || "0"}.`
        : tender === "0"
          ? value
          : tender + value;
    if (/^\d{0,10}(\.\d{0,2})?$/.test(next)) onTender(next);
  }
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
      title="Complete payment"
      description="Review the sale and choose how the customer is paying."
      className="checkout-dialog"
    >
      <div className="payment-layout">
        <section className="payment-summary" aria-label="Order summary">
          <h3>Order summary</h3>
          <p className="payment-customer">{customer}</p>
          <div className="payment-items">
            {lines.map((line) => (
              <div key={line.id}>
                <span>
                  <b>
                    {line.quantity}
                    {line.unit !== "UNIT" ? ` ${line.unit}` : ""} ×
                  </b>{" "}
                  {line.name}
                </span>
                <strong>{money(line.total)}</strong>
              </div>
            ))}
          </div>
          <div className="payment-summary-totals">
            <div>
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div>
              <span>Discount</span>
              <span>−{money(discount)}</span>
            </div>
            <div>
              <span>{vatRateLabel(vatRates)}</span>
              <span>{money(vat)}</span>
            </div>
          </div>
          <div className="payment-total">
            <strong>Total due</strong>
            <strong>{money(total)}</strong>
          </div>
          {pending && (
            <p className="notice amber">
              This sale is awaiting confirmation. Retry the same payment to
              avoid posting it twice.
            </p>
          )}
        </section>
        <section className="payment-controls" aria-label="Payment details">
          <div className="payment-methods" aria-label="Payment method">
            {["cash", "bkash", "nagad"].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={method === value}
                disabled={locked}
                onClick={() => onMethod(value)}
              >
                {value === "cash" ? (
                  <Banknote size={22} />
                ) : (
                  <Smartphone size={22} />
                )}
                <span>{paymentNames[value]}</span>
              </button>
            ))}
          </div>
          {method === "cash" ? (
            <>



              <Field label="Cash received (৳)">
                <input
                  ref={cashInputRef}
                  className="cash-received-input"
                  aria-label="Cash received"
                  type="text"
                  inputMode="decimal"
                  value={tender}
                  onChange={(event) => {
                    const value = event.target.value;

                    if (/^\d{0,10}(\.\d{0,2})?$/.test(value)) {
                      onTender(value);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;

                    event.preventDefault();

                    if (!event.repeat && !locked && lines.length && validCash) {
                      onPay();
                    }
                  }}
                  disabled={locked}
                  placeholder="0.00"
                  autoComplete="off"
                />
              </Field>

              <div className="cash-shortcuts">
                <button
                  disabled={locked}
                  onClick={() => onTender((total / 100).toFixed(2))}
                >
                  Exact amount
                </button>
                {shortcuts.map((amount) => (
                  <button
                    disabled={locked}
                    key={amount}
                    onClick={() => onTender((amount / 100).toFixed(2))}
                  >
                    {money(amount, true)}
                  </button>
                ))}
                <button
                  className="clear-cash"
                  disabled={locked || !tender}
                  onClick={() => onTender("")}
                >
                  Clear
                </button>
              </div>
              <div className="cash-keypad" aria-label="Cash amount keypad">
                {[
                  "1",
                  "2",
                  "3",
                  "4",
                  "5",
                  "6",
                  "7",
                  "8",
                  "9",
                  ".",
                  "0",
                  "delete",
                ].map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={locked}
                    aria-label={
                      value === "delete"
                        ? "Delete last digit"
                        : value === "."
                          ? "Decimal point"
                          : `Digit ${value}`
                    }
                    onClick={() => key(value)}
                  >
                    {value === "delete" ? <Delete size={22} /> : value}
                  </button>
                ))}
              </div>
              <div
                className={`change-line${received < total ? " still-due" : ""}`}
                aria-live="polite"
                aria-atomic="true"
              >
                <span>
                  {received < total ? "Still due" : "Change to return"}
                </span>
                <strong>{money(Math.abs(received - total))}</strong>
              </div>
            </>
          ) : (
            <div className="mobile-payment-fields">
              <Field
                label={`${paymentNames[method]} transaction ID`}
                hint="Enter the reference for a payment already received in your merchant account."
              >
                <input
                  value={reference}
                  maxLength={80}
                  disabled={locked}
                  onChange={(event) => onReference(event.target.value.trim())}
                />
              </Field>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={locked}
                  onChange={(event) => onConfirmed(event.target.checked)}
                />
                <span>
                  I verified {money(total)} in the {paymentNames[method]}{" "}
                  merchant account
                </span>
              </label>
              <p className="payment-note">
                This records the payment. It does not charge the customer or
                verify it with the provider.
              </p>
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <Button
            className="full-width payment-confirm"
            busy={busy}
            disabled={!lines.length || (!pending && !valid)}
            onClick={onPay}
          >
            {pending
              ? "Confirm pending sale"
              : `Confirm payment · ${money(total)}`}
          </Button>
          <p className="payment-note">
            {method === "cash"
              ? "Enter the cash received or choose Exact amount to confirm."
              : "Verify the transaction before confirming this sale."}
          </p>
        </section>
      </div>
    </Modal>
  );
}
