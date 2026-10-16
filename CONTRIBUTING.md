# Contributing

Use a private repository and short reviewable changes. Domain rules belong in
application services. Views validate and authorize input; they do not own stock
or money mutations. Never trust a browser price, approval flag, or tenant ID.

All amounts are integer paisa. Only the backend allocates batches. Every stock
change must have a corresponding signed ledger entry. Posted records are
append-only; future refunds must use explicit reversal records.

Critical writes require a branch lock, atomic transaction, operation key, and
audit event. Add adversarial tests for new authorization and financial paths.
Run the checks in README before review. Schema changes need migrations, a data
recovery plan, and integration tests on PostgreSQL. Keep the generated OpenAPI
contract current. Use Ruff for Python and Prettier for TypeScript/CSS.

Never check in credentials, patient records, database dumps, or access tokens.
Do not add placeholders that simulate a completed payment, compliance result,
clinical decision, or a deployed feature.
