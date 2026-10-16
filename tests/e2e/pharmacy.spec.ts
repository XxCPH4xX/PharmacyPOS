import { expect, test, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}

async function register(page: Page) {
  const code = randomUUID();
  const password = `Test-only-${randomUUID()}!`;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page.getByLabel("Your name", { exact: true }).fill("Test Owner");
  await page
    .getByLabel("Pharmacy name", { exact: true })
    .fill(`Test Pharmacy ${code}`);
  await page.getByLabel("First branch", { exact: true }).fill("Test Branch");
  await page
    .getByLabel("Address", { exact: true })
    .fill("Fictional test address, Dhaka");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(`test-${code}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page.getByLabel("Confirm your password").fill(password);
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const secret = await page
    .getByLabel("Setup key", { exact: true })
    .inputValue();
  await page.getByLabel("Authenticator or recovery code").fill(totp(secret));
  await page
    .getByRole("button", { name: "Enable authenticator", exact: true })
    .click();
  await page
    .getByRole("button", { name: "I have saved my codes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revenue overview", exact: true }),
  ).toBeVisible();
  return { password };
}

async function demo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Revenue overview", exact: true }),
  ).toBeVisible();
}

test("dashboard, global search, responsive navigation, and theme", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await demo(page);
  const branch = page.getByRole("combobox", { name: "Select branch" });
  const triggerBounds = (await branch.boundingBox())!;
  await branch.click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const menuBounds = (await menu.boundingBox())!;
  expect(
    Math.abs(
      menuBounds.x + menuBounds.width - triggerBounds.x - triggerBounds.width,
    ),
  ).toBeLessThan(2);
  expect(menuBounds.y).toBeGreaterThanOrEqual(
    triggerBounds.y + triggerBounds.height,
  );
  await page.screenshot({ path: ".local/screenshots/branch-menu.png" });
  await page.keyboard.press("Escape");
  await expect(branch).toBeFocused();
  await page.getByRole("combobox", { name: "Chart period" }).click();
  await page
    .getByRole("option", { name: "Last 3 months", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Chart period" }),
  ).toContainText("Last 3 months");
  await page
    .getByRole("button", { name: "Search your pharmacy", exact: true })
    .click();
  await page.getByPlaceholder("Start typing a medicine name…").fill("Napa");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Napa 500 mg/ })
    .click();
  await expect(page.getByLabel("Search inventory")).toHaveValue("Napa");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Revenue overview", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: ".local/screenshots/mobile-dashboard.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".local/screenshots/dashboard.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("register organization, create medicine, receive batch, checkout, receipt, ledger, export", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await register(page);
  await page.getByRole("button", { name: "Add medicine", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Brand / medicine name").fill("Test Supply");
  await dialog.getByLabel("Generic name", { exact: true }).fill("Test gauze");
  await dialog.getByLabel("Strength", { exact: true }).fill("10 cm");
  await dialog.getByLabel("Dosage form").click();
  await page.getByRole("option", { name: "Supplies", exact: true }).click();
  await dialog
    .getByLabel("Manufacturer", { exact: true })
    .fill("Test manufacturer");
  await dialog.getByLabel("SKU", { exact: true }).fill("TEST-SUPPLY");
  await dialog.getByLabel("Barcode", { exact: true }).fill("TEST12345");
  await dialog.getByLabel("Selling price (৳ / unit)").fill("12.50");
  await dialog
    .getByRole("button", { name: "Add medicine", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: /^Inventory/ }).click();
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await dialog.getByLabel("Medicine", { exact: true }).click();
  await page
    .getByRole("option", { name: "Test Supply · 10 cm", exact: true })
    .click();
  await dialog.getByLabel("Batch / lot number").fill("TEST-BATCH");
  await dialog.getByLabel("Expiry date").fill("2030-12-31");
  await dialog.getByLabel("Quantity (individual units)").fill("10");
  await dialog.getByLabel("Purchase cost (৳ / unit)").fill("8.00");
  await dialog.getByLabel("Supplier", { exact: true }).fill("Test supplier");
  await dialog
    .getByLabel("Delivery reference", { exact: false })
    .fill("TEST-DELIVERY");
  let receivingResponseLost = false;
  await page.route("**/api/v1/inventory/receive/", async (route) => {
    if (!receivingResponseLost) {
      receivingResponseLost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Confirm receiving", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Receive stock", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm receiving", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: "Point of sale POS" }).click();
  await page
    .getByRole("button", {
      name: "Choose customer: Walk-in customer",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "New customer", exact: true }).click();
  await dialog
    .getByLabel("Customer name", { exact: true })
    .fill("Returning Customer");
  await dialog
    .getByLabel("Phone number", { exact: true })
    .fill("+8801700000000");
  await dialog.getByLabel("Address (optional)").fill("Sample address, Dhaka");
  let customerResponseLost = false;
  await page.route("**/api/v1/customers/", async (route) => {
    if (route.request().method() === "POST" && !customerResponseLost) {
      customerResponseLost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Save & select customer", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Confirm customer", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", {
      name: "Choose customer: Walk-in customer",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm customer", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const selectedCustomer = page.getByRole("button", {
    name: "Choose customer: Returning Customer",
    exact: true,
  });
  await expect(selectedCustomer).toContainText("01700000000");
  await selectedCustomer.click();
  await dialog.getByRole("button", { name: /Continue as walk-in/ }).click();
  await page
    .getByRole("button", {
      name: "Choose customer: Walk-in customer",
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("Search customers by name or phone")
    .fill("01700000000");
  await expect(dialog.locator(".customer-result")).toHaveCount(1);
  await page.screenshot({ path: ".local/screenshots/customer-picker.png" });
  await dialog
    .getByRole("button", { name: /Returning Customer.*01700000000/ })
    .click();
  await expect(selectedCustomer).toBeVisible();
  await page.getByLabel("Scan or search medicine").fill("TEST12345");
  await page.getByLabel("Scan or search medicine").press("Enter");
  await page.getByLabel("Quantity of Test Supply").fill("2");
  await page.getByRole("button", { name: /^Review payment/ }).click();
  await expect(
    dialog.getByRole("button", { name: /^Confirm payment/ }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Digit 2", exact: true }).click();
  await dialog.getByRole("button", { name: "Digit 0", exact: true }).click();
  await expect(dialog.locator(".change-line")).toContainText("Still due৳5.00");
  await dialog
    .getByRole("button", { name: "Decimal point", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Digit 5", exact: true }).click();
  await expect(page.getByLabel("Cash received", { exact: true })).toHaveValue(
    "20.5",
  );
  await dialog
    .getByRole("button", { name: "Delete last digit", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await dialog.getByRole("button", { name: "Digit 5", exact: true }).click();
  await dialog.getByRole("button", { name: "Digit 0", exact: true }).click();
  await expect(dialog.locator(".change-line")).toContainText(
    "Change to return৳25.00",
  );
  await expect(dialog.locator(".change-line strong")).toHaveCSS(
    "font-size",
    "32px",
  );
  await page.screenshot({ path: ".local/screenshots/checkout-dialog.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth))
    .toBe(true);
  await page.screenshot({ path: ".local/screenshots/checkout-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Confirm payment · ৳25.00", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sale complete", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator(".retail-total .document-row")).toContainText(
    "25.00",
  );
  await expect(
    dialog.locator(".document-row").filter({ hasText: "Change" }),
  ).toContainText("25.00");
  await expect(dialog.getByText("TEST-BATCH", { exact: false })).toBeVisible();
  await expect(
    dialog.getByRole("article", { name: "Thermal receipt" }),
  ).toContainText("Returning Customer");
  await page.screenshot({ path: ".local/screenshots/receipt.png" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Test Supply to cart" }),
  ).toContainText("8 available");
  await page.getByRole("link", { name: "Stock ledger", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "-2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "+10", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Reports & analytics", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export sales report" }).click();
  expect((await download).suggestedFilename()).toMatch(/pharmacore-sales/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
});

test("lost checkout response survives reload and retries without duplicate stock deduction", async ({
  page,
}) => {
  await demo(page);
  await page.getByRole("link", { name: "Point of sale POS" }).click();
  const productButton = page.getByRole("button", {
    name: "Add Sterile Gauze to cart",
    exact: true,
  });
  await expect(productButton).toBeVisible();
  const before = Number(
    (await productButton.innerText())
      .match(/([\d,]+) available/)![1]
      .replaceAll(",", ""),
  );
  await productButton.click();
  let intercepted = false;
  await page.route("**/api/v1/sales/checkout/", async (route) => {
    if (!intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: /^Review payment/ }).click();
  await page.getByRole("button", { name: "Exact amount", exact: true }).click();
  await page.getByRole("button", { name: /^Confirm payment/ }).click();
  await expect(
    page.getByRole("button", { name: "Confirm pending sale", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Confirm pending sale", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sale complete", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(productButton).toContainText(`${before - 1} available`);
});

test("BOX stock, bKash checkout, branding snapshots, thermal print and Bangladesh invoice PDF", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await register(page);
  const session = await (
    await page.request.get("/api/v1/auth/session/")
  ).json();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "csrftoken",
  )!.value;
  const headers = {
    "X-CSRFToken": csrf,
    "X-Branch-ID": session.branches[0].id,
    "Idempotency-Key": randomUUID(),
  };
  const created = await page.request.post("/api/v1/catalog/", {
    headers,
    data: {
      name: "Boxed Gauze",
      generic: "Sterile gauze",
      strength: "10 cm",
      form: "Supplies",
      manufacturer: "Test supplier",
      sku: "BOX-GAUZE",
      barcode: "BOX12345",
      price_minor: 125,
      packaging: {
        base_unit: "PIECE",
        outer_name: "BOX",
        inners_per_outer: 10,
        allow_break_outer: true,
      },
    },
  });
  expect(created.status()).toBe(201);
  const product = await created.json();
  const received = await page.request.post("/api/v1/inventory/receive/", {
    headers,
    data: {
      product_id: product.id,
      batch_number: "BOX-BATCH",
      expiry: "2030-12-31",
      quantity: 10,
      unit_id: product.units.find((u: { name: string }) => u.name === "BOX").id,
      expected_base_units: 10,
      unit_cost_minor: 80,
      supplier: "Test supplier",
      reference: "BOX-DELIVERY",
    },
  });
  expect(received.status()).toBe(201);
  await page.goto("/inventory");
  await page
    .getByRole("button", { name: "View Boxed Gauze", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Configure boxes / strips", exact: true })
    .click();
  await page.getByLabel("Base units per BOX").fill("10");
  await page
    .getByRole("button", { name: "Save packaging", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("link", { name: "Receipt & invoice", exact: true })
    .click();
  await page
    .getByLabel("Shop name", { exact: true })
    .fill("Dhaka Care Pharmacy");
  await page
    .getByLabel("Shop address", { exact: true })
    .fill("Sample Road, Dhanmondi, Dhaka");
  await page.getByLabel("Shop phone", { exact: true }).fill("01700 000000");
  await page.getByLabel("Paper width").click();
  await page.getByRole("option", { name: "58 mm", exact: true }).click();
  await page.getByLabel("Default staff name").fill("Default Staff");
  await page.getByLabel("Default created by").fill("Default Creator");
  await page
    .getByLabel("Invoice terms (A4 only)")
    .fill("Please retain this invoice for your records.");
  await expect(page.getByLabel("Enable Scan to Pay QR")).not.toBeChecked();
  await page
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Print settings saved");
  await page.reload();
  await expect(page.getByLabel("Shop name", { exact: true })).toHaveValue(
    "Dhaka Care Pharmacy",
  );
  await expect(page.getByLabel("Paper width")).toContainText("58 mm");
  await page.screenshot({
    path: ".local/screenshots/print-settings.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Point of sale POS" }).click();
  await page
    .getByRole("button", { name: "Add Boxed Gauze to cart", exact: true })
    .click();
  const unit = page.getByLabel("Selling unit for Boxed Gauze");
  await unit.click();
  await page
    .getByRole("option", { name: "BOX · 10 units · ৳12.50", exact: true })
    .click();
  await page.getByLabel("Quantity of Boxed Gauze").fill("2");
  await page.getByText("Customer & invoice details", { exact: false }).click();
  await page.getByLabel("Staff name", { exact: true }).fill("Sales Assistant");
  await page.getByLabel("Created by", { exact: true }).fill("Counter Two");
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Sample Customer");
  await page.getByLabel("Customer phone", { exact: true }).fill("01700000000");
  await page
    .getByLabel("Customer address", { exact: true })
    .fill("Dhaka, Bangladesh");
  await page
    .getByLabel("Invoice remarks", { exact: true })
    .fill("Two sealed boxes");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: /^Review payment/ }).click();
  await page.getByRole("button", { name: "bKash", exact: true }).click();
  await page.getByLabel("bKash transaction ID").fill("TEST-MOBILE-123");
  await expect(
    page.getByRole("button", { name: /^Confirm payment/ }),
  ).toBeDisabled();
  await page
    .getByLabel("I verified ৳25.00 in the bKash merchant account")
    .check();
  await page
    .getByRole("button", { name: "Confirm payment · ৳25.00", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    page.getByRole("heading", { name: "Sale complete", exact: true }),
  ).toBeVisible();
  const thermal = page.getByRole("article", { name: "Thermal receipt" });
  await expect(
    thermal.getByRole("cell", { name: "2 BOX", exact: true }),
  ).toBeVisible();
  await expect(thermal).toContainText("Dhaka Care Pharmacy");
  await expect(thermal).toContainText("Sample Customer");
  await expect(thermal).toContainText("Staff name: Sales Assistant");
  await expect(thermal).toContainText("Created by: Counter Two");
  await expect(
    thermal.getByRole("img", { name: /^Receipt barcode/ }),
  ).toBeVisible();
  await expect(thermal).toContainText("Original Copy");
  await expect(thermal).toContainText("bKash");
  await expect(thermal).toContainText("TEST-MOBILE-123");
  await expect(thermal.getByText("SCAN TO PAY")).toHaveCount(0);
  await expect(thermal).not.toContainText("Terms & conditions");
  await thermal.screenshot({ path: ".local/screenshots/thermal-58.png" });
  await page.evaluate(() => {
    window.print = () => {};
  });
  await dialog
    .getByRole("button", { name: "Print thermal receipt", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator(".print-surface style").evaluate((el) =>
        Array.from((el as HTMLStyleElement).sheet?.cssRules || [])
          .map((r) => r.cssText)
          .join(""),
      ),
    )
    .toContain("size: 58mm");
  await page.pdf({
    path: ".local/screenshots/thermal-58.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await dialog
    .getByRole("button", { name: "Invoice copy", exact: true })
    .click();
  const invoice = page.getByRole("article", { name: "A4 invoice copy" });
  await expect(invoice).toContainText("Sales Invoice · Customer Copy");
  await expect(invoice).toContainText("Twenty Five Taka Only");
  await expect(invoice).toContainText("Two sealed boxes");
  await expect(invoice).not.toContainText("Bank Details");
  await expect(invoice).not.toContainText("GSTIN");
  await expect(invoice).not.toContainText("UPI");
  await invoice.screenshot({ path: ".local/screenshots/invoice-copy.png" });
  await dialog
    .getByRole("button", { name: "Print / Save invoice PDF", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator(".print-surface style").evaluate((el) =>
        Array.from((el as HTMLStyleElement).sheet?.cssRules || [])
          .map((r) => r.cssText)
          .join(""),
      ),
    )
    .toContain("size: a4");
  await page.pdf({
    path: ".local/screenshots/invoice-copy.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Boxed Gauze to cart", exact: true }),
  ).toContainText("80 available");
  await page
    .getByRole("link", { name: "Receipt & invoice", exact: true })
    .click();
  await page.getByLabel("Paper width").click();
  await page.getByRole("option", { name: "80 mm", exact: true }).click();
  await page.getByLabel("Default staff name").fill("Sample Staff");
  await page.getByLabel("Default created by").fill("Sample Creator");
  await page
    .getByRole("article", { name: "Thermal receipt" })
    .screenshot({ path: ".local/screenshots/thermal-80.png" });
  await page
    .getByRole("button", { name: "Print thermal receipt", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator(".print-surface style").evaluate((el) =>
        Array.from((el as HTMLStyleElement).sheet?.cssRules || [])
          .map((r) => r.cssText)
          .join(""),
      ),
    )
    .toContain("size: 80mm");
  await page.pdf({
    path: ".local/screenshots/thermal-80.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.getByLabel("Shop name", { exact: true }).fill("Updated Shop");
  await page
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Print settings saved");
  await page
    .getByRole("link", { name: "Sales & receipts", exact: true })
    .click();
  await page
    .getByRole("button", { name: /View receipt/ })
    .first()
    .click();
  await expect(
    page.getByRole("article", { name: "Thermal receipt" }),
  ).toContainText("Dhaka Care Pharmacy");
});

test("long invoice repeats item headings and prints all lines", async ({
  page,
}) => {
  await demo(page);
  await page.route(/\/api\/v1\/sales\/[0-9a-f-]+\/$/, async (route) => {
    const response = await route.fetch();
    const receipt = await response.json();
    receipt.lines = Array.from({ length: 80 }, (_, i) => ({
      ...receipt.lines[0],
      id: `print-${i}`,
      name: `Print sample item ${i + 1} with a long medicine description and strength`,
      quantity: 1,
      base_units: 1,
      unit_name: "UNIT",
      unit_price_minor: 100,
      total_minor: 100,
    }));
    receipt.total_minor = 8000;
    receipt.tendered_minor = 8000;
    receipt.change_minor = 0;
    receipt.amount_in_words = "Eighty Taka Only";
    await route.fulfill({ response, json: receipt });
  });
  await page
    .getByRole("link", { name: "Sales & receipts", exact: true })
    .click();
  await page
    .getByRole("button", { name: /View receipt/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Invoice copy", exact: true }).click();
  await expect(page.locator(".invoice-items tbody tr")).toHaveCount(80);
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page
    .getByRole("button", { name: "Print / Save invoice PDF", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator(".print-surface style").evaluate((el) =>
        Array.from((el as HTMLStyleElement).sheet?.cssRules || [])
          .map((r) => r.cssText)
          .join(""),
      ),
    )
    .toContain("size: a4");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".app-shell")).toBeHidden();
  await expect(
    page.locator(".print-surface .invoice-items tbody tr"),
  ).toHaveCount(80);
  await page.pdf({
    path: ".local/screenshots/invoice-multipage.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
});

test("POS grid scrolls independently, compact cart, draft recovery and responsive workspace", async ({
  page,
}) => {
  await demo(page);
  // A large catalog fixture exercises layout without changing business inventory.
  await page.route("**/api/v1/catalog/?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const source = data.results.filter(
      (p: { prescription_required: boolean; stock: number }) =>
        !p.prescription_required && p.stock > 0,
    );
    data.results = Array.from({ length: 120 }, (_, i) => ({
      ...source[i % source.length],
      id: `layout-${i}`,
      name: `Layout product ${String(i).padStart(3, "0")}`,
    }));
    data.count = data.results.length;
    await route.fulfill({ response, json: data });
  });
  await page.getByRole("link", { name: "Point of sale POS" }).click();
  await expect(page.locator(".product-card")).toHaveCount(120);
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1600, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1280, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    const fixed = [
      ".topbar",
      ".sidebar",
      ".page-heading",
      ".pos-search-panel",
      ".category-tabs",
      ".cart-panel",
      ".cart-checkout",
    ];
    const before = await Promise.all(
      fixed.map((s) => page.locator(s).boundingBox()),
    );
    await page.locator(".catalog-scroll").hover();
    await page.mouse.wheel(0, 100000);
    await expect
      .poll(() =>
        page.locator(".catalog-scroll").evaluate((el) => el.scrollTop),
      )
      .toBeGreaterThan(0);
    await page.mouse.wheel(0, 100000);
    const after = await Promise.all(
      fixed.map((s) => page.locator(s).boundingBox()),
    );
    expect(after).toEqual(before);
    expect(
      await page.evaluate(() => ({
        scroll: window.scrollY,
        height: document.documentElement.scrollHeight,
        viewport: innerHeight,
        width: document.documentElement.scrollWidth,
        vw: innerWidth,
      })),
    ).toEqual({
      scroll: 0,
      height: viewport.height,
      viewport: viewport.height,
      width: viewport.width,
      vw: viewport.width,
    });
    await expect(
      page.getByRole("button", { name: /^Review payment/ }),
    ).toBeInViewport();
  }
  await page.locator(".catalog-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  for (let i = 0; i < 12; i++)
    await page
      .getByRole("button", {
        name: `Add Layout product ${String(i).padStart(3, "0")} to cart`,
        exact: true,
      })
      .click();
  await expect(page.locator(".cart-line")).toHaveCount(12);
  await page.setViewportSize({ width: 1280, height: 720 });
  const bounds = (await page.locator(".cart-lines").boundingBox())!;
  expect(bounds.height).toBeGreaterThan(180);
  await expect(
    page.getByRole("button", { name: /^Review payment/ }),
  ).toBeInViewport();
  expect(
    await page
      .locator(".cart-lines")
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await page.screenshot({ path: ".local/screenshots/pos-stationary-1280.png" });
  await page
    .getByRole("link", { name: "Sales & receipts", exact: true })
    .click();
  await page.getByRole("link", { name: "Point of sale POS" }).click();
  await expect(page.locator(".cart-line")).toHaveCount(12);
  await page.reload();
  await expect(page.locator(".cart-line")).toHaveCount(12);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".pos-mobile-tabs")).toBeVisible();
  await page.getByRole("button", { name: /^Current sale \(12\)/ }).click();
  await expect(
    page.getByRole("button", { name: /^Review payment/ }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/screenshots/pos-mobile-cart.png" });
});

test("receipt preview is the only scroll owner at desktop and zoom-equivalent sizes", async ({
  page,
}) => {
  await demo(page);
  await page
    .getByRole("link", { name: "Sales & receipts", exact: true })
    .click();
  await page
    .getByRole("button", { name: /^View receipt/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1024, height: 576 },
    { width: 853, height: 480 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const format of ["Thermal receipt", "Invoice copy"]) {
      await page.getByRole("button", { name: format, exact: true }).click();
      const header = (await dialog.locator(".modal-heading").boundingBox())!;
      const footer = (await dialog.locator(".modal-actions").boundingBox())!;
      const rect = (await dialog.boundingBox())!;
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
      expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height);
      expect(
        await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight),
      ).toBe(true);
      await dialog.locator(".document-preview").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      expect(await dialog.locator(".modal-heading").boundingBox()).toEqual(
        header,
      );
      expect(await dialog.locator(".modal-actions").boundingBox()).toEqual(
        footer,
      );
      await expect(
        dialog.getByRole("button", { name: "Done", exact: true }),
      ).toBeInViewport();
    }
    if (viewport.width === 1280)
      await page.screenshot({
        path: ".local/screenshots/receipt-single-scroll.png",
      });
  }
});

test("workspace owner edits persist and navigation has room for management", async ({
  page,
}) => {
  await register(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit workspace", exact: true })
    .click();
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill("Updated Pharmacy");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("button", { name: "Edit Test Branch", exact: true })
    .click();
  await page.getByLabel("Branch name", { exact: true }).fill("Main Pharmacy");
  await page.getByLabel("Address", { exact: true }).fill("Dhaka, Bangladesh");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  await expect(page.locator(".workspace-picker")).toContainText(
    "Updated Pharmacy",
  );
  await expect(
    page.getByRole("combobox", { name: "Select branch" }),
  ).toContainText("Main Pharmacy");
  await expect(page.locator(".care-card")).toHaveCount(0);
});

test("owner removes a medicine then resets to an empty workspace with safe response retry", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { password } = await register(page);
  const session = await (
    await page.request.get("/api/v1/auth/session/")
  ).json();
  const headers = {
    "X-CSRFToken": (await page.context().cookies()).find(
      (c) => c.name === "csrftoken",
    )!.value,
    "X-Branch-ID": session.branches[0].id,
    "Idempotency-Key": randomUUID(),
  };
  const created = await page.request.post("/api/v1/catalog/", {
    headers,
    data: {
      name: "Removable test medicine",
      generic: "Test ingredient",
      strength: "10 mg",
      form: "Tablets",
      manufacturer: "Test supplier",
      sku: "REMOVE-TEST",
      barcode: "REMOVE123",
      price_minor: 100,
    },
  });
  expect(created.status()).toBe(201);
  const product = await created.json();
  const received = await page.request.post("/api/v1/inventory/receive/", {
    headers,
    data: {
      product_id: product.id,
      batch_number: "REMOVE-BATCH",
      expiry: "2030-12-31",
      quantity: 10,
      unit_cost_minor: 60,
      supplier: "Test supplier",
      reference: "REMOVE-DELIVERY",
    },
  });
  expect(received.status()).toBe(201);
  await page.goto("/catalog");
  await page
    .getByRole("button", {
      name: "Remove Removable test medicine from catalog",
      exact: true,
    })
    .click();
  await expect(page.locator(".maintenance-impact")).toContainText(
    "10 base units",
  );
  await page.getByLabel("Type REMOVE-TEST to confirm").fill("REMOVE-TEST");
  await page.getByLabel("Reason for removal").fill("Test catalog clean up");
  await page
    .getByRole("button", { name: "Remove medicine", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Remove Removable test medicine from catalog",
    }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Stock ledger", exact: true }).click();
  await expect(page.locator("tbody")).toContainText("Removed");
  await page
    .getByRole("button", { name: "Reset workspace", exact: true })
    .click();
  await page
    .getByLabel("Type workspace name to confirm")
    .fill(session.tenant.name);
  await page.getByLabel("Current password", { exact: true }).fill(password);
  let dropped = false;
  await page.route("**/api/v1/settings/reset/", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Reset to empty workspace", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Unable to reach");
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Confirm reset status", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const replacement = await (
    await page.request.get("/api/v1/auth/session/")
  ).json();
  expect(replacement.tenant.id).not.toBe(session.tenant.id);
  expect(
    (await (await page.request.get("/api/v1/catalog/")).json()).count,
  ).toBe(0);
  expect(
    (await (await page.request.get("/api/v1/inventory/ledger/")).json()).count,
  ).toBe(0);
  expect(replacement.mfa.enabled).toBe(true);
});

test("unit changes reset quantities and a changed pack price preserves the cart for review", async ({
  page,
}) => {
  await register(page);
  const session = await (
    await page.request.get("/api/v1/auth/session/")
  ).json();
  const headers = {
    "X-CSRFToken": (await page.context().cookies()).find(
      (c) => c.name === "csrftoken",
    )!.value,
    "X-Branch-ID": session.branches[0].id,
    "Idempotency-Key": randomUUID(),
  };
  const packaging = {
    base_unit: "TABLET",
    inner_name: "STRIP",
    inner_size: 10,
    outer_name: "BOX",
    inners_per_outer: 10,
    allow_break_inner: true,
    allow_break_outer: true,
    inner_price_minor: 900,
  };
  const response = await page.request.post("/api/v1/catalog/", {
    headers,
    data: {
      name: "Package Test Tablet",
      generic: "Test ingredient",
      strength: "500 mg",
      form: "Tablets",
      manufacturer: "Test supplier",
      sku: "PACK-TEST",
      barcode: "PACK123",
      price_minor: 125,
      packaging,
    },
  });
  expect(response.status()).toBe(201);
  const product = await response.json();
  const box = product.units.find((u: { name: string }) => u.name === "BOX");
  expect(
    (
      await page.request.post("/api/v1/inventory/receive/", {
        headers,
        data: {
          product_id: product.id,
          unit_id: box.id,
          expected_base_units: 100,
          batch_number: "PACK-BATCH",
          expiry: "2030-12-31",
          quantity: 1,
          unit_cost_minor: 60,
          supplier: "Test supplier",
          reference: "PACK-DELIVERY",
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/pos");
  const search = page.getByLabel("Scan or search medicine");
  await search.fill("Package Test");
  await search.press("Enter");
  await expect(page.locator(".cart-line")).toHaveCount(0);
  await search.fill("PACK123");
  await search.press("Enter");
  await search.fill("PACK123");
  await search.press("Enter");
  await expect(page.getByLabel("Quantity of Package Test Tablet")).toHaveValue(
    "2",
  );
  await page.getByLabel("Selling unit for Package Test Tablet").click();
  await page
    .getByRole("option", { name: "STRIP · 10 units · ৳9.00", exact: true })
    .click();
  await expect(page.getByLabel("Quantity of Package Test Tablet")).toHaveValue(
    "1",
  );
  await expect(page.locator(".cart-total")).toContainText("৳9.00");
  expect(
    (
      await page.request.put(`/api/v1/catalog/${product.id}/units/`, {
        headers,
        data: { ...packaging, inner_price_minor: 1000 },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: /^Review payment/ }).click();
  await page.getByLabel("Cash received (৳)").fill("20");
  await page.getByRole("button", { name: /^Confirm payment/ }).click();
  await expect(
    page.getByRole("button", {
      name: "Review updated prices & stock",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Review updated prices & stock", exact: true })
    .click();
  await expect(page.locator(".cart-total")).toContainText("৳10.00");
  await page.getByRole("button", { name: /^Review payment/ }).click();
  await page.getByRole("button", { name: /^Confirm payment/ }).click();
  await expect(
    page.getByRole("heading", { name: "Sale complete", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Thermal receipt" }),
  ).toContainText("1 STRIP");
});
