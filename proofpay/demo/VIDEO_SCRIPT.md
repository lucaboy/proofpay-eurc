# ProofPay EURC - final video script (2:55 maximum)

Record one continuous terminal session from a clean isolated runtime. Freeze and
push the source commit first. Show no seed, private key, browser profile, API
token, `.secrets` file, or raw ledger contents. The external payer script may
print only public addresses, balances, the finalized signature, and the
explorer URL.

## 0:00-0:20 - Problem and promise

> Payment links identify an amount and recipient, but usually lose the exact
> work revision being paid. ProofPay binds an opaque deliverable SHA-256 to an
> EURC Solana Pay request. A real ZeroClaw CLI agent creates, reconciles, and
> evidences it, but never receives a wallet or signing capability.

Show the repository URL and frozen commit.

## 0:20-0:40 - Small authority surface

Show `proofpay/skills/proofpay-demo-tools/SKILL.toml` and the ZeroClaw skill
listing:

- six manifest-locked tools and no model-visible raw shell;
- `create_sample_request` is the only financial-intent checkpoint and is
  `always_ask`;
- reconciliation and evidence are fixed post-payment actions;
- browser, HTTP, MCP, wallet, signer, transfer, refund, and arbitrary RPC tools
  are absent.

The CLI is an official always-available ZeroClaw channel. State that any macOS
no-OS-sandbox fallback exists only in a disposable `/private/tmp` recording
runtime; the distributed template keeps the sandbox enabled.

## 0:40-1:00 - Tests and canonical preview

Run `npm test` and retain both passing summaries. Briefly name the negative
coverage: preview mismatch, conflicting idempotency key, path/symlink escape,
concurrent writers, canonical ATA, wrong mint/recipient/amount/memo/reference,
instruction order, signature reuse, time bounds, expiry, evidence tampering,
and offline-versus-online verification scope.

Show the fixed preview and highlight:

- `demo-atlas-m1`, devnet, 12.5 EURC;
- Circle-listed EURC mint;
- 604800-second payment window;
- deliverable SHA-256
  `4a3adafc3eeaa1670c5acd78349af5db9755c89efa0f9015f9bc293392ec20c8`;
- reference
  `BYX5MWZexvGk9ZpD2bY1eRtD4Tkmc4CgbJVrGK1TT87X`;
- canonical Solana Pay URI;
- preview is non-persistent.

## 1:00-1:35 - ZeroClaw creates the request

Ask the agent to call `proofpay-demo__create_sample_request` exactly once.
Keep the explicit ZeroClaw approval prompt visible, approve once, and retain
the native tool result. Show the sanitized trace proof requiring both
`native_tool_calls > 0` and `parsed_tool_calls > 0`.

Highlight `pending`, the exact digest/reference/URI, seven-day expiry, and
`payment: null`. An identical retry is idempotent; the same invoice ID with
different immutable terms fails with `INVOICE_CONFLICT`.

The trace is dispatch evidence, not a cryptographic tool receipt or human
signature. Preview freshness is supplied by the visible `always_ask`
checkpoint; the reference binds the fixed duration and immutable terms, not an
absolute preview timestamp.

## 1:35-2:05 - Independent payer and agent reconciliation

Run the private `/private/tmp` payer script outside ZeroClaw. It sends exactly
12.5 faucet EURC on Solana devnet and prints the finalized signature plus
explorer URL. State:

> The payer signed independently. Its key never entered the repository,
> ZeroClaw config, agent workspace, prompt, trace, or evidence.

Ask ZeroClaw to call `proofpay-demo__check_sample_payment`. Show the returned
`paid` status, signature, slot, and finality. Explain that ProofPay checks the
exact reference, memo, mint, amount, recipient canonical ATA, balance delta,
instruction order, success, finality, and block-time window before persisting
`pending -> paid`.

## 2:05-2:35 - Evidence and independent verification

Ask ZeroClaw to call `proofpay-demo__write_sample_evidence`. Show the schema-v3
bundle path, signature, digest, `expiresAt`, and
`withinPaymentWindow: true`.

Then run:

```sh
./proofpay/tools/proofpay.mjs verify-evidence \
  --evidence proofpay/evidence/demo-atlas-m1.evidence/evidence.json \
  --deliverable proofpay/deliverables/sample-milestone.txt \
  --online
```

Show `proofpay-online-evidence-v1`, `onChainLookupPerformed: true`, and
`onChainPayment: true`. Clarify that offline mode independently checks schema,
canonical terms, time bounds, and artifact digest; `--online` additionally
re-queries Solana. Neither mode authenticates the evidence producer.

## 2:35-2:55 - Close

> ProofPay strengthens payment evidence by shrinking the agent's financial
> authority: exact intent, external signer, finalized verification, zero
> custody.

End on the transaction explorer URL, repository URL, and frozen commit SHA.
