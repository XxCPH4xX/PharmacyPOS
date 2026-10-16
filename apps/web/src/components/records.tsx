"use client";

import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpRight,
  Banknote,
  Check,
  ClipboardList,
  FileText,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { api, date, money, number } from "@/lib/api";
import type {
  Audit,
  DashboardData,
  Movement,
  Receipt,
  SaleSummary,
  Session,
} from "@/lib/types";
import { Badge, Button, Empty, Field, Modal, Pagination } from "./ui";
import { ReceiptDialog } from "./pos";
import { paymentNames } from "./print-documents";
import { Distribution, RevenueChart } from "./dashboard";

export function Sales({
  sales,
  branch,
  canReport,
  onExport,
}: {
  sales: SaleSummary[];
  branch: string;
  canReport: boolean;
  onExport: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const params = useSearchParams();
  async function view(id: string) {
    try {
      setReceipt(await api<Receipt>(`sales/${id}/`, {}, branch));
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    const id = params.get("receipt");
    if (id) void view(id);
  }, [params, branch]);
  const filtered = sales.filter((s) =>
    `${s.receipt_number} ${s.cashier}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Sales & receipts</h2>
            <p>Your completed sales and the payment method used.</p>
          </div>
          {canReport && (
            <Button variant="secondary" onClick={onExport}>
              <ArrowDownToLine size={16} />
              Export CSV
            </Button>
          )}
        </div>
        <div className="table-toolbar">
          <label className="search-box">
            <Search size={17} />
            <input
              placeholder="Search receipt or cashier…"
              aria-label="Search sales"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <Badge tone="teal">{sales.length} completed sales</Badge>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date & time</th>
                <th>Cashier</th>
                <th>Payment</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(page * 10, page * 10 + 10).map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <button
                      className="receipt-link"
                      onClick={() => view(sale.id)}
                    >
                      {sale.receipt_number}
                    </button>
                  </td>
                  <td>{date(sale.created_at, true)}</td>
                  <td>{sale.cashier}</td>
                  <td>
                    <span className="inline-icon">
                      <Banknote size={14} />
                      {paymentNames[sale.payment_method] || sale.payment_method}
                    </span>
                  </td>
                  <td>
                    <Badge>
                      <Check size={11} />
                      Completed
                    </Badge>
                  </td>
                  <td className="text-right amount">
                    {money(sale.total_minor)}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      onClick={() => view(sale.id)}
                      aria-label={`View receipt ${sale.receipt_number}`}
                    >
                      <ReceiptText size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <Empty
            title="No transactions to show"
            description="Your completed sales will be recorded here."
          />
        )}
        <Pagination
          page={page}
          size={10}
          total={filtered.length}
          onChange={setPage}
        />
      </section>
      <div className="page-note">
        <ShieldCheck size={16} />
        Posted sales are preserved. Reversal and refund workflows are planned
        for a later release.
      </div>
      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

export function Ledger({ movements }: { movements: Movement[] }) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const filtered = movements.filter((m) =>
    `${m.name} ${m.batch} ${m.reference}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Stock movement ledger</h2>
          <p>Every unit has a history. Every movement has a source.</p>
        </div>
        <Badge>
          <ShieldCheck size={13} />
          Append-only
        </Badge>
      </div>
      <div className="table-toolbar">
        <label className="search-box">
          <Search size={17} />
          <input
            aria-label="Search ledger"
            placeholder="Search medicine, batch or reference…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Movement</th>
              <th>Medicine</th>
              <th>Batch</th>
              <th>Reference</th>
              <th>Date & time</th>
              <th className="text-right">Units</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(page * 12, page * 12 + 12).map((m) => (
              <tr key={m.id}>
                <td>
                  <Badge tone={m.kind === "receipt" ? "teal" : "blue"}>
                    {m.kind === "receipt" ? (
                      <ArrowDownLeft size={13} />
                    ) : (
                      <ArrowUpRight size={13} />
                    )}
                    {m.kind === "receipt"
                      ? "Received"
                      : m.kind === "removal"
                        ? "Removed"
                        : "Sold"}
                  </Badge>
                </td>
                <td className="amount">{m.name}</td>
                <td className="mono">{m.batch}</td>
                <td className="mono">{m.reference}</td>
                <td>{date(m.created_at, true)}</td>
                <td
                  className={`text-right amount ${m.quantity > 0 ? "positive" : ""}`}
                >
                  {m.quantity > 0 ? "+" : ""}
                  {number(m.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <Empty
          title="No movements yet"
          description="Receive stock to create your first ledger entry."
        />
      )}
      <Pagination
        page={page}
        size={12}
        total={filtered.length}
        onChange={setPage}
      />
    </section>
  );
}

export function Reports({
  data,
  onExport,
}: {
  data: DashboardData;
  onExport: () => void;
}) {
  return (
    <>
      <div className="report-intro">
        <div className="report-intro-icon">
          <FileText size={26} />
        </div>
        <div>
          <h2>Know your numbers.</h2>
          <p>
            Revenue, batch costs, and stock availability from your recorded
            operations.
          </p>
        </div>
        <Button onClick={onExport}>
          <ArrowDownToLine size={16} />
          Export sales report
        </Button>
      </div>
      <div className="analytics-grid">
        <RevenueChart data={data} />
        <Distribution data={data} />
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Monthly performance</h2>
            <p>Gross profit is revenue less the cost of dispensed stock.</p>
          </div>
          <Badge tone="muted">BDT · Asia/Dhaka</Badge>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Cost of goods</th>
                <th className="text-right">Gross profit</th>
                <th className="text-right">Gross margin</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((row) => (
                <tr key={row.label}>
                  <td className="amount">{row.label}</td>
                  <td className="text-right">{money(row.revenue_minor)}</td>
                  <td className="text-right">{money(row.cost_minor)}</td>
                  <td className="text-right amount positive">
                    {money(row.revenue_minor - row.cost_minor)}
                  </td>
                  <td className="text-right">
                    {row.revenue_minor
                      ? `${(((row.revenue_minor - row.cost_minor) / row.revenue_minor) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="page-note">
        <FileText size={16} />
        Operating expenses, taxes, refunds, and full accounting are not included
        in this release.
      </div>
    </>
  );
}

export function ActivityLog({ events }: { events: Audit[] }) {
  const [page, setPage] = useState(0);
  const labels: Record<string, string> = {
    "catalog.created": "Medicine added to catalog",
    "inventory.received": "Stock received",
    "sale.completed": "Cash sale completed",
    "branch.created": "Branch created",
    "report.sales_exported": "Sales report exported",
    "tenant.registered": "Organization registered",
  };
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Activity & audit trail</h2>
          <p>A traceable record of changes in this branch.</p>
        </div>
        <Badge>
          <ShieldCheck size={13} />
          Append-only
        </Badge>
      </div>
      <div className="activity-list">
        {events.slice(page * 12, page * 12 + 12).map((event) => (
          <div className="activity-row" key={event.id}>
            <span className="activity-icon">
              <ClipboardList size={18} />
            </span>
            <div>
              <strong>{labels[event.action] || event.action}</strong>
              <p>
                {event.actor} <span>·</span>{" "}
                {event.detail.receipt
                  ? String(event.detail.receipt)
                  : event.detail.sku
                    ? String(event.detail.sku)
                    : event.detail.quantity
                      ? `${event.detail.quantity} units`
                      : event.entity_id.slice(0, 8)}
              </p>
            </div>
            <time>{date(event.created_at, true)}</time>
          </div>
        ))}
      </div>
      {!events.length && (
        <Empty
          title="A clean slate"
          description="Branch activity will appear as you work."
        />
      )}
      <Pagination
        page={page}
        size={12}
        total={events.length}
        onChange={setPage}
      />
    </section>
  );
}

export function Settings({
  session,
  branch,
  role,
  onSession,
  notify,
}: {
  session: Session;
  branch: string;
  role: string;
  onSession: (session: Session) => void;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    address?: string;
    version: number;
  } | null>(null);
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      onSession(
        await api<Session>(
          editing.id ? `branches/${editing.id}/` : "settings/workspace/",
          {
            method: "PATCH",
            body: JSON.stringify({
              name: form.get("name"),
              version: editing.version,
              ...(editing.id ? { address: form.get("address") } : {}),
            }),
          },
          branch,
        ),
      );
      setEditing(null);
      notify("Workspace details saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSession(
        await api<Session>(
          "branches/",
          {
            method: "POST",
            body: JSON.stringify(
              Object.fromEntries(new FormData(event.currentTarget)),
            ),
          },
          branch,
        ),
      );
      setOpen(false);
      notify("Branch created. Select it from the branch menu to get started.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Organization</h2>
            <p>Your pharmacy’s workspace details.</p>
          </div>
          {role === "owner" ? (
            <Button
              variant="secondary"
              onClick={() => {
                setError("");
                setEditing({
                  name: session.tenant!.name,
                  version: session.tenant!.version,
                });
              }}
            >
              Edit workspace
            </Button>
          ) : (
            <Badge>
              {session.demo ? "Demo workspace" : "Connected workspace"}
            </Badge>
          )}
        </div>
        <div className="detail-grid">
          {[
            ["Organization", session.tenant?.name],
            ["Signed in as", session.user?.name],
            ["Email", session.user?.email],
            ["Role", role],
            ["Currency", "Bangladeshi Taka (BDT)"],
            ["Timezone", "Asia/Dhaka"],
          ].map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Branches</h2>
            <p>Each branch keeps its own inventory and transaction history.</p>
          </div>
          {role === "owner" && (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} />
              Add branch
            </Button>
          )}
        </div>
        <div className="branches-list">
          {session.branches?.map((b) => (
            <div key={b.id}>
              <span className="summary-icon teal">
                <Banknote size={22} />
              </span>
              <div>
                <strong>{b.name}</strong>
                <p>{b.address || "No address added"}</p>
              </div>
              {role === "owner" && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setError("");
                    setEditing(b);
                  }}
                  aria-label={`Edit ${b.name}`}
                >
                  Edit
                </Button>
              )}
              <Badge tone={branch === b.id ? "teal" : "muted"}>
                {branch === b.id ? "Current branch" : "Active"}
              </Badge>
            </div>
          ))}
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Release capabilities</h2>
            <p>
              Catalog, receiving, BOX / STRIP sales, cash and recorded mobile
              payments, thermal receipts, A4 invoices, MFA, and staff
              invitations.
            </p>
          </div>
          <span className="version">v0.1.0</span>
        </div>
        <div className="release-note">
          <ShieldCheck size={21} />
          <p>
            bKash and Nagad payments must be verified in your merchant account
            before recording them here. Automatic gateway verification,
            prescription dispensing, refunds, tax calculation, and offline
            operations are not yet available.
          </p>
        </div>
      </section>
      <Modal
        open={!!editing}
        onOpenChange={(value) => {
          if (!value) setEditing(null);
        }}
        title={editing?.id ? "Edit branch" : "Edit workspace"}
        description="Update your workspace details. Posted receipts retain their original information."
      >
        {editing && (
          <form key={editing.id || "workspace"} onSubmit={saveSettings}>
            <Field label={editing.id ? "Branch name" : "Workspace name"}>
              <input
                name="name"
                required
                maxLength={editing.id ? 120 : 150}
                defaultValue={editing.name}
              />
            </Field>
            {editing.id && (
              <Field label="Address">
                <input
                  name="address"
                  maxLength={250}
                  defaultValue={editing.address}
                />
              </Field>
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
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button busy={busy}>Save changes</Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Add a branch"
        description="Create a separate inventory and sales workspace."
      >
        <form onSubmit={create}>
          <Field label="Branch name">
            <input
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Gulshan Branch"
            />
          </Field>
          <Field label="Address">
            <input
              name="address"
              maxLength={250}
              placeholder="Street, area, city"
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button busy={busy}>Create branch</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
