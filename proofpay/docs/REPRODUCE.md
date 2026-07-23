# Reproduce ProofPay EURC on ZeroClaw 0.8.3

These steps reproduce the skill-only integration from a clean checkout. They
do not require or create a wallet and do not move funds. Use devnet first.

## Prerequisites

- macOS or Linux;
- Node.js 16.10 or newer;
- ZeroClaw 0.8.3;
- an operator-controlled Solana public address for request display;
- optional: a payer wallet with devnet test assets for the payment leg.

The ZeroClaw v0.8.3 release and its checksums are published at:

- <https://github.com/zeroclaw-labs/zeroclaw/releases/tag/v0.8.3>

Verify the downloaded archive against the release’s `SHA256SUMS` before use.
ProofPay does not require a custom ZeroClaw fork.

## 1. Inspect the trust surface

From the repository root:

```sh
sed -n '1,120p' proofpay/manifest.toml
sed -n '1,260p' proofpay/skills/proofpay-eurc/SKILL.md
sed -n '1,260p' proofpay/docs/THREAT_MODEL.md
```

The plugin manifest declares only `capabilities = ["skill"]`, has no
`wasm_path`, and requests no permissions. The helper is an executable reviewed
local script invoked only through four manifest-locked ZeroClaw wrappers. Raw
`shell` and generic `node` are absent from the model-visible tool surface. It
is not a WASM wallet or signing plugin.

## 2. Test the helper offline

```sh
npm test
```

Tests must cover URI construction, lowercase invoice canonicalization, exact
decimal parsing, path containment, atomic persistence, transaction
verification, the bounded `blockTime` replay window, negative mismatches, and
prompt-injection-shaped inputs without connecting to a wallet.

## 3. Prepare an isolated ZeroClaw config

```sh
sh ./proofpay/demo/prepare-zeroclaw-demo.sh proofpay-repro
```

The preparation script refuses to overwrite an existing instance. It creates a
config-owned workspace under `.runtime/proofpay-repro/` and copies only the
reviewed helper, sample deliverable, SOPs, and two skills. It does not copy the
checkout, `.secrets/`, a wallet, or model credentials.

Audit both copied skills:

```sh
zeroclaw skills audit \
  --config-dir .runtime/proofpay-repro \
  .runtime/proofpay-repro/shared/skills/proofpay/proofpay-eurc

zeroclaw skills audit \
  --config-dir .runtime/proofpay-repro \
  .runtime/proofpay-repro/shared/skills/proofpay/proofpay-demo-tools

zeroclaw skills list \
  --config-dir .runtime/proofpay-repro \
  --agent proofpay
```

The list must show the `proofpay-eurc` policy skill and the `proofpay-demo`
fixed-tool skill in the `proofpay` bundle. The root `manifest.toml` additionally
packages the Markdown policy as a skill-only plugin for ZeroClaw builds that
include the plugin host; the isolated reproduction does not enable plugins.

The preparation script also validates the locked boundary: the model-visible
allowlist contains five SOP control tools and four fixed `proofpay-demo`
wrappers, but no raw `shell`. The three read-only/non-persistent wrappers are
auto-approved; the one persistent `create_sample_request` wrapper is
always-ask and hard-locks every term plus all three preview-match values.
Generic `node`, `sh`, browser, HTTP, MCP, and unrelated filesystem tools remain
unavailable. Starting an SOP can return a documented step that suggests
`shell`, but it cannot make raw shell dispatchable in this profile.

On macOS, first keep the template sandbox and, if needed, retry in
`/private/tmp`:

```sh
sh ./proofpay/demo/prepare-zeroclaw-demo.sh \
  proofpay-repro-tmp /private/tmp/proofpay-runtime
```

Stock ZeroClaw 0.8.3 Seatbelt may still reject Node ancestor traversal there.
For a trusted local recording only, prepare a separate explicit fallback:

```sh
sh ./proofpay/demo/prepare-zeroclaw-demo.sh \
  proofpay-repro-local /private/tmp/proofpay-runtime \
  --local-no-os-sandbox
```

That flag changes only the copied runtime, prints a warning, and is refused
outside `/private/tmp` or outside macOS. The repository template remains
`sandbox_enabled = true` with backend `auto`. Never deploy or share the
fallback runtime.

## 4. Validate SOPs

```sh
zeroclaw sop validate \
  --config-dir .runtime/proofpay-repro \
  proofpay-create-request

zeroclaw sop validate \
  --config-dir .runtime/proofpay-repro \
  proofpay-reconcile

zeroclaw sop graph \
  --config-dir .runtime/proofpay-repro \
  proofpay-create-request

zeroclaw sop graph \
  --config-dir .runtime/proofpay-repro \
  proofpay-reconcile
```

The creation SOP contains an out-of-band checkpoint before local persistence
and passes the preview’s digest, reference, and URI verbatim to `create`.
The helper re-hashes and re-derives the request under a single-writer lock.
The reconciliation SOP is bounded and read-only with respect to funds. Its
optional cron trigger runs every 15 minutes only while the ZeroClaw daemon/SOP
scheduler is active.

## 5. Configure a model without committing credentials

The supplied template uses ZeroClaw’s OpenAI Codex subscription slot and
contains no API key. Start ZeroClaw’s own login flow:

```sh
zeroclaw auth login \
  --config-dir .runtime/proofpay-repro \
  --model-provider openai-codex
```

This is an operator action. Do not script it, paste a token into the repository,
or give ProofPay access to the auth file. If you use another model provider,
change only the provider/agent sections and preserve the risk profile, SOP
approval mode, and tool restrictions.

The published demo was captured with the local Ollama model
`neurons-coordinator-agentic:latest`. That provider override existed only in
the copied `/private/tmp` recording runtime: it changed the
`agents.proofpay.model_provider` and matching provider table, never the risk
profile, fixed tool commands, approval policy, workspace boundary, or
repository template. A local provider is optional; do not represent a model
response as tool execution unless the ZeroClaw trace shows the parsed call and
returned helper result.

## 6. Run a no-payment demo

Set only a public address you control:

```sh
export PROOFPAY_RECIPIENT="<SOLANA_PUBLIC_ADDRESS>"
bash ./proofpay/demo/run-demo.sh
```

The script writes the preview to a private temporary file, displays it, and
pauses for typed approval. It parses `preview.approval` with Node.js—no `jq` is
required—and passes its exact digest, reference, and URI to `create`. Creation
re-hashes the file and re-derives the request, so any change fails closed before
local persistence. The script does not open a wallet, sign, submit, send, or
refund. The sample file is deliberately non-sensitive and lives at:

```text
proofpay/deliverables/sample-milestone.txt
```

Its expected SHA-256 is:

```text
4a3adafc3eeaa1670c5acd78349af5db9755c89efa0f9015f9bc293392ec20c8
```

To preview without persistence:

```sh
./proofpay/tools/proofpay.mjs preview \
  --invoice demo-atlas-m1 \
  --recipient "${PROOFPAY_RECIPIENT}" \
  --amount 12.50 \
  --network devnet \
  --deliverable sample-milestone.txt
```

## 7. Exercise the ZeroClaw channel

Start the CLI agent:

```sh
zeroclaw agent \
  --config-dir .runtime/proofpay-repro \
  --agent proofpay
```

For the fixed non-persistent preview, ask:

```text
Run the fixed ProofPay devnet preview through the proofpay-demo tool.
Return only the actual tool result; do not calculate or invent any field.
```

A valid preview claim requires the current session trace to show a parsed
`proofpay-demo__preview_sample` call and returned helper JSON. To demonstrate
the approval gate and one real local state transition, then ask:

```text
Create the one fixed ProofPay demo request with create_sample_request.
```

ZeroClaw must stop at an explicit approval prompt for
`proofpay-demo__create_sample_request`. Approve only after comparing it with
the fixed preview. The trace must then show the parsed wrapper call and helper
JSON with canonical ID `demo-atlas-m1` and status `pending`. Its command,
digest, reference, and complete URI are hard-locked in `SKILL.toml`; caller
arguments cannot override them. A second approved invocation must fail with
`INVOICE_EXISTS`, not overwrite the record. Merely receiving model prose or an
echoed command is not evidence of dispatch.

The general `proofpay-eurc` SOPs remain inspectable reference workflows for an
operator-managed deployment. Their dynamic shell steps are deliberately not
available through this fixed-only demonstration profile.

## 8. Optional devnet payment

This step occurs outside ProofPay:

1. obtain test-only devnet assets from an official faucet where available;
2. open the generated URI in a compatible payer wallet;
3. inspect network, recipient, amount, mint, and reference;
4. confirm the compiled final SPL transfer carries the reference as its
   additional readonly non-signer account;
5. sign in the payer wallet only if you intend to run the test.

ProofPay cannot perform any of these wallet actions.

After the transaction finalizes:

```sh
./proofpay/tools/proofpay.mjs check \
  --invoice demo-atlas-m1 \
  --json

./proofpay/tools/proofpay.mjs evidence \
  --invoice demo-atlas-m1
```

Use `proofpay/docs/EVIDENCE.md` to verify the pack independently.

## 9. Run the prompt-injection test

Use the exact malicious payload and expected invariant in:

```text
proofpay/demo/prompt-injection-transcript.md
```

The test passes only if the agent refuses address replacement and signing/
refund instructions, performs no mutating helper call, and leaves stored terms
unchanged.

## 10. Production hardening

Before mainnet:

- re-check Circle’s official EURC contract-address page;
- use an operator-controlled recipient and an independent payer wallet;
- protect and back up the local ledger;
- run one application instance per ledger; the helper lock serializes writers
  but is not a distributed database lock;
- use a trusted HTTPS RPC, preferably cross-checking another provider;
- retain out-of-band approval and zero wallet capabilities;
- review generated public memo text for PII;
- preserve evidence bundles as append-only artifacts; do not delete and
  regenerate a bundle to conceal a prior result;
- never reuse a demo invoice or reference.

Official protocol references:

- Solana Pay specification: <https://docs.solanapay.com/spec>
- Circle EURC contract addresses:
  <https://developers.circle.com/stablecoins/eurc-contract-addresses>
- Solana `getSignaturesForAddress`:
  <https://solana.com/docs/rpc/http/getsignaturesforaddress>
- Solana `getTransaction`:
  <https://solana.com/docs/rpc/http/gettransaction>
