"use client";

import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import type { Product } from "@/lib/types";
import { Button } from "./ui";
import styles from "./tax-settings.module.css";

type VatRule = {
  product_id: string;
  treatment: "default" | "exempt" | "taxable";
  rate_bps?: number;
  mode?: "inclusive" | "exclusive";
};
type VatConfiguration = {
  enabled: boolean;
  default_rate_bps: number;
  default_mode: "inclusive" | "exclusive";
  default_product_discount_bps: number;
  rules: VatRule[];
  version: number;
};

export function TaxSettings({ branch, isOwner }: { branch: string; isOwner: boolean }) {
  const [config, setConfig] = useState<VatConfiguration | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      api<VatConfiguration>("settings/tax/", {}, branch),
      api<{ results: Product[] }>("catalog/?limit=200", {}, branch),
    ]).then(([c, catalog]) => {
      if (!mounted) return;
      setConfig(c);
      setProducts(catalog.results);
    }).catch(e => { if (mounted) setStatus((e as Error).message); });
    return () => { mounted = false; };
  }, [branch]);

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      void api<{ results: Product[] }>(`catalog/?limit=200${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`, {}, branch)
        .then(result => { if (mounted) setProducts(result.results); })
        .catch(e => { if (mounted) setStatus((e as Error).message); });
    }, 200);
    return () => { mounted = false; clearTimeout(timer); };
  }, [branch, search]);

  async function save() {
    if (!config || !isOwner) return;
    setSaving(true);
    setStatus("");
    try {
      const next = await api<VatConfiguration>("settings/tax/", {
        method: "PUT",
        body: JSON.stringify(config),
      }, branch);
      setConfig(next);
      setStatus("Workspace VAT and discount settings saved. New sales use the updated policy; existing receipts are unchanged.");
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!config) return <section className="panel"><h2>Tax & VAT</h2><p>{status || "Loading VAT settings…"}</p></section>;
  const update = (patch: Partial<VatConfiguration>) => setConfig(c => c ? { ...c, ...patch } : c);
  const toPercentage = (bps: number) => String(bps / 100);
  const fromPercentage = (value: string) => Math.min(10000, Math.max(0, Math.round(Number(value) * 100)));
  const ruleFor = (id: string) => config.rules.find(r => r.product_id === id);
  const editRule = (id: string, patch: VatRule) => {
    update({ rules: [...config.rules.filter(r => r.product_id !== id), patch] });
  };
  const listed = products.filter(product =>
    `${product.name} ${product.sku} ${product.generic}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <>
    <section className={`panel settings-panel vat-settings-panel ${styles.root}`}>
      <div className="panel-heading">
        <div>
          <h2>Tax & VAT</h2>
          <p>Configure checkout tax rules for this workspace.</p>
        </div>
        {isOwner && (
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save VAT settings"}
          </Button>
        )}
      </div>

      <div className="vat-settings-body">
        <label className="vat-enabled-row">
          <input type="checkbox" checked={config.enabled} disabled={!isOwner || saving}
            onChange={e => update({ enabled: e.target.checked })} />
          <span>
            <strong>Enable VAT on new sales</strong>
            <small>Existing receipts keep their original tax calculations.</small>
          </span>
        </label>

        <div className="vat-fields-grid">
          <div className="field">
            <label htmlFor="vat-default-rate">Default VAT rate (%)</label>
            <input id="vat-default-rate" type="number" min="0" max="100" step="0.01"
              disabled={!isOwner || saving || !config.enabled}
              value={toPercentage(config.default_rate_bps)}
              onChange={e => update({ default_rate_bps: fromPercentage(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="vat-default-mode">Price treatment</label>
            <select id="vat-default-mode" value={config.default_mode}
              disabled={!isOwner || saving || !config.enabled}
              onChange={e => update({ default_mode: e.target.value as "inclusive" | "exclusive" })}>
              <option value="exclusive">VAT added to price (exclusive)</option>
              <option value="inclusive">VAT included in price (inclusive)</option>
            </select>
          </div>
        </div>

        <div className="vat-rules-heading">
          <div>
            <h3>Medicine-specific VAT rules</h3>
            <p>Apply the default rate, mark an item exempt, or assign a custom VAT rate.</p>
          </div>
          <input aria-label="Search medicine VAT rules" placeholder="Search medicine or SKU…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="vat-rules-table" role="region" aria-label="Medicine VAT rules" tabIndex={0}>
          <div className="vat-rules-columns" aria-hidden="true">
            <span>Medicine</span><span>Shelf price</span><span>Tax treatment</span><span>Rate (%)</span><span>Pricing</span>
          </div>
          {listed.slice(0, 80).map(product => {
            const rule = ruleFor(product.id);
            const treatment = rule?.treatment ?? "default";
            return (
              <div className="vat-rule-row" key={product.id}>
                <div className="vat-rule-product">
                  <strong title={product.name}>{product.name}</strong>
                  <small>{product.sku}</small>
                </div>
                <span className="vat-rule-price">{money(product.price_minor)}</span>
                <select aria-label={`VAT treatment ${product.name}`} value={treatment}
                  disabled={!isOwner || saving || !config.enabled}
                  onChange={e => {
                    const selectedTreatment = e.target.value as VatRule["treatment"];
                    editRule(product.id, {
                      product_id: product.id, treatment: selectedTreatment,
                      ...(selectedTreatment === "taxable" ? {
                        rate_bps: config.default_rate_bps, mode: config.default_mode,
                      } : {}),
                    });
                  }}>
                  <option value="default">Default</option>
                  <option value="exempt">Exempt</option>
                  <option value="taxable">Custom VAT</option>
                </select>
                {treatment === "taxable" ? (
                  <input aria-label={`VAT rate ${product.name}`} type="number" min="0" max="100" step="0.01"
                    value={toPercentage(rule?.rate_bps ?? 0)} disabled={!isOwner || saving || !config.enabled}
                    onChange={e => editRule(product.id, { ...rule!, rate_bps: fromPercentage(e.target.value) })} />
                ) : <span className="vat-rule-muted">—</span>}
                {treatment === "taxable" ? (
                  <select aria-label={`VAT pricing ${product.name}`} value={rule?.mode ?? config.default_mode}
                    disabled={!isOwner || saving || !config.enabled}
                    onChange={e => editRule(product.id, { ...rule!, mode: e.target.value as "inclusive" | "exclusive" })}>
                    <option value="exclusive">Exclusive</option>
                    <option value="inclusive">Inclusive</option>
                  </select>
                ) : <span className="vat-rule-muted">—</span>}
              </div>
            );
          })}
          {listed.length === 0 && <p className="vat-rules-empty">No matching medicines found.</p>}
        </div>
        {listed.length > 80 && <p className="payment-note">Showing the first 80 results. Search to narrow the list.</p>}
        {status && <p className="vat-settings-status" role="status">{status}</p>}
        <p className="payment-note">Confirm applicable rates and exemptions under Bangladesh tax rules before issuing invoices. This is not a statutory Mushak 6.3 certification.</p>
      </div>
    </section>
    <section className={`panel settings-panel ${styles.root} ${styles.discountPanel}`} aria-label="Customer discount settings">
      <div className="panel-heading">
        <div>
          <h2>Customer discounts</h2>
          <p>Set a workspace-wide default product discount for new sales.</p>
        </div>
        {isOwner && (
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save discount settings"}
          </Button>
        )}
      </div>
      <div className="discount-policy-body">
        <div className="field">
          <label htmlFor="discount-product-default">Default product discount (%)</label>
          <input
            id="discount-product-default"
            aria-describedby="discount-product-help"
            type="number"
            min="0"
            max="100"
            step="0.01"
            disabled={!isOwner || saving}
            value={toPercentage(config.default_product_discount_bps)}
            onChange={e => update({ default_product_discount_bps: fromPercentage(e.target.value) })}
          />
          <small id="discount-product-help">
            Automatically applied to each new sale. Set 0 to disable it. A cashier can
            replace the rate for an individual sale; Extra discount is a fixed amount
            for that transaction only and replaces the default discount.
          </small>
        </div>
        <p className="payment-note">Previously completed sales and printed receipts are never recalculated.</p>
        {status && <p className="vat-settings-status" role="status">{status}</p>}
      </div>
    </section>
    </>
  );
}
