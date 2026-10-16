"use client";
import { useEffect, useState, type FormEvent } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { api, ApiError, money, number } from "@/lib/api";
import type { Product, Session } from "@/lib/types";
import { Button, Field, Modal } from "./ui";

type RemovalPreview = {
  name: string;
  sku: string;
  quantity: number;
  cost_minor: number;
  branches: number;
  preview_token: string;
};
export function RemoveMedicine({
  product,
  branch,
  demo,
  onClose,
  onRemoved,
}: {
  product: Product | null;
  branch: string;
  demo: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [preview, setPreview] = useState<RemovalPreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState("");
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError("");
    setKey(crypto.randomUUID());
    if (product)
      api<RemovalPreview>(`catalog/${product.id}/remove/`, {}, branch)
        .then((data) => {
          if (!cancelled) setPreview(data);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [product, branch]);
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !preview) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(
        `catalog/${product.id}/remove/`,
        {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({
            preview_token: preview.preview_token,
            confirmation: form.get("confirmation"),
            reason: form.get("reason"),
          }),
        },
        branch,
      );
      onRemoved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!product}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Remove medicine"
      description="Review the effect across your workspace before confirming."
    >
      {preview ? (
        <form onSubmit={remove}>
          <p>
            <strong>{preview.name}</strong> · {preview.sku}
          </p>
          <div className="maintenance-impact">
            <div>
              <span>Stock removed</span>
              <strong>{number(preview.quantity)} base units</strong>
            </div>
            <div>
              <span>Branches with stock</span>
              <strong>{preview.branches}</strong>
            </div>
            <div>
              <span>Recorded stock cost</span>
              <strong>{money(preview.cost_minor)}</strong>
            </div>
          </div>
          <p>
            The medicine will disappear from Inventory, Medicine catalog and POS
            in every branch. Remaining stock is recorded as a removal. Existing
            sales, receipts and ledger evidence are retained.
          </p>
          {demo ? (
            <p className="notice">
              Removal is available in your own workspace. The shared demo is
              preserved for other visitors.
            </p>
          ) : (
            <>
              <Field label={`Type ${preview.sku} to confirm`}>
                <input
                  name="confirmation"
                  required
                  autoComplete="off"
                  maxLength={80}
                />
              </Field>
              <Field label="Reason for removal">
                <input
                  name="reason"
                  required
                  minLength={5}
                  maxLength={250}
                  placeholder="Why this medicine is being removed"
                />
              </Field>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="danger" busy={busy} disabled={demo}>
              <Trash2 size={16} />
              Remove medicine
            </Button>
          </div>
        </form>
      ) : (
        <p role={error ? "alert" : undefined}>
          {error || "Loading affected stock…"}
        </p>
      )}
    </Modal>
  );
}

type ResetPreview = {
  name: string;
  source_tenant_id: string;
  branch_id: string;
  counts: Record<string, number>;
  preview_token: string;
};
type PendingReset = {
  key: string;
  preview: ResetPreview;
  confirmation: string;
};
export function ResetWorkspace({
  session,
  branch,
  onReset,
}: {
  session: Session;
  branch: string;
  onReset: (session: Session) => void;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState<ResetPreview | null>(null),
    [pending, setPending] = useState<PendingReset | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const storageKey = `pharmacore:reset:${session.user?.id}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved) {
        setPending(saved);
        setPreview(saved.preview);
        setOpen(true);
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }, [storageKey]);
  async function review() {
    setOpen(true);
    setError("");
    if (pending) return;
    setPreview(null);
    try {
      setPreview(await api<ResetPreview>("settings/reset/", {}, branch));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    const form = new FormData(event.currentTarget);
    const operation = pending || {
      key: crypto.randomUUID(),
      preview,
      confirmation: String(form.get("confirmation")),
    };
    setBusy(true);
    setError("");
    setPending(operation);
    sessionStorage.setItem(storageKey, JSON.stringify(operation));
    try {
      const result = await api<Session>("settings/reset/", {
        method: "POST",
        headers: { "Idempotency-Key": operation.key },
        body: JSON.stringify({
          source_tenant_id: operation.preview.source_tenant_id,
          branch_id: operation.preview.branch_id,
          preview_token: operation.preview.preview_token,
          confirmation: operation.confirmation,
          password: form.get("password"),
        }),
      });
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setOpen(false);
      setPreview(null);
      onReset(result);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="icon-button reset-workspace-button"
        aria-label="Reset workspace"
        title="Reset entire workspace"
        onClick={() => void review()}
      >
        <RotateCcw size={16} />
      </button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
        title="Reset entire workspace"
        description="Start from scratch across all workspace and management sections."
      >
        {preview ? (
          <form onSubmit={reset}>
            {pending && (
              <p className="notice">
                A reset request is awaiting confirmation. Re-enter your password
                to check the same request safely.
              </p>
            )}
            <p>
              <strong>{preview.name}</strong>
            </p>
            <div className="maintenance-impact">
              {Object.entries(preview.counts).map(([label, count]) => (
                <div key={label}>
                  <span>{label.replaceAll("_", " ")}</span>
                  <strong>{number(count)}</strong>
                </div>
              ))}
            </div>
            <p>
              This archives the entire current workspace, including all
              branches, and opens an empty replacement with the same name and
              the selected branch’s details. Catalog, inventory, customers,
              sales and printing settings start fresh. Only your owner access is
              carried over.
            </p>
            <p>
              Your account, password and authenticator stay active. Previous
              records remain in the archived workspace for administrator
              recovery; this does not permanently erase them. Other staff lose
              access to the archived workspace.
            </p>
            {session.demo ? (
              <p className="notice">
                Create your own workspace to use reset. The shared demo cannot
                be reset.
              </p>
            ) : (
              <>
                <Field label="Type workspace name to confirm">
                  <input
                    name="confirmation"
                    required
                    autoComplete="off"
                    maxLength={150}
                    defaultValue={pending?.confirmation}
                    readOnly={!!pending}
                  />
                </Field>
                <Field label="Current password">
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={128}
                  />
                </Field>
              </>
            )}
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
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="danger" disabled={session.demo} busy={busy}>
                {pending ? "Confirm reset status" : "Reset to empty workspace"}
              </Button>
            </div>
          </form>
        ) : (
          <p role={error ? "alert" : undefined}>
            {error || "Loading workspace summary…"}
          </p>
        )}
      </Modal>
    </>
  );
}
