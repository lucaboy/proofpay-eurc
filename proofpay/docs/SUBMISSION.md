# ProofPay EURC — submission pack

## Superteam title

ProofPay EURC — deliverable-bound, non-custodial Solana payments for ZeroClaw

## One-line pitch

ProofPay lets a freelancer bind an exact file revision to a human-approved EURC
Solana Pay request, while a walletless ZeroClaw agent later verifies the exact
finalized transfer and creates a reproducible evidence pack.

## Submission description

Payment links answer “where and how much?”, but they usually lose the connection
to the exact revision being paid. ProofPay adds that missing technical link
without making the agent a custodian.

An operator supplies an invoice slug, their full public recipient, an exact EURC
amount, network, and a file inside a constrained deliverables directory.
ProofPay hashes the file as opaque bytes and produces a non-persistent preview
containing every normalized term, a domain-separated Solana reference, and a
Solana Pay URI. A ZeroClaw SOP then stops at an out-of-band human checkpoint.
After approval, `create` must receive the preview’s full deliverable digest,
reference, and URI verbatim. It re-hashes and re-derives the request and rejects
any changed or missing value before persistence. Only an independently
controlled payer wallet may sign.

After payment, ProofPay queries a fixed HTTPS Solana RPC in read-only mode. It
accepts `paid` only when all required facts match: finalized status,
transaction success, unique reference, exact memo, memo/transfer instruction
tail, the reference as the additional readonly non-signer on the compiled final
SPL transfer, Circle-listed EURC mint, exact recipient owner and destination
account, exact six-decimal amount, and a non-null `blockTime` inside the
bounded request/verification window that agrees across both RPC views. Any
missing, malformed, ambiguous, stale, or mismatched field fails closed and
leaves the immutable request pending.

The resulting evidence pack binds:

1. the complete locally persisted technical request;
2. a persisted preview-match commitment containing the digest, reference, and
   URI accepted by `create`;
3. SHA-256 of the exact deliverable bytes;
4. one unique Solana Pay reference;
5. one exact finalized EURC transfer.

It deliberately does not claim authorship, identity, legal acceptance, tax
treatment, refund entitlement, or proof of who approved the request. Evidence
schema v2 records a technical preview match, not a human signature or
checkpoint identity; attribution remains in the separate operator/SOP audit
trail.

### Why this is a real ZeroClaw use case

- The `proofpay-eurc` skill supplies the authority and prompt-injection policy.
- `proofpay-create-request` is a supervised SOP with a mandatory out-of-band
  checkpoint and machine-enforced preview values before local persistence.
- `proofpay-reconcile` is a bounded, read-only SOP suitable for a daemon or
  scheduled run.
- The isolated preparation script installs both the policy skill and
  `proofpay-demo` fixed-tool skill in a config-owned workspace.
- The locked demo profile exposes no raw shell. Three fixed wrappers are
  read-only/non-persistent; one always-ask wrapper can persist only the
  hard-locked canonical `demo-atlas-m1` devnet request.
- The general SOP shell steps remain reference documentation for an
  operator-managed profile; starting an SOP cannot make raw shell dispatchable
  in this locked demo.
- The fixed demo skill lets judges capture both a preview and one approved
  persistent local request with no wallet or provider secret. A live-call
  claim is valid only when the video visibly contains the parsed calls and
  returned helper JSON.
- The stock ZeroClaw 0.8.3 binary is used; there is no fork or custom runtime.
- The distributed template keeps the OS sandbox on `auto`; an explicit
  `/private/tmp` no-sandbox flag exists only for a trusted local macOS
  recording affected by the stock 0.8.3 Seatbelt/Node bug and prints a
  do-not-deploy warning.

### Custody and safety

ProofPay is intentionally Tier 1 and zero-custody:

- no wallet SDK, adapter, session, key, seed, signer, or transaction builder;
- no send, transfer, swap, bridge, refund, sweep, or delegation command;
- no arbitrary RPC override, token override, or runtime credential input;
- fixed Circle-listed Solana EURC mint;
- exact integer arithmetic without floating point;
- immutable local records, a per-ledger single-writer lock, atomic `0600`
  writes, path containment, and symlink rejection;
- an evidence-v2 preview-match commitment whose values must equal the stored
  digest, reference, and URI, without claiming approver identity;
- exclusive per-invoice evidence bundles that fail rather than overwrite an
  existing bundle;
- customer text, deliverable bytes, memos, RPC fields, and webpages remain
  untrusted data and cannot modify operator-approved terms.

The included red-team transcript tries to replace the recipient and EURC mint,
extract a seed, mark an invoice paid, issue a refund, and run an arbitrary
script. The agent refuses and performs no tool call or state mutation.

### Reproduction and evidence

- Tests: `npm test` — the complete offline suite must pass at the submitted
  commit.
- Core guide: `proofpay/README.md`.
- Clean-room setup: `proofpay/docs/REPRODUCE.md`.
- Threat model: `proofpay/docs/THREAT_MODEL.md`.
- Evidence contract: `proofpay/docs/EVIDENCE.md`.
- Injection test: `proofpay/demo/prompt-injection-transcript.md`.
- Video script: `proofpay/demo/VIDEO_SCRIPT.md`.

## Publication links

- Repository: `https://github.com/lucaboy/proofpay-eurc`
- Demo video and ZeroClaw Discord `#solana-bounty` showcase: supplied directly
  in the bounty submission after the source commit is frozen.

Do not submit until all three links resolve publicly, the repository commit
shown in the video matches the submitted source, and the video visibly proves
the live tool dispatch. Repository code alone is not evidence that the model
already completed a tool call.

## Discord showcase draft

> **ProofPay EURC** binds an exact deliverable SHA-256 to a human-approved
> Solana Pay request, then a walletless ZeroClaw agent verifies the exact
> finalized EURC transfer and emits a reproducible evidence pack. Stock
> ZeroClaw 0.8.3, supervised SOP checkpoint, fixed Circle mint, no signer/send/
> refund path, preview-bound creation, single-writer persistence, exclusive
> no-overwrite evidence bundles, a persisted technical preview-match
> commitment, a fully passing offline suite, and an included prompt-injection
> red team.
> Repo: `https://github.com/lucaboy/proofpay-eurc` · Demo: see the public
> bounty submission link.

## Judge quick path

```sh
npm test

./proofpay/tools/proofpay.mjs preview \
  --invoice demo-atlas-m1 \
  --recipient CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8 \
  --amount 12.50 \
  --network devnet \
  --deliverable sample-milestone.txt
```

Expected sample SHA-256:

```text
4a3adafc3eeaa1670c5acd78349af5db9755c89efa0f9015f9bc293392ec20c8
```

The preview is non-persistent. The sample address is a deterministic public
test key with no represented controller or private key. Do not send assets to
it.

## Final pre-submit checklist

- [ ] Public repository link works in a private browser window.
- [ ] License, README, source, tests, config, SOPs, skills, and sample are
      present; `.secrets/`, runtime data, ledgers, and evidence are absent.
- [ ] CI passes on Node.js 16 and 22.
- [ ] Video is shorter than three minutes and shows a real ZeroClaw tool call.
- [ ] Tool-call footage visibly includes the parsed
      `proofpay-demo__preview_sample` and
      `proofpay-demo__create_sample_request` calls, the approval gate, and
      returned helper JSON; it is not model prose or an echoed command.
- [ ] Video clearly states that no wallet is connected, a local pending request
      is created, and no payment occurs.
- [ ] Discord showcase is posted in `#solana-bounty`.
- [ ] Superteam submission uses the final repository, video, and Discord links.
- [ ] No seed phrase, private key, API key, claim code, PII, or controlled
      production recipient appears anywhere.
