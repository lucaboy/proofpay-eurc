# ProofPay standards and primary-source crosswalk

This crosswalk distinguishes protocol requirements from ProofPay's stricter
local policy. It is intentionally limited to primary project and vendor
sources.

| External fact | Primary source | ProofPay control |
|---|---|---|
| ZeroClaw 0.8.3 is the pinned stock release used by the demo. | [ZeroClaw v0.8.3 release](https://github.com/zeroclaw-labs/zeroclaw/releases/tag/v0.8.3) | The preparation and capture scripts check the binary version and use no fork. |
| The official v0.8.3 release publishes GitHub artifact provenance and an exact `gh attestation verify` command. | [ZeroClaw v0.8.3 release](https://github.com/zeroclaw-labs/zeroclaw/releases/tag/v0.8.3) | The reproduction guide includes the upstream verification command and explicitly limits its claim to the downloaded ZeroClaw artifact. |
| ZeroClaw v0.8.3 includes Telegram as a standard channel and uses long polling, so no webhook or public listener is required. | [v0.8.3 channel overview](https://github.com/zeroclaw-labs/zeroclaw/blob/v0.8.3/docs/book/src/channels/overview.md#L7-L18) and [network deployment](https://github.com/zeroclaw-labs/zeroclaw/blob/v0.8.3/docs/book/src/ops/network-deployment.md#L7-L15) | The primary demo uses one private `telegram.proofpay` DM and no inbound public network surface. The CLI remains the dependency-free fallback. |
| Telegram tool approvals use inline keyboard buttons, and unanswered approvals time out as denials. | [ZeroClaw autonomy documentation](https://github.com/zeroclaw-labs/zeroclaw/blob/v0.8.3/docs/book/src/security/autonomy.md#L28-L42) | `create_sample_request` remains `always_ask`; the operator taps the one-shot approval in the originating private DM. The 120-second channel timeout fails closed. |
| ZeroClaw v0.8.3 gates inbound channel identities through alias-scoped peer groups, where an empty external-peer set denies everyone. | [ZeroClaw peer groups](https://github.com/zeroclaw-labs/zeroclaw/blob/v0.8.3/docs/book/src/channels/peer-groups.md#L9-L29) | The committed profile starts disabled with an empty `telegram.proofpay` peer group. Pairing adds one numeric operator ID only; wildcard peers and group-chat approvals are prohibited. |
| ZeroClaw's direct `agent --message` CLI path in stock v0.8.3 does not wire a receipt generator into the legacy loop, even though other runtime paths support tool receipts. | [ZeroClaw CLI loop](https://github.com/zeroclaw-labs/zeroclaw/blob/24476b71d33eb1672a9495a7ce3d155377a60ce8/crates/zeroclaw-runtime/src/agent/loop_.rs#L1937-L1978) | ProofPay makes no tool-receipt claim for either channel. Its trace verifier requires an ordered parsed-call → tool-start → successful-result chain in one trace and iteration; Telegram mode also requires channel and agent attribution on all three records. The video labels this as runtime evidence, not a signature or approval. |
| A Solana Pay transfer request carries `recipient`, `amount`, optional `spl-token`, `reference`, `label`, `message`, and `memo` fields. | [Solana Pay specification v1](https://docs.solanapay.com/spec) | Preview and create produce one canonical URI from normalized, immutable terms. |
| The Solana Pay transfer-request field set has no absolute expiry parameter. | [Solana Pay specification v1](https://docs.solanapay.com/spec) | ProofPay binds a fixed 604800-second duration into its reference, records `expiresAt` when the always-ask create checkpoint succeeds, and rejects a later `blockTime`; it does not claim the URI prevents a late broadcast. |
| For an SPL-token request, references are readonly non-signers on the transfer, the memo is penultimate, and the transfer is final. | [Solana Pay specification v1](https://docs.solanapay.com/spec) | Reconciliation checks the destination token account and owner, compiled transfer binding, reference position, memo, and exact outer-instruction order. Non-standard layouts fail closed. |
| An associated token account is deterministically derived from its wallet owner and token mint. | [SPL Associated Token Account program](https://www.solana-program.com/docs/associated-token-account) | ProofPay derives the canonical destination without a wallet SDK and rejects a final transfer to any other account, even one with the expected owner and mint. |
| Validators index transactions by account keys, enabling reference-based lookup. | [Solana Pay specification v1](https://docs.solanapay.com/spec) and [`getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress) | Each request derives one domain-separated reference and accepts only one finalized, successful matching signature. |
| `blockTime` may be null in both signature history and confirmed transaction responses. | [`getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress) and [`getTransaction`](https://solana.com/docs/rpc/http/gettransaction) | ProofPay is deliberately stricter: both values must be positive integers, equal, and no later than either `expiresAt` plus skew or verification time plus skew. |
| The Circle-listed EURC mint on Solana mainnet and devnet is `HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr`. | [Circle EURC contract addresses](https://developers.circle.com/stablecoins/eurc-contract-addresses) | The mint is a constant; symbols, caller overrides, and arbitrary token addresses are rejected. |

## Policy choices beyond the protocols

Solana Pay defines how a wallet should construct a transfer request and
transaction. It does not require ProofPay's deliverable hash, fixed application
validity window, deterministic reference derivation, preview-match commitment,
single-successful-finalized-match policy, single-writer ledger,
signature-reuse rejection, offline/online evidence verifier, or no-overwrite
evidence bundle. Those are application-level controls.

Likewise, ZeroClaw can support far broader tool and custody surfaces. ProofPay's
demo profile intentionally exposes only six manifest-locked executable tools
and five built-in SOP control verbs. Three tools are non-mutating views;
creation is always-ask and idempotent; reconciliation may persist only a
verified paid checkpoint; and evidence may create only one exclusive bundle.
It contains no model-visible raw shell, wallet, signer, browser, HTTP, or MCP
capability.

The strongest safety claim remains architectural rather than model-dependent:
ProofPay has no private key, wallet session, transaction submission, transfer,
swap, refund, or sweep path.
