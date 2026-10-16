"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Boxes,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Moon,
  Package,
  Pill,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  Sun,
  X,
} from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ResetWorkspace } from "./maintenance";
import { api, date, downloadCsv, listAll } from "@/lib/api";
import type {
  Audit,
  Batch,
  DashboardData,
  Movement,
  Product,
  Role,
  SaleSummary,
  Section,
  Session,
  WorkspaceData,
} from "@/lib/types";
import { Auth } from "./auth";
import { Dashboard } from "./dashboard";
import { AddMedicine, Inventory, ReceiveStock } from "./inventory";
import { POS } from "./pos";
import { ActivityLog, Ledger, Reports, Sales, Settings } from "./records";
import { Brand, Button, Empty, Modal, Skeleton } from "./ui";
import { MFAGate, Team } from "./security";
import { BranchPicker } from "./branch-picker";
import { PrintingSettings } from "./printing-settings";

const nav = [
  {
    section: "printing",
    label: "Receipt & invoice",
    icon: ClipboardList,
    group: "MANAGEMENT",
    owner: true,
  },
  {
    section: "team",
    label: "Team & access",
    icon: Store,
    group: "MANAGEMENT",
    owner: true,
  },
  {
    section: "security",
    label: "Account security",
    icon: ShieldCheck,
    group: "MANAGEMENT",
  },
  {
    section: "dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    group: "WORKSPACE",
    report: true,
  },
  { section: "inventory", label: "Inventory", icon: Boxes, group: "WORKSPACE" },
  {
    section: "catalog",
    label: "Medicine catalog",
    icon: Pill,
    group: "WORKSPACE",
  },
  {
    section: "pos",
    label: "Point of sale",
    icon: ShoppingCart,
    group: "WORKSPACE",
    sell: true,
  },
  {
    section: "sales",
    label: "Sales & receipts",
    salesRead: true,
    icon: ClipboardList,
    group: "WORKSPACE",
  },
  {
    section: "reports",
    label: "Reports & analytics",
    icon: ChartNoAxesCombined,
    group: "WORKSPACE",
    report: true,
  },
  {
    section: "ledger",
    label: "Stock ledger",
    icon: BookOpen,
    group: "MANAGEMENT",
    report: true,
  },
  {
    section: "activity",
    label: "Activity log",
    icon: Activity,
    group: "MANAGEMENT",
    report: true,
  },
  {
    section: "settings",
    label: "Settings",
    icon: Settings2,
    group: "MANAGEMENT",
  },
] as const;
const titles: Record<Section, [string, string]> = {
  printing: [
    "Receipt & invoice settings",
    "Your shop details, thermal receipt, and printable invoice copy.",
  ],
  team: ["Team & access", "Invite staff and manage branch access."],
  security: ["Account security", "Protect access to your pharmacy."],
  dashboard: ["Dashboard", "A clear view of your pharmacy, all in one place."],
  inventory: [
    "Inventory management",
    "Good care starts with well-managed stock.",
  ],
  catalog: [
    "Medicine catalog",
    "One organized home for your pharmacy’s medicines.",
  ],
  pos: ["Point of sale", "Ready for the next customer."],
  sales: [
    "Sales & receipts",
    "Your daily transactions, down to the last detail.",
  ],
  reports: [
    "Reports & analytics",
    "Turn your everyday operations into useful insight.",
  ],
  ledger: ["Stock ledger", "A reliable history of every stock movement."],
  activity: ["Activity log", "Keep track of what changed, when, and by whom."],
  settings: [
    "Workspace settings",
    "The details that make this workspace yours.",
  ],
};

export function Workspace() {
  return (
    <Suspense fallback={<Skeleton />}>
      <WorkspaceInner />
    </Suspense>
  );
}

function WorkspaceInner() {
  const pathname = usePathname();
  const router = useRouter();
  const section = (pathname.split("/")[1] || "dashboard") as Section;
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [branch, setBranch] = useState("");
  const [dataBranch, setDataBranch] = useState("");
  const [dataSection, setDataSection] = useState("");
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [events, setEvents] = useState<Audit[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [dark, setDark] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState("");
  const rank: Record<Role, number> = {
    owner: 0,
    manager: 1,
    pharmacist: 2,
    inventory: 3,
    accountant: 4,
    cashier: 5,
    auditor: 6,
  };
  const roles =
    session?.memberships
      ?.filter((m) => !m.branch_id || m.branch_id === branch)
      .map((m) => m.role) || [];
  const role = ([...roles].sort((a, b) => rank[a] - rank[b])[0] ||
    "auditor") as Role;
  const canReport = roles.some((r) =>
      ["owner", "manager", "auditor", "accountant"].includes(r),
    ),
    canManage = roles.some((r) =>
      ["owner", "manager", "inventory"].includes(r),
    ),
    canSell = roles.some((r) => ["owner", "manager", "cashier"].includes(r)),
    canReadSales = canReport || canSell;
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  const acceptSession = useCallback((value: Session) => {
    setSession(value);
    setBranch((current) =>
      value.branches?.some((b) => b.id === current)
        ? current
        : value.branches?.[0]?.id || "",
    );
  }, []);
  const bootstrap = useCallback(async () => {
    setBootstrapError("");
    try {
      acceptSession(await api<Session>("auth/session/"));
    } catch (error) {
      setBootstrapError((error as Error).message);
    }
  }, [acceptSession]);
  useEffect(() => {
    void bootstrap();
    const saved = localStorage.getItem("pharmacore:theme") === "dark";
    setDark(saved);
    document.documentElement.dataset.theme = saved ? "dark" : "light";
  }, [bootstrap]);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!session?.authenticated || session.mfa?.required || !branch) return;
    let cancelled = false;
    setBusy(true);
    setLoadError("");
    async function load() {
      try {
        const [products, batches, sales, dashboard, ledger, audit] =
          await Promise.all([
            listAll<Product>("catalog/", branch),
            ["inventory", "catalog"].includes(section)
              ? listAll<Batch>("inventory/batches/", branch)
              : [],
            canReadSales && ["sales", "dashboard"].includes(section)
              ? listAll<SaleSummary>("sales/", branch)
              : [],
            canReport && ["dashboard", "reports"].includes(section)
              ? api<DashboardData>("dashboard/", {}, branch)
              : null,
            canReport && section === "ledger"
              ? listAll<Movement>("inventory/ledger/", branch)
              : [],
            canReport && section === "activity"
              ? listAll<Audit>("audit/", branch)
              : [],
          ]);
        if (!cancelled) {
          setData({ products, batches, sales, dashboard });
          setMovements(ledger);
          setEvents(audit);
          setDataBranch(branch);
          setDataSection(section);
        }
      } catch (error) {
        if (!cancelled) setLoadError((error as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    session?.authenticated,
    session?.mfa?.required,
    branch,
    canReport,
    canReadSales,
    revision,
    section,
  ]);
  useEffect(() => {
    if (session?.authenticated && !canReport && section === "dashboard")
      router.replace(canSell ? "/pos" : "/catalog");
  }, [session, canReport, canSell, section, router]);
  const searchResults = useMemo(
    () =>
      data?.products
        .filter((p) =>
          `${p.name} ${p.generic} ${p.strength} ${p.form} ${p.barcode}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .slice(0, 8) || [],
    [data, search],
  );
  function theme() {
    const value = !dark;
    setDark(value);
    document.documentElement.dataset.theme = value ? "dark" : "light";
    localStorage.setItem("pharmacore:theme", value ? "dark" : "light");
  }
  function receive(id?: string) {
    setSelectedProduct(id);
    setReceiveOpen(true);
  }
  async function exportReport() {
    try {
      await downloadCsv(branch);
      setToast("Sales report downloaded.");
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  async function signOut() {
    try {
      await api("auth/logout/", { method: "POST" });
      setData(null);
      setDataBranch("");
      acceptSession(await api<Session>("auth/session/"));
      router.replace("/");
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  if (!session)
    return (
      <div className="boot-screen">
        <Brand />
        {bootstrapError ? (
          <>
            <p role="alert">{bootstrapError}</p>
            <Button onClick={bootstrap}>Try again</Button>
          </>
        ) : (
          <LoaderCircle size={24} className="spin" />
        )}
      </div>
    );
  if (!session.authenticated)
    return (
      <Auth
        session={session}
        onLogin={(value) => {
          acceptSession(value);
          router.replace("/");
        }}
      />
    );
  const heading = titles[section] || [
    "Page not found",
    "Choose a workspace from the navigation.",
  ];
  if (session.mfa?.required)
    return <MFAGate session={session} onSession={acceptSession} />;
  const alertCount =
    (data?.dashboard?.low_stock_count || 0) +
    (data?.dashboard?.expiring_count || 0);
  const availableNav = nav.filter(
    (item) =>
      (!("report" in item) || canReport) &&
      (!("sell" in item) || canSell) &&
      (!("salesRead" in item) || canReadSales) &&
      (!("owner" in item) || role === "owner"),
  );
  const allowed = availableNav.some((item) => item.section === section);
  return (
    <div className={`app-shell ${section === "pos" ? "pos-workspace" : ""}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {mobileNav && (
        <button
          className="sidebar-backdrop"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <Link href="/" className="sidebar-brand">
          <Brand />
        </Link>
        <div className="workspace-picker">
          <span>
            <Store size={18} />
          </span>
          <div>
            <strong>{session.tenant?.name}</strong>
            <small>
              {session.demo ? "Demo workspace" : "Pharmacy workspace"}
            </small>
          </div>
          <ShieldCheck size={15} />
        </div>
        <nav aria-label="Main navigation">
          {["WORKSPACE", "MANAGEMENT"].map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-title">{group}</span>
              {availableNav
                .filter((item) => item.group === group)
                .map((item) => (
                  <Link
                    key={item.section}
                    href={
                      item.section === "dashboard" ? "/" : `/${item.section}`
                    }
                    className={`nav-item ${section === item.section ? "active" : ""}`}
                    aria-current={section === item.section ? "page" : undefined}
                    onClick={() => setMobileNav(false)}
                  >
                    <item.icon size={19} strokeWidth={1.7} />
                    <span>{item.label}</span>
                    {item.section === "inventory" &&
                      !!data?.dashboard?.low_stock_count && (
                        <span className="nav-count">
                          {data.dashboard.low_stock_count}
                        </span>
                      )}
                    {item.section === "pos" && <kbd>POS</kbd>}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-help" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={17} />
            Help & getting started
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-foot">
            <span>
              <i className={`dot ${loadError ? "amber" : "teal"}`} />
              {loadError ? "Connection needs attention" : "Workspace connected"}
            </span>
            <small>v0.1</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{section === "dashboard" ? "Overview" : heading[0]}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="global-search"
              aria-label="Search your pharmacy"
              onClick={() => {
                setSearch("");
                setSearchOpen(true);
              }}
            >
              <Search size={16} />
              <span>Search your pharmacy…</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button notification-button"
              aria-label={`Notifications, ${alertCount} alerts`}
              onClick={() => setAlertsOpen(true)}
            >
              <Bell size={19} />
              {alertCount > 0 && <i />}
            </button>
            <button
              className="icon-button theme-toggle"
              aria-label={
                dark ? "Switch to light theme" : "Switch to dark theme"
              }
              onClick={theme}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <div className="topbar-divider" />
            <button
              className="user-menu"
              onClick={() => router.push("/settings")}
              aria-label="Open account settings"
            >
              <span className="avatar">
                {session.user?.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{session.user?.name}</strong>
                <small>
                  {role === "owner"
                    ? "Pharmacy owner"
                    : role.charAt(0).toUpperCase() + role.slice(1)}
                </small>
              </span>
              <ChevronDown size={13} />
            </button>
            <button
              className="icon-button sign-out"
              onClick={signOut}
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className={`main-content ${section === "pos" ? "pos-content" : ""}`}
        >
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                <span className="eyebrow">YOUR PHARMACY, AT A GLANCE</span>
                {session.demo && (
                  <span className="demo-label">Sample data</span>
                )}
              </div>
              <h1>{heading[0]}</h1>
              <p>{heading[1]}</p>
            </div>
            <div className="page-heading-actions">
              <BranchPicker
                value={branch}
                branches={session.branches || []}
                onChange={(value) => {
                  setBranch(value);
                  setAddOpen(false);
                  setReceiveOpen(false);
                }}
              />
              {role === "owner" && (
                <ResetWorkspace
                  session={session}
                  branch={branch}
                  onReset={(updated) => {
                    setData(null);
                    acceptSession(updated);
                    refresh();
                    setToast(
                      "An empty workspace is ready. Previous records are archived.",
                    );
                  }}
                />
              )}
              <span className="date-chip">
                <CalendarDays size={15} />
                {date(new Date().toISOString())}
              </span>
              <button
                className="icon-button refresh-button"
                onClick={refresh}
                disabled={busy}
                aria-label="Refresh workspace"
              >
                <RefreshCw size={16} className={busy ? "spin" : ""} />
              </button>
            </div>
          </div>
          {loadError && (
            <div className="error-banner" role="alert">
              <span>{loadError}</span>
              <Button variant="secondary" onClick={refresh}>
                Retry
              </Button>
            </div>
          )}
          {!data || dataBranch !== branch || dataSection !== section ? (
            loadError ? (
              <Empty
                title="Unable to load this workspace"
                description="Restore the connection and retry. Your recorded transactions remain on the server."
              />
            ) : (
              <Skeleton />
            )
          ) : !allowed ? (
            <Empty
              title="This workspace is not available"
              description="Choose an available page from the navigation."
            />
          ) : (
            <div key={branch} className="page-content">
              {section === "team" && <Team session={session} branch={branch} />}
              {section === "printing" && (
                <PrintingSettings session={session} branch={branch} />
              )}
              {section === "security" &&
                (session.mfa?.enabled ? (
                  <section className="panel operation-panel">
                    <h2>Authenticator enabled</h2>
                    <p>
                      Your authenticator protects every sign-in. Keep your
                      single-use recovery codes private.
                    </p>
                  </section>
                ) : session.demo ? (
                  <section className="panel operation-panel">
                    <h2>Demo account</h2>
                    <p>
                      Create your own workspace to configure an authenticator.
                    </p>
                  </section>
                ) : (
                  <MFAGate session={session} onSession={acceptSession} />
                ))}
              {section === "dashboard" && data.dashboard && (
                <Dashboard
                  data={data.dashboard}
                  sales={data.sales}
                  name={session.user?.name || "there"}
                  canManage={canManage}
                  onAdd={() => setAddOpen(true)}
                  onExport={exportReport}
                />
              )}
              {(section === "inventory" || section === "catalog") && (
                <Inventory
                  key={section}
                  products={data.products}
                  batches={data.batches}
                  catalog={section === "catalog"}
                  canManage={canManage}
                  canRemove={role === "owner"}
                  demo={!!session.demo}
                  onAdd={() => setAddOpen(true)}
                  onReceive={receive}
                  branch={branch}
                  onChanged={refresh}
                />
              )}
              {section === "pos" && (
                <POS
                  identity={`${session.tenant?.id}:${session.user?.id}`}
                  products={data.products}
                  branch={branch}
                  onCompleted={refresh}
                  notify={setToast}
                />
              )}
              {section === "sales" && (
                <Sales
                  sales={data.sales}
                  branch={branch}
                  canReport={canReport}
                  onExport={exportReport}
                />
              )}
              {section === "reports" && data.dashboard && (
                <Reports data={data.dashboard} onExport={exportReport} />
              )}
              {section === "ledger" && <Ledger movements={movements} />}
              {section === "activity" && <ActivityLog events={events} />}
              {section === "settings" && (
                <Settings
                  session={session}
                  branch={branch}
                  role={role}
                  onSession={acceptSession}
                  notify={setToast}
                />
              )}
            </div>
          )}
        </main>
      </div>
      <AddMedicine
        open={addOpen}
        onClose={() => setAddOpen(false)}
        branch={branch}
        onSaved={() => {
          refresh();
          setToast(
            "Medicine added to the catalog. Receive stock to make it available.",
          );
        }}
      />
      <ReceiveStock
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        branch={branch}
        products={data?.products || []}
        selected={selectedProduct}
        onSaved={() => {
          refresh();
          setToast("Stock received. The batch and ledger have been updated.");
        }}
      />
      <Modal
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search your pharmacy"
        description="Find a medicine by brand, generic, or barcode."
      >
        <label className="search-box command-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Start typing a medicine name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="command-results">
          {searchResults.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSearchOpen(false);
                router.push(`/catalog?search=${encodeURIComponent(item.name)}`);
              }}
            >
              <span className="medicine-mini">
                <Pill size={18} />
              </span>
              <div>
                <strong>
                  {item.name} <span className="muted">{item.strength}</span>
                </strong>
                <small>
                  {item.generic} · {item.stock} available
                </small>
              </div>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
        {!searchResults.length && (
          <Empty
            title="No matching medicines"
            description="Try a generic name or barcode."
          />
        )}
      </Modal>
      <Modal
        open={alertsOpen}
        onOpenChange={setAlertsOpen}
        title="Your attention, please"
        description="Current stock alerts for the selected branch."
      >
        <div className="alert-list">
          {data?.dashboard?.low_stock.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setAlertsOpen(false);
                router.push(
                  `/inventory?search=${encodeURIComponent(item.name)}`,
                );
              }}
            >
              <span className="summary-icon amber">
                <Package size={19} />
              </span>
              <div>
                <strong>{item.name} is running low</strong>
                <small>
                  {item.stock} units available · Reorder level{" "}
                  {item.reorder_level}
                </small>
              </div>
              <ArrowRight size={16} />
            </button>
          ))}
          {data?.dashboard?.expiring.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setAlertsOpen(false);
                router.push("/inventory");
              }}
            >
              <span className="summary-icon red">
                <CalendarDays size={19} />
              </span>
              <div>
                <strong>{item.name} expires soon</strong>
                <small>
                  {item.number} · {date(item.expiry)}
                </small>
              </div>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
        {!alertCount && (
          <Empty
            title="You’re all caught up"
            description="There are no stock alerts to show."
          />
        )}
      </Modal>
      <Modal
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="A smooth start to your day"
        description="Your first connected pharmacy workflow."
      >
        <ol className="quick-guide">
          <li>
            <span>01</span>
            <div>
              <h3>Build your medicine catalog</h3>
              <p>
                Add product details, barcodes, unit prices, and prescription
                restrictions.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Receive a batch</h3>
              <p>
                Open Inventory → Receive stock. Record its expiry, quantity,
                cost, and delivery reference.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Complete a sale</h3>
              <p>
                Use Point of sale. Press F2 to scan, choose units or configured
                boxes, then record cash or a verified bKash / Nagad payment.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Close the loop</h3>
              <p>
                Print a thermal receipt or save an A4 invoice as PDF. Customize
                shop details in Receipt & invoice.
              </p>
            </div>
          </li>
        </ol>
        <div className="notice">
          <ShieldCheck size={19} />
          <p>
            Mobile payments are recorded after you verify receipt in your
            merchant account. This app does not charge the customer or verify
            payments with a gateway.
          </p>
        </div>
      </Modal>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Dismiss message">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
