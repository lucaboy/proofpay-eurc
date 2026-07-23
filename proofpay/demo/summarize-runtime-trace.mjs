#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";

const args = process.argv.slice(2);
let expectedChannel;
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--channel") {
    expectedChannel = args[index + 1];
    if (!expectedChannel || expectedChannel.startsWith("--")) {
      console.error("--channel requires a dotted channel alias");
      process.exit(2);
    }
    index += 1;
  } else {
    positional.push(args[index]);
  }
}

const [tracePath, expectedTool = "proofpay-demo__create_sample_request"] =
  positional;

if (!tracePath || positional.length > 2) {
  console.error(
    "Usage: summarize-runtime-trace.mjs <runtime-trace.jsonl> [expected-tool] [--channel <type.alias>]",
  );
  process.exit(2);
}
if (
  expectedChannel !== undefined &&
  !/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/.test(expectedChannel)
) {
  console.error("--channel must be a dotted channel alias such as telegram.proofpay");
  process.exit(2);
}

const supportedTools = new Set([
  "proofpay-demo__preview_sample",
  "proofpay-demo__create_sample_request",
  "proofpay-demo__check_sample_payment",
  "proofpay-demo__write_sample_evidence",
]);
if (!supportedTools.has(expectedTool)) {
  throw new Error(`Unsupported expected tool: ${expectedTool}`);
}

const records = (await readFile(tracePath, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL record at line ${index + 1}`);
    }
  });

function traceIdOf(record) {
  const value = record.trace_id ?? record.attributes?.trace_id;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isEvent(record, category, action, outcome) {
  return (
    record.event?.category === category &&
    record.event?.action === action &&
    (outcome === undefined || record.event?.outcome === outcome)
  );
}

const indexed = records.map((record, index) => ({ index, record }));
const resultEntry = [...indexed].reverse().find(({ record }) => {
  const iteration = record.attributes?.iteration;
  return (
    isEvent(record, "tool", "complete", "success") &&
    record.attributes?.tool === expectedTool &&
    typeof record.attributes?.output === "string" &&
    traceIdOf(record) !== null &&
    Number.isSafeInteger(iteration) &&
    iteration >= 1
  );
});
if (!resultEntry) {
  throw new Error(
    `Trace does not contain a successful, identified ${expectedTool} result`,
  );
}

const resultRecord = resultEntry.record;
const traceId = traceIdOf(resultRecord);
const iteration = resultRecord.attributes.iteration;
const parsedEntry = [...indexed]
  .slice(0, resultEntry.index)
  .reverse()
  .find(
    ({ record }) =>
      traceIdOf(record) === traceId &&
      record.attributes?.iteration === iteration &&
      isEvent(record, "provider", "receive", "success"),
  );
if (!parsedEntry) {
  throw new Error(
    "Trace is missing a successful provider receive in the result iteration",
  );
}

const parsed = parsedEntry.record;
if (
  parsed.attributes?.native_tool_calls !== 1 ||
  parsed.attributes?.parsed_tool_calls !== 1
) {
  throw new Error(
    "Nearest provider receive does not contain exactly one parsed native tool call",
  );
}
if (parsed.attributes?.model !== "gpt-5.6-terra") {
  throw new Error(
    "Nearest provider receive is not attributed to the verified gpt-5.6-terra model",
  );
}

const startEntry = indexed
  .slice(parsedEntry.index + 1, resultEntry.index)
  .find(
    ({ record }) =>
      traceIdOf(record) === traceId &&
      record.attributes?.iteration === iteration &&
      record.attributes?.tool === expectedTool &&
      isEvent(record, "tool", "start"),
  );
if (!startEntry) {
  throw new Error(
    "Trace is missing the ordered tool-start event between parse and result",
  );
}

if (expectedChannel) {
  for (const [label, record] of [
    ["parsed native tool call", parsed],
    ["tool start", startEntry.record],
    ["returned tool result", resultRecord],
  ]) {
    if (
      record.zeroclaw?.channel !== expectedChannel ||
      record.zeroclaw?.agent_alias !== "proofpay"
    ) {
      throw new Error(
        `${label} is not attributed to ${expectedChannel} and agent proofpay`,
      );
    }
  }
}

let result;
try {
  result = JSON.parse(resultRecord.attributes.output);
} catch {
  throw new Error("Successful tool result is not valid JSON");
}

const DEMO_ID = "demo-atlas-m3";
const DEMO_DIGEST =
  "4a3adafc3eeaa1670c5acd78349af5db9755c89efa0f9015f9bc293392ec20c8";
const DEMO_REFERENCE = "343KZRYcEbERLtiSP4X41brhCtMNTDmLCbruDsTSxjkt";
const DEMO_RECIPIENT = "CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8";
const EURC_MINT = "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr";
const DEMO_URI =
  `solana:${DEMO_RECIPIENT}?amount=5&spl-token=${EURC_MINT}` +
  `&reference=${DEMO_REFERENCE}&label=ProofPay%20EURC` +
  `&message=ProofPay%20invoice%20${DEMO_ID}` +
  `&memo=PROOFPAY%3A${DEMO_ID}%3A4a3adafc3eeaa167`;
const PAYMENT_WINDOW_MS = 604_800_000;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

function isTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function successfulPriorTool(toolName) {
  return [...indexed]
    .slice(0, resultEntry.index)
    .reverse()
    .find(
      ({ record }) =>
        isEvent(record, "tool", "complete", "success") &&
        record.attributes?.tool === toolName &&
        typeof record.attributes?.output === "string" &&
        traceIdOf(record) !== null &&
        (!expectedChannel ||
          (record.zeroclaw?.channel === expectedChannel &&
            record.zeroclaw?.agent_alias === "proofpay")),
    )?.record;
}

console.log("ZEROCLAW NATIVE TOOL TRACE");
if (expectedChannel) {
  console.log(`channel=${expectedChannel} agent=proofpay`);
}
console.log(`model=${parsed.attributes.model}`);
console.log(
  `native_tool_calls=${parsed.attributes.native_tool_calls} parsed_tool_calls=${parsed.attributes.parsed_tool_calls}`,
);
console.log(`iteration=${iteration} ordered_parse_start_result=true`);
console.log(`tool=${expectedTool}`);
console.log("dispatch=manifest-locked fixed wrapper");

if (expectedTool === "proofpay-demo__preview_sample") {
  if (
    result?.schemaVersion !== 3 ||
    result?.status !== "preview" ||
    result?.id !== DEMO_ID ||
    result?.network !== "devnet" ||
    result?.rpcUrl !== "https://api.devnet.solana.com" ||
    result?.currency !== "EURC" ||
    result?.mint !== EURC_MINT ||
    result?.decimals !== 6 ||
    result?.recipient !== DEMO_RECIPIENT ||
    result?.amount !== "5" ||
    result?.amountAtomic !== "5000000" ||
    result?.validForSeconds !== 604800 ||
    result?.reference !== DEMO_REFERENCE ||
    result?.memo !== `PROOFPAY:${DEMO_ID}:4a3adafc3eeaa167` ||
    result?.label !== "ProofPay EURC" ||
    result?.message !== `ProofPay invoice ${DEMO_ID}` ||
    result?.deliverable?.path !== "sample-milestone.txt" ||
    result?.deliverable?.size !== 496 ||
    result?.deliverable?.sha256 !== DEMO_DIGEST ||
    result?.approval?.schemaVersion !== 1 ||
    result?.approval?.deliverableSha256 !== DEMO_DIGEST ||
    result?.approval?.reference !== DEMO_REFERENCE ||
    result?.approval?.solanaPayUri !== DEMO_URI ||
    result?.solanaPayUri !== DEMO_URI ||
    Object.hasOwn(result, "createdAt") ||
    Object.hasOwn(result, "updatedAt") ||
    Object.hasOwn(result, "expiresAt") ||
    Object.hasOwn(result, "idempotent") ||
    Object.hasOwn(result, "payment")
  ) {
    throw new Error("Tool result is not the complete canonical m3 preview");
  }
  console.log(`result.id=${result.id} result.status=${result.status}`);
  console.log(`amount=${result.amount} ${result.currency} network=${result.network}`);
  console.log(`sha256=${result.deliverable.sha256}`);
  console.log(`reference=${result.reference}`);
  console.log(`solanaPayUri=${result.solanaPayUri}`);
  console.log("persistence=false payment=false");
} else if (expectedTool === "proofpay-demo__create_sample_request") {
  const createdAt = Date.parse(result?.createdAt);
  const expiresAt = Date.parse(result?.expiresAt);
  if (
    result?.schemaVersion !== 3 ||
    result?.id !== DEMO_ID ||
    result?.status !== "pending" ||
    result?.network !== "devnet" ||
    result?.rpcUrl !== "https://api.devnet.solana.com" ||
    result?.currency !== "EURC" ||
    result?.mint !== EURC_MINT ||
    result?.decimals !== 6 ||
    result?.recipient !== DEMO_RECIPIENT ||
    result?.amount !== "5" ||
    result?.amountAtomic !== "5000000" ||
    result?.validForSeconds !== 604800 ||
    result?.reference !== DEMO_REFERENCE ||
    result?.memo !== `PROOFPAY:${DEMO_ID}:4a3adafc3eeaa167` ||
    result?.label !== "ProofPay EURC" ||
    result?.message !== `ProofPay invoice ${DEMO_ID}` ||
    result?.deliverable?.path !== "sample-milestone.txt" ||
    result?.deliverable?.size !== 496 ||
    result?.deliverable?.sha256 !== DEMO_DIGEST ||
    result?.approval?.schemaVersion !== 1 ||
    result?.approval?.kind !== "preview-match" ||
    result?.approval?.deliverableSha256 !== DEMO_DIGEST ||
    result?.approval?.reference !== DEMO_REFERENCE ||
    result?.approval?.solanaPayUri !== DEMO_URI ||
    result?.approval?.recordedAt !== result?.createdAt ||
    result?.solanaPayUri !== DEMO_URI ||
    !isTimestamp(result?.createdAt) ||
    !isTimestamp(result?.updatedAt) ||
    !isTimestamp(result?.expiresAt) ||
    result?.updatedAt !== result?.createdAt ||
    expiresAt - createdAt !== PAYMENT_WINDOW_MS ||
    result?.idempotent !== false ||
    result?.payment !== null
  ) {
    throw new Error("Tool result is not the complete canonical pending demo request");
  }
  console.log(`result.id=${result.id} result.status=${result.status}`);
  console.log(`amount=${result.amount} ${result.currency} network=${result.network}`);
  console.log(`sha256=${result.deliverable.sha256}`);
  console.log(`reference=${result.reference}`);
  console.log(`expiresAt=${result.expiresAt}`);
  console.log("payment=null (agent has no wallet or signing capability)");
} else if (expectedTool === "proofpay-demo__check_sample_payment") {
  const priorCreate = successfulPriorTool(
    "proofpay-demo__create_sample_request",
  );
  let priorCreateResult;
  try {
    priorCreateResult = JSON.parse(priorCreate?.attributes?.output ?? "");
  } catch {
    throw new Error("Paid trace has no earlier successful canonical create");
  }
  if (
    priorCreateResult?.id !== DEMO_ID ||
    priorCreateResult?.status !== "pending" ||
    priorCreateResult?.reference !== DEMO_REFERENCE ||
    result?.invoiceId !== DEMO_ID ||
    result?.status !== "paid" ||
    !SOLANA_SIGNATURE.test(result?.signature ?? "") ||
    !Number.isSafeInteger(result?.slot) ||
    result.slot <= 0 ||
    !Number.isSafeInteger(result?.blockTime) ||
    result.blockTime <= 0 ||
    result?.confirmationStatus !== "finalized" ||
    result?.idempotent !== false
  ) {
    throw new Error("Tool result is not the expected paid reconciliation");
  }
  console.log(
    `result.invoiceId=${result.invoiceId} result.status=${result.status}`,
  );
  console.log(`signature=${result.signature}`);
  console.log(`slot=${result.slot} blockTime=${result.blockTime}`);
  console.log(`confirmationStatus=${result.confirmationStatus}`);
} else if (expectedTool === "proofpay-demo__write_sample_evidence") {
  const priorCheck = successfulPriorTool(
    "proofpay-demo__check_sample_payment",
  );
  let priorCheckResult;
  try {
    priorCheckResult = JSON.parse(priorCheck?.attributes?.output ?? "");
  } catch {
    throw new Error("Evidence trace has no earlier successful reconciliation");
  }
  if (
    priorCheckResult?.invoiceId !== DEMO_ID ||
    priorCheckResult?.status !== "paid" ||
    priorCheckResult?.confirmationStatus !== "finalized" ||
    !SOLANA_SIGNATURE.test(priorCheckResult?.signature ?? "") ||
    result?.invoiceId !== DEMO_ID ||
    result?.status !== "evidence-written" ||
    result?.schemaVersion !== 3 ||
    result?.paymentSignature !== priorCheckResult.signature ||
    !SOLANA_SIGNATURE.test(result?.paymentSignature ?? "") ||
    result?.deliverableSha256 !== DEMO_DIGEST ||
    result?.bundle !== `proofpay/evidence/${DEMO_ID}.evidence` ||
    result?.files?.json !==
      `proofpay/evidence/${DEMO_ID}.evidence/evidence.json` ||
    result?.files?.markdown !==
      `proofpay/evidence/${DEMO_ID}.evidence/evidence.md`
  ) {
    throw new Error("Tool result is not the expected evidence bundle");
  }
  console.log(
    `result.invoiceId=${result.invoiceId} result.status=${result.status}`,
  );
  console.log(`schemaVersion=${result.schemaVersion}`);
  console.log(`paymentSignature=${result.paymentSignature}`);
  console.log(`deliverableSha256=${result.deliverableSha256}`);
  console.log(`evidence.json=${result.files.json}`);
  console.log(`evidence.md=${result.files.markdown}`);
}
