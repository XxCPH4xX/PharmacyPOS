"use client";
import { AppSelect } from "./select";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  CircleAlert,
  FileBarChart2,
  Layers3,
  Package,
  Plus,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { date, money, number } from "@/lib/api";
import type { DashboardData, SaleSummary } from "@/lib/types";
import { Badge, Button, Empty } from "./ui";

const palette = ["#3475e8", "#13b2a0", "#39bd7b", "#f0ae38", "#9567e8"];

export function RevenueChart({ data }: { data: DashboardData }) {
  const [range, setRange] = useState(6);
  const [hover, setHover] = useState<number | null>(null);
  const points = data.trend.slice(-range);
  const max = Math.max(...points.map((p) => p.revenue_minor), 10000) * 1.2;
  const x = (i: number) => 50 + (i * 650) / (points.length - 1);
  const y = (value: number) => 220 - (value / max) * 185;
  function smooth(values: number[]) {
    return values
      .map((value, i) =>
        i === 0
          ? `M${x(i)},${y(value)}`
          : `C${x(i - 1) + 65},${y(values[i - 1])} ${x(i) - 65},${y(value)} ${x(i)},${y(value)}`,
      )
      .join(" ");
  }
  const revenuePath = smooth(points.map((p) => p.revenue_minor));
  const costPath = smooth(points.map((p) => p.cost_minor));
  const change = data.previous_revenue_minor
    ? ((data.revenue_minor - data.previous_revenue_minor) /
        data.previous_revenue_minor) *
      100
    : null;
  return (
    <section className="panel revenue-panel">
      <div className="panel-heading">
        <div>
          <h2>Revenue overview</h2>
          <p>A little clarity for your next big decision.</p>
        </div>
        <div className="select-wrap">
          <AppSelect
            aria-label="Chart period"
            value={range}
            onValueChange={(value) => setRange(Number(value))}
            options={[
              { value: 6, label: "Last 6 months" },
              { value: 3, label: "Last 3 months" },
            ]}
          />
        </div>
      </div>
      <div className="revenue-numbers">
        <div>
          <span>
            <i style={{ background: palette[1] }} />
            Revenue
          </span>
          <strong>{money(data.revenue_minor, true)}</strong>
          <small
            className={change !== null && change < 0 ? "negative" : "positive"}
          >
            {change === null
              ? "This month"
              : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs last month`}
          </small>
        </div>
        <div>
          <span>
            <i style={{ background: palette[0] }} />
            Gross profit
          </span>
          <strong>{money(data.revenue_minor - data.cost_minor, true)}</strong>
          <small>Before operating expenses</small>
        </div>
        <div>
          <span>
            <i style={{ background: "#c7d8e4" }} />
            Cost of goods
          </span>
          <strong>{money(data.cost_minor, true)}</strong>
          <small>From allocated batches</small>
        </div>
      </div>
      <div className="chart-wrap">
        <svg
          viewBox="0 0 740 270"
          role="img"
          aria-label={`Monthly revenue: ${points.map((p) => `${p.label} ${money(p.revenue_minor)}`).join(", ")}`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#11b4a5" stopOpacity=".19" />
              <stop offset="100%" stopColor="#11b4a5" stopOpacity=".01" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line
                x1="50"
                x2="700"
                y1={35 + i * 46.25}
                y2={35 + i * 46.25}
                stroke="var(--line)"
                strokeDasharray="3 5"
              />
              <text
                x="35"
                y={39 + i * 46.25}
                textAnchor="end"
                className="chart-label"
              >
                {((max * (4 - i)) / 4 / 100000).toFixed(1)}k
              </text>
            </g>
          ))}
          <path
            d={`${revenuePath} L700,220 L50,220 Z`}
            fill="url(#revenue-fill)"
          />
          <path
            d={costPath}
            fill="none"
            stroke="#96b3d8"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
          <path
            d={revenuePath}
            fill="none"
            stroke="#0cac9e"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {points.map((p, i) => (
            <g key={p.label} onMouseEnter={() => setHover(i)}>
              <text
                x={x(i)}
                y="251"
                textAnchor="middle"
                className="chart-label"
              >
                {p.label}
              </text>
              <rect
                x={x(i) - 35}
                y="25"
                width="70"
                height="200"
                fill="transparent"
              />
              {hover === i && (
                <>
                  <line
                    x1={x(i)}
                    x2={x(i)}
                    y1="25"
                    y2="220"
                    stroke="#91bfb9"
                    strokeDasharray="4 4"
                  />
                  <circle
                    cx={x(i)}
                    cy={y(p.revenue_minor)}
                    r="5"
                    fill="#fff"
                    stroke="#0cac9e"
                    strokeWidth="3"
                  />
                </>
              )}
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div className="chart-tooltip">
            {points[hover].label} · {money(points[hover].revenue_minor)}
          </div>
        )}
      </div>
      <div className="chart-foot">
        <span>
          <i className="dot teal" /> Revenue
        </span>
        <span>
          <i className="dot pale" /> Cost of goods
        </span>
        <small>All amounts in BDT</small>
      </div>
    </section>
  );
}

export function Distribution({ data }: { data: DashboardData }) {
  const total = data.distribution.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;
  const values = data.distribution.map((item, i) => {
    const slice = {
      ...item,
      offset,
      share: total ? (item.value / total) * 100 : 0,
      color: palette[i % palette.length],
    };
    offset += slice.share;
    return slice;
  });
  return (
    <section className="panel distribution-panel">
      <div className="panel-heading">
        <div>
          <h2>Inventory mix</h2>
          <p>Available stock by medicine form</p>
        </div>
        <Layers3 size={18} className="muted" />
      </div>
      <div className="donut-wrap">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={`Inventory distribution: ${values.map((v) => `${v.name} ${number(v.value)} units`).join(", ")}`}
        >
          <circle
            cx="100"
            cy="100"
            r="77"
            fill="none"
            stroke="var(--line)"
            strokeWidth="24"
          />
          {values.map((item) => (
            <circle
              key={item.name}
              cx="100"
              cy="100"
              r="77"
              fill="none"
              stroke={item.color}
              strokeWidth="24"
              pathLength="100"
              strokeDasharray={`${Math.max(0, item.share - 0.8)} ${100 - Math.max(0, item.share - 0.8)}`}
              strokeDashoffset={-item.offset}
              transform="rotate(-90 100 100)"
            />
          ))}
        </svg>
        <div>
          <small>Total units</small>
          <strong>{number(total)}</strong>
          <span>across all forms</span>
        </div>
      </div>
      <div className="distribution-legend">
        {values.map((item) => (
          <div key={item.name}>
            <span>
              <i style={{ background: item.color }} />
              {item.name}
            </span>
            <small>{number(item.value)}</small>
            <strong>{item.share.toFixed(0)}%</strong>
          </div>
        ))}
      </div>
      <Link href="/inventory" className="panel-link">
        Explore inventory <ArrowRight size={14} />
      </Link>
    </section>
  );
}

function HeroArt() {
  return (
    <svg
      className="hero-art"
      viewBox="0 0 350 230"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="227"
        cy="113"
        r="101"
        stroke="white"
        strokeOpacity=".06"
        strokeWidth="1"
      />
      <circle
        cx="227"
        cy="113"
        r="77"
        stroke="white"
        strokeOpacity=".08"
        strokeWidth="1"
      />
      <circle cx="227" cy="113" r="128" stroke="white" strokeOpacity=".04" />
      <g transform="rotate(30 230 105)">
        <rect
          x="193"
          y="20"
          width="78"
          height="169"
          rx="39"
          fill="white"
          fillOpacity=".08"
          stroke="white"
          strokeOpacity=".28"
          strokeWidth="2"
        />
        <path
          d="M194 106h77v44a38 38 0 0 1-77 0z"
          fill="white"
          fillOpacity=".14"
        />
        <path
          d="M209 62a22 22 0 0 1 22-23"
          stroke="white"
          strokeOpacity=".5"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M194 106h77"
          stroke="white"
          strokeOpacity=".3"
          strokeWidth="2"
        />
      </g>
      <g transform="rotate(-18 125 147)">
        <rect
          x="92"
          y="113"
          width="67"
          height="67"
          rx="18"
          fill="#63d9c8"
          fillOpacity=".22"
          stroke="white"
          strokeOpacity=".2"
        />
        <path
          d="M125 130v33m-16-16h32"
          stroke="white"
          strokeOpacity=".7"
          strokeWidth="9"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M302 50v13m-6-6h12M86 72v9m-4-4h8"
        stroke="white"
        strokeOpacity=".45"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="176" cy="205" r="3" fill="white" fillOpacity=".4" />
      <circle cx="305" cy="165" r="4" fill="#90ddd2" fillOpacity=".5" />
    </svg>
  );
}

export function Dashboard({
  data,
  sales,
  name,
  canManage,
  onAdd,
  onExport,
}: {
  data: DashboardData;
  sales: SaleSummary[];
  name: string;
  canManage: boolean;
  onAdd: () => void;
  onExport: () => void;
}) {
  const [alertTab, setAlertTab] = useState("low");
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const change = data.previous_revenue_minor
    ? ((data.revenue_minor - data.previous_revenue_minor) /
        data.previous_revenue_minor) *
      100
    : null;
  const stats = [
    {
      title: "Monthly revenue",
      value: money(data.revenue_minor, true),
      icon: TrendingUp,
      color: "blue",
      tag:
        change === null
          ? "This month"
          : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
      sub: "vs. previous month",
    },
    {
      title: "Medicines in stock",
      value: number(data.stock_units),
      icon: Package,
      color: "teal",
      tag: "Available",
      sub: `${data.medicine_count} catalog medicines`,
    },
    {
      title: "Transactions",
      value: number(data.month_transactions),
      icon: FileBarChart2,
      color: "green",
      tag: "This month",
      sub: `${data.today_transactions} completed today`,
    },
    {
      title: "Low stock alerts",
      value: number(data.low_stock_count),
      icon: CircleAlert,
      color: "amber",
      tag: "Reorder",
      sub: "At or below reorder level",
    },
    {
      title: "Expiring soon",
      value: number(data.expiring_count),
      icon: CalendarClock,
      color: "red",
      tag: "90 days",
      sub: "Batches to review",
    },
    {
      title: "Today’s sales",
      value: money(data.today_revenue_minor, true),
      icon: ShoppingBag,
      color: "blue",
      tag: "Today",
      sub: "Completed payments",
    },
  ];
  return (
    <>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <span className="system-pill">
            <i /> Your pharmacy, connected
          </span>
          <h2>
            {greeting}, {name.split(" ")[0]} <span className="wave">✦</span>
          </h2>
          <p>
            A little more clarity. A lot more care.
            <br className="mobile-break" /> Here’s how your pharmacy is doing
            today.
          </p>
          <div className="welcome-actions">
            <Button variant="secondary" onClick={onExport}>
              <FileBarChart2 size={16} />
              Generate report
            </Button>
            {canManage && (
              <button className="hero-add" onClick={onAdd}>
                <Plus size={17} />
                Add medicine
              </button>
            )}
            <span className="hero-activity">
              <Activity size={17} />
              {data.today_transactions} transactions today
            </span>
          </div>
        </div>
        <HeroArt />
      </section>
      <div className="stats-grid">
        {stats.map((stat) => (
          <div className={`stat-card stat-${stat.color}`} key={stat.title}>
            <div className="stat-top">
              <span className="stat-icon">
                <stat.icon size={20} strokeWidth={1.8} />
              </span>
              <span className="stat-tag">{stat.tag}</span>
            </div>
            <span className="stat-label">{stat.title}</span>
            <strong>{stat.value}</strong>
            <small>{stat.sub}</small>
            <div className="stat-accent" />
          </div>
        ))}
      </div>
      <div className="analytics-grid">
        <RevenueChart data={data} />
        <Distribution data={data} />
      </div>
      <div className="details-grid">
        <section className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <h2>
                Needs your attention{" "}
                <span className="count-bubble">
                  {data.low_stock_count + data.expiring_count}
                </span>
              </h2>
              <p>Small actions that keep things running smoothly.</p>
            </div>
            <Link href="/inventory" className="text-link">
              View inventory
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="tab-line">
            <button
              className={alertTab === "low" ? "active" : ""}
              onClick={() => setAlertTab("low")}
            >
              Low stock <span>{data.low_stock_count}</span>
            </button>
            <button
              className={alertTab === "expiry" ? "active" : ""}
              onClick={() => setAlertTab("expiry")}
            >
              Expiring soon <span>{data.expiring_count}</span>
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>{alertTab === "low" ? "Available" : "Expiry date"}</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {alertTab === "low"
                  ? data.low_stock.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="medicine-cell">
                            <span className="medicine-mini">
                              <Package size={17} />
                            </span>
                            <div>
                              <strong>{item.name}</strong>
                              <small>
                                {item.strength} · {item.manufacturer}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong>{item.stock}</strong>{" "}
                          <span className="muted">units</span>
                        </td>
                        <td>
                          <Badge tone="amber">Low stock</Badge>
                        </td>
                        <td>
                          <Link
                            href="/inventory"
                            aria-label={`View ${item.name}`}
                            className="icon-button"
                          >
                            <ArrowRight size={15} />
                          </Link>
                        </td>
                      </tr>
                    ))
                  : data.expiring.map((batch) => (
                      <tr key={batch.id}>
                        <td>
                          <div className="medicine-cell">
                            <span className="medicine-mini red">
                              <CalendarClock size={17} />
                            </span>
                            <div>
                              <strong>{batch.name}</strong>
                              <small>{batch.number}</small>
                            </div>
                          </div>
                        </td>
                        <td>{date(batch.expiry)}</td>
                        <td>
                          <Badge tone="red">Expiring soon</Badge>
                        </td>
                        <td>
                          <Link
                            href="/inventory"
                            aria-label={`Review ${batch.name}`}
                            className="icon-button"
                          >
                            <ArrowRight size={15} />
                          </Link>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {(alertTab === "low" ? data.low_stock : data.expiring).length ===
            0 && (
            <Empty
              title="All clear here"
              description="There are no alerts in this category."
            />
          )}
        </section>
        <section className="panel top-products">
          <div className="panel-heading">
            <div>
              <h2>Moving off the shelves</h2>
              <p>Most sold medicines this month</p>
            </div>
            <TrendingUp size={18} className="muted" />
          </div>
          {data.top_products.length ? (
            data.top_products.map((item, i) => (
              <div className="top-product" key={item.id}>
                <span className="rank">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{number(item.units)} units sold</small>
                  <span className="product-bar">
                    <i
                      style={{
                        width: `${(item.units / data.top_products[0].units) * 100}%`,
                      }}
                    />
                  </span>
                </div>
                <strong>{money(item.revenue_minor, true)}</strong>
              </div>
            ))
          ) : (
            <Empty
              title="Your first sale starts here"
              description="Completed sales will appear in this overview."
            />
          )}
          <Link href="/reports" className="panel-link">
            See sales performance <ArrowRight size={14} />
          </Link>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h2>Recent transactions</h2>
            <p>Every sale, safely recorded.</p>
          </div>
          <Link href="/sales" className="text-link">
            View all transactions
            <ArrowRight size={14} />
          </Link>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date & time</th>
                <th>Cashier</th>
                <th>Payment</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sales.slice(0, 4).map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <Link
                      className="receipt-link"
                      href={`/sales?receipt=${sale.id}`}
                    >
                      {sale.receipt_number}
                    </Link>
                  </td>
                  <td>{date(sale.created_at, true)}</td>
                  <td>{sale.cashier}</td>
                  <td>
                    {(
                      {
                        cash: "Cash",
                        bkash: "bKash",
                        nagad: "Nagad",
                      } as Record<string, string>
                    )[sale.payment_method] || sale.payment_method}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!sales.length && (
          <Empty
            title="No transactions yet"
            description="Complete a sale in the POS to see it here."
          />
        )}
      </section>
      <div className="workspace-footer">
        <span>
          <i className="dot teal" />
          Last updated{" "}
          {new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Dhaka",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(data.as_of))}{" "}
          · Asia/Dhaka
        </span>
        <span>
          Thoughtfully connected. <strong>PharmaCore.</strong>
        </span>
      </div>
    </>
  );
}
