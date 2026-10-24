# Devnet proof — full money path on real XRPL (2026-10-24, ~22:05–22:25 UTC)

Run by Jalil's agent with `pnpm --filter @xrlp/xrpl demo` from `scaffold/xrpl` (`DEMO_SUBSCRIPTION_S=60 DEMO_M3_CANCEL_S=150`), fresh
faucet wallets. Every row is a real devnet transaction. **Caveat:** this run still uses the scaffold's v1 signer list (inspectors w2 / AI w1 /
platform w1) and script-generated conditions; XRPL-05/06 + CORE-12 move it to the v2 model. The ledger mechanics proven here are unchanged by v2.

What this proves on-chain: mock RLUSD issuance with trust-line locking · credentials (create + accept) · SPV with SignerList and master key
disabled · **closed-ended vault + LoanBroker + first-loss cover deposit** · three `VaultDeposit`s with share tokens · subscription gate passing ·
**`LoanSet` countersigned by a master-disabled multisig borrower** · three token escrows with conditions, SPV liquid balance 0 · three
attestations then **`EscrowFinish` paying the builder 9,000 RLUSD** · **`EscrowCancel` after expiry back to the SPV** · sub-periodic `LoanPay`
rejected (`tecINSUFFICIENT_PAYMENT`, as the protocol notes predicted) · **overpayment `LoanPay` of the refund** reducing principal 30,000 → 21,000
and vault `AssetsAvailable` 0 → 9,000. `VaultWithdraw` skipped (closed-ended: reopens at Redemption).

Accounts (devnet, throwaway): issuer `rHBhCKQcS9JGjAsP6c6yU7twrKTvT7prC7` · platform `rnDR5GaLWjADKkt1yQrQz6aEKApoWS2wq4` · builder
`rP7q7fZKyCrngZroNwj2PK8BUgy69cMvmY` · SPV `rpKruBV7219Vm6e4zuvtwLELMj5TWyGPX5` · vault `6957BD97E5B080162BB6D577BBA735D88828A89A5AFCDA4E68271FDCE5320405` ·
loan `B427F71DC62ACDA8505C453DEBE6C2E7862040B452150BFF44380DDCDFB6B5E7`.

| # | step                                                    | result | explorer |
|---|---------------------------------------------------------|--------|----------|
| 1 | bootstrap #1                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/057F7717970F51FF1C190C078CE21DC35F471F3F3B7B08E38E1003AFCD1F00BD |
| 2 | bootstrap #2                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/22398C9E9E4FA3499F61C86042B7E587783EC9E501714067AE5CB4A5D1906C30 |
| 3 | bootstrap #3                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/7410B35EB28D4D7209617E56A41466D51DFB4BE8214A54A287297D70C842F033 |
| 4 | bootstrap #4                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/A04DDDF99F214D7F4868DBBA7682D694C5BC4E5A60CC6B2B09C668EAB2735BC3 |
| 5 | bootstrap #5                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/A551BC031C8A39606BE402C30C4065534AAF2ACDEC13077D7C72B75B28DECB84 |
| 6 | bootstrap #6                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/386CA273C23CFCCAD73FA880B43A0E7B5B50B603C56F13D5CD1325DB0F69C3DD |
| 7 | bootstrap #7                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/302D08F70244601DF0D412563996220E5B1DFA451028A3223508963B8EB9101B |
| 8 | bootstrap #8                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/F9A8C306B1E0594305D57884F4733B0ED6F04C5D6C183BE2848ACE5CB9D42C36 |
| 9 | bootstrap #9                                            | tesSUCCESS | https://devnet.xrpl.org/transactions/16CE2AB3BFF0B59ADCC87D0819FAFD10072BDE1453072E38673B72EF03EC75B4 |
| 10 | bootstrap #10                                           | tesSUCCESS | https://devnet.xrpl.org/transactions/32CAC9EEFB8A0CB2764336AB99A291055DC016B751E58568A3D919468A6EC693 |
| 11 | bootstrap #11                                           | tesSUCCESS | https://devnet.xrpl.org/transactions/21A7CB1F561F82A1EE75C72D89FE74DA909515FB39F1A45332715372B362E318 |
| 12 | bootstrap #12                                           | tesSUCCESS | https://devnet.xrpl.org/transactions/3C15591344A609F6696D619674D6CAF15C672AFF83848A2FE0048C8D007FB707 |
| 13 | bootstrap #13                                           | tesSUCCESS | https://devnet.xrpl.org/transactions/B5DEDEDE998581CD2755CC76A3CB665CF1EFC0613DEAFA91C04205C60B754B63 |
| 14 | bootstrap #14                                           | tesSUCCESS | https://devnet.xrpl.org/transactions/0529F2E0018C49B45A466F2240C9340BB381CC7610C755468EED2CF8BDE07AEA |
| 15 | CredentialCreate VERIFIED_BUILDER                       | tesSUCCESS | https://devnet.xrpl.org/transactions/63167ECBFA8693B7721B266A01073F605D118D697EC9A1C84645637B06E28E71 |
| 16 | CredentialAccept VERIFIED_BUILDER                       | tesSUCCESS | https://devnet.xrpl.org/transactions/86BDCD9383AE73A2E71818D514353F9FC71369E4C031B1A9378FDFF86636708A |
| 17 | CredentialCreate KYC_INVESTOR investor1                 | tesSUCCESS | https://devnet.xrpl.org/transactions/A6EE0F14D98A555F1054694F811F2FCE950AEBAE96F420786466A8EFDEEA37E0 |
| 18 | CredentialAccept KYC_INVESTOR investor1                 | tesSUCCESS | https://devnet.xrpl.org/transactions/23CAD8431D990F09F35A5671C4FCE857C2D98DC70AEFBAB18A4EB5A8485C70EE |
| 19 | CredentialCreate KYC_INVESTOR investor2                 | tesSUCCESS | https://devnet.xrpl.org/transactions/D676BBD7381A0254F949DA7B034D174CF0A1A74FF91E2A7000A8D52FCEDEF5FE |
| 20 | CredentialAccept KYC_INVESTOR investor2                 | tesSUCCESS | https://devnet.xrpl.org/transactions/A7AD0E065BACD2E8ACE10B54CA0CB78DFE1966C24DD48E06C945B8127362D7E1 |
| 21 | CredentialCreate KYC_INVESTOR investor3                 | tesSUCCESS | https://devnet.xrpl.org/transactions/974878B933ADFCD9759FFFC64740FF4128187585AF737F19D777EE6EBE33284E |
| 22 | CredentialAccept KYC_INVESTOR investor3                 | tesSUCCESS | https://devnet.xrpl.org/transactions/8458702D0D178B3C14DB2FCC26EEA82D0A27A8CACB838A934111ADB655050835 |
| 23 | spvTrustSet                                             | tesSUCCESS | https://devnet.xrpl.org/transactions/4C4C5B11CBE5A1D2665F55B3FBD45AE3C706129B0CC87AABFCB1027BFAC17364 |
| 24 | spvSignerListSet                                        | tesSUCCESS | https://devnet.xrpl.org/transactions/A0366E83C716995000C00B4DEFC6F3389103F0563E9E3894F7113C16D46E2F38 |
| 25 | spvDisableMaster                                        | tesSUCCESS | https://devnet.xrpl.org/transactions/22E25C30FA59BE790D383E4229324E3D7A97D47E399BB900743B1D9E3FAF6B7F |
| 26 | vaultCreate                                             | tesSUCCESS | https://devnet.xrpl.org/transactions/69B6388488D3768806BED6F7CF800DB94065F9BBC7F65B75BC4A02A15586A2CA |
| 27 | loanBrokerSet                                           | tesSUCCESS | https://devnet.xrpl.org/transactions/16C8EEDAFA7563C4476EAEF622036D613511799A1F0E5C154AD674C9DBE9B5FB |
| 28 | loanBrokerCoverDeposit                                  | tesSUCCESS | https://devnet.xrpl.org/transactions/2AF9C162FDD68EBA3369A7E54F92382A03A8991D99AC70D7F7A53869591E0FE5 |
| 29 | VaultDeposit investor1 10000                            | tesSUCCESS | https://devnet.xrpl.org/transactions/077CAAF22290E2C6D84CFC48675F8A63174C76D2AF93FC6EF4C882269FB6088E |
| 30 | VaultDeposit investor2 12000                            | tesSUCCESS | https://devnet.xrpl.org/transactions/4B3C9F9B73EDE08B468EF1D2AB7294BA84BA8688B556F196FBCFE5316B3B4D64 |
| 31 | VaultDeposit investor3 8000                             | tesSUCCESS | https://devnet.xrpl.org/transactions/A73F468E7AF14722BB2F9DFF1FC162F7FC2228932C90B08999F5D6DF65EE85EC |
| 32 | LoanSet (multisig countersign)                          | tesSUCCESS | https://devnet.xrpl.org/transactions/9BDB5AE5D316E4171B56B0F3F289DF76161A862A058F1F82FB37C5A01ECB4314 |
| 33 | EscrowCreate m1 9000 (cancel 2026-11-23T22:18:11.000Z)  | tesSUCCESS | https://devnet.xrpl.org/transactions/1A7B82ED51756AC7C9D4EB009070318994F0CDC9ABD447FF5B5A96E4F069DAC9 |
| 34 | EscrowCreate m2 12000 (cancel 2026-11-23T22:18:11.000Z) | tesSUCCESS | https://devnet.xrpl.org/transactions/BFD98A00327C47B8F9BACC881C72FB8907A94BF933FC405AAF96E8821F59CA15 |
| 35 | EscrowCreate m3 9000 (cancel 2026-10-24T22:20:40.000Z)  | tesSUCCESS | https://devnet.xrpl.org/transactions/783DF76B369C704A80E3F10E22FB48BC23A2E281D10906EA0520664AB006B281 |
| 36 | attest m1 ai_agent                                      | tesSUCCESS | https://devnet.xrpl.org/transactions/E6CE3DE58D2264AFA2538DD6B90B25EBBB3256DDCA1195117E732DFF7584D48A |
| 37 | attest m1 inspector                                     | tesSUCCESS | https://devnet.xrpl.org/transactions/FA3D46559A63B2328116FD37436D6558D717E4E5986CB46A1293FC3F7DF88545 |
| 38 | attest m1 platform                                      | tesSUCCESS | https://devnet.xrpl.org/transactions/0A15544D89611DE5F32BE2D6E9BB361202C697D916D47B89E0D514A4A44F8F31 |
| 39 | EscrowFinish m1 -> builder                              | tesSUCCESS | https://devnet.xrpl.org/transactions/02D4D19FDA20634EB2CAD143F59B59A19CECF6EC5A6BC9FD7B84C5BC76E102F8 |
| 40 | EscrowCancel m3 -> SPV                                  | tesSUCCESS | https://devnet.xrpl.org/transactions/B17637FEDBED97E27327C2C68BB00F6AB5FC4876B60D7AD0C046A306FD17A885 |
| 41 | LoanPay 9000 (escrow refund, overpayment)               | tesSUCCESS | https://devnet.xrpl.org/transactions/F01909AC0790A0390E73437BF80B754FEF6DB4E2C5BB2AE5C199BA562E39A149 |
NOTE: Sub-periodic LoanPay of 1000 rejected as expected: LoanPay failed: tecINSUFFICIENT_PAYMENT (https://devnet.xrpl.org/transactions/ED23F018CC2D68DEBE875333E53D4E05506EA2C8219A18B006EE907B6B1AB1D8)
NOTE: Overpayment LoanPay of 9000: principalOutstanding 30000 -> 21000.02853880468, periodic 7500.017836764691587 -> 7000.022831070150645, paymentsRemaining 4 -> 3
NOTE: VaultWithdraw skipped (closed-ended vault: withdrawals reopen at Redemption 2026-10-24T22:40:36.000Z). Run with DEMO_WITHDRAW=1.

run record: /private/tmp/xrlp-proof/.data/demo-run-demo-mvmykif9.json
