#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";

const [, , tracePath, expectedTool = "proofpay-demo__create_sample_request"] =
  process.argv;

if (!tracePath) {
  console.error(
    "Usage: summarize-runtime-trace.mjs <runtime-trace.jsonl> [expected-tool]",
  );
  process.exit(2);
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

const toolCall = [...records]
  .reverse()
  .find((record) => record.attributes?.tool === expectedTool);
if (!toolCall) {
  throw new Error(`Trace does not contain ${expectedTool}`);
}

const traceId = toolCall.trace_id ?? toolCall.attributes?.trace_id;
const sameTrace = records.filter(
  (record) =>
    (record.trace_id ?? record.attributes?.trace_id) === traceId,
);
const parsed = sameTrace.find(
  (record) =>
    record.attributes?.native_tool_calls > 0 &&
    record.attributes?.parsed_tool_calls > 0,
);
const resultRecord = sameTrace.find(
  (record) =>
    record.attributes?.tool === expectedTool &&
    typeof record.attributes?.output === "string",
);

if (!parsed || !resultRecord) {
  throw new Error("Trace is missing parsed-call or returned-tool evidence");
}

const result = JSON.parse(resultRecord.attributes.output);
if (
  result?.id !== "demo-atlas-m1" ||
  result?.status !== "pending" ||
  result?.payment !== null
) {
  throw new Error("Tool result is not the expected pending demo request");
}

console.log("ZEROCLAW NATIVE TOOL TRACE");
console.log(`model=${parsed.attributes.model}`);
console.log(
  `native_tool_calls=${parsed.attributes.native_tool_calls} parsed_tool_calls=${parsed.attributes.parsed_tool_calls}`,
);
console.log(`tool=${expectedTool}`);
console.log("dispatch=manifest-locked fixed wrapper");
console.log(`result.id=${result.id} result.status=${result.status}`);
console.log(`amount=${result.amount} ${result.currency} network=${result.network}`);
console.log(`sha256=${result.deliverable.sha256}`);
console.log(`reference=${result.reference}`);
console.log("payment=null (no wallet, signature, submission, or funds moved)");
