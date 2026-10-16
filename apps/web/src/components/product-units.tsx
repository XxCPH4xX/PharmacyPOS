"use client";
import { AppSelect } from "./select";
import { useState, type FormEvent } from "react";
import type { Product, Packaging } from "@/lib/types";
import { api, money, toMinor } from "@/lib/api";
import { Button, Field, Modal } from "./ui";

export const baseUnits: Record<string, string[]> = {
  Tablets: ["TABLET"],
  Capsules: ["CAPSULE"],
  Syrups: ["BOTTLE"],
  Creams: ["TUBE"],
  Injections: ["AMPOULE", "VIAL"],
  Powders: ["SACHET"],
  Supplies: ["PIECE", "BOTTLE", "SACHET", "TUBE"],
};
export function packagingFromForm(form: FormData): Packaging {
  const price = (name: string) =>
    form.get(name) ? toMinor(String(form.get(name))) : null;
  return {
    base_unit: String(form.get("pack_base")),
    inner_name: String(form.get("pack_inner") || ""),
    inner_size: Number(form.get("pack_size") || 1),
    outer_name: String(form.get("pack_outer") || ""),
    inners_per_outer: Number(form.get("pack_count") || 1),
    allow_break_inner: form.get("pack_break_inner") === "on",
    allow_break_outer: form.get("pack_break_outer") === "on",
    inner_price_minor: price("pack_inner_price"),
    outer_price_minor: price("pack_outer_price"),
  };
}
export function PackagingFields({
  form,
  initial,
}: {
  form: string;
  initial?: Packaging;
}) {
  const [inner, setInner] = useState(initial?.inner_name || "");
  const [outer, setOuter] = useState(initial?.outer_name || "");
  return (
    <fieldset className="packaging-fields">
      <legend>Packaging</legend>
      <p>
        Define the manufacturer’s packs once. Receive sealed packs or loose
        units separately.
      </p>
      <div className="form-grid">
        <Field label="Base unit">
          <AppSelect
            name="pack_base"
            defaultValue={initial?.base_unit || baseUnits[form]?.[0] || "PIECE"}
            options={(baseUnits[form] || ["PIECE"]).map((value) => ({
              value,
              label: value,
            }))}
          />
        </Field>
        <Field label="Inner package">
          <AppSelect
            name="pack_inner"
            value={inner}
            onValueChange={setInner}
            options={[
              { value: "", label: "None" },
              ...(["Tablets", "Capsules"].includes(form)
                ? ["STRIP", "PACK"]
                : ["PACK"]
              ).map((value) => ({ value, label: value })),
            ]}
          />
        </Field>
        {inner && (
          <>
            <Field label={`Base units per ${inner}`}>
              <input
                name="pack_size"
                type="number"
                min={2}
                max={10000}
                defaultValue={
                  initial?.inner_size && initial.inner_size > 1
                    ? initial.inner_size
                    : 10
                }
                required
              />
            </Field>
            <Field
              label={`${inner} selling price (৳)`}
              hint="Blank uses the base price × pack size."
            >
              <input
                name="pack_inner_price"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                defaultValue={
                  initial?.inner_price_minor == null
                    ? ""
                    : (initial.inner_price_minor / 100).toFixed(2)
                }
              />
            </Field>
          </>
        )}
        <Field label="Outer package">
          <AppSelect
            name="pack_outer"
            value={outer}
            onValueChange={setOuter}
            options={[
              { value: "", label: "None" },
              ...["BOX", "CARTON"].map((value) => ({ value, label: value })),
            ]}
          />
        </Field>
        {outer && (
          <>
            <Field label={`${inner || "Base units"} per ${outer}`}>
              <input
                name="pack_count"
                type="number"
                min={inner ? 1 : 2}
                max={10000}
                defaultValue={
                  initial?.inners_per_outer && initial.inners_per_outer > 1
                    ? initial.inners_per_outer
                    : 10
                }
                required
              />
            </Field>
            <Field
              label={`${outer} selling price (৳)`}
              hint="Blank uses the base price × pack size."
            >
              <input
                name="pack_outer_price"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                defaultValue={
                  initial?.outer_price_minor == null
                    ? ""
                    : (initial.outer_price_minor / 100).toFixed(2)
                }
              />
            </Field>
          </>
        )}
      </div>
      {inner && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="pack_break_inner"
            defaultChecked={initial?.allow_break_inner}
          />
          <span>Allow opening {inner.toLowerCase()}s to sell loose units</span>
        </label>
      )}
      {outer && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="pack_break_outer"
            defaultChecked={initial?.allow_break_outer}
          />
          <span>
            Allow opening {outer.toLowerCase()}s to sell smaller units
          </span>
        </label>
      )}
    </fieldset>
  );
}
export function ProductUnits({
  product,
  branch,
  onClose,
  onSaved,
}: {
  product: Product | null;
  branch: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!product) return;
    setError("");
    setBusy(true);
    try {
      await api(
        `catalog/${product.id}/units/`,
        {
          method: "PUT",
          body: JSON.stringify(
            packagingFromForm(new FormData(e.currentTarget)),
          ),
        },
        branch,
      );
      onSaved();
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
        if (!open) onClose();
      }}
      title="Boxes, strips & packs"
      description={
        product
          ? `Packaging for ${product.name}. Base selling price: ${money(product.price_minor)}.`
          : ""
      }
      wide
    >
      {product && (
        <form key={product.id} onSubmit={save}>
          <PackagingFields form={product.form} initial={product.packaging} />
          <p>
            Existing loose stock stays loose. Pack sizes cannot change while
            sealed stock remains.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              Save packaging
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
