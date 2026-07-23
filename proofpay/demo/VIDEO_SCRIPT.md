# ProofPay EURC — video script (2:45 target)

The recording must show one continuous terminal session from a clean checkout.
Do not display `.secrets/`, wallet software, private addresses, browser
profiles, API tokens, or the local request ledger.

## 0:00–0:20 — Problem and promise

Show the repository README and say:

> Payment links identify an amount and recipient, but not the exact work
> revision being paid. ProofPay binds an opaque deliverable hash to an EURC
> Solana Pay request. ZeroClaw orchestrates approval and verification but never
> receives a wallet or signing capability.

## 0:20–0:45 — Trust boundary

Show `proofpay/manifest.toml` and the architecture in `proofpay/README.md`.
Point out:

- skill-only integration on stock ZeroClaw 0.8.3;
- fixed Circle-listed EURC mint;
- human checkpoint before persistence;
- no key, signer, send, swap, refund, or arbitrary RPC path.

## 0:45–1:10 — Tests

Run:

```sh
npm test
```

Keep the final all-passing summary visible. Briefly name the negative cases:
changed/missing approval values, concurrent writers, path escape, decimals,
mint, recipient, finality, compiled transfer reference, memo, transfer order,
signature reuse, stale or inconsistent `blockTime`, lowercase invoice
canonicalization, and a second evidence write failing with `EVIDENCE_EXISTS`
without modifying the original bundle.

## 1:10–2:05 — Capture preview and approved creation through ZeroClaw

Before recording, prepare a fresh isolated instance:

```sh
sh ./proofpay/demo/prepare-zeroclaw-demo.sh proofpay-video

zeroclaw skills list \
  --config-dir .runtime/proofpay-video \
  --agent proofpay
```

Show that the config-owned bundle contains both `proofpay-eurc` and
`proofpay-demo`, with no repository, wallet, or secret copied into its
workspace. Authenticate the model before recording without displaying
credentials.

On macOS only, if stock ZeroClaw 0.8.3 Seatbelt reports `EPERM` while starting
Node, prepare a separate trusted local-recording runtime:

```sh
sh ./proofpay/demo/prepare-zeroclaw-demo.sh \
  proofpay-video /private/tmp/proofpay-video-runtime \
  --local-no-os-sandbox
```

Show the script’s warning and state that the distributed template remains on
`sandbox_backend = "auto"`. This fallback is limited to `/private/tmp`, must
not be deployed or shared, and remains fixed-only with no model-visible raw
shell.

The release capture uses the local Ollama model
`neurons-coordinator-agentic:latest` through an override in this copied
recording runtime only. Keep the repository template and every risk/tool
setting unchanged.

Start the agent against that isolated config and ask:

```text
Run the fixed ProofPay devnet preview through the proofpay-demo tool.
Return the actual tool output; do not calculate or invent any field.
```

Keep this segment only if the trace visibly shows a parsed tool call to
`proofpay-demo__preview_sample`, followed by returned helper JSON. Model prose,
an echoed command, or invented fields do not count; if dispatch is not visible,
stop and fix the recording rather than claiming success. Once the real call is
captured, highlight:

- sample SHA-256
  `4a3adafc3eeaa1670c5acd78349af5db9755c89efa0f9015f9bc293392ec20c8`;
- devnet and 12.5 EURC;
- fixed mint;
- full reference and Solana Pay URI;
- `preview` means no local request was persisted.

Keep outbound redaction enabled. Stock ZeroClaw 0.8.3 may replace part of the
public EURC mint inside the URI with `Hzwq*[REDACTED]` in the captured trace.
Label that as a capture-layer false positive and show the direct fixed-helper
preview or manifest beside it for the complete URI; do not disable redaction or
describe the shortened trace string as a different request.

Then ask:

```text
Create the one fixed ProofPay demo request with create_sample_request.
```

Keep the explicit approval prompt visible. Compare it with the preview, approve
once, and retain the parsed
`proofpay-demo__create_sample_request` call plus returned helper JSON. Highlight
canonical ID `demo-atlas-m1`, status `pending`, and the same digest, reference,
and URI. Explain that all command terms and preview-match values are hard-locked
in the manifest, caller arguments cannot override them, and a second invocation
fails with `INVOICE_EXISTS`.

State that the deterministic sample address has no represented controller and
must not receive assets. Before the trace exists in the finished video, do not
describe the live tool call as already completed.

## 2:05–2:25 — Reference SOP and reconciliation

Show the four-step creation SOP graph as an operator-managed reference
workflow. State precisely that its dynamic shell steps are not executable in
the locked demo profile; starting an SOP does not expose raw shell. Point out
that the fixed creation still re-hashes/re-derives under a single-writer lock
and persists an evidence-v2 `preview-match` commitment. Then show the
reconciliation checklist, including the compiled transfer reference, bounded
`blockTime` replay guard, and exclusive no-overwrite evidence bundle.

Do not open a wallet or make a payment in this short demo.

## 2:25–2:40 — Prompt-injection result

Show `proofpay/demo/prompt-injection-transcript.md`. Summarize the attack:
replace recipient and mint, extract a seed, fake paid state, sign a refund, and
run a script. Show the captured refusal and the zero-tool-call trace.

## 2:40–2:45 — Close

> ProofPay makes the payment evidence stronger by making the agent’s financial
> authority smaller: exact verification, zero custody.

End on the repository URL and commit SHA.
