# Evidence format and verification

ProofPay evidence is a reproducible technical receipt. It binds:

1. immutable locally persisted request terms;
2. a persisted preview-match commitment over the exact digest, reference, and
   Solana Pay URI received by `create`;
3. SHA-256 of exact deliverable bytes;
4. one unique Solana Pay reference;
5. one finalized Solana EURC transfer that matches every stored term, including
   the reference account on the compiled transfer instruction.

It is not a wallet receipt, identity credential, legal acceptance record, tax
document, escrow decision, or proof that the deliverable is good.

Evidence schema v2 includes the stored `approval` preview-match commitment.
Within the validated local record, it establishes that `create` received the
same deliverable digest, reference, and URI that the helper recomputed at
creation. It is not a human identity credential, a signature, or a copy of the
checkpoint response. Who approved the terms—and whether an external
out-of-band checkpoint was properly administered—remains attributable only
through the separate ZeroClaw/operator audit trail.

## State model

```text
preview (not persisted)
   |
   | out-of-band checkpoint (identity/attribution remains external)
   v
pending (immutable request + persisted preview-match commitment)
   | \
   |  \ malformed/mismatched observation
   |   +--> verification error; stored state remains pending
   |
   +---- exact finalized transfer ----> paid ----> evidence
```

`pending` means no exact finalized transfer has been observed. A mismatch or
malformed candidate fails with a typed error and leaves the immutable stored
state pending. Only `paid` can produce a positive evidence pack.

Ledger mutations are serialized by a per-ledger exclusive lock. Reconciliation
may observe RPC data before acquiring the lock, but it reloads state and checks
immutable identity fields inside the lock before committing `paid`.

## JSON evidence v2

The helper’s JSON is the machine-readable source. Field ordering is
deterministic for review-friendly diffs; consumers must use field names rather
than order. A v2 pack has this logical shape:

```json
{
  "schemaVersion": 2,
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
    "id": "demo-atlas-m1",
    "network": "devnet",
    "currency": "EURC",
    "mint": "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
    "recipient": "<full Solana address>",
    "amount": "12.5",
    "amountAtomic": "12500000",
    "reference": "<unique full Solana reference>",
    "memo": "PROOFPAY:demo-atlas-m1:<first-16-sha256>",
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
    "confirmedAtomic": "12500000",
    "confirmedAmount": "12.5",
    "confirmationStatus": "finalized",
    "verifiedAt": "2026-07-23T11:59:00.000Z",
    "rpcUrl": "https://api.devnet.solana.com"
  },
  "assertions": {
    "finalized": true,
    "transactionSucceeded": true,
    "uniqueReference": true,
    "exactMemo": true,
    "exactMint": true,
    "exactRecipientDelta": true,
    "previewMatchedAtCreation": true,
    "nonCustodial": true
  },
  "limitations": [
    "Verifies a finalized on-chain payment and the stored deliverable digest only.",
    "The preview commitment proves that create received matching digest, reference, and URI values; the external checkpoint audit is the source for who approved them.",
    "Does not prove authorship, identity, legal acceptance, tax treatment, or refund entitlement."
  ]
}
```

Integer-like monetary values are strings where necessary so a JSON parser
cannot round them. Addresses, references, hashes, and signatures are never
shortened in the machine-readable file. A human-facing display may shorten a
value only if it also points to the full JSON.

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

### Time consistency and replay window

`blockTime` must be a positive, non-null integer. It must agree between the
finalized signature-history record and the fetched transaction, be no earlier
than five minutes before local request creation, and be no later than five
minutes after the verification clock. Missing, stale, future, or inconsistent
timestamps fail closed. This prevents an old matching transaction from being
replayed against a later local request while tolerating bounded clock skew.

### Unique reference

The stored reference must appear in the transaction account keys. It is the
base58 encoding of a 32-byte, domain-separated SHA-256 over network, recipient,
atomic amount, invoice, and full deliverable digest. It is reproducible from
approved terms, but is not a signer and not a wallet. Preview and create must
produce the same value. The same signature may not settle more than one local
request.

The reference must appear exactly once as a readonly non-signer transaction
key. It must also be the one additional readonly non-signer account on the
compiled final SPL `transfer` or `transferChecked` instruction. A reference
that is merely present elsewhere in the transaction does not pass. The v2
`assertions.uniqueReference` value is true only after both placements and local
signature uniqueness have been checked.

### Mint

Token balances must use the exact Circle-listed EURC mint:

```text
HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr
```

Symbol or token name is never sufficient.

### Recipient

Verification uses the token-account owner from parsed pre/post token balances,
not a display label. The credited owner must equal the stored operator
recipient.

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
non-signer. Its destination must uniquely map through the parsed post-token
balance to an EURC account owned by the stored recipient, and that destination
account’s pre/post delta must equal the request.

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
./proofpay/tools/proofpay.mjs check --invoice demo-atlas-m1 --json
./proofpay/tools/proofpay.mjs evidence --invoice demo-atlas-m1
```

The first successful `evidence` call creates
`proofpay/evidence/demo-atlas-m1.evidence/` atomically under a per-invoice lock.
The JSON and Markdown files are created exclusively. A later call for the same
invoice fails with `EVIDENCE_EXISTS`; it does not replace, merge, or silently
regenerate the bundle. This is application-level exclusive no-overwrite
behavior, not filesystem immutability: an operating-system owner can still edit
or delete files.

Then independently:

1. hash the current deliverable and compare all 64 lowercase SHA-256 digits;
2. query the transaction signature from an independent Solana RPC or explorer;
3. verify finalized success, reference, mint, recipient owner, atomic delta,
   and the bounded, cross-response-consistent `blockTime`;
4. confirm the request network, full immutable local terms, and that the
   `approval` digest/reference/URI equal the corresponding stored fields;
5. verify `approval.kind` is `preview-match` and `approval.recordedAt` equals
   the request creation timestamp;
6. verify the signature is not reused by another local invoice.

A modified deliverable should produce a different digest and must not be
represented as the paid revision. Create a new invoice/revision rather than
editing settled evidence.

## Safe wording

Use:

> ProofPay observed a finalized Solana EURC transfer that matched the stored
> recipient, amount, mint, network, unique reference, and deliverable
> commitment. Its persisted preview-match commitment records that `create`
> received the same digest, reference, and URI that were recomputed at
> creation; approver identity and checkpoint attribution remain external.

Do not use:

> The customer legally accepted the work, a named person approved it, the
> identity is verified, or a refund is owed.
