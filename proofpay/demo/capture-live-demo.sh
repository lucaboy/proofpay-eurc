#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /private/tmp/<prepared-proofpay-runtime>" >&2
  exit 2
fi

CONFIG_DIR=$1
case "${CONFIG_DIR}" in
  /private/tmp/*) ;;
  *)
    echo "The local recording runtime must live under /private/tmp." >&2
    exit 2
    ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)
ZEROCLAW_BIN=${PROOFPAY_ZEROCLAW_BIN:-"${REPO_ROOT}/.tools/zeroclaw-v0.8.3/zeroclaw"}
WORKSPACE_DIR="${CONFIG_DIR}/agents/proofpay/workspace"
TRACE_PATH="${CONFIG_DIR}/data/state/runtime-trace.jsonl"
LEDGER_PATH="${WORKSPACE_DIR}/proofpay/data/invoices.json"
PAYER_SCRIPT=${PROOFPAY_DEVNET_PAYER_SCRIPT:-}

if [ ! -x "${ZEROCLAW_BIN}" ]; then
  echo "ZeroClaw 0.8.3 binary not found: ${ZEROCLAW_BIN}" >&2
  exit 2
fi
if [ ! -f "${CONFIG_DIR}/config.toml" ]; then
  echo "Prepared runtime config not found: ${CONFIG_DIR}/config.toml" >&2
  exit 2
fi
if [ -e "${LEDGER_PATH}" ]; then
  echo "Recording runtime is not fresh; a request ledger already exists." >&2
  exit 2
fi
case "${PAYER_SCRIPT}" in
  /private/tmp/*) ;;
  *)
    echo "Set PROOFPAY_DEVNET_PAYER_SCRIPT to the prepared private /private/tmp payer script." >&2
    exit 2
    ;;
esac
if [ ! -f "${PAYER_SCRIPT}" ] || [ -L "${PAYER_SCRIPT}" ]; then
  echo "External devnet payer script is missing or unsafe: ${PAYER_SCRIPT}" >&2
  exit 2
fi

TEST_LOG=$(mktemp /private/tmp/proofpay-tests.XXXXXX)
trap 'rm -f "${TEST_LOG}"' EXIT HUP INT TERM

printf '\033[2J\033[H'
printf '%s\n' \
  "PROOFPAY EURC — REAL ZEROCLAW AGENT / EXTERNAL PAYER" \
  "====================================================="
printf 'source_commit=%s\n' "$(git -C "${REPO_ROOT}" rev-parse HEAD)"
"${ZEROCLAW_BIN}" --version
printf '%s\n\n' \
  "fixed Circle EURC mint · deliverable SHA-256 · human approval · finalized verification"

printf '%s\n' "1) OFFLINE SECURITY SUITE"
(cd "${REPO_ROOT}" && npm test >"${TEST_LOG}")
grep -E '^([0-9]+ tests|[0-9]+/[0-9]+ tests) passed$' "${TEST_LOG}"
printf '\n'

printf '%s\n' "2) LOCKED ZEROCLAW SKILL SURFACE"
"${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" skills list --agent proofpay
printf '%s\n\n' "Raw shell, wallet, browser, HTTP, and signing tools are not exposed."

printf '%s\n' "3) DIRECT FIXED-HELPER PREVIEW (CANONICAL, NON-PERSISTENT)"
(
  cd "${WORKSPACE_DIR}"
  ./proofpay/tools/proofpay.mjs preview \
    --invoice demo-atlas-m1 \
    --recipient CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8 \
    --amount 12.50 \
    --network devnet \
    --deliverable sample-milestone.txt
) | grep -E '"(status|id|network|currency|mint|amount|reference|sha256|solanaPayUri)"'
printf '%s\n\n' \
  "The full URI above is canonical. ZeroClaw capture redaction may shorten the public mint."

printf '%s\n' "4) ZEROCLAW MODEL CALL + EXPLICIT APPROVAL CHECKPOINT"
export PROOFPAY_VIDEO_ZEROCLAW="${ZEROCLAW_BIN}"
export PROOFPAY_VIDEO_CONFIG="${CONFIG_DIR}"
export PROOFPAY_VIDEO_MESSAGE="Call proofpay-demo__create_sample_request exactly once to persist the fixed demo-atlas-m1 devnet request. Do not call any other tool. After the actual tool result, reply in one line with the request id, status, and that no funds moved."

/usr/bin/expect <<'EXPECT_EOF'
set timeout 300
set env(NO_COLOR) 1
spawn -noecho $env(PROOFPAY_VIDEO_ZEROCLAW) \
  --config-dir $env(PROOFPAY_VIDEO_CONFIG) \
  agent --agent proofpay --log-level info \
  --message $env(PROOFPAY_VIDEO_MESSAGE)
expect {
  -re {proofpay-demo__create_sample_request: *$} {
    send -- "y\r"
    exp_continue
  }
  eof {}
  timeout {
    puts stderr "Timed out waiting for the local ZeroClaw agent"
    exit 124
  }
}
catch wait result
exit [lindex $result 3]
EXPECT_EOF

printf '\n%s\n' "5) VERIFIED TRACE + PERSISTED RESULT"
node "${SCRIPT_DIR}/summarize-runtime-trace.mjs" \
  "${TRACE_PATH}" \
  "proofpay-demo__create_sample_request"

printf '\n%s\n' "6) INDEPENDENT DEVNET PAYER (OUTSIDE ZEROCLAW)"
printf '%s\n' \
  "The payer key stays in a private temporary file and is never copied into the agent."
node "${PAYER_SCRIPT}" transfer

printf '\n%s\n' "7) ZEROCLAW RECONCILES THE FIXED REFERENCE"
export PROOFPAY_VIDEO_MESSAGE="Call proofpay-demo__check_sample_payment exactly once. Do not call any other tool. After the actual tool result, reply in one line with the invoice id, paid status, and finalized signature."
NO_COLOR=1 "${ZEROCLAW_BIN}" \
  --config-dir "${CONFIG_DIR}" \
  agent --agent proofpay --log-level info \
  --message "${PROOFPAY_VIDEO_MESSAGE}"
node "${SCRIPT_DIR}/summarize-runtime-trace.mjs" \
  "${TRACE_PATH}" \
  "proofpay-demo__check_sample_payment"

printf '\n%s\n' "8) ZEROCLAW WRITES IMMUTABLE EVIDENCE"
export PROOFPAY_VIDEO_MESSAGE="Call proofpay-demo__write_sample_evidence exactly once for demo-atlas-m1. Do not call any other tool. After the actual tool result, reply in one line with the evidence schema and path."
NO_COLOR=1 "${ZEROCLAW_BIN}" \
  --config-dir "${CONFIG_DIR}" \
  agent --agent proofpay --log-level info \
  --message "${PROOFPAY_VIDEO_MESSAGE}"
node "${SCRIPT_DIR}/summarize-runtime-trace.mjs" \
  "${TRACE_PATH}" \
  "proofpay-demo__write_sample_evidence"

printf '\n%s\n' "9) INDEPENDENT ONLINE EVIDENCE VERIFICATION"
(
  cd "${WORKSPACE_DIR}"
  ./proofpay/tools/proofpay.mjs verify-evidence \
    --evidence proofpay/evidence/demo-atlas-m1.evidence/evidence.json \
    --deliverable proofpay/deliverables/sample-milestone.txt \
    --online
) | grep -E '"(ok|verification|invoiceId|paymentSignature|onChainLookupPerformed|onChainPayment)"'

printf '\n%s\n' \
  "RESULT: pending → finalized paid → schema-v3 evidence, through stock ZeroClaw." \
  "The agent never received a key and cannot sign, submit, transfer, or refund." \
  "https://github.com/lucaboy/proofpay-eurc"
