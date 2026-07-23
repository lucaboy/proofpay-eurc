# ProofPay standards and primary-source crosswalk

This crosswalk distinguishes protocol requirements from ProofPay's stricter
local policy. It is intentionally limited to primary project and vendor
sources.

| External fact | Primary source | ProofPay control |
|---|---|---|
| ZeroClaw 0.8.3 is the pinned stock release used by the demo. | [ZeroClaw v0.8.3 release](https://github.com/zeroclaw-labs/zeroclaw/releases/tag/v0.8.3) | The preparation and capture scripts check the binary version and use no fork. |
| The official v0.8.3 release publishes GitHub artifact provenance and an exact `gh attestation verify` command. | [ZeroClaw v0.8.3 release](https://github.com/zeroclaw-labs/zeroclaw/releases/tag/v0.8.3) | The reproduction guide includes the upstream verification command and explicitly limits its claim to the downloaded ZeroClaw artifact. |
| ZeroClaw exposes `cli` as an always-available channel. | [ZeroClaw channel matrix](https://github.com/zeroclaw-labs/zeroclaw/wiki/06-Channels) | The recorded `zeroclaw agent --message` interaction is a real CLI-channel job with a visible native tool dispatch and approval prompt. |
| ZeroClaw 0.8.3 can append an ephemeral HMAC-SHA256 receipt to successful tool results and surface it in channel replies. Receipts are scoped in memory and are not durable third-party proofs. | [ZeroClaw tool receipts](https://github.com/zeroclaw-labs/zeroclaw/blob/v0.8.3/docs/book/src/security/tool-receipts.md) | The demo agent enables per-agent receipts and `show_in_response`; the video retains the receipt beside the verified native result without treating it as a signature or approval. |
| A Solana Pay transfer request carries `recipient`, `amount`, optional `spl-token`, `reference`, `label`, `message`, and `memo` fields. | [Solana Pay specification v1](https://docs.solanapay.com/spec) | Preview and create produce one canonical URI from normalized, immutable terms. |
| For an SPL-token request, references are readonly non-signers on the transfer, the memo is penultimate, and the transfer is final. | [Solana Pay specification v1](https://docs.solanapay.com/spec) | Reconciliation checks the destination token account and owner, compiled transfer binding, reference position, memo, and exact outer-instruction order. Non-standard layouts fail closed. |
| Validators index transactions by account keys, enabling reference-based lookup. | [Solana Pay specification v1](https://docs.solanapay.com/spec) and [`getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress) | Each request derives one domain-separated reference and accepts only one finalized, successful matching signature. |
| `blockTime` may be null in both signature history and confirmed transaction responses. | [`getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress) and [`getTransaction`](https://solana.com/docs/rpc/http/gettransaction) | ProofPay is deliberately stricter: both values must be positive integers, equal, and inside the request/verification replay window. |
| The Circle-listed EURC mint on Solana mainnet and devnet is `HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr`. | [Circle EURC contract addresses](https://developers.circle.com/stablecoins/eurc-contract-addresses) | The mint is a constant; symbols, caller overrides, and arbitrary token addresses are rejected. |

## Policy choices beyond the protocols

Solana Pay defines how a wallet should construct a transfer request and
transaction. It does not require ProofPay's deliverable hash, deterministic
reference derivation, preview-match commitment, replay window, single-writer
ledger, signature-reuse rejection, or no-overwrite evidence bundle. Those are
application-level controls.

Likewise, ZeroClaw can support far broader tool and custody surfaces. ProofPay's
demo profile intentionally exposes only four manifest-locked executable tools
and five built-in SOP control verbs. It contains no model-visible raw shell,
wallet, signer, browser, HTTP, or MCP capability.

The strongest safety claim remains architectural rather than model-dependent:
ProofPay has no private key, wallet session, transaction submission, transfer,
swap, refund, or sweep path.
