# Reproduce ProofPay EURC on ZeroClaw 0.8.3

These steps reproduce the skill integration and narrow local helper from a
clean checkout, without a ZeroClaw runtime fork or wallet plugin. The agent does
not require or create a wallet and cannot move funds. The complete demonstration
uses a separate devnet payer for the external payment leg.

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

For stronger supply-chain verification, the official v0.8.3 release also
publishes GitHub artifact provenance. Run this against the downloaded release
artifact:

```sh
gh attestation verify <artifact> \
  --repo zeroclaw-labs/zeroclaw \
  --signer-workflow zeroclaw-labs/zeroclaw/.github/workflows/release-stable-manual.yml \
  --source-digest 24476b71d33eb1672a9495a7ce3d155377a60ce8
```

This verifies the upstream release artifact; it does not attest this ProofPay
repository or the local recording.

## 1. Inspect the trust surface

From the repository root:

```sh
sed -n '1,120p' proofpay/manifest.toml
sed -n '1,260p' proofpay/skills/proofpay-eurc/SKILL.md
sed -n '1,260p' proofpay/docs/THREAT_MODEL.md
```

The plugin manifest declares only `capabilities = ["skill"]`, has no
`wasm_path`, and requests no permissions. The helper is an executable reviewed
local script invoked only through six manifest-locked ZeroClaw wrappers. Raw
`shell` and generic `node` are absent from the model-visible tool surface. It
is not a WASM wallet or signing plugin.

## 2. Test the helper offline

```sh
npm test
npm run verify:live-evidence
```

Tests must cover URI construction, lowercase invoice canonicalization, exact
decimal parsing, path containment, atomic and idempotent persistence, conflicting
invoice terms, canonical associated token derivation, unique successful
finalized reference lookup, fixed expiry, transaction verification, offline and
online evidence verification, negative mismatches, and
prompt-injection-shaped inputs without connecting to a wallet.

The second command independently validates the committed evidence from the
recorded live devnet payment against the exact committed sample bytes. It needs
no wallet, credentials, runtime ledger, or network. To additionally repeat the
payment lookup and transaction checks against Solana devnet:

```sh
npm run verify:live-evidence:online
```

The online command is read-only and requires network access. Both modes state
that they do not authenticate the evidence producer.

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
allowlist contains five SOP control tools and six fixed `proofpay-demo`
wrappers, but no raw `shell`. Hash, preview, and compact list are non-mutating;
`create_sample_request` is always-ask and hard-locks every term plus all three
preview-match values; `check_sample_payment` can only reconcile the fixed
reference and persist a verified paid checkpoint; and
`write_sample_evidence` can only create the fixed paid evidence bundle. The
latter two are locally stateful but cannot sign or move funds. Generic `node`,
`sh`, browser, HTTP, MCP, and unrelated filesystem tools remain unavailable.
Starting an SOP can return a documented step that suggests `shell`, but it
cannot make raw shell dispatchable in this profile.

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
and passes the preview’s digest, reference, and URI verbatim to `create`. The
checkpoint also displays the fixed validity duration; successful creation
records the absolute `expiresAt`. The helper re-hashes and re-derives the
request under a single-writer lock.
The reconciliation SOP is bounded and read-only with respect to funds. Its
optional cron trigger runs every 15 minutes only while the ZeroClaw daemon/SOP
scheduler is active.

## 5. Configure a model without committing credentials

The supplied template uses ZeroClaw’s OpenAI Codex subscription slot and
contains no API key. Start ZeroClaw’s own login flow:

```sh
zeroclaw --config-dir .runtime/proofpay-repro \
  auth login --model-provider openai-codex
```

This is an operator action. Do not script it, paste a token into the repository,
or give ProofPay access to the auth file. If you use another model provider,
change only the provider/agent sections and preserve the risk profile, SOP
approval mode, and tool restrictions.

The recording provider is an operator choice and must not alter the risk
profile, fixed tool commands, approval policy, workspace boundary, or
repository template. Do not represent a model response as tool execution
unless the ZeroClaw trace shows the ordered parsed call, matching tool start,
and successful returned helper result in one trace and iteration.

## 6. Run the request-creation phase

Set only a public address you control:

```sh
export PROOFPAY_RECIPIENT="<SOLANA_PUBLIC_ADDRESS>"
bash ./proofpay/demo/run-demo.sh
```

This auxiliary local script stops before payment. It writes the preview to a
private temporary file, displays it, and
pauses for typed approval. It parses `preview.approval` with Node.js—no `jq` is
required—and passes its exact digest, reference, and URI to `create`. Creation
re-hashes the file and re-derives the request, so any change fails closed before
local persistence. An identical retry is idempotent; reusing the invoice ID for
different terms fails with `INVOICE_CONFLICT`. The script does not open a
wallet, sign, submit, send, or refund. The sample file is deliberately
non-sensitive and lives at:

```text
proofpay/deliverables/sample-milestone.txt
```

Its expected SHA-256 is:

```text
4a3adafc3eeaa1670c5acd78349af5db9755c89efa0f9015f9bc293392ec20c8
```

The preview carries `validForSeconds = 604800`, but its reference does not bind
an absolute preview time and the Solana Pay URI cannot expire itself. Treat the
ZeroClaw `always_ask` prompt at the actual create invocation as the freshness
checkpoint. `create` records the absolute `expiresAt`.

To preview without persistence:

```sh
./proofpay/tools/proofpay.mjs preview \
  --invoice demo-atlas-m3 \
  --recipient "${PROOFPAY_RECIPIENT}" \
  --amount 5.00 \
  --network devnet \
  --deliverable sample-milestone.txt
```

## 7. Exercise the real Telegram channel

Keep the credential-bearing runtime outside the checkout. Create a new one
under a temporary root; do not reuse the CLI runtime from the earlier checks:

```sh
sh ./proofpay/demo/prepare-zeroclaw-demo.sh \
  proofpay-telegram /private/tmp/proofpay-runtime

zeroclaw --config-dir \
  /private/tmp/proofpay-runtime/proofpay-telegram \
  auth login --model-provider openai-codex

sh ./proofpay/demo/configure-telegram-demo.sh \
  /private/tmp/proofpay-runtime/proofpay-telegram
```

Create a temporary bot with Telegram's `@BotFather`, but never put its token in
this repository, a chat message, a shell argument, or an environment variable.
The OpenAI Codex auth profile is scoped to this exact config directory; the
configuration script fails before accepting a bot token if that profile is
missing. Use BotFather `/setjoingroups` to disable group joins, then type the
script's explicit confirmation. The script accepts only the prepared config
directory. ZeroClaw itself prompts for the token with masked input and persists
only its encrypted form. The script refuses a non-temporary or symlinked
runtime, a pre-existing ledger/evidence directory, a non-stock version, any
extra or type-wide peer group, and an unhealthy Telegram credential.

Start the channel in the foreground using the command printed by the setup
script:

```sh
zeroclaw --config-dir \
  /private/tmp/proofpay-runtime/proofpay-telegram \
  --log-level info channel start
```

The immutable `info` trace floor is required: the sanitized verifier needs the
provider receive, tool start, and tool completion events. A default
warning-only poller can deliver messages successfully while omitting those
proof records, so do not reuse one for the final flow.

When `channel start` prints the one-time bind code in the private terminal,
open a **private DM** with the bot and send the displayed `/bind <code>` command
from the one intended account. The bot may also return a pairing hint, but the
secret code originates in the operator terminal. Pair only the resulting
numeric Telegram identity; never use `external_peers = ["*"]`, a group chat,
or a second bot poller. The committed template is disabled and has an empty
peer set, so it denies every sender until this explicit pairing occurs.

`channel doctor` proves only that Telegram accepts the bot credential. Before
recording, send this real private-DM canary:

```text
PROOFPAY_CANARY: Do not call any tool. Reply with exactly
PROOFPAY_CANARY_OK and nothing else.
```

Require the exact `PROOFPAY_CANARY_OK` reply, inspect the daemon for no `409`
poller conflict, then send `/new` to clear that canary session. This jointly
exercises Telegram receive/send, the paired peer, channel routing, the
temporary runtime's model auth, and the provider. It is still not payment-tool
evidence; the subsequent channel-attributed trace checks provide that.

For the fixed non-persistent preview, send:

```text
Run the fixed ProofPay devnet preview through the proofpay-demo tool.
Return only the actual tool result; do not calculate or invent any field.
```

A valid preview claim requires the current session trace to show an ordered
parsed `proofpay-demo__preview_sample` call, matching tool-start event, and
successful returned helper JSON attributed to `telegram.proofpay` and agent
`proofpay`. To demonstrate the approval gate and one real local state
transition, then send:

```text
Create the one fixed ProofPay demo request with create_sample_request.
```

ZeroClaw must display its native Telegram inline approval for
`proofpay-demo__create_sample_request`. The card authorizes that named fixed
wrapper; stock v0.8.3 does not repeat its manifest-locked arguments in the
card. Compare the exact amount, digest, reference, and URI in the preceding
preview, then tap the one-shot **Approve** action; never choose **Always**. An
unanswered prompt expires as a denial after 120 seconds. The trace must then
show, in one trace and iteration, the ordered parsed wrapper call, matching
tool-start event, and successful helper JSON with canonical ID
`demo-atlas-m3`, status `pending`, channel `telegram.proofpay`, and agent
`proofpay`; the sanitized summary prints
`ordered_parse_start_result=true`. Its command, digest, reference, and complete
URI are hard-locked in `SKILL.toml`; caller arguments cannot override them. A
second approved invocation cannot overwrite the request: an exact retry
returns the existing request with `idempotent: true`, while different terms
for the same ID fail with `INVOICE_CONFLICT`. Merely receiving model prose or
an echoed command is not evidence of dispatch.

Sanitize and verify a specific tool trace without publishing the raw
conversation trace:

```sh
node ./proofpay/demo/summarize-runtime-trace.mjs \
  /private/tmp/proofpay-runtime/proofpay-telegram/data/state/runtime-trace.jsonl \
  proofpay-demo__create_sample_request \
  --channel telegram.proofpay
```

Stock v0.8.3 runs its outbound redactor before recording tool output. It keeps
the complete public EURC mint in `result.mint`, but may replace that same value
only inside the URI with `Hzwq*[REDACTED]`. The verifier accepts either the
byte-exact canonical URI or only that byte-exact stock form, requires the
separate mint/recipient/reference fields to remain complete and canonical, and
prints `uri_trace_form`. Any other shortening, key removal, label change, or
mint substitution fails.

The raw trace, encrypted token, paired user/chat identifiers, and session
metadata remain private temporary artifacts. The direct CLI agent remains a
fallback for environments without Telegram:

```sh
zeroclaw agent \
  --config-dir .runtime/proofpay-repro \
  --agent proofpay
```

The general `proofpay-eurc` SOPs remain inspectable reference workflows for an
operator-managed deployment. Their dynamic shell steps are deliberately not
available through this fixed-only demonstration profile.

## 8. Reproduce the real devnet `pending → paid → evidence` path

The signing step occurs outside ProofPay:

1. obtain test-only devnet assets from an official faucet where available;
2. open the generated URI in a compatible payer wallet;
3. inspect network, recipient, amount, mint, and reference;
4. confirm the compiled final SPL transfer carries the reference as its
   additional readonly non-signer account and targets the recipient’s canonical
   associated token account for EURC;
5. confirm the request has not passed its displayed `expiresAt`;
6. sign in the payer wallet only if you intend to run the test.

ProofPay cannot perform any of these wallet actions.

After the transaction finalizes, ask the same Telegram DM to call only the
fixed reconciliation tool:

```text
Call proofpay-demo__check_sample_payment exactly once. Return only its actual
compact result.
```

The actual tool result must show `status: paid` and the finalized signature.
Then ask:

```text
Call proofpay-demo__write_sample_evidence exactly once for the verified sample.
Return only its actual compact result.
```

The result must show `status: evidence-written` and the same signature. These
tools may write the paid checkpoint and evidence bundle locally, but have no
wallet or fund-moving capability. The final short video must visibly show the
real Telegram agent calls, inline approval, and results, not only direct helper
commands or model prose. Run the trace summarizer for the reconciliation and
evidence tools with `--channel telegram.proofpay`.

Independently validate the pack:

```sh
cd /private/tmp/proofpay-runtime/proofpay-telegram/agents/proofpay/workspace

./proofpay/tools/proofpay.mjs verify-evidence \
  --evidence proofpay/evidence/demo-atlas-m3.evidence/evidence.json \
  --deliverable proofpay/deliverables/sample-milestone.txt

./proofpay/tools/proofpay.mjs verify-evidence \
  --evidence proofpay/evidence/demo-atlas-m3.evidence/evidence.json \
  --deliverable proofpay/deliverables/sample-milestone.txt \
  --online
```

The first command checks artifact integrity and self-consistency without a
network call. The second additionally repeats the exact on-chain lookup through
the allowlisted network RPC. Neither mode authenticates the evidence producer.
Use `proofpay/docs/EVIDENCE.md` for the complete verification scope.

After capture, stop the channel, revoke the temporary bot token in BotFather,
and remove the entire temporary runtime. Do not publish its config, raw trace,
session database, paired numeric identity, or notification/sidebar metadata.

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

## 11. Verify the tested source bundle

Build the deterministic archive from committed Git objects rather than
uncommitted runtime state:

```sh
node scripts/build-submission-bundle.mjs --source-ref HEAD --verify
```

For checksum commands, CI provenance, GitHub attestation scope, and explicit
limitations, follow [`SUPPLY_CHAIN.md`](./SUPPLY_CHAIN.md).
