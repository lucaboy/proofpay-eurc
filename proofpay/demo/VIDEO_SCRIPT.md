# ProofPay EURC — final Telegram video script (2:55 maximum)

Record the real private-DM flow from a clean isolated runtime after executable
source, policy, config, and PDF are frozen and pushed. Pair the temporary bot
before recording. After the flow, commit only the reviewed sanitized m3
evidence, expected signature/fixture constants, and stable publication links;
append that post-flow HEAD as the closing shot. Hide the Telegram sidebar,
contact identity, notifications, BotFather chat, token, config, raw trace,
payer key, wallet seed, and browser profile. Enable system Do Not Disturb.

Use one continuous capture where practical. Model/RPC waiting may be
accelerated only with an explicit on-screen speed label; never splice in a
result from another runtime or transaction. The payer script may print only
public addresses, balances, finalized signature, and explorer URL.

## 0:00–0:12 — Product first

Open on the private Telegram DM, not a title slide.

> ProofPay binds the exact SHA-256 revision being paid to a human-approved EURC
> Solana Pay request. ZeroClaw can create, verify, and evidence it—but it never
> receives a wallet.

Briefly overlay the public repository and pre-flow implementation commit.

## 0:12–0:38 — Exact preview in Telegram

Send:

```text
Run the fixed ProofPay devnet preview through the proofpay-demo tool.
Return only the actual tool result; do not calculate or invent any field.
```

Keep the native tool result visible. Highlight only:

- invoice `demo-atlas-m3`;
- 5 EURC on devnet and the Circle-listed mint;
- exact deliverable SHA-256;
- seven-day validity and exact reference;
- the canonical Solana Pay URI from the reviewed manifest/terminal verifier.
  Stock ZeroClaw may visibly redact the public mint only inside the
  Telegram/trace URI while preserving the complete `mint` field;
- preview is non-persistent and no funds moved.

## 0:38–1:02 — Native inline approval

Send:

```text
Create the one fixed ProofPay demo request with create_sample_request.
```

Show ZeroClaw's native Telegram inline approval card. The stock card names the
fixed wrapper but does not repeat its manifest-locked arguments, so compare the
exact amount, digest, and reference in the immediately preceding preview, plus
the canonical URI in the reviewed fixed manifest. The trace verifier accepts
only the full URI or ZeroClaw's one exact documented public-mint redaction.
Tap the one-shot **Approve** action once, and never choose **Always**. Keep the
real tool result visible: `pending`, exact reference, verified URI trace form,
`payment: null`, and expiry. State that the fixed wrapper is idempotent and
cannot sign or submit.

## 1:02–1:27 — Independent payer

Switch to the safe terminal view and run the private external payer. It must
make a **new** 5 EURC devnet transfer after this request was created; the older
fixture transaction cannot satisfy the new payment window. Show the public
finalized signature and explorer URL.

> The payer signed independently. Its key never entered the repository,
> ZeroClaw config, agent workspace, prompt, trace, or evidence.

## 1:27–1:52 — Telegram reconciliation

Return to the same DM and send:

```text
Call proofpay-demo__check_sample_payment exactly once. Return only its actual
compact result.
```

Show `paid`, finalized signature, slot, and block time. In one sentence:
ProofPay requires the unique finalized reference match, exact memo, mint,
amount, canonical recipient ATA, transfer position, success, and request time
window.

## 1:52–2:10 — Evidence from the same channel

Send:

```text
Call proofpay-demo__write_sample_evidence exactly once for the verified sample.
Return only its actual compact result.
```

Show `evidence-written`, schema v3, the same signature, and deliverable digest.

## 2:10–2:38 — Independent proof, not narration

In the terminal, show the two passing suite summaries: 12/12 Superteam client
tests and 30/30 ProofPay tests. Then run the trace summarizer for all four live
tools—preview, create, check, and evidence—with:

```sh
node proofpay/demo/summarize-runtime-trace.mjs \
  <private-runtime>/data/state/runtime-trace.jsonl \
  <expected-tool> \
  --channel telegram.proofpay
```

Keep `channel=telegram.proofpay agent=proofpay`,
`native_tool_calls=1`, `parsed_tool_calls=1`, and the sanitized result
visible. Require `ordered_parse_start_result=true`; never show the raw trace.

Run the copied workspace verifier with `--online` and show:

- `proofpay-online-evidence-v1`;
- `onChainLookupPerformed: true`;
- `onChainPayment: true`.

## 2:38–2:55 — Close on verifiable artifacts

End on the public explorer transaction, repository, and the post-flow commit
containing the reviewed sanitized m3 evidence, followed by one sentence:

> Not an invoice generator: one exact work revision, one explicit approval,
> one finalized payment, one independently verifiable evidence pack—zero
> custody.

After upload and review, revoke the temporary BotFather token and remove the
temporary runtime. Publish only the sanitized trace summaries and reviewed
screen capture.
