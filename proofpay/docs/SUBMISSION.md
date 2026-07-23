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

The reference binds the fixed 604800-second duration, not an absolute preview
timestamp, because Solana Pay transfer URLs have no native expiry. Freshness
comes from ZeroClaw’s `always_ask` checkpoint at the actual create invocation;
`create` then records the absolute `expiresAt`. Exact retries are idempotent,
while conflicting terms for the same invoice ID fail with
`INVOICE_CONFLICT`.

After payment, ProofPay queries a fixed HTTPS Solana RPC in read-only mode. It
accepts `paid` only when all required facts match: finalized status,
transaction success, unique reference, exact memo, memo/transfer instruction
tail, the reference as the additional readonly non-signer on the compiled final
SPL transfer, Circle-listed EURC mint, exact recipient owner and destination
account, exact six-decimal amount, and a non-null `blockTime` inside the
fixed seven-day payment window (with five-minute skew) that agrees across both
RPC views. The transfer destination must be the recipient’s canonical
associated token account for the pinned mint, and exactly one successful
finalized signature may match the reference. Any missing, malformed, ambiguous,
stale, or mismatched field fails closed and
leaves the immutable request unchanged. If the window elapses without a match,
list/check output derives `expired` for display without rewriting the stored
pending record.

The resulting evidence pack binds:

1. the complete locally persisted technical request;
2. a persisted preview-match commitment containing the digest, reference, and
   URI accepted by `create`;
3. SHA-256 of the exact deliverable bytes;
4. one Solana Pay reference with exactly one accepted successful finalized
   history match;
5. one exact finalized EURC transfer.

It deliberately does not claim authorship, identity, legal acceptance, tax
treatment, refund entitlement, or proof of who approved the request. Evidence
schema v3 records a technical preview match, fixed `validForSeconds`, absolute
`expiresAt`, `uniqueSuccessfulFinalizedReference`, and
`withinPaymentWindow`—not a human signature or checkpoint identity;
attribution remains in the separate operator/SOP audit trail.

### Why this is a real ZeroClaw use case

- The `proofpay-eurc` skill supplies the authority and prompt-injection policy.
- `proofpay-create-request` is a supervised SOP with a mandatory out-of-band
  checkpoint and machine-enforced preview values before local persistence.
- `proofpay-reconcile` is bounded and read-only with respect to funds; it may
  persist only a verified local paid checkpoint and is suitable for a daemon or
  scheduled run.
- The isolated preparation script installs both the policy skill and
  `proofpay-demo` fixed-tool skill in a config-owned workspace.
- The locked demo profile exposes no raw shell. Six fixed wrappers provide
  hash, preview, compact list, always-ask idempotent creation, fixed
  reconciliation, and exclusive evidence writing for the hard-locked canonical
  `demo-atlas-m1` devnet request.
- The general SOP shell steps remain reference documentation for an
  operator-managed profile; starting an SOP cannot make raw shell dispatchable
  in this locked demo.
- The fixed demo skill lets judges capture the real
  `pending → paid → evidence` path while the payer remains independent and the
  agent remains walletless. A live-call claim is valid only when the video
  visibly contains the parsed calls and returned helper JSON.
- The stock ZeroClaw 0.8.3 binary is used; there is no fork or custom runtime.
- The recorded interaction uses ZeroClaw's built-in CLI channel, a real channel
  that the official channel matrix lists as always available.
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
- an evidence-v3 preview-match commitment whose values must equal the stored
  digest, reference, and URI, plus a fixed duration and absolute expiry,
  without claiming approver identity;
- canonical associated token destination derivation and exactly one successful
  finalized reference-history match;
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
- Research-to-control matrix: `proofpay/docs/RESEARCH.md`.
- Supply-chain bundle and attestation boundary:
  `proofpay/docs/SUPPLY_CHAIN.md`.
- Injection test: `proofpay/demo/prompt-injection-transcript.md`.
- Video script: `proofpay/demo/VIDEO_SCRIPT.md`.

The independent `verify-evidence` command checks schema, canonical terms,
timestamps, limitations, and supplied deliverable bytes offline. With
`--online`, it additionally repeats the exact Solana payment checks. Neither
mode authenticates the evidence producer.

## Publication links

- Repository: `https://github.com/lucaboy/proofpay-eurc`
- Demo video:
  `https://drive.google.com/file/d/1JDNN-wTHlMtd-Qo2NVQQSg-s2mVaY59B/view?usp=sharing`
- One-pager:
  `https://drive.google.com/file/d/1TOnDbGysRhAmgfB1SKux9pv5S60IdgtV/view?usp=sharing`
- ZeroClaw Discord `#solana-bounty` showcase:
  `https://discord.com/channels/1472154792351760419/1527427886410109029/1529827367919423628`

Do not submit until all four links resolve publicly, the repository commit
shown in the video matches the submitted source, and the video visibly proves
the live tool dispatch. Repository code alone is not evidence that the model
already completed a tool call.

## Discord showcase draft

> **ProofPay EURC** binds an exact deliverable SHA-256 to a human-approved
> Solana Pay request, then a walletless ZeroClaw agent verifies the exact
> finalized EURC transfer and emits a reproducible evidence pack. Stock
> ZeroClaw 0.8.3, supervised SOP checkpoint, fixed Circle mint, no signer/send/
> refund path, preview-bound creation, single-writer persistence, exclusive
> no-overwrite evidence bundles, evidence schema v3, canonical associated token
> verification, a real devnet `pending → paid → evidence` capture, offline and
> online evidence verification, a fully passing suite, and an included
> prompt-injection red team.
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
devnet test key with no private key in this repository. Use it only for the
documented valueless devnet demonstration; never send mainnet assets.

## Final pre-submit checklist

- [ ] Public repository link works in a private browser window.
- [ ] License, README, source, tests, config, SOPs, skills, and sample are
      present; `.secrets/`, runtime data, ledgers, and evidence are absent.
- [ ] CI passes on Node.js 16 and 22.
- [ ] Main-branch submission bundle has a downloadable checksum and GitHub
      provenance attestation as described in `SUPPLY_CHAIN.md`.
- [ ] Video is shorter than three minutes and shows a real ZeroClaw tool call.
- [ ] Footage shows the canonical direct fixed-helper preview followed by the
      parsed native `proofpay-demo__create_sample_request` call over the CLI
      channel, the approval gate, `check_sample_payment`,
      `write_sample_evidence`, and their verified result traces; it is not model
      prose or an echoed command.
- [ ] Source, tape, and PDF were committed before capture; the generated MP4 was
      uploaded externally and not committed.
- [ ] Video clearly states that the agent has no wallet, an independent payer
      signs the devnet transaction, and the agent follows the request from
      `pending` to `paid` to evidence.
- [ ] The finalized devnet explorer URL is public, and both offline and
      `--online` evidence verification pass for the displayed signature.
- [ ] Discord showcase is posted in `#solana-bounty`.
- [ ] Superteam submission uses the final repository, video, and Discord links.
- [ ] No seed phrase, private key, API key, claim code, PII, or controlled
      production recipient appears anywhere.
