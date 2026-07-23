# Evidence format and verification

ProofPay evidence is a reproducible technical evidence artifact. It binds:

1. immutable locally persisted request terms;
2. a persisted preview-match commitment over the exact digest, reference, and
   Solana Pay URI received by `create`;
3. SHA-256 of exact deliverable bytes;
4. one Solana Pay reference with exactly one accepted successful finalized
   history match, plus a fixed 604800-second validity duration;
5. one finalized Solana EURC transfer that matches every stored term, including
   the reference account on the compiled transfer instruction.

It is not a wallet receipt, identity credential, legal acceptance record, tax
document, escrow decision, or proof that the deliverable is good.

Evidence schema v3 includes the stored `approval` preview-match commitment,
`validForSeconds`, `expiresAt`, `uniqueSuccessfulFinalizedReference`, and
`withinPaymentWindow`. Within the validated local record, it establishes that
`create` received the same deliverable digest, reference, and URI that the
helper recomputed at creation. It is not a human identity credential, a
signature, or a copy of the checkpoint response. Who approved the terms—and
whether an external out-of-band checkpoint was properly administered—remains
attributable only through the separate ZeroClaw/operator audit trail.

The reference binds the fixed duration, not an absolute issue timestamp, and a
Solana Pay transfer URL has no native expiry field. Preview freshness therefore
depends on the ZeroClaw `always_ask` checkpoint at the actual create invocation.
`expiresAt` is computed from that recorded creation time.

## State model

```text
preview (not persisted)
   |
   | out-of-band checkpoint (identity/attribution remains external)
   v
pending (immutable request + persisted preview-match commitment)
   | |\
   | | \ malformed/mismatched observation
   | |  +--> verification error; stored state remains pending
   | +---- window elapsed ----> derived `expired` display; stored state unchanged
   |
   +---- exact finalized transfer ----> paid ----> evidence
```

`pending` means no exact finalized transfer has been observed. A mismatch or
malformed candidate fails with a typed error and leaves the immutable stored
state pending. Once the fixed window plus skew has elapsed, list/check output
uses the derived display status `expired`; that is not a ledger rewrite. Only
`paid` can produce a positive evidence pack.

Ledger mutations are serialized by a per-ledger exclusive lock. Reconciliation
may observe RPC data before acquiring the lock, but it reloads state and checks
immutable identity fields inside the lock before committing `paid`.

## JSON evidence v3

The helper’s JSON is the machine-readable source. Field ordering is
deterministic for review-friendly diffs; consumers must use field names rather
than order. A v3 pack has this logical shape:

```json
{
  "schemaVersion": 3,
  "generatedAt": "2026-07-23T12:00:00.000Z",
  "approval": {
    "schemaVersion": 1,
    "deliverableSha256": "<64 lowercase hexadecimal characters>",
    "reference": "<unique full Solana reference>",
    "solanaPayUri": "<full Solana Pay URI>",
    "kind": "preview-match",
    "recordedAt": "2026-07-23T11:55:00.000Z"
  },
  "invoice": {
    "id": "demo-atlas-m3",
    "network": "devnet",
    "currency": "EURC",
    "mint": "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
    "recipient": "<full Solana address>",
    "amount": "5",
    "amountAtomic": "5000000",
    "validForSeconds": 604800,
    "expiresAt": "2026-07-30T11:55:00.000Z",
    "reference": "<unique full Solana reference>",
    "memo": "PROOFPAY:demo-atlas-m3:<first-16-sha256>",
    "solanaPayUri": "<full Solana Pay URI>"
  },
  "deliverable": {
    "path": "sample-milestone.txt",
    "size": 496,
    "sha256": "<64 lowercase hexadecimal characters>"
  },
  "payment": {
    "signature": "<full Solana transaction signature>",
    "slot": 123456,
    "blockTime": 1784808000,
    "confirmedAtomic": "5000000",
    "confirmedAmount": "5",
    "confirmationStatus": "finalized",
    "verifiedAt": "2026-07-23T11:59:00.000Z",
    "rpcUrl": "https://api.devnet.solana.com"
  },
  "assertions": {
    "finalized": true,
    "transactionSucceeded": true,
    "uniqueSuccessfulFinalizedReference": true,
    "exactMemo": true,
    "exactMint": true,
    "exactRecipientDelta": true,
    "withinPaymentWindow": true,
    "previewMatchedAtCreation": true,
    "nonCustodial": true
  },
  "limitations": [
    "Records a finalized on-chain payment verified by ProofPay; offline verification independently checks only the schema, canonical terms, timestamps, and deliverable digest.",
    "The preview commitment proves that create received matching digest, reference, and URI values; the external checkpoint audit is the source for who approved them.",
    "Does not prove authorship, identity, legal acceptance, tax treatment, or refund entitlement."
  ]
}
```

Integer-like monetary values are strings where necessary so a JSON parser
cannot round them. Addresses, references, hashes, and signatures are never
shortened in the machine-readable file. A human-facing display may shorten a
value only if it also points to the full JSON.

The verifier rejects duplicate object names at every nesting level, including
names that become equal only after JSON escape decoding. This prevents
different parsers from assigning different meanings to the same evidence
bytes.

The generated Markdown mirror also states the non-custodial and attribution
limitations. The implementation must bump `schemaVersion` before removing a
field, changing a field’s meaning, or weakening a verification rule.

## Required reconciliation checks

All positive checks are conjunctive. One false, missing, ambiguous, or malformed
value prevents `paid`.

### Network

The request pins `devnet` or `mainnet`. Reconciliation uses only the configured
HTTPS RPC for that network. Network selection never comes from the payer,
transaction memo, or a runtime prompt.

### Finality and execution

The transaction must be observed at `finalized` commitment and its metadata
must report `err: null`. A processed, confirmed, dropped, failed, or unavailable
transaction is not payment evidence.

Solana's native System Program uses the canonical all-zero 32-byte account key
`11111111111111111111111111111111`. ProofPay accepts that value only while
decoding the immutable account-key list of an already-finalized transaction.
Operator-controlled recipient, mint, and reference terms continue to reject it.

### Time consistency and replay window

`blockTime` must be a positive, non-null integer. It must agree between the
finalized signature-history record and the fetched transaction, be no earlier
than five minutes before local request creation, and be no later than either
five minutes after `expiresAt` or five minutes after the verification clock.
Missing, stale, late, future, or inconsistent timestamps fail closed. This
prevents an old or late matching transaction from being replayed against the
request while tolerating bounded clock skew.

### Unique reference

Exactly one successful finalized signature-history entry may match the stored
reference. The reference must appear in the transaction account keys. It is the
base58 encoding of a 32-byte, domain-separated SHA-256 over network, recipient,
atomic amount, invoice, full deliverable digest, and the fixed validity
duration. It is reproducible from approved terms, but is not a signer and not a
wallet. Preview and create must produce the same value. The same signature may
not settle more than one local request.

The reference must appear exactly once as a readonly non-signer transaction
key. It must also be the one additional readonly non-signer account on the
compiled final SPL `transfer` or `transferChecked` instruction. A reference
that is merely present elsewhere in the transaction does not pass. The v3
`assertions.uniqueSuccessfulFinalizedReference` value is true only after the
single successful finalized history match, both placements, and local signature
uniqueness have been checked.

### Mint

Token balances must use the exact Circle-listed EURC mint:

```text
HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr
```

Symbol or token name is never sufficient.

### Recipient

Verification uses the token-account owner from parsed pre/post token balances,
not a display label. The credited owner must equal the stored operator
recipient. The final destination must also equal the canonical associated token
account derived from that recipient and the pinned mint; a different token
account owned by the same recipient fails closed.

### Amount

The exact decimal request is converted to atomic units without floating point.
The recipient’s EURC token-balance delta must equal that value. A larger,
smaller, split, rounded, or different-token transfer does not silently settle
the request.

### Memo and deliverable binding

The deterministic memo is required and must match exactly:

```text
PROOFPAY:<non-sensitive-invoice>:<first-16-lowercase-sha256>
```

The complete SHA-256 remains in the local request and evidence file. The
truncated on-chain commitment is a correlation aid, not a collision-resistant
replacement for the full digest.

### Instruction tail

The outer instruction list must end with exactly this request’s memo followed
by a compiled SPL Token `transfer` or `transferChecked`. The final transfer must
carry the stored atomic amount; a checked transfer must also carry the pinned
mint and six decimals. Its account list must have exactly the canonical SPL
accounts plus the stored reference in the final position as a readonly
non-signer. Its destination must be the canonical associated token account
derived from recipient plus mint, uniquely map through the parsed post-token
balance to an EURC account owned by the stored recipient, and have the exact
requested pre/post delta.

This prevents a transaction from borrowing an unrelated memo or aggregate
balance movement while performing a different final action.

## Privacy rules

Evidence must not include:

- seed phrases, private keys, wallet authorization, provider/API tokens;
- customer names, emails, handles, addresses, contract text, or free-form
  descriptions;
- absolute home-directory paths;
- deliverable contents;
- raw model prompts or customer messages;
- full raw RPC responses unless an operator separately preserves them in a
  protected forensic archive.

The invoice slug itself must be non-sensitive. Public-chain metadata is
permanent; removing it from a local evidence file cannot remove it from Solana.

## Reproduce a pack

From the repository root:

```sh
./proofpay/tools/proofpay.mjs check \
  --invoice demo-atlas-m3 \
  --compact --json
./proofpay/tools/proofpay.mjs evidence \
  --invoice demo-atlas-m3 \
  --compact --json
```

The first successful `evidence` call creates
`proofpay/evidence/demo-atlas-m3.evidence/` atomically under a per-invoice lock.
The JSON and Markdown files are created exclusively. A later call for the same
invoice fails with `EVIDENCE_EXISTS`; it does not replace, merge, or silently
regenerate the bundle. This is application-level exclusive no-overwrite
behavior, not filesystem immutability: an operating-system owner can still edit
or delete files.

Verify the resulting JSON and the claimed deliverable without trusting the
writer’s ledger:

```sh
./proofpay/tools/proofpay.mjs verify-evidence \
  --evidence proofpay/evidence/demo-atlas-m3.evidence/evidence.json \
  --deliverable proofpay/deliverables/sample-milestone.txt
```

The default offline verifier checks the exact v3 schema, canonical invoice
derivation, preview commitment, fixed duration and absolute expiry, timestamp
relations, required limitations, and the supplied file’s size and SHA-256. It
does **not** query Solana or authenticate the evidence producer.

To independently repeat the live reference lookup and every payment check:

```sh
./proofpay/tools/proofpay.mjs verify-evidence \
  --evidence proofpay/evidence/demo-atlas-m3.evidence/evidence.json \
  --deliverable proofpay/deliverables/sample-milestone.txt \
  --online
```

Online mode uses the allowlisted RPC for the evidence network and requires the
live signature, slot, `blockTime`, amount, and finality to equal the artifact.
It still does not authenticate the producer, prove checkpoint identity, or
eliminate reliance on that RPC transport.

Then independently:

1. hash the current deliverable and compare all 64 lowercase SHA-256 digits;
2. query the transaction signature from an independent Solana RPC or explorer;
3. verify exactly one successful finalized reference match, reference
   placement, mint, recipient owner, canonical associated token destination,
   atomic delta, and the bounded, cross-response-consistent `blockTime`;
4. confirm the request network, full immutable local terms, and that the
   `approval` digest/reference/URI equal the corresponding stored fields;
5. verify `approval.kind` is `preview-match` and `approval.recordedAt` equals
   the request creation timestamp;
6. verify `expiresAt - approval.recordedAt` equals 604800 seconds and the
   payment falls inside that window plus skew;
7. verify the signature is not reused by another local invoice.

A modified deliverable should produce a different digest and must not be
represented as the paid revision. Create a new invoice/revision rather than
editing settled evidence.

## Safe wording

Use:

> ProofPay observed a finalized Solana EURC transfer that matched the stored
> recipient, canonical token destination, amount, mint, network, unique
> successful finalized reference, payment window, and deliverable commitment.
> Its persisted preview-match commitment records that `create`
> received the same digest, reference, and URI that were recomputed at
> creation; approver identity and checkpoint attribution remain external.

Do not use:

> The customer legally accepted the work, a named person approved it, the
> identity is verified, or a refund is owed.
