# What we don't claim

## We never say

- **"Trustless AI."** The AI runs a published suite, mostly deterministic checks, and every result is attested on-chain. It's still our
  service. Its judgement checks can only turn a green into `needs_human`, which a named operator resolves with a signed reason.
- **"Ledger-enforced release."** The ledger enforces where a milestone's money can go (this builder, or back to the project account) and
  when the escrow expires. *When* it's released is up to our release service, which holds the escrow preimages and finishes only after the
  suite is green and attested on-chain. Ledger-enforced release would need Smart Escrows (XLS-100): roadmap.
- **"Mainnet-ready."** Single Asset Vault and the Lending Protocol run on devnet only. They aren't on testnet or mainnet; the validator
  vote opened in Oct 2026.
- **"Automatic refunds to investors."** An expired escrow goes back to the project account, not to investors. Our keeper (or anyone)
  submits `EscrowCancel`, the project account repays the vault with `LoanPay`, and investors redeem from the vault's `RedemptionDate`.
- **That XRPL removes credit risk.** Money already released to a builder is a loan, and the builder can default. First-loss cover absorbs
  the first part. The default flow (`LoanManage`) is designed, not built.

## How the demo differs from production

- **Devnet only**, with throwaway faucet wallets. Nothing touches testnet or mainnet.
- **Mock RLUSD.** On devnet "RLUSD" is an IOU from our own `issuer` account, not Ripple's RLUSD.
- **Mock registries.** Licence, insurance, entity, sanctions and permit checks run against mock registries, labelled MOCK in the UI.
  `KYC_INVESTOR` is a credential we issue; no KYC provider is integrated.
- **Demo keys on one server.** The platform, release service, trustee and AI keys (and the inspector's, unless it was imported into the
  inspector app) sit on one demo server. That's disclosed, and it means the demo's trustee isn't independent. Inspector keys are software
  keys; no hardware wallet.
- **Share price rises as interest is repaid, not at `LoanSet`.** Devnet (rippled 3.4.1) leaves `Vault.AssetsTotal` at the principal after
  `LoanSet` and adds interest when `LoanPay` lands: 30 000 → 30 000.0257 in our v2 run. See `docs/decisions.md` (10-24) and
  [xrpl-primitives.md](xrpl-primitives.md).
- **Not an offer to invest.** Vault shares backed by loans are securities; a launch would be accredited-only (Reg D 506(c)).
