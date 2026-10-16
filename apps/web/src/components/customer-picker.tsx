"use client";

import { ChevronRight, Search, UserPlus, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Customer } from "@/lib/types";
import { Button, Field, Modal, Pagination } from "./ui";

type Draft = Omit<Customer, "id">;
type PendingCustomer = { key: string; body: Draft };
const emptyDraft: Draft = { name: "", phone: "", address: "", bin: "" };
const pageSize = 20;

export function CustomerPicker({
  branch,
  onSelect,
  onClose,
}: {
  branch: string;
  onSelect: (customer: Customer | null) => void;
  onClose: () => void;
}) {
  const storageKey = `pharmacore:customer:${branch}`;
  const [pending, setPending] = useState<PendingCustomer | null>(() => {
    const saved = sessionStorage.getItem(storageKey);
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState<"existing" | "new">(
    pending ? "new" : "existing",
  );
  const [draft, setDraft] = useState<Draft>(pending?.body || emptyDraft);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (mode !== "existing") return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const response = await api<{ count: number; results: Customer[] }>(
          `customers/?search=${encodeURIComponent(search)}&limit=${pageSize}&offset=${page * pageSize}`,
          { signal: controller.signal },
          branch,
        );
        if (active) {
          setResults(response.results);
          setTotal(response.count);
        }
      } catch (error) {
        if (active) setError((error as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [branch, mode, search, page, retry]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    const operation = pending || { key: crypto.randomUUID(), body: draft };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
      setPending(operation);
      const customer = await api<Customer>(
        "customers/",
        {
          method: "POST",
          headers: { "Idempotency-Key": operation.key },
          body: JSON.stringify(operation.body),
        },
        branch,
      );
      sessionStorage.removeItem(storageKey);
      onSelect(customer);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        setError(error.message);
      } else {
        setError(
          `${(error as Error).message} Confirm this customer to safely retry.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Choose customer"
      description="Find a saved customer in this branch, add someone new, or use walk-in checkout."
    >
      <button
        className="customer-walk-in"
        disabled={busy || !!pending}
        onClick={() => onSelect(null)}
      >
        <span className="customer-icon">
          <UserRound size={20} />
        </span>
        <span>
          <strong>Continue as walk-in</strong>
          <small>No customer details needed</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <div className="customer-picker-tabs" aria-label="Customer options">
        <button
          type="button"
          aria-pressed={mode === "existing"}
          disabled={busy || !!pending}
          onClick={() => {
            setMode("existing");
            setError("");
          }}
        >
          Existing customer
        </button>
        <button
          type="button"
          aria-pressed={mode === "new"}
          disabled={busy || !!pending}
          onClick={() => {
            setMode("new");
            setError("");
          }}
        >
          <UserPlus size={16} /> New customer
        </button>
      </div>
      {mode === "existing" ? (
        <>
          <label className="search-box customer-search">
            <Search size={18} />
            <input
              aria-label="Search customers by name or phone"
              placeholder="Search by name or phone number…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
                setLoading(true);
              }}
            />
          </label>
          <div className="customer-results" aria-busy={loading}>
            {loading ? (
              <p className="customer-picker-status" role="status">
                Finding customers…
              </p>
            ) : error ? (
              <div className="customer-picker-status">
                <p role="alert">{error}</p>
                <Button
                  variant="secondary"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Try again
                </Button>
              </div>
            ) : results.length ? (
              results.map((customer) => (
                <button
                  className="customer-result"
                  key={customer.id}
                  onClick={() => onSelect(customer)}
                >
                  <span className="customer-avatar">
                    {customer.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{customer.name}</strong>
                    <small>
                      {customer.phone || "No phone number"}
                      {customer.address ? ` · ${customer.address}` : ""}
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))
            ) : (
              <div className="customer-picker-status">
                <UserRound size={28} />
                <strong>
                  {search ? "No matching customers" : "No saved customers yet"}
                </strong>
                <p>Add a customer to find them easily on their next visit.</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMode("new");
                    setError("");
                  }}
                >
                  Add new customer
                </Button>
              </div>
            )}
          </div>
          {!loading && !error && total > pageSize && (
            <Pagination
              page={page}
              size={pageSize}
              total={total}
              onChange={(value) => {
                setPage(value);
                setLoading(true);
              }}
            />
          )}
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {pending && (
            <p className="notice amber">
              A customer save is awaiting confirmation. Retry below to confirm
              it without creating a duplicate.
            </p>
          )}
          <Field label="Customer name">
            <input
              required
              maxLength={100}
              autoComplete="off"
              value={draft.name}
              disabled={busy || !!pending}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </Field>
          <Field
            label="Phone number"
            hint="Optional. Use this to find a returning customer."
          >
            <input
              type="tel"
              maxLength={25}
              value={draft.phone}
              disabled={busy || !!pending}
              placeholder="01XXXXXXXXX"
              onChange={(event) =>
                setDraft({ ...draft, phone: event.target.value })
              }
            />
          </Field>
          <Field label="Address (optional)">
            <input
              maxLength={250}
              value={draft.address}
              disabled={busy || !!pending}
              onChange={(event) =>
                setDraft({ ...draft, address: event.target.value })
              }
            />
          </Field>
          <Field
            label="Customer BIN (optional)"
            hint="For business customers, if applicable."
          >
            <input
              inputMode="numeric"
              maxLength={13}
              pattern="[0-9]{13}"
              value={draft.bin}
              disabled={busy || !!pending}
              onChange={(event) =>
                setDraft({ ...draft, bin: event.target.value })
              }
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              {pending ? "Confirm customer" : "Save & select customer"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
