#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <prepared-config-dir>" >&2
  echo "The BotFather token is never accepted as an argument or environment variable." >&2
  exit 2
fi

CONFIG_DIR_INPUT=$1
case "${CONFIG_DIR_INPUT}" in
  /*) ;;
  *)
    echo "Prepared config directory must be an absolute path." >&2
    exit 2
    ;;
esac

if [ -L "${CONFIG_DIR_INPUT}" ] || [ ! -d "${CONFIG_DIR_INPUT}" ]; then
  echo "Prepared config directory must be a real, non-symlinked directory." >&2
  exit 2
fi

CONFIG_DIR=$(CDPATH= cd -- "${CONFIG_DIR_INPUT}" && pwd -P)
case "${CONFIG_DIR}/" in
  "${REPO_ROOT}/"*)
    echo "Refusing to put a Telegram credential in the repository checkout." >&2
    exit 2
    ;;
esac

IS_TEMP_RUNTIME=false
for TEMP_ROOT_CANDIDATE in /private/tmp /tmp "${TMPDIR:-}"; do
  if [ -z "${TEMP_ROOT_CANDIDATE}" ] || [ ! -d "${TEMP_ROOT_CANDIDATE}" ]; then
    continue
  fi
  TEMP_ROOT=$(CDPATH= cd -- "${TEMP_ROOT_CANDIDATE}" && pwd -P)
  case "${CONFIG_DIR}/" in
    "${TEMP_ROOT}/"*)
      IS_TEMP_RUNTIME=true
      break
      ;;
  esac
done
if [ "${IS_TEMP_RUNTIME}" != true ]; then
  echo "Telegram demo credentials are allowed only in a temporary runtime." >&2
  echo "Prepare one under /private/tmp (macOS), /tmp, or the system temporary directory." >&2
  exit 2
fi

CONFIG_FILE="${CONFIG_DIR}/config.toml"
WORKSPACE="${CONFIG_DIR}/agents/proofpay/workspace"
LEDGER="${WORKSPACE}/proofpay/data/invoices.json"
EVIDENCE_DIR="${WORKSPACE}/proofpay/evidence"

for REQUIRED_PATH in \
  "${CONFIG_FILE}" \
  "${WORKSPACE}" \
  "${WORKSPACE}/proofpay/tools/proofpay.mjs" \
  "${WORKSPACE}/proofpay/deliverables/sample-milestone.txt"
do
  if [ -L "${REQUIRED_PATH}" ] || { [ ! -f "${REQUIRED_PATH}" ] && [ ! -d "${REQUIRED_PATH}" ]; }; then
    echo "Missing, unsafe, or symlinked prepared-runtime path: ${REQUIRED_PATH}" >&2
    exit 2
  fi
done

FOUND_LINK=$(find "${CONFIG_DIR}" -type l -print -quit)
if [ -n "${FOUND_LINK}" ]; then
  echo "Refusing prepared runtime containing a symlink: ${FOUND_LINK}" >&2
  exit 2
fi

if [ -e "${CONFIG_DIR}/.secrets" ] || [ -e "${WORKSPACE}/.git" ]; then
  echo "Prepared runtime contains forbidden credential or repository metadata." >&2
  exit 2
fi

if [ -e "${LEDGER}" ] || [ -L "${LEDGER}" ]; then
  echo "Telegram demo requires a fresh runtime with no invoice ledger." >&2
  exit 2
fi
if [ -e "${EVIDENCE_DIR}" ] || [ -L "${EVIDENCE_DIR}" ]; then
  echo "Telegram demo requires a fresh runtime with no evidence directory." >&2
  exit 2
fi

ZEROCLAW_BIN=${PROOFPAY_ZEROCLAW_BIN:-}
if [ -z "${ZEROCLAW_BIN}" ] && \
   [ -x "${REPO_ROOT}/.tools/zeroclaw-v0.8.3/zeroclaw" ]; then
  ZEROCLAW_BIN="${REPO_ROOT}/.tools/zeroclaw-v0.8.3/zeroclaw"
fi
if [ -z "${ZEROCLAW_BIN}" ] && command -v zeroclaw >/dev/null 2>&1; then
  ZEROCLAW_BIN=$(command -v zeroclaw)
fi
if [ -z "${ZEROCLAW_BIN}" ] || [ ! -x "${ZEROCLAW_BIN}" ]; then
  echo "Stock ZeroClaw v0.8.3 is required." >&2
  echo "Set PROOFPAY_ZEROCLAW_BIN to its executable path." >&2
  exit 2
fi

ZEROCLAW_VERSION=$("${ZEROCLAW_BIN}" --version)
if [ "${ZEROCLAW_VERSION}" != "zeroclaw 0.8.3" ]; then
  echo "Expected stock zeroclaw 0.8.3, found: ${ZEROCLAW_VERSION}" >&2
  exit 2
fi

expect_config() {
  CONFIG_PATH=$1
  EXPECTED_VALUE=$2
  ACTUAL_VALUE=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
    config get "${CONFIG_PATH}")
  if [ "${ACTUAL_VALUE}" != "${EXPECTED_VALUE}" ]; then
    echo "Unexpected ${CONFIG_PATH}: ${ACTUAL_VALUE}" >&2
    exit 2
  fi
}

expect_config agents.proofpay.channels '["telegram.proofpay"]'
expect_config channels.telegram.proofpay.enabled false
expect_config channels.telegram.proofpay.api_base_url https://api.telegram.org
expect_config channels.telegram.proofpay.mention_only true
expect_config channels.telegram.proofpay.ack_reactions false
expect_config channels.telegram.proofpay.approval_timeout_secs 120
expect_config channels.session_persistence false
expect_config peer_groups.telegram_proofpay.channel telegram.proofpay
expect_config peer_groups.telegram_proofpay.agents '["proofpay"]'
expect_config peer_groups.telegram_proofpay.external_peers '[]'
expect_config peer_groups.telegram_proofpay.admin_for_agent_scope false

PEER_GROUP_CONFIG=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
  config list --filter peer_groups)
PEER_GROUP_CHANNEL_COUNT=$(printf '%s\n' "${PEER_GROUP_CONFIG}" | awk '
  /^  peer_groups\.[^.]+\.channel[[:space:]]*=/ { count += 1 }
  END { print count + 0 }
')
if [ "${PEER_GROUP_CHANNEL_COUNT}" -ne 1 ] || \
   ! printf '%s\n' "${PEER_GROUP_CONFIG}" | grep -Eq \
     '^  peer_groups\.telegram_proofpay\.channel[[:space:]]*= telegram\.proofpay[[:space:]]'
then
  echo "Refusing extra or type-wide peer groups that could broaden Telegram access." >&2
  exit 2
fi

AUTH_STATUS=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" auth status)
if printf '%s\n' "${AUTH_STATUS}" | grep -Fq "No auth profiles configured." || \
   ! printf '%s\n' "${AUTH_STATUS}" | grep -Fqi "openai"
then
  echo "The temporary runtime has no active OpenAI Codex auth profile." >&2
  echo "Authenticate it before Telegram setup:" >&2
  echo "  ${ZEROCLAW_BIN} --config-dir ${CONFIG_DIR} auth login --model-provider openai-codex" >&2
  exit 2
fi

MODEL_CANARY_OUTPUT=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
  agent --agent proofpay \
  --message 'PROOFPAY_MODEL_CANARY: Do not call any tool. Reply with exactly PROOFPAY_MODEL_CANARY_OK and nothing else.')
if [ "${MODEL_CANARY_OUTPUT}" != "PROOFPAY_MODEL_CANARY_OK" ]; then
  echo "The configured OpenAI Codex model failed the exact no-tool canary." >&2
  echo "Telegram remains disabled; refresh the served model ID before continuing." >&2
  exit 2
fi

if [ ! -t 0 ] || [ ! -t 1 ]; then
  echo "Run this command in an interactive terminal so token input stays masked." >&2
  exit 2
fi

echo "Before continuing, use BotFather /setjoingroups and DISABLE group joins"
echo "for this new temporary bot. ProofPay supports a private DM only."
printf '%s' "Type GROUPS-DISABLED after BotFather confirms the change: "
IFS= read -r GROUP_CONFIRMATION
if [ "${GROUP_CONFIRMATION}" != "GROUPS-DISABLED" ]; then
  echo "Group-join disablement was not confirmed; Telegram remains disabled." >&2
  exit 2
fi

chmod 0700 "${CONFIG_DIR}"
chmod 0600 "${CONFIG_FILE}"

CHANNEL_ENABLED=false
disable_on_error() {
  STATUS=$?
  trap - EXIT HUP INT TERM
  if [ "${STATUS}" -ne 0 ] && [ "${CHANNEL_ENABLED}" = true ]; then
    "${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
      config set channels.telegram.proofpay.enabled false >/dev/null 2>&1 || true
    echo "Telegram was disabled after setup failed; the encrypted token remains only in the temporary runtime." >&2
  fi
  exit "${STATUS}"
}
trap disable_on_error EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

echo "ZeroClaw will now request the BotFather token using masked input."
echo "Do not paste it into chat, shell arguments, environment variables, or source files."
"${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
  config set channels.telegram.proofpay.bot_token

if ! grep -Eq '^bot_token = "enc2:[^"]+"$' "${CONFIG_FILE}"; then
  echo "ZeroClaw did not persist the BotFather token in encrypted form." >&2
  exit 2
fi

CHANNEL_ENABLED=true
"${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" \
  config set channels.telegram.proofpay.enabled true >/dev/null

DOCTOR_OUTPUT=$("${ZEROCLAW_BIN}" --config-dir "${CONFIG_DIR}" channel doctor)
printf '%s\n' "${DOCTOR_OUTPUT}"
if ! printf '%s\n' "${DOCTOR_OUTPUT}" | \
  grep -Eq '^Summary: 1 healthy, 0 unhealthy, 0 timed out$'
then
  echo "Telegram channel health check failed." >&2
  exit 2
fi
expect_config channels.telegram.proofpay.enabled true

trap - EXIT HUP INT TERM

echo
echo "Telegram API credential is healthy; a real private-DM canary is still required."
echo "Start it in the foreground with:"
echo "  ${ZEROCLAW_BIN} --config-dir ${CONFIG_DIR} --log-level info channel start"
echo
echo "Then copy the one-time /bind code printed by channel start into a PRIVATE"
echo "chat with the bot. Never use a group and never authorize a wildcard peer."
echo "Send the documented no-tool PROOFPAY_CANARY DM, require the exact"
echo "PROOFPAY_CANARY_OK reply, then send /new before recording."
echo "The API-only doctor does not prove receive/model routing."
echo "The immutable info trace floor is required for sanitized dispatch proof."
echo "For the demo, tap the one-shot Approve button, never Always."
