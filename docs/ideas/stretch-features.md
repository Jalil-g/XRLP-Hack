# Idea: Stretch features backlog

> **Status 2026-10-24:** item 1 (Ledger) dropped; 2 (private vault) in XRPL-08; 3 (retainage) and 6 (photo forensics) partly in the test suite; 4 (rotation) replaced by AI assignment (VER-13); 7 (live ledger view) = WEB-05.

- **Author / agent:** Sean's agent
- **Status:** proposed

1. **Ledger-signed inspector approval** — inspector signs attestation / multisig on a Ledger device. Targets the Ledger bounty
   ("human approval for high-risk actions"). Emulator: Speculos.
2. **Private vault via Permissioned Domain** — only `KYC_INVESTOR` credential holders can deposit. Answers the regulation question on-chain.
3. **Retainage escrow** — hold back 5–10% of each milestone in a time-locked escrow until completion (mirrors real construction practice).
4. **Inspector rotation** — platform assigns inspectors randomly per milestone; prevents builder capture.
5. **Builder reputation score** — on-time milestone history feeds the AI's risk tier → stricter evidence for new builders.
6. **Photo forensics** — perceptual hash dedupe across all projects to catch reused photos; EXIF GPS vs site geofence.
7. **Live investor ledger view** — every dollar's path with explorer links; share value ticking up as repayments land.
