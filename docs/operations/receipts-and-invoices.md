# Receipts, selling units, and invoices

Updated 16 October 2026. The thermal template replaces the earlier Apna-style
layout with the user's latest retail-receipt reference. It uses a large serif
shop name, a locally bundled Roboto Condensed body, aligned ITEM / QTY / PRICE /
AMOUNT BDT columns, separate total/payment/change sections, a Code 128 receipt
barcode, an optional shop policy, and an Original Copy footer. It uses actual
shop and transaction data, not the sample retailer's identity or return policy.

## Configure and use

1. Open **Receipt & invoice** as an organization owner. Set shop name, address,
   phone/email, optional BIN and drug licence, and upload a PNG/JPEG/WebP logo.
   Choose 58 or 80 mm paper and font size. A live preview uses fictional data.
2. **Default staff name** and **Default created by** control printed names.
   Leave blank to use the signed-in user. In POS, open **Customer & invoice
   details** to override either for one sale. The actual cashier and audit actor
   never change. Posted receipt names and branding are immutable snapshots.
3. The receipt barcode is enabled by default. **Enable Scan to Pay QR** is off
   by default. To enable it, paste the exact provider-issued merchant payload
   or payment URL, then save. The QR only encodes that value; it does not charge
   anyone or confirm receipt of funds. No UPI or bank-details block is included.
4. Set a **Thermal receipt footer** for your shop's own policy/message. A4 terms
   are separate. The latest reference supersedes the earlier request to stop
   immediately after Scan to Pay; the new layout ends with Original Copy.
5. In Inventory, open a medicine and **Configure boxes / strips**. Enter the
   actual individual units per BOX, STRIP, or PACK. Stock is still received and
   counted in individual units. Prices multiply the individual-unit price; a
   separate discounted package price is not implemented.
6. At checkout, choose the selling unit and quantity. Example: 1 BOX = 10 units,
   2 BOX deducts 20 units and prints 2 BOX. Mixed batches are allocated by FEFO;
   box availability represents enough eligible individual units, not tracking
   whether a manufacturer's box remains physically sealed.
7. Click the customer card to choose an **Existing customer**, save a **New
   customer**, or **Continue as walk-in**. Saved customers are searchable by
   name or phone within the current branch, with server pagination. Bangladesh
   mobile numbers in local / +880 formats match the same contact; phone is
   optional. New customer saves can be safely retried after connection loss.
   Earlier invoice-only customer text is not automatically merged into profiles.
   Selecting a saved customer fills their name, phone, address and optional BIN;
   the server snapshots those details when posting the sale.
8. Click **Review payment** to open the payment dialog. Cash payments require
   an amount: type it, use the keypad or select **Exact amount** / a suggested
   cash amount. The large panel shows change to return, or the amount still due
   in amber. Choose Cash, bKash, or Nagad. For mobile money, verify the exact amount in the
   merchant account, enter the transaction ID, and tick the verification box.
   The app records that staff confirmation; no live provider verification exists.
9. From the completed sale or Sales & receipts, choose **Print thermal receipt**
   or **Print / Save invoice PDF**. In the browser print dialog choose the
   installed printer or Save as PDF. Use matching paper, 100% scale, no browser
   headers/footers. Thermal output uses a measured continuous page; A4 uses
   10 mm margins. Actual driver roll handling and hardware need local testing.

Saved print settings apply to new sales. Existing sales keep their original
customer, shop, unit and name snapshots. Legacy sales from before print profiles
use their existing tenant/branch/cashier data. Change is shown as the positive
amount returned to the customer. Mobile payments have no cash change.

## Bangladesh invoice choices and sources

The A4 document is **Sales Invoice · Customer Copy**, with BDT totals, Asia/Dhaka
date/time, invoice number, shop and optional BIN/drug-licence details, buyer
contact/address and optional BIN, item quantities and unit prices, batch/expiry,
payment type/reference, amount in words, optional terms/remarks and signatory.
It omits GSTIN, FSSAI, CGST/SGST, UPI, bank details and social QR promotions.

The official [NBR VAT Rules](https://nbr.gov.bd/uploads/rules/Authentic_English_Text_VAT_Rules_2016.pdf)
provide the VAT-6.3 invoice framework (Rule 40 and the prescribed form), including
seller/buyer information where applicable, invoice timing/identity, supply
quantity/value and tax information. See also the
[NBR VAT FAQ](https://nbr.gov.bd/faq/vat-faq/eng/contents/e-services/vatcalculator/eng).
Those requirements informed the field selection; they do not make the current
sales receipt a statutory tax invoice. Tax rules were deferred, so VAT is
explicitly **Not calculated** and A4 states it is **not a Mushak 6.3 VAT invoice**.
No rates, exemptions, medicine tax treatment, or compliance certification are
assumed. A reviewed tax module and required prescribed fields must be completed
before claiming statutory VAT-invoice support.

The earlier [Apna reference](https://apnabillbook.com/invoice-formats/thermal-bill-format)
still informs the A4 structure. The latest user-supplied screenshot is the
thermal layout reference. No retailer branding or return policy was copied.
