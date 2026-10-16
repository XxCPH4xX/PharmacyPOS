# First pharmacy workflow

1. **Create workspace** creates an organization and first branch. Sample records
   are available through **Explore demo workspace** in local development.
2. In **Medicine catalog**, add a medicine's identity, SKU, barcode, individual
   unit price, and reorder level. Check prescription restrictions carefully.
3. In **Inventory → Receive stock**, select the medicine and enter batch number,
   expiry, unit quantity and cost, supplier, rack, and a unique delivery reference.
   For multiple delivery lines, include a line identifier in the reference.
4. In **Point of sale**, press **F2** to focus barcode/name search. A keyboard
   scanner followed by Enter adds a matching barcode to the cart. Change unit
   quantities and enter cash received; leaving cash blank records exact payment.
5. **Complete sale** validates prices and stock on the server. It allocates the
   earliest eligible batch, records payment, and displays a printable receipt.
   Printing uses the browser; actual thermal printer models are not certified.
6. Review **Sales & receipts**, **Stock ledger**, and **Reports & analytics**.
   CSV exports contain integer paisa amounts, so divide by 100 for BDT.
7. Owners can add a branch in **Settings**. Switch branches at the top of the
   workspace. Stock and sales remain scoped to that branch.

Only cash and individual units are supported in this release. Prescription-only
products are visible but blocked at checkout. Taxes, discounts, electronic
payments, refunds, and offline dispensing are not enabled.
