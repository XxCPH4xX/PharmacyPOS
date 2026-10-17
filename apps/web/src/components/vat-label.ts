/** Render the actual product rates, not a misleading single workspace default. */
export type VatRateLine = { rate_bps?: number | null };

export function vatRateLabel(lines?: readonly VatRateLine[] | null): string {
  if (!lines?.length) return "VAT";
  const rates = [...new Set(
    lines
      .map((line) => line.rate_bps)
      .filter((rate): rate is number => typeof rate === "number" && Number.isFinite(rate)),
  )].sort((a, b) => a - b);
  if (!rates.length) return "VAT";
  return `VAT (${rates.map((rate) => `${Number((rate / 100).toFixed(2))}%`).join(", ")})`;
}
