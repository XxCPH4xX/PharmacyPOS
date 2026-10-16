export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "network_error",
    public fields: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  branch?: string,
): Promise<T> {
  const csrf =
    typeof document !== "undefined"
      ? document.cookie
          .split("; ")
          .find((c) => c.startsWith("csrftoken="))
          ?.slice(10)
      : undefined;
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRFToken": decodeURIComponent(csrf) } : {}),
        ...(branch ? { "X-Branch-ID": branch } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      "Unable to reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = body?.error;
    const fields = error?.fields || {};
    const detail = Object.entries(fields)
      .map(
        ([key, value]) =>
          `${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join(" ") : String(value)}`,
      )
      .join(" ");
    throw new ApiError(
      detail ||
        error?.message ||
        `The request could not be completed (${response.status}).`,
      response.status,
      error?.code,
      fields,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function listAll<T>(path: string, branch: string): Promise<T[]> {
  const items: T[] = [];
  let count = 1;
  while (items.length < count) {
    const page = await api<{ count: number; results: T[] }>(
      `${path}?limit=200&offset=${items.length}`,
      {},
      branch,
    );
    items.push(...page.results);
    count = page.count;
    if (!page.results.length) break;
  }
  return items;
}

export const money = (minor: number, compact = false) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: compact ? 0 : 2,
    minimumFractionDigits: compact ? 0 : 2,
  }).format(minor / 100);
export const number = (value: number) =>
  new Intl.NumberFormat("en-BD").format(value);
export const date = (value: string, withTime = false) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
export const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
    new Date(),
  );
export const daysUntil = (value: string) =>
  Math.round((Date.parse(value) - Date.parse(today())) / 86400000);
export function toMinor(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a valid amount with no more than two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor))
    throw new Error("This amount is too large.");
  return minor;
}
export function downloadCsv(branch: string) {
  return fetch("/api/v1/sales/export/", {
    credentials: "same-origin",
    headers: { "X-Branch-ID": branch },
  }).then(async (response) => {
    if (!response.ok)
      throw new Error("The sales report could not be exported.");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pharmacore-sales-${today()}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
