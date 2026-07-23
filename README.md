# ProofPay EURC for ZeroClaw

ProofPay turns an exact work revision into a human-approved EURC Solana Pay
request, then verifies the finalized transfer and produces a reproducible
technical evidence pack.

The agent never has a wallet. There is no seed import, private-key storage,
signing, transaction submission, transfer, swap, refund, or sweep path.

This repository is a submission for the
[ZeroClaw Solana bounty](https://superteam.fun/earn/listing/zeroclaw).

## What is included

- a stock ZeroClaw 0.8.3 instruction skill and supervised SOPs;
- six fixed demo tools prepared for a reproducible ZeroClaw tool-dispatch
  recording: three non-mutating views, one operator-approved idempotent request
  writer, one fixed reconciler, and one exclusive evidence writer;
- a sanitized ZeroClaw runtime trace that independently requires both a parsed
  native tool call and its returned helper JSON before a dispatch claim passes;
- a dependency-free Node.js 16 helper for preview-bound creation, single-writer
  request storage, read-only-chain reconciliation with a verified local paid
  checkpoint, and exclusive no-overwrite
  evidence bundles;
- evidence schema v3 with a persisted technical preview-match commitment, fixed
  seven-day payment window, absolute expiry, and an explicit
  `withinPaymentWindow` assertion, separated from human identity/checkpoint
  attribution;
- exact EURC arithmetic and a pinned Circle-listed Solana mint;
- fail-closed verification of finality, execution, the unique successful
  finalized reference match, memo, instruction order, mint, recipient owner,
  canonical associated token destination, amount, and matching positive RPC
  block times inside the fixed payment window;
- offline evidence verification for schema, canonical terms, timestamps, and
  deliverable bytes, plus opt-in online re-verification against Solana;
- an offline suite covering the ProofPay core and the Superteam Agent API
  client;
- a threat model, clean-room reproduction guide, prompt-injection transcript,
  standards crosswalk, deterministic supply-chain bundle, short video script,
  and submission copy.

Start with [proofpay/README.md](./proofpay/README.md), then read the
[threat model](./proofpay/docs/THREAT_MODEL.md).

## Quick verification

```sh
npm test

./proofpay/tools/proofpay.mjs preview \
  --invoice demo-atlas-m1 \
  --recipient CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8 \
  --amount 12.50 \
  --network devnet \
  --deliverable sample-milestone.txt
```

The preview is non-persistent and cannot move funds. Its sample deliverable
must hash to:

```text
4a3adafc3eeaa1670c5acd78349af5db9755c89efa0f9015f9bc293392ec20c8
```

For ZeroClaw installation, SOP validation, and a model-driven demo, follow
[proofpay/docs/REPRODUCE.md](./proofpay/docs/REPRODUCE.md).

The supported ZeroClaw setup uses
`proofpay/demo/prepare-zeroclaw-demo.sh`: it creates a dedicated runtime
workspace and copies both the policy skill and fixed demo-tool skill. A live
tool call is proven over ZeroClaw's built-in CLI channel by the final submission
video and its visible ZeroClaw trace; repository code alone is not evidence of
model dispatch. ZeroClaw's official channel matrix lists `cli` as an
always-available channel with no external dependency.
The final devnet capture follows one real request from approved `pending`
creation through independently signed payment, ZeroClaw reconciliation to
`paid`, and exclusive evidence generation. The payer remains outside the agent.
The locked demo profile exposes no raw shell. On macOS, the preparation guide
documents a clearly marked `/private/tmp` local-recording fallback for a stock
ZeroClaw 0.8.3 Seatbelt/Node incompatibility; the distributed template keeps
the OS sandbox enabled in `auto` mode.

The implementation-to-specification mapping is documented in
[`proofpay/docs/STANDARDS.md`](./proofpay/docs/STANDARDS.md).
The paper, protocol, open-source, and community findings that shaped the final
controls are mapped in
[`proofpay/docs/RESEARCH.md`](./proofpay/docs/RESEARCH.md).
The deterministic tested-source bundle and GitHub attestation boundary are
documented in
[`proofpay/docs/SUPPLY_CHAIN.md`](./proofpay/docs/SUPPLY_CHAIN.md).

## Superteam Agent API monitor

The repository also includes a hardened, dependency-free client used to find
eligible Superteam opportunities without leaking the Agent API credential:

```sh
npm run agent -- actionable --take 20
npm run agent -- heartbeat
```

The credential and claim code live only in the ignored
`.secrets/superteam-agent.json`. Registration creates a separate agent
identity; it does not replace the human Superteam Talent account.

## Safety boundaries

- Never commit `.secrets/`, `proofpay/data/`, or `proofpay/evidence/`.
- Never provide ProofPay a seed phrase, private key, wallet session, or API
  token.
- A human approves complete request terms, signs independently if desired, and
  submits or claims any Superteam payout.
- Devnet requests are test-only and have no represented monetary value.
- Evidence proves a narrow technical match, not authorship, legal acceptance,
  identity, tax treatment, or refund entitlement.

MIT licensed. See [proofpay/LICENSE-MIT](./proofpay/LICENSE-MIT).
