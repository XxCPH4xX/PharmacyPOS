# Security

This release is for local engineering and supervised development. Do not use it
for live dispensing or customer/patient data until the documented launch gates
are met. Known gaps are recorded in `docs/security/threat-model.md`.

Report suspected vulnerabilities privately to the repository owner using the
private security reporting channel configured on the eventual private remote.
No monitored security email or public disclosure program has been configured.
Do not include credentials, patient information, or full database exports in
issues. Provide a minimal fictional reproduction and affected commit/version.

If a secret is exposed, revoke it and invalidate associated sessions before
removing it from history. Preserve access logs and audit evidence. Test fixes
against other tenants and branches, not just the original failing request.
