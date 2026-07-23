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
- four fixed demo tools prepared for a reproducible ZeroClaw tool-dispatch
  recording: three read-only/non-persistent tools plus one operator-approved,
  persistent devnet sample request;
- ephemeral HMAC tool receipts surfaced by the CLI channel so a narrated call
  without a successful runtime dispatch is visibly receipt-less;
- a dependency-free Node.js 16 helper for preview-bound creation, single-writer
  request storage, read-only reconciliation, and exclusive no-overwrite
  evidence bundles;
- evidence schema v2 with a persisted technical preview-match commitment,
  explicitly separated from human identity/checkpoint attribution;
- exact EURC arithmetic and a pinned Circle-listed Solana mint;
- fail-closed verification of finality, execution, reference, memo,
  instruction order, mint, recipient owner, destination account, amount, and
  matching positive RPC block times inside a bounded replay window;
- an offline suite covering the ProofPay core and the Superteam Agent API
  client;
- a threat model, clean-room reproduction guide, prompt-injection transcript,
  standards crosswalk, short video script, and submission copy.

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
The locked demo profile exposes no raw shell. On macOS, the preparation guide
documents a clearly marked `/private/tmp` local-recording fallback for a stock
ZeroClaw 0.8.3 Seatbelt/Node incompatibility; the distributed template keeps
the OS sandbox enabled in `auto` mode.

The implementation-to-specification mapping is documented in
[`proofpay/docs/STANDARDS.md`](./proofpay/docs/STANDARDS.md).

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
