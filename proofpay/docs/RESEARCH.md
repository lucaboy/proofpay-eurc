# Research-to-control matrix

ProofPay is intentionally small, but its control choices were compared against
current agent-payment protocols, security guidance, academic work, and
production-oriented open-source specifications. This document records what was
adopted, what was adapted, and what is explicitly not claimed.

## Applied findings

| Source | Relevant finding | ProofPay application | Limit |
|---|---|---|---|
| [Agent Payments Protocol (AP2) specification](https://ap2-protocol.org/ap2/specification/) and [agent authorization framework](https://ap2-protocol.org/ap2/agent_authorization/) | A verifier should be able to connect the action being authorized to the user's constrained intent through typed, verifiable mandates. | Preview exposes exact normalized terms; `create` requires the preview's digest, reference, and URI byte-for-byte; the persisted `preview-match` object records that technical equality. | ProofPay does not implement AP2, signed mandates, non-repudiation, or approver identity. The human checkpoint remains an external ZeroClaw/operator event. |
| [Zero-Trust Runtime Verification for Agentic Payment Protocols](https://arxiv.org/abs/2602.06345) | Static issuance is insufficient when execution context can change; runtime context binding, time bounds, and consume-once semantics reduce replay. | Reconciliation rechecks immutable context at execution time, enforces a fixed payment window and cross-RPC `blockTime`, accepts one successful finalized reference match, and rejects local signature reuse. | The reference binds a duration, not an absolute preview timestamp. This is not a cryptographic consume-once mandate; freshness depends on the visible `always_ask` create checkpoint. |
| [Google's Approach for Secure AI Agents](https://research.google/pubs/an-introduction-to-googles-approach-for-secure-ai-agents/) | Agents need a defined human controller, deliberately limited powers, and observable actions/plans. | The operator is the term authority; the agent gets six fixed tools and no wallet/raw shell; the trace summary requires a parsed native call and actual returned helper JSON. | The stock ZeroClaw direct CLI path does not provide a cryptographic tool receipt, so ProofPay claims observable dispatch evidence only. |
| [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) | Apply least privilege, require human approval for consequential actions, treat model output as untrusted for authorization, and retest after material changes. | Request creation is `always_ask`; terms are validated outside model prose; tool/network/filesystem surfaces are allowlisted; adversarial cases and the full suite are rerun before release. | Human approval cannot rescue a compromised operator display or device. |
| [CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) | Trusted control flow should be separated from untrusted data so retrieved content cannot alter program flow. | Deliverable bytes, customer text, memos, and RPC fields are typed data only; they cannot add tools, replace a recipient/mint, or become shell input. | This is an application of the design principle, not an implementation or formal proof of CaMeL. |
| [AgentDojo](https://arxiv.org/abs/2406.13352) and its [open benchmark](https://agentdojo.spylab.ai/) | Tool-using agents remain vulnerable to indirect prompt injection and need task-specific adversarial evaluation, not only benign demos. | The red-team transcript attempts address/mint replacement, seed extraction, false paid state, arbitrary execution, and refund authority; the expected invariant is refusal and zero mutating calls. | The included scenario is not a claim of passing the full AgentDojo benchmark. |
| [x402 payment-identifier extension](https://docs.x402.org/extensions/payment-identifier) | A stable payment identifier allows safe retries without duplicate payment processing. | Identical `create` retries return the existing record with `idempotent: true`; the same invoice ID with different immutable terms fails with `INVOICE_CONFLICT`. | ProofPay is not an x402 implementation and does not cache HTTP responses. |
| [SLSA provenance specification](https://slsa.dev/spec/v1.2/provenance) and [GitHub artifact attestations](https://github.com/actions/attest) | A distributable artifact should be cryptographically connected to its source/build context, with explicit trust boundaries. | CI tests two Node versions, creates a deterministic archive from committed Git blobs, publishes checksums, and attests the main-branch archive through GitHub/Sigstore. | The attestation proves the workflow produced the archive; it does not prove application semantics, runner integrity, or any payment. |

## Open-source implementation checks

- Solana's [Associated Token Account program specification](https://www.solana-program.com/docs/associated-token-account)
  was used to implement dependency-free canonical ATA derivation. Multiple
  hard-coded vectors were generated independently with `@solana/spl-token`
  0.4.8 and are enforced by the offline suite.
- The [Solana Pay specification](https://docs.solanapay.com/spec) determined
  the URI field set, compiled transfer reference placement, memo/transfer
  order, and the absence of a native expiry parameter.
- The official Circle
  [EURC contract-address registry](https://developers.circle.com/stablecoins/eurc-contract-addresses)
  is the source of the pinned Solana EURC mint; token symbols are never trusted.
- The public ZeroClaw v0.8.3 source was inspected to avoid claiming a CLI tool
  receipt that its direct `agent --message` path does not generate. ProofPay
  therefore distinguishes a sanitized execution trace, payment evidence, and
  GitHub build provenance as three separate artifacts.

## Community and operational scan

Discord, Reddit, forum, and repository discussions were treated as hypothesis
generators rather than protocol authority. Recurring operational concerns were
unreliable devnet faucets, wallet UIs that may not foreground memo/reference
details, and approval dialogs that summarize prose instead of the exact action.
They led to three release choices:

1. the payer remains external and test funding is completed before recording;
2. the demo prints the exact reference, full explorer transaction, and an
   independently verifiable evidence file;
3. the approval gate shows the fixed tool/action and the helper still
   re-derives every term rather than trusting model narration.

No mainnet asset, real ETH, seed phrase, or production wallet is needed for the
demonstration. Community anecdotes are not used to support security or protocol
claims; those claims link to primary specifications or papers above.

## Decision summary

The research consistently favors a narrow deterministic execution layer over a
more capable payment agent. ProofPay therefore optimizes for:

- exact intent equality rather than free-form model interpretation;
- an independent payer rather than agent custody;
- re-verification at execution time rather than trusting issuance alone;
- explicit expiry, idempotency, and fail-closed ambiguity;
- data/control separation and adversarial tests;
- observable tool dispatch, on-chain evidence, and build provenance with
  non-overlapping claims.

The remaining gaps are deliberate and documented: no cryptographic identity or
signed intent mandate, no native Solana Pay expiry enforcement, reliance on one
RPC transport by default, and no claim that a technical payment match proves
legal acceptance or work quality.
