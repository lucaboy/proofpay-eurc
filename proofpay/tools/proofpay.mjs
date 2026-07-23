#!/usr/bin/env node

import path from "node:path";
import {
  DEFAULT_PATHS,
  ProofPayError,
  checkInvoice,
  createInvoice,
  hashDeliverable,
  listInvoices,
  previewInvoice,
  verifyEvidence,
  writeEvidence,
} from "../src/core.mjs";

const VALUE_FLAGS = new Set([
  "invoice",
  "recipient",
  "amount",
  "deliverable",
  "network",
  "approve-digest",
  "approve-reference",
  "approve-uri",
  "evidence",
]);
const BOOLEAN_FLAGS = new Set(["compact", "json", "online"]);

function parseFlags(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--") || token === "--") {
      throw new ProofPayError("INVALID_ARGUMENT", `Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (Object.hasOwn(parsed, name)) {
      throw new ProofPayError("DUPLICATE_FLAG", `Duplicate flag: --${name}`);
    }
    if (BOOLEAN_FLAGS.has(name)) {
      parsed[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new ProofPayError("UNKNOWN_FLAG", `Unknown flag: --${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ProofPayError("MISSING_FLAG_VALUE", `Missing value for --${name}`);
    }
    parsed[name] = value;
    index += 1;
  }
  return parsed;
}

function assertOnly(flags, allowed) {
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) {
      throw new ProofPayError(
        "FLAG_NOT_ALLOWED",
        `--${key} is not valid for this command`,
      );
    }
  }
}

function requireFlags(flags, names) {
  for (const name of names) {
    if (!Object.hasOwn(flags, name)) {
      throw new ProofPayError(
        "MISSING_REQUIRED_FLAG",
        `Missing required flag: --${name}`,
      );
    }
  }
}

function invoiceInput(flags) {
  const value = {
    invoiceId: flags.invoice,
    recipient: flags.recipient,
    amount: flags.amount,
    deliverable: flags.deliverable,
    network: flags.network ?? "devnet",
  };
  if (
    Object.hasOwn(flags, "approve-digest") ||
    Object.hasOwn(flags, "approve-reference") ||
    Object.hasOwn(flags, "approve-uri")
  ) {
    value.approval = {
      schemaVersion: 1,
      deliverableSha256: flags["approve-digest"],
      reference: flags["approve-reference"],
      solanaPayUri: flags["approve-uri"],
    };
  }
  return value;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function compactInvoice(invoice) {
  return {
    id: invoice.id,
    status: invoice.status,
    network: invoice.network,
    amount: invoice.amount,
    currency: invoice.currency,
    expiresAt: invoice.expiresAt,
    ...(invoice.payment?.signature
      ? { signature: invoice.payment.signature }
      : {}),
  };
}

function compactCheck(result) {
  return {
    invoiceId: result.invoiceId,
    status: result.status,
    ...(result.code ? { code: result.code } : {}),
    ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
    ...(result.payment?.signature
      ? {
          signature: result.payment.signature,
          slot: result.payment.slot,
          blockTime: result.payment.blockTime,
          confirmationStatus: result.payment.confirmationStatus,
        }
      : {}),
    ...(typeof result.idempotent === "boolean"
      ? { idempotent: result.idempotent }
      : {}),
  };
}

function compactWrittenEvidence(result) {
  const relative = (value) => path.relative(process.cwd(), value);
  return {
    schemaVersion: result.evidence.schemaVersion,
    invoiceId: result.evidence.invoice.id,
    status: "evidence-written",
    paymentSignature: result.evidence.payment.signature,
    deliverableSha256: result.evidence.deliverable.sha256,
    bundle: relative(result.bundle),
    files: {
      json: relative(result.files.json),
      markdown: relative(result.files.markdown),
    },
  };
}

function usage() {
  return {
    usage: [
      "proofpay hash --deliverable <relative-path>",
      "proofpay preview --invoice <id> --recipient <pubkey> --amount <EURC> --deliverable <relative-path> [--network devnet|mainnet]",
      "proofpay create --invoice <id> --recipient <pubkey> --amount <EURC> --deliverable <relative-path> [--network devnet|mainnet] --approve-digest <sha256> --approve-reference <pubkey> --approve-uri <solana-pay-uri>",
      "proofpay list [--compact]",
      "proofpay check --invoice <id> [--compact]",
      "proofpay evidence --invoice <id> [--compact]",
      "proofpay verify-evidence --evidence <path> --deliverable <path> [--online]",
    ],
    safety:
      "This utility can persist local requests, paid checkpoints, and evidence. It has no signing, transaction-submission, transfer, or refund capability.",
  };
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    print(usage());
    return;
  }
  const flags = parseFlags(rest);
  const paths = DEFAULT_PATHS;

  if (command === "hash") {
    assertOnly(flags, new Set(["deliverable", "json"]));
    requireFlags(flags, ["deliverable"]);
    print(
      await hashDeliverable(flags.deliverable, {
        deliverablesDir: paths.deliverablesDir,
      }),
    );
    return;
  }

  if (command === "preview") {
    assertOnly(
      flags,
      new Set([
        "invoice",
        "recipient",
        "amount",
        "deliverable",
        "network",
        "json",
      ]),
    );
    requireFlags(flags, ["invoice", "recipient", "amount", "deliverable"]);
    const options = {
      deliverablesDir: paths.deliverablesDir,
      storagePath: paths.storagePath,
    };
    print(await previewInvoice(invoiceInput(flags), options));
    return;
  }

  if (command === "create") {
    assertOnly(
      flags,
      new Set([
        "invoice",
        "recipient",
        "amount",
        "deliverable",
        "network",
        "approve-digest",
        "approve-reference",
        "approve-uri",
        "json",
      ]),
    );
    requireFlags(flags, [
      "invoice",
      "recipient",
      "amount",
      "deliverable",
      "approve-digest",
      "approve-reference",
      "approve-uri",
    ]);
    print(
      await createInvoice(invoiceInput(flags), {
        deliverablesDir: paths.deliverablesDir,
        storagePath: paths.storagePath,
      }),
    );
    return;
  }

  if (command === "list") {
    assertOnly(flags, new Set(["compact", "json"]));
    const invoices = await listInvoices({ storagePath: paths.storagePath });
    print(flags.compact ? invoices.map(compactInvoice) : invoices);
    return;
  }

  if (command === "check") {
    assertOnly(flags, new Set(["invoice", "compact", "json"]));
    requireFlags(flags, ["invoice"]);
    const result = await checkInvoice(flags.invoice, {
      storagePath: paths.storagePath,
    });
    print(flags.compact ? compactCheck(result) : result);
    if (result.status !== "paid") {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "evidence") {
    assertOnly(flags, new Set(["invoice", "compact", "json"]));
    requireFlags(flags, ["invoice"]);
    const written = await writeEvidence(flags.invoice, {
      storagePath: paths.storagePath,
      evidenceDir: paths.evidenceDir,
    });
    print(flags.compact ? compactWrittenEvidence(written) : written);
    return;
  }

  if (command === "verify-evidence") {
    assertOnly(flags, new Set(["evidence", "deliverable", "json", "online"]));
    requireFlags(flags, ["evidence", "deliverable"]);
    print(
      await verifyEvidence({
        evidencePath: flags.evidence,
        deliverablePath: flags.deliverable,
        online: flags.online === true,
      }),
    );
    return;
  }

  throw new ProofPayError("UNKNOWN_COMMAND", `Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => {
  const safeError =
    error instanceof ProofPayError
      ? {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        }
      : {
          code: "UNEXPECTED_ERROR",
          message: "ProofPay failed unexpectedly",
        };
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeError })}\n`);
  process.exitCode = 1;
});
