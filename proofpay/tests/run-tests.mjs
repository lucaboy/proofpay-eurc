import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  EURC_MINT,
  PAYMENT_WINDOW_SECONDS,
  ProofPayError,
  base58Decode,
  base58Encode,
  checkInvoice,
  createInvoice,
  deriveAssociatedTokenAddress,
  generateEvidence,
  hashDeliverable,
  listInvoices,
  parseAmount,
  previewInvoice,
  verifyPayment,
  verifyEvidence,
  writeEvidence,
} from "../src/core.mjs";
import {
  OTHER_RECIPIENT,
  OTHER_SIGNATURE,
  RECIPIENT,
  SIGNATURE,
  TOKEN_ACCOUNT,
  WRONG_MINT,
  rpcFixture,
} from "./fixtures/rpc-fixtures.mjs";

const tests = [];
const execFileAsync = promisify(execFile);
const proofPayCli = fileURLToPath(
  new URL("../tools/proofpay.mjs", import.meta.url),
);

function test(name, fn) {
  tests.push({ name, fn });
}

async function expectCode(code, fn) {
  await assert.rejects(fn, (error) => {
    assert.ok(error instanceof ProofPayError);
    assert.equal(error.code, code);
    return true;
  });
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "proofpay-test-"));
  const deliverablesDir = path.join(root, "deliverables");
  const dataDir = path.join(root, "data");
  const evidenceDir = path.join(root, "evidence");
  await mkdir(deliverablesDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(deliverablesDir, "release-manifest.json"),
    '{"release":"v1.2.3","sha256":"abc"}\n',
  );
  return {
    root,
    deliverablesDir,
    storagePath: path.join(dataDir, "invoices.json"),
    evidenceDir,
  };
}

function input(overrides = {}) {
  return {
    invoiceId: "milestone-001",
    recipient: RECIPIENT,
    amount: "42.500000",
    deliverable: "release-manifest.json",
    network: "devnet",
    ...overrides,
  };
}

async function createApproved(value, options) {
  const preview = await previewInvoice(value, {
    deliverablesDir: options.deliverablesDir,
  });
  return await createInvoice(
    {
      ...value,
      approval: preview.approval,
    },
    options,
  );
}

test("base58 round-trips exact 32- and 64-byte values", () => {
  for (const bytes of [Buffer.alloc(32, 7), Buffer.alloc(64, 11)]) {
    assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  }
  assert.deepEqual(base58Decode(base58Encode(Buffer.alloc(32))), Buffer.alloc(32));
});

test("canonical associated token addresses match the Solana derivation", () => {
  const officialVectors = [
    [RECIPIENT, TOKEN_ACCOUNT],
    [
      "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9",
      "6rWbK2k5m1VWbFmWUaM4aYTq2cBaCU7PhrYSNYn3Kx6n",
    ],
    [
      "9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu",
      "5WnsZugYkpeeDt9hQNAWHCe3xSpCSQvb7jkGR3GG1WTA",
    ],
    [
      "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB",
      "73Y6Wxci3A49Uib5tf4UodDXVsm9SWoCMQTLQVjdFhik",
    ],
  ];
  for (const [owner, associatedTokenAccount] of officialVectors) {
    assert.equal(
      deriveAssociatedTokenAddress(owner, EURC_MINT),
      associatedTokenAccount,
    );
  }
});

test("amount parser is strict, canonical, positive, and limited to 6 decimals", async () => {
  assert.deepEqual(parseAmount("42.500000"), {
    amount: "42.5",
    amountAtomic: "42500000",
    decimals: 6,
  });
  for (const invalid of [
    "0",
    "0.000000",
    "01",
    "1.",
    ".1",
    "1.0000001",
    "1e3",
    "+1",
    "-1",
    " 1",
    "1 ",
    "1000000000000",
  ]) {
    await expectCode("INVALID_AMOUNT", async () => parseAmount(invalid));
  }
});

test("preview and create produce the same canonical reference and URI", async () => {
  const env = await setup();
  const preview = await previewInvoice(input(), env);
  const created = await createInvoice(
    {
      ...input(),
      approval: preview.approval,
    },
    {
      ...env,
      clock: () => new Date("2026-07-23T10:00:00.000Z"),
    },
  );
  assert.equal(base58Decode(preview.reference).length, 32);
  assert.equal(preview.reference, created.reference);
  assert.equal(preview.solanaPayUri, created.solanaPayUri);
  assert.equal(preview.validForSeconds, PAYMENT_WINDOW_SECONDS);
  assert.equal(created.idempotent, false);
  assert.equal(
    Date.parse(created.expiresAt) - Date.parse(created.createdAt),
    PAYMENT_WINDOW_SECONDS * 1000,
  );
  assert.deepEqual(created.approval, {
    ...preview.approval,
    kind: "preview-match",
    recordedAt: created.createdAt,
  });
  assert.match(
    created.solanaPayUri,
    new RegExp(
      `^solana:${RECIPIENT}\\?amount=42\\.5&spl-token=${EURC_MINT}&reference=`,
    ),
  );
  assert.match(
    created.solanaPayUri,
    /&label=ProofPay%20EURC&message=ProofPay%20invoice%20milestone-001&memo=PROOFPAY%3Amilestone-001%3A/,
  );
  const mode = (await stat(env.storagePath)).mode & 0o777;
  assert.equal(mode, 0o600);
  const retry = await createApproved(input(), { ...env });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.createdAt, created.createdAt);
  await expectCode("INVOICE_CONFLICT", () =>
    createApproved(input({ amount: "43" }), { ...env }),
  );
});

test("create requires approved preview terms and rejects a changed deliverable", async () => {
  const env = await setup();
  await expectCode("APPROVAL_REQUIRED", () =>
    createInvoice(input(), env),
  );
  const preview = await previewInvoice(input(), env);
  await writeFile(
    path.join(env.deliverablesDir, "release-manifest.json"),
    '{"release":"v1.2.4","sha256":"changed"}\n',
  );
  await expectCode("PREVIEW_CHANGED", () =>
    createInvoice(
      {
        ...input(),
        approval: preview.approval,
      },
      env,
    ),
  );
  await assert.rejects(stat(env.storagePath), { code: "ENOENT" });
});

test("empty deliverables fail before preview or persistence", async () => {
  const env = await setup();
  await writeFile(path.join(env.deliverablesDir, "empty.txt"), "");
  await expectCode("EMPTY_DELIVERABLE", () =>
    previewInvoice(input({ deliverable: "empty.txt" }), env),
  );
  await assert.rejects(stat(env.storagePath), { code: "ENOENT" });
});

test("deliverable hashing rejects traversal, absolute paths, and symlink escape", async () => {
  const env = await setup();
  const outside = path.join(env.root, "outside.txt");
  await writeFile(outside, "secret\n");
  await symlink(outside, path.join(env.deliverablesDir, "escape.txt"));
  for (const malicious of [
    "../outside.txt",
    "/etc/passwd",
    "nested/../../outside.txt",
    "escape.txt",
    "release-manifest.json\u0000ignored",
    "C:\\windows\\system.ini",
    "`injected`.txt",
    "$(touch-pwn).txt",
    "<script>.txt",
  ]) {
    await assert.rejects(
      () =>
        hashDeliverable(malicious, {
          deliverablesDir: env.deliverablesDir,
        }),
      ProofPayError,
    );
  }
});

test("happy path accepts the System Program, verifies exact EURC, and writes evidence mode 600", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), {
    ...env,
    clock: () => new Date("2026-07-23T10:00:00.000Z"),
  });
  const mock = rpcFixture(invoice);
  const checked = await checkInvoice(invoice.id, {
    storagePath: env.storagePath,
    rpcCall: mock.rpcCall,
    clock: () => new Date("2026-07-23T10:05:00.000Z"),
  });
  assert.equal(checked.status, "paid");
  assert.equal(checked.payment.signature, SIGNATURE);
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(
    mock.calls.map(({ method }) => method),
    ["getSignaturesForAddress", "getTransaction"],
  );
  assert.deepEqual(mock.calls[0].params, [
    invoice.reference,
    { commitment: "finalized", limit: 20 },
  ]);
  assert.deepEqual(mock.calls[1].params, [
    SIGNATURE,
    {
      commitment: "finalized",
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    },
  ]);

  const evidence = await generateEvidence(invoice.id, {
    storagePath: env.storagePath,
    clock: () => new Date("2026-07-23T10:06:00.000Z"),
  });
  assert.equal(evidence.schemaVersion, 3);
  assert.deepEqual(evidence.approval, invoice.approval);
  assert.equal(evidence.assertions.previewMatchedAtCreation, true);
  assert.equal(evidence.assertions.nonCustodial, true);
  assert.equal(evidence.assertions.withinPaymentWindow, true);
  assert.equal(evidence.invoice.validForSeconds, PAYMENT_WINDOW_SECONDS);
  assert.equal(evidence.invoice.expiresAt, invoice.expiresAt);
  assert.equal(evidence.payment.signature, SIGNATURE);

  const written = await writeEvidence(invoice.id, {
    storagePath: env.storagePath,
    evidenceDir: env.evidenceDir,
    clock: () => new Date("2026-07-23T10:06:00.000Z"),
  });
  for (const file of Object.values(written.files)) {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  assert.match(await readFile(written.files.markdown, "utf8"), /non-custodial/i);
  const originalJson = await readFile(written.files.json, "utf8");
  const originalMarkdown = await readFile(written.files.markdown, "utf8");
  await expectCode("EVIDENCE_EXISTS", () =>
    writeEvidence(invoice.id, {
      storagePath: env.storagePath,
      evidenceDir: env.evidenceDir,
      clock: () => new Date("2026-07-23T10:07:00.000Z"),
    }),
  );
  assert.equal(await readFile(written.files.json, "utf8"), originalJson);
  assert.equal(await readFile(written.files.markdown, "utf8"), originalMarkdown);
});

test("offline evidence verifier recomputes the artifact digest and canonical terms", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), {
    ...env,
    clock: () => new Date("2026-07-23T10:00:00.000Z"),
  });
  const mock = rpcFixture(invoice);
  await checkInvoice(invoice.id, {
    storagePath: env.storagePath,
    rpcCall: mock.rpcCall,
    clock: () => new Date("2026-07-23T10:05:00.000Z"),
  });
  const written = await writeEvidence(invoice.id, {
    storagePath: env.storagePath,
    evidenceDir: env.evidenceDir,
    clock: () => new Date("2026-07-23T10:06:00.000Z"),
  });

  const verified = await verifyEvidence({
    evidencePath: written.files.json,
    deliverablePath: path.join(
      env.deliverablesDir,
      "release-manifest.json",
    ),
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.invoiceId, invoice.id);
  assert.equal(verified.deliverable.sha256, invoice.deliverable.sha256);
  assert.equal(verified.checks.canonicalInvoiceTerms, true);
  assert.equal(verified.scope.onChainLookupPerformed, false);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    proofPayCli,
    "verify-evidence",
    "--evidence",
    written.files.json,
    "--deliverable",
    path.join(env.deliverablesDir, "release-manifest.json"),
  ]);
  assert.equal(stderr, "");
  const cliVerified = JSON.parse(stdout);
  assert.equal(cliVerified.verification, "proofpay-offline-evidence-v1");
  assert.equal(cliVerified.invoiceId, invoice.id);

  const onlineRpc = rpcFixture(invoice);
  const online = await verifyEvidence({
    evidencePath: written.files.json,
    deliverablePath: path.join(
      env.deliverablesDir,
      "release-manifest.json",
    ),
    online: true,
    rpcCall: onlineRpc.rpcCall,
    clock: () => new Date("2026-07-23T10:06:00.000Z"),
  });
  assert.equal(online.verification, "proofpay-online-evidence-v1");
  assert.equal(online.scope.onChainLookupPerformed, true);
  assert.equal(online.checks.onChainPayment, true);
  assert.deepEqual(
    onlineRpc.calls.map(({ method }) => method),
    ["getSignaturesForAddress", "getTransaction"],
  );
});

test("offline evidence verifier fails closed on artifact and evidence tampering", async () => {
  const env = await setup();
  const deliverablePath = path.join(
    env.deliverablesDir,
    "release-manifest.json",
  );
  const invoice = await createApproved(input(), {
    ...env,
    clock: () => new Date("2026-07-23T10:00:00.000Z"),
  });
  await checkInvoice(invoice.id, {
    storagePath: env.storagePath,
    rpcCall: rpcFixture(invoice).rpcCall,
    clock: () => new Date("2026-07-23T10:05:00.000Z"),
  });
  const evidence = await generateEvidence(invoice.id, {
    storagePath: env.storagePath,
    clock: () => new Date("2026-07-23T10:06:00.000Z"),
  });
  const validEvidencePath = path.join(env.root, "valid-evidence.json");
  await writeFile(validEvidencePath, `${JSON.stringify(evidence)}\n`);

  const changedDeliverable = path.join(env.root, "changed.json");
  const changedBytes = Buffer.from(await readFile(deliverablePath));
  changedBytes[0] ^= 1;
  await writeFile(changedDeliverable, changedBytes);
  await expectCode("DELIVERABLE_DIGEST_MISMATCH", () =>
    verifyEvidence({
      evidencePath: validEvidencePath,
      deliverablePath: changedDeliverable,
    }),
  );

  const cases = [
    ["digest", (value) => {
      value.deliverable.sha256 = "0".repeat(64);
    }, "DELIVERABLE_DIGEST_MISMATCH"],
    ["amount", (value) => {
      value.invoice.amountAtomic = "1";
    }, "INVALID_EVIDENCE"],
    ["uri", (value) => {
      value.invoice.solanaPayUri += "&memo=forged";
    }, "INVALID_EVIDENCE"],
    ["assertion", (value) => {
      value.assertions.exactMemo = false;
    }, "INVALID_EVIDENCE"],
    ["limitations", (value) => {
      value.limitations = [];
    }, "INVALID_EVIDENCE"],
  ];
  for (const [name, mutate, expectedCode] of cases) {
    const tampered = JSON.parse(JSON.stringify(evidence));
    mutate(tampered);
    const evidencePath = path.join(env.root, `${name}.json`);
    await writeFile(evidencePath, `${JSON.stringify(tampered)}\n`);
    await expectCode(expectedCode, () =>
      verifyEvidence({ evidencePath, deliverablePath }),
    );
  }

  const forgedSignatureEvidence = JSON.parse(JSON.stringify(evidence));
  forgedSignatureEvidence.payment.signature = OTHER_SIGNATURE;
  const forgedSignaturePath = path.join(
    env.root,
    "forged-signature-evidence.json",
  );
  await writeFile(
    forgedSignaturePath,
    `${JSON.stringify(forgedSignatureEvidence)}\n`,
  );
  assert.equal(
    (
      await verifyEvidence({
        evidencePath: forgedSignaturePath,
        deliverablePath,
      })
    ).scope.onChainLookupPerformed,
    false,
  );
  await expectCode("EVIDENCE_CHAIN_MISMATCH", () =>
    verifyEvidence({
      evidencePath: forgedSignaturePath,
      deliverablePath,
      online: true,
      rpcCall: rpcFixture(invoice).rpcCall,
      clock: () => new Date("2026-07-23T10:06:00.000Z"),
    }),
  );

  const impossibleTimestamp = JSON.parse(JSON.stringify(evidence));
  impossibleTimestamp.generatedAt = "2026-02-31T10:06:00.000Z";
  const impossibleTimestampPath = path.join(
    env.root,
    "impossible-timestamp-evidence.json",
  );
  await writeFile(
    impossibleTimestampPath,
    `${JSON.stringify(impossibleTimestamp)}\n`,
  );
  await expectCode("INVALID_EVIDENCE", () =>
    verifyEvidence({
      evidencePath: impossibleTimestampPath,
      deliverablePath,
    }),
  );

  const evidenceLink = path.join(env.root, "evidence-link.json");
  const deliverableLink = path.join(env.root, "deliverable-link.json");
  await symlink(validEvidencePath, evidenceLink);
  await symlink(deliverablePath, deliverableLink);
  await expectCode("UNSAFE_EVIDENCE_PATH", () =>
    verifyEvidence({ evidencePath: evidenceLink, deliverablePath }),
  );
  await expectCode("UNSAFE_DELIVERABLE_PATH", () =>
    verifyEvidence({
      evidencePath: validEvidencePath,
      deliverablePath: deliverableLink,
    }),
  );
});

test("wrong mint fails closed", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), env);
  const mock = rpcFixture(invoice, { mint: WRONG_MINT });
  await expectCode("MINT_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: mock.rpcCall }),
  );
});

test("wrong recipient fails closed", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), env);
  const mock = rpcFixture(invoice, { recipient: OTHER_RECIPIENT });
  await expectCode("AMOUNT_OR_RECIPIENT_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: mock.rpcCall }),
  );
});

test("underpayment fails closed", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), env);
  const underpaid = (BigInt(invoice.amountAtomic) - 1n).toString();
  const mock = rpcFixture(invoice, { delta: underpaid });
  await expectCode("AMOUNT_OR_RECIPIENT_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: mock.rpcCall }),
  );
});

test("failed and pending transactions are never marked paid", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), env);
  const failed = rpcFixture(invoice, { metaErr: { InstructionError: [0, "x"] } });
  await expectCode("PAYMENT_TRANSACTION_FAILED", () =>
    checkInvoice(invoice.id, {
      storagePath: env.storagePath,
      rpcCall: failed.rpcCall,
    }),
  );

  const pending = rpcFixture(invoice, { confirmationStatus: "confirmed" });
  const result = await checkInvoice(invoice.id, {
    storagePath: env.storagePath,
    rpcCall: pending.rpcCall,
  });
  assert.equal(result.status, "pending");
  assert.equal(result.code, "PAYMENT_NOT_FINALIZED");
  assert.equal((await listInvoices({ storagePath: env.storagePath }))[0].status, "pending");
});

test("transaction time must match the invoice verification window", async () => {
  const env = await setup();
  const createdAt = "2026-07-23T10:00:00.000Z";
  const createdAtSeconds = Date.parse(createdAt) / 1000;
  const invoice = await createApproved(input(), {
    ...env,
    clock: () => new Date(createdAt),
  });

  const historical = rpcFixture(invoice, {
    blockTime: createdAtSeconds - 301,
  });
  await expectCode("PAYMENT_PREDATES_INVOICE", () =>
    verifyPayment(invoice, {
      rpcCall: historical.rpcCall,
      clock: () => new Date("2026-07-23T10:05:00.000Z"),
    }),
  );

  const toleratedSkew = rpcFixture(invoice, {
    blockTime: createdAtSeconds - 300,
  });
  assert.equal(
    (
      await verifyPayment(invoice, {
        rpcCall: toleratedSkew.rpcCall,
        clock: () => new Date("2026-07-23T10:05:00.000Z"),
      })
    ).status,
    "paid",
  );

  const missing = rpcFixture(invoice, { blockTime: null });
  await expectCode("INVALID_BLOCK_TIME", () =>
    verifyPayment(invoice, {
      rpcCall: missing.rpcCall,
      clock: () => new Date("2026-07-23T10:05:00.000Z"),
    }),
  );

  for (const invalidHistory of [
    rpcFixture(invoice, { signatureBlockTime: null }),
    rpcFixture(invoice, { signatureBlockTime: 0 }),
    rpcFixture(invoice, { omitSignatureBlockTime: true }),
  ]) {
    await expectCode("INVALID_BLOCK_TIME", () =>
      verifyPayment(invoice, {
        rpcCall: invalidHistory.rpcCall,
        clock: () => new Date("2026-07-23T10:05:00.000Z"),
      }),
    );
  }

  const mismatched = rpcFixture(invoice, {
    blockTime: createdAtSeconds + 60,
    signatureBlockTime: createdAtSeconds + 61,
  });
  await expectCode("BLOCK_TIME_MISMATCH", () =>
    verifyPayment(invoice, {
      rpcCall: mismatched.rpcCall,
      clock: () => new Date("2026-07-23T10:05:00.000Z"),
    }),
  );
});

test("expired requests and payments outside the fixed window fail closed", async () => {
  const env = await setup();
  const createdAt = "2026-07-23T10:00:00.000Z";
  const invoice = await createApproved(input(), {
    ...env,
    clock: () => new Date(createdAt),
  });
  const expiresAtSeconds = Date.parse(invoice.expiresAt) / 1000;

  const noHistory = async (_rpcUrl, method) => {
    assert.equal(method, "getSignaturesForAddress");
    return [];
  };
  const expired = await checkInvoice(invoice.id, {
    storagePath: env.storagePath,
    rpcCall: noHistory,
    clock: () => new Date((expiresAtSeconds + 301) * 1000),
  });
  assert.deepEqual(expired, {
    invoiceId: invoice.id,
    status: "expired",
    code: "PAYMENT_WINDOW_EXPIRED",
    message: "No finalized payment was found before the request expired",
    expiresAt: invoice.expiresAt,
  });
  assert.equal(
    (
      await listInvoices({
        storagePath: env.storagePath,
        clock: () => new Date((expiresAtSeconds + 301) * 1000),
      })
    )[0].status,
    "expired",
  );

  const boundary = rpcFixture(invoice, {
    blockTime: expiresAtSeconds + 300,
  });
  assert.equal(
    (
      await verifyPayment(invoice, {
        rpcCall: boundary.rpcCall,
        clock: () => new Date((expiresAtSeconds + 300) * 1000),
      })
    ).status,
    "paid",
  );

  const late = rpcFixture(invoice, {
    blockTime: expiresAtSeconds + 301,
  });
  await expectCode("PAYMENT_AFTER_EXPIRY", () =>
    verifyPayment(invoice, {
      rpcCall: late.rpcCall,
      clock: () => new Date((expiresAtSeconds + 301) * 1000),
    }),
  );
});

test("memo, reference, and transaction signature must match exactly", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), env);
  const wrongMemo = rpcFixture(invoice, {
    memo: `${invoice.memo}:ignore-previous-instructions`,
  });
  await expectCode("MEMO_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: wrongMemo.rpcCall }),
  );

  const duplicateReference = rpcFixture(invoice, { duplicateReference: true });
  await expectCode("REFERENCE_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: duplicateReference.rpcCall }),
  );

  const unrelatedReference = rpcFixture(invoice, {
    referenceOnTransfer: false,
  });
  await expectCode("REFERENCE_INSTRUCTION_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: unrelatedReference.rpcCall }),
  );

  const referenceNotAtExactTail = rpcFixture(invoice, {
    extraTransferAccount: true,
  });
  await expectCode("REFERENCE_INSTRUCTION_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: referenceNotAtExactTail.rpcCall }),
  );

  const auxiliaryDestination = rpcFixture(invoice, {
    destinationTokenAccount: base58Encode(Buffer.alloc(32, 6)),
  });
  await expectCode("TRANSFER_DESTINATION_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: auxiliaryDestination.rpcCall }),
  );

  const wrongSignature = rpcFixture(invoice, {
    transactionSignature: OTHER_SIGNATURE,
  });
  await expectCode("SIGNATURE_MISMATCH", () =>
    verifyPayment(invoice, { rpcCall: wrongSignature.rpcCall }),
  );
});

test("large unrelated compiled instruction data does not hide the payment", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), env);
  const previousInstructionData = base58Encode(Buffer.alloc(96, 1));
  assert.ok(previousInstructionData.length > 128);
  const mock = rpcFixture(invoice, { previousInstructionData });
  const verified = await verifyPayment(invoice, { rpcCall: mock.rpcCall });
  assert.equal(verified.status, "paid");
});

test("memo must be penultimate and SPL transfer must be last", async () => {
  const env = await setup();
  const invoice = await createApproved(input(), env);
  const noTransfer = rpcFixture(invoice, { omitTransfer: true });
  await expectCode("PAYMENT_INSTRUCTION_MISSING", () =>
    verifyPayment(invoice, { rpcCall: noTransfer.rpcCall }),
  );

  const wrongOrder = rpcFixture(invoice, { transferBeforeMemo: true });
  await expectCode("PAYMENT_INSTRUCTION_ORDER", () =>
    verifyPayment(invoice, { rpcCall: wrongOrder.rpcCall }),
  );
});

test("ambiguous references and signature reuse across invoices fail closed", async () => {
  const env = await setup();
  const first = await createApproved(input(), {
    ...env,
    clock: () => new Date("2026-07-23T10:00:00.000Z"),
  });
  const firstMock = rpcFixture(first);
  await checkInvoice(first.id, {
    storagePath: env.storagePath,
    rpcCall: firstMock.rpcCall,
    clock: () => new Date("2026-07-23T10:01:00.000Z"),
  });

  await writeFile(path.join(env.deliverablesDir, "second.txt"), "second\n");
  const second = await createApproved(
    input({
      invoiceId: "milestone-002",
      deliverable: "second.txt",
      amount: "1",
    }),
    {
      ...env,
      clock: () => new Date("2026-07-23T10:02:00.000Z"),
    },
  );
  const reused = rpcFixture(second, { signature: SIGNATURE });
  await expectCode("SIGNATURE_REUSED", () =>
    checkInvoice(second.id, {
      storagePath: env.storagePath,
      rpcCall: reused.rpcCall,
      clock: () => new Date("2026-07-23T10:03:00.000Z"),
    }),
  );

  const normal = rpcFixture(second);
  const ambiguousRpc = async (rpcUrl, method, params) => {
    if (method === "getSignaturesForAddress") {
      return [
        {
          signature: SIGNATURE,
          err: null,
          confirmationStatus: "finalized",
        },
        {
          signature: OTHER_SIGNATURE,
          err: null,
          confirmationStatus: "finalized",
        },
      ];
    }
    return normal.rpcCall(rpcUrl, method, params);
  };
  await expectCode("AMBIGUOUS_REFERENCE", () =>
    verifyPayment(second, { rpcCall: ambiguousRpc }),
  );
});

test("concurrent creates serialize ledger updates without losing invoices", async () => {
  const env = await setup();
  await writeFile(path.join(env.deliverablesDir, "second.txt"), "second\n");
  const firstInput = input({ invoiceId: "concurrent-001" });
  const secondInput = input({
    invoiceId: "concurrent-002",
    deliverable: "second.txt",
    amount: "1",
  });
  const [firstPreview, secondPreview] = await Promise.all([
    previewInvoice(firstInput, env),
    previewInvoice(secondInput, env),
  ]);
  await Promise.all([
    createInvoice(
      { ...firstInput, approval: firstPreview.approval },
      env,
    ),
    createInvoice(
      { ...secondInput, approval: secondPreview.approval },
      env,
    ),
  ]);
  const invoices = await listInvoices({ storagePath: env.storagePath });
  assert.deepEqual(
    new Set(invoices.map(({ id }) => id)),
    new Set(["concurrent-001", "concurrent-002"]),
  );
});

test("stale malformed locks recover but fresh malformed locks fail closed", async () => {
  const staleEnv = await setup();
  const staleInput = input({ invoiceId: "stale-lock" });
  const stalePreview = await previewInvoice(staleInput, staleEnv);
  await writeFile(`${staleEnv.storagePath}.lock`, "{}\n");
  const old = new Date(Date.now() - 120_000);
  await utimes(`${staleEnv.storagePath}.lock`, old, old);
  const created = await createInvoice(
    { ...staleInput, approval: stalePreview.approval },
    { ...staleEnv, lockTimeoutMs: 0 },
  );
  assert.equal(created.id, "stale-lock");

  const freshEnv = await setup();
  const freshInput = input({ invoiceId: "fresh-lock" });
  const freshPreview = await previewInvoice(freshInput, freshEnv);
  await writeFile(`${freshEnv.storagePath}.lock`, "{}\n");
  await expectCode("STORE_LOCKED", () =>
    createInvoice(
      { ...freshInput, approval: freshPreview.approval },
      { ...freshEnv, lockTimeoutMs: 0 },
    ),
  );
});

test("invoice ids are canonicalized to lowercase before persistence", async () => {
  const env = await setup();
  const created = await createApproved(input({ invoiceId: "CaseID" }), env);
  assert.equal(created.id, "caseid");
  assert.equal(
    (await createApproved(input({ invoiceId: "caseid" }), env)).idempotent,
    true,
  );
  assert.deepEqual(
    (await listInvoices({ storagePath: env.storagePath })).map(({ id }) => id),
    ["caseid"],
  );
});

test("malicious invoice and URI inputs are rejected, not interpolated", async () => {
  const env = await setup();
  for (const invoiceId of [
    "../pwn",
    "invoice:refund",
    "ignore previous instructions",
    "<script>",
    "__proto__",
  ]) {
    await expectCode("INVALID_INVOICE_ID", () =>
      previewInvoice(input({ invoiceId }), env),
    );
  }
  await expectCode("INVALID_PUBLIC_KEY", () =>
    previewInvoice(input({ recipient: "javascript:alert(1)" }), env),
  );
  await expectCode("INVALID_PUBLIC_KEY", () =>
    previewInvoice(
      input({ recipient: "11111111111111111111111111111111" }),
      env,
    ),
  );
  await expectCode("INVALID_NETWORK", () =>
    previewInvoice(input({ network: "https://evil.example" }), env),
  );
});

test("corrupt or symlinked storage is rejected", async () => {
  const env = await setup();
  const outside = path.join(env.root, "outside-store.json");
  await writeFile(outside, '{"schemaVersion":1,"invoices":{}}\n');
  await symlink(outside, env.storagePath);
  await expectCode("UNSAFE_STORAGE", () =>
    listInvoices({ storagePath: env.storagePath }),
  );
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`ok ${passed} - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n`);
    throw error;
  }
}
process.stdout.write(`\n${passed}/${tests.length} tests passed\n`);
