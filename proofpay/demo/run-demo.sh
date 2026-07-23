#!/usr/bin/env bash
set -euo pipefail

umask 077

if [[ -z "${PROOFPAY_RECIPIENT:-}" ]]; then
  echo "Set PROOFPAY_RECIPIENT to a Solana address you control." >&2
  echo "The demo never creates a wallet, signs, sends, refunds, or moves funds." >&2
  exit 2
fi

PROOFPAY_DEMO_NETWORK="${PROOFPAY_DEMO_NETWORK:-devnet}"
PROOFPAY_DEMO_ID="${PROOFPAY_DEMO_ID:-demo-atlas-m1}"
PROOFPAY_DEMO_AMOUNT="${PROOFPAY_DEMO_AMOUNT:-12.50}"

PROOFPAY_DEMO_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/proofpay-demo.XXXXXX")"
PROOFPAY_DEMO_PREVIEW="${PROOFPAY_DEMO_TMPDIR}/preview.json"
readonly PROOFPAY_DEMO_TMPDIR PROOFPAY_DEMO_PREVIEW

proofpay_demo_cleanup() {
  rm -f -- "${PROOFPAY_DEMO_PREVIEW}"
  rmdir -- "${PROOFPAY_DEMO_TMPDIR}"
}
trap proofpay_demo_cleanup EXIT

./proofpay/tools/proofpay.mjs preview \
  --invoice "${PROOFPAY_DEMO_ID}" \
  --recipient "${PROOFPAY_RECIPIENT}" \
  --amount "${PROOFPAY_DEMO_AMOUNT}" \
  --network "${PROOFPAY_DEMO_NETWORK}" \
  --deliverable sample-milestone.txt \
  >"${PROOFPAY_DEMO_PREVIEW}"

sed -n '1,260p' "${PROOFPAY_DEMO_PREVIEW}"

proofpay_preview_field() {
  node -e '
    const fs = require("node:fs");
    const preview = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (
      preview.approval?.schemaVersion !== 1 ||
      preview.approval?.deliverableSha256 !== preview.deliverable?.sha256 ||
      preview.approval?.reference !== preview.reference ||
      preview.approval?.solanaPayUri !== preview.solanaPayUri
    ) {
      process.stderr.write("Preview approval object does not match the displayed terms.\n");
      process.exit(2);
    }
    const value = preview.approval && preview.approval[process.argv[2]];
    if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) {
      process.stderr.write(`Invalid preview approval field: ${process.argv[2]}\n`);
      process.exit(2);
    }
    process.stdout.write(value);
  ' "${PROOFPAY_DEMO_PREVIEW}" "$1"
}

PROOFPAY_APPROVE_DIGEST="$(proofpay_preview_field deliverableSha256)"
PROOFPAY_APPROVE_REFERENCE="$(proofpay_preview_field reference)"
PROOFPAY_APPROVE_URI="$(proofpay_preview_field solanaPayUri)"

echo
echo "Review the full recipient, amount, network, EURC mint, digest, reference,"
echo "and URI above. The three approval values are read from this exact preview."
echo "Creation re-hashes and re-derives the request, then writes immutable local"
echo "metadata only if digest, reference, and URI still match byte-for-byte."
printf 'Type "CREATE %s" to approve these exact terms: ' "${PROOFPAY_DEMO_ID}"
read -r PROOFPAY_DEMO_APPROVAL

if [[ "${PROOFPAY_DEMO_APPROVAL}" != "CREATE ${PROOFPAY_DEMO_ID}" ]]; then
  echo "Not approved; no request was created."
  exit 0
fi

./proofpay/tools/proofpay.mjs create \
  --invoice "${PROOFPAY_DEMO_ID}" \
  --recipient "${PROOFPAY_RECIPIENT}" \
  --amount "${PROOFPAY_DEMO_AMOUNT}" \
  --network "${PROOFPAY_DEMO_NETWORK}" \
  --deliverable sample-milestone.txt \
  --approve-digest "${PROOFPAY_APPROVE_DIGEST}" \
  --approve-reference "${PROOFPAY_APPROVE_REFERENCE}" \
  --approve-uri "${PROOFPAY_APPROVE_URI}"

./proofpay/tools/proofpay.mjs list

echo
echo "Open the emitted Solana Pay URI in a wallet only if you intentionally want"
echo "to test a payment. Nothing in this demo signs or submits a transaction."
echo
echo "After an independently signed payment, reconcile with:"
echo "  ./proofpay/tools/proofpay.mjs check --invoice ${PROOFPAY_DEMO_ID}"
