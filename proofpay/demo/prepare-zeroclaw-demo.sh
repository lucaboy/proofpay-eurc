#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)
INSTANCE_NAME=${1:-proofpay-demo}
RUNTIME_ROOT=${2:-"${REPO_ROOT}/.runtime"}
LOCAL_SANDBOX_MODE=${3:-}

if [ "$#" -gt 3 ]; then
  echo "Usage: $0 [instance] [absolute-runtime-root] [--local-no-os-sandbox]" >&2
  exit 2
fi

case "${LOCAL_SANDBOX_MODE}" in
  "") ;;
  "--local-no-os-sandbox")
    if [ "$(uname -s)" != "Darwin" ]; then
      echo "--local-no-os-sandbox is a macOS-only ZeroClaw 0.8.3 demo workaround." >&2
      exit 2
    fi
    case "${RUNTIME_ROOT}" in
      /private/tmp/*) ;;
      *)
        echo "--local-no-os-sandbox is allowed only under /private/tmp." >&2
        exit 2
        ;;
    esac
    ;;
  *)
    echo "Unknown preparation mode: ${LOCAL_SANDBOX_MODE}" >&2
    echo "Expected --local-no-os-sandbox or no third argument." >&2
    exit 2
    ;;
esac

case "${INSTANCE_NAME}" in
  ""|*[!A-Za-z0-9_-]*)
    echo "Instance name must use only letters, digits, underscore, or hyphen." >&2
    exit 2
    ;;
esac

case "${RUNTIME_ROOT}" in
  /*) ;;
  *)
    echo "Runtime root must be an absolute path: ${RUNTIME_ROOT}" >&2
    exit 2
    ;;
esac

CONFIG_DIR="${RUNTIME_ROOT}/${INSTANCE_NAME}"
WORKSPACE="${CONFIG_DIR}/agents/proofpay/workspace"
SOPS_DIR="${CONFIG_DIR}/data/sops"
BUNDLE_DIR="${CONFIG_DIR}/shared/skills/proofpay"

if [ -L "${RUNTIME_ROOT}" ]; then
  echo "Refusing symlinked runtime root: ${RUNTIME_ROOT}" >&2
  exit 2
fi

if [ -e "${CONFIG_DIR}" ] || [ -L "${CONFIG_DIR}" ]; then
  echo "Refusing to overwrite existing runtime directory: ${CONFIG_DIR}" >&2
  echo "Use a new instance name to create a clean isolated copy." >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 16 or newer is required to prepare the ProofPay demo." >&2
  exit 2
fi

REQUIRED_SOURCES="
proofpay/config/zeroclaw.template.toml
proofpay/tools/proofpay.mjs
proofpay/src/core.mjs
proofpay/deliverables/sample-milestone.txt
proofpay/sops/create-request/SOP.toml
proofpay/sops/create-request/SOP.md
proofpay/sops/reconcile/SOP.toml
proofpay/sops/reconcile/SOP.md
proofpay/skills/proofpay-eurc/SKILL.md
proofpay/skills/proofpay-demo-tools/SKILL.toml
"

for SOURCE_REL in ${REQUIRED_SOURCES}; do
  SOURCE_PATH="${REPO_ROOT}/${SOURCE_REL}"
  if [ ! -f "${SOURCE_PATH}" ] || [ -L "${SOURCE_PATH}" ]; then
    echo "Missing, non-regular, or symlinked source: ${SOURCE_PATH}" >&2
    exit 2
  fi
done

if [ ! -x "${REPO_ROOT}/proofpay/tools/proofpay.mjs" ]; then
  echo "ProofPay helper must be executable: ${REPO_ROOT}/proofpay/tools/proofpay.mjs" >&2
  exit 2
fi

umask 077

install -d -m 0700 \
  "${CONFIG_DIR}" \
  "${WORKSPACE}/proofpay/src" \
  "${WORKSPACE}/proofpay/tools" \
  "${WORKSPACE}/proofpay/data" \
  "${WORKSPACE}/proofpay/deliverables" \
  "${SOPS_DIR}/create-request" \
  "${SOPS_DIR}/reconcile" \
  "${BUNDLE_DIR}/proofpay-eurc" \
  "${BUNDLE_DIR}/proofpay-demo-tools"

install -m 0600 \
  "${REPO_ROOT}/proofpay/config/zeroclaw.template.toml" \
  "${CONFIG_DIR}/config.toml"

if [ "${LOCAL_SANDBOX_MODE}" = "--local-no-os-sandbox" ]; then
  if [ "$(grep -c '^sandbox_enabled = true$' "${CONFIG_DIR}/config.toml")" -ne 1 ] || \
     [ "$(grep -c '^sandbox_backend = \"auto\"$' "${CONFIG_DIR}/config.toml")" -ne 1 ]; then
    echo "Refusing local fallback: expected sandbox settings were not found exactly once." >&2
    exit 2
  fi
  sed \
    -e 's/^sandbox_enabled = true$/sandbox_enabled = false/' \
    -e 's/^sandbox_backend = "auto"$/sandbox_backend = "none"/' \
    "${CONFIG_DIR}/config.toml" >"${CONFIG_DIR}/config.toml.local"
  mv "${CONFIG_DIR}/config.toml.local" "${CONFIG_DIR}/config.toml"
fi

install -m 0500 \
  "${REPO_ROOT}/proofpay/tools/proofpay.mjs" \
  "${WORKSPACE}/proofpay/tools/proofpay.mjs"

install -m 0400 \
  "${REPO_ROOT}/proofpay/src/core.mjs" \
  "${WORKSPACE}/proofpay/src/core.mjs"

install -m 0400 \
  "${REPO_ROOT}/proofpay/deliverables/sample-milestone.txt" \
  "${WORKSPACE}/proofpay/deliverables/sample-milestone.txt"

install -m 0400 \
  "${REPO_ROOT}/proofpay/sops/create-request/SOP.toml" \
  "${SOPS_DIR}/create-request/SOP.toml"
install -m 0400 \
  "${REPO_ROOT}/proofpay/sops/create-request/SOP.md" \
  "${SOPS_DIR}/create-request/SOP.md"
install -m 0400 \
  "${REPO_ROOT}/proofpay/sops/reconcile/SOP.toml" \
  "${SOPS_DIR}/reconcile/SOP.toml"
install -m 0400 \
  "${REPO_ROOT}/proofpay/sops/reconcile/SOP.md" \
  "${SOPS_DIR}/reconcile/SOP.md"

install -m 0400 \
  "${REPO_ROOT}/proofpay/skills/proofpay-eurc/SKILL.md" \
  "${BUNDLE_DIR}/proofpay-eurc/SKILL.md"
install -m 0400 \
  "${REPO_ROOT}/proofpay/skills/proofpay-demo-tools/SKILL.toml" \
  "${BUNDLE_DIR}/proofpay-demo-tools/SKILL.toml"

FOUND_LINK=$(find "${CONFIG_DIR}" -type l -print -quit)
if [ -n "${FOUND_LINK}" ]; then
  echo "Isolation check failed; symlink found: ${FOUND_LINK}" >&2
  exit 2
fi

if [ -e "${CONFIG_DIR}/.secrets" ] || [ -e "${WORKSPACE}/.git" ]; then
  echo "Isolation check failed: credential or repository metadata was copied." >&2
  exit 2
fi

# Exercise the exact commands delegated by the three non-mutating fixed tools
# from the same working directory ZeroClaw derives for the proofpay agent.
# These operations are read-only and non-persistent; no request or payment is
# made.
(
  cd "${WORKSPACE}"
  ./proofpay/tools/proofpay.mjs hash \
    --deliverable sample-milestone.txt >/dev/null
  ./proofpay/tools/proofpay.mjs preview \
    --invoice demo-atlas-m2 \
    --recipient CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8 \
    --amount 5.00 \
    --network devnet \
    --deliverable sample-milestone.txt >/dev/null
  ./proofpay/tools/proofpay.mjs list --compact --json >/dev/null
)

ZEROCLAW_BIN=${PROOFPAY_ZEROCLAW_BIN:-}
if [ -z "${ZEROCLAW_BIN}" ] && \
   [ -x "${REPO_ROOT}/.tools/zeroclaw-v0.8.3/zeroclaw" ]; then
  ZEROCLAW_BIN="${REPO_ROOT}/.tools/zeroclaw-v0.8.3/zeroclaw"
fi
if [ -z "${ZEROCLAW_BIN}" ] && command -v zeroclaw >/dev/null 2>&1; then
  ZEROCLAW_BIN=$(command -v zeroclaw)
fi

if [ -n "${ZEROCLAW_BIN}" ]; then
  if [ ! -x "${ZEROCLAW_BIN}" ]; then
    echo "PROOFPAY_ZEROCLAW_BIN is not executable: ${ZEROCLAW_BIN}" >&2
    exit 2
  fi

  ZEROCLAW_VERSION=$("${ZEROCLAW_BIN}" --version)
  case "${ZEROCLAW_VERSION}" in
    "zeroclaw 0.8.3") ;;
    *)
      echo "Warning: validating with ${ZEROCLAW_VERSION}; the pinned demo target is zeroclaw 0.8.3." >&2
      ;;
  esac

  "${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    config list --filter agents.proofpay >/dev/null

  ALLOWED_TOOLS=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    config get risk_profiles.proofpay.allowed_tools)
  EXPECTED_TOOLS='["sop_list", "sop_execute", "sop_advance", "sop_approve", "sop_status", "proofpay-demo__hash_sample", "proofpay-demo__preview_sample", "proofpay-demo__create_sample_request", "proofpay-demo__list_local_requests", "proofpay-demo__check_sample_payment", "proofpay-demo__write_sample_evidence"]'
  if [ "${ALLOWED_TOOLS}" != "${EXPECTED_TOOLS}" ]; then
    echo "Unexpected model-visible tool allowlist: ${ALLOWED_TOOLS}" >&2
    exit 2
  fi

  ALLOWED_COMMANDS=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    config get risk_profiles.proofpay.allowed_commands)
  if [ "${ALLOWED_COMMANDS}" != '["./proofpay/tools/proofpay.mjs"]' ]; then
    echo "Unexpected command allowlist: ${ALLOWED_COMMANDS}" >&2
    exit 2
  fi

  EXPECTED_SANDBOX_ENABLED=true
  EXPECTED_SANDBOX_BACKEND=auto
  if [ "${LOCAL_SANDBOX_MODE}" = "--local-no-os-sandbox" ]; then
    EXPECTED_SANDBOX_ENABLED=false
    EXPECTED_SANDBOX_BACKEND=none
  fi

  for CONFIG_ASSERTION in \
    "runtime_profiles.proofpay.parallel_tools=false" \
    "scheduler.max_concurrent=1" \
    "channels.max_concurrent_per_channel=1" \
    "sop.max_concurrent_total=1" \
    "mcp.enabled=false" \
    "browser.enabled=false" \
    "browser_delegate.enabled=false" \
    "text_browser.enabled=false" \
    "http_request.enabled=false" \
    "web_fetch.enabled=false" \
    "web_search.enabled=false" \
    "risk_profiles.proofpay.sandbox_enabled=${EXPECTED_SANDBOX_ENABLED}" \
    "risk_profiles.proofpay.sandbox_backend=${EXPECTED_SANDBOX_BACKEND}"
  do
    CONFIG_PATH=${CONFIG_ASSERTION%%=*}
    EXPECTED_VALUE=${CONFIG_ASSERTION#*=}
    ACTUAL_VALUE=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
      config get "${CONFIG_PATH}")
    if [ "${ACTUAL_VALUE}" != "${EXPECTED_VALUE}" ]; then
      echo "Unexpected ${CONFIG_PATH}: ${ACTUAL_VALUE}" >&2
      exit 2
    fi
  done

  SKILLS_OUTPUT=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    skills list --agent proofpay)
  for EXPECTED_SKILL_ITEM in \
    "proofpay-demo v0.1.0" \
    "hash_sample, preview_sample, create_sample_request, list_local_requests, check_sample_payment, write_sample_evidence" \
    "proofpay-eurc v0.1.0"
  do
    if ! printf '%s\n' "${SKILLS_OUTPUT}" | grep -Fq "${EXPECTED_SKILL_ITEM}"; then
      echo "Installed skill surface is missing: ${EXPECTED_SKILL_ITEM}" >&2
      exit 2
    fi
  done

  "${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    skills audit "${BUNDLE_DIR}/proofpay-demo-tools" >/dev/null
  "${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    skills audit "${BUNDLE_DIR}/proofpay-eurc" >/dev/null
  "${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    sop validate >/dev/null
  "${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    security status --agent proofpay --json >/dev/null

  echo "Validated with ${ZEROCLAW_VERSION}: config, fixed tools, skills, SOPs, sandbox posture, and single concurrency."
else
  echo "ZeroClaw binary not found; copied runtime and fixed-tool smoke tests passed."
  echo "Set PROOFPAY_ZEROCLAW_BIN to a stock zeroclaw 0.8.3 binary for full validation."
fi

if [ "${LOCAL_SANDBOX_MODE}" = "--local-no-os-sandbox" ]; then
  echo "WARNING: OS sandbox disabled only in this copied local demo runtime." >&2
  echo "Raw shell remains model-invisible and all helper commands remain fixed." >&2
  echo "Do not deploy or share this runtime; remove it after local validation." >&2
elif [ "$(uname -s)" = "Darwin" ]; then
  case "${CONFIG_DIR}" in
    /private/tmp/*)
      echo "macOS note: stock ZeroClaw 0.8.3 Seatbelt may still reject Node ancestor traversal under /private/tmp."
      echo "For a trusted local recording only, create a separate fallback runtime:"
      echo "  $0 ${INSTANCE_NAME}-local /private/tmp/proofpay-runtime --local-no-os-sandbox"
      ;;
    *)
      echo "macOS note: ZeroClaw 0.8.3 Seatbelt cannot traverse some nested user-directory workspaces."
      echo "First retry with an isolated /private/tmp root and the template sandbox intact:"
      echo "  $0 ${INSTANCE_NAME}-tmp /private/tmp/proofpay-runtime"
      echo "If stock v0.8.3 still reports EPERM, use a separate trusted local-only fallback:"
      echo "  $0 ${INSTANCE_NAME}-local /private/tmp/proofpay-runtime --local-no-os-sandbox"
      ;;
  esac
fi

echo "Prepared isolated ZeroClaw demo:"
echo "  config:    ${CONFIG_DIR}/config.toml"
echo "  workspace: ${WORKSPACE}"
echo "  SOPs:      ${SOPS_DIR}"
echo "  skills:    ${BUNDLE_DIR}"
echo
echo "No repository directory, .secrets directory, wallet, or credential was copied."
