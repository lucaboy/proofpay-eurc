import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROOFPAY_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const DEFAULT_PATHS = Object.freeze({
  deliverablesDir: path.join(PROOFPAY_ROOT, "deliverables"),
  storagePath: path.join(PROOFPAY_ROOT, "data", "invoices.json"),
  evidenceDir: path.join(PROOFPAY_ROOT, "evidence"),
});

export const EURC_MINT =
  "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr";

export const NETWORKS = Object.freeze({
  devnet: Object.freeze({
    rpcUrl: "https://api.devnet.solana.com",
    eurcMint: EURC_MINT,
  }),
  mainnet: Object.freeze({
    rpcUrl: "https://api.mainnet-beta.solana.com",
    eurcMint: EURC_MINT,
  }),
});

const ALLOWED_RPC_URLS = new Set(
  Object.values(NETWORKS).map(({ rpcUrl }) => rpcUrl),
);
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
);
const MEMO_PROGRAM_IDS = new Set([
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);
const SPL_TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const STORE_SCHEMA_VERSION = 1;
const INVOICE_SCHEMA_VERSION = 3;
const EURC_DECIMALS = 6;
const MAX_RPC_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DELIVERABLE_BYTES = 1024 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const APPROVAL_SCHEMA_VERSION = 1;
const STORE_LOCK_TIMEOUT_MS = 10_000;
const STORE_LOCK_STALE_MS = 60_000;
const BLOCK_TIME_SKEW_MS = 5 * 60 * 1000;
export const PAYMENT_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const PAYMENT_WINDOW_MS = PAYMENT_WINDOW_SECONDS * 1000;

export class ProofPayError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ProofPayError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function fail(code, message, details) {
  throw new ProofPayError(code, message, details);
}

function assertPlainObject(value, code, message) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code, message);
  }
}

function nowIso(clock = () => new Date()) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("INVALID_CLOCK", "Clock returned an invalid date");
  }
  return date.toISOString();
}

function isCanonicalIsoTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const timestamp = Date.parse(value);
  return (
    !Number.isNaN(timestamp) &&
    new Date(timestamp).toISOString() === value
  );
}

export function base58Encode(bytes) {
  const input = Buffer.from(bytes);
  if (input.length === 0) {
    return "";
  }

  let zeroes = 0;
  while (zeroes < input.length && input[zeroes] === 0) {
    zeroes += 1;
  }

  let value = 0n;
  for (const byte of input) {
    value = value * 256n + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    value /= 58n;
  }

  return "1".repeat(zeroes) + encoded;
}

export function base58Decode(value, { maxLength = 128 } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    fail("INVALID_BASE58", "Base58 value must be a non-empty string");
  }
  if (
    !Number.isSafeInteger(maxLength) ||
    maxLength < 1 ||
    maxLength > 4096 ||
    value.length > maxLength
  ) {
    fail("INVALID_BASE58", "Base58 value is too long");
  }

  let number = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) {
      fail("INVALID_BASE58", "Base58 value contains an invalid character");
    }
    number = number * 58n + BigInt(digit);
  }

  const decoded = [];
  while (number > 0n) {
    decoded.push(Number(number % 256n));
    number /= 256n;
  }
  decoded.reverse();

  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === "1") {
    zeroes += 1;
  }

  return Buffer.concat([Buffer.alloc(zeroes), Buffer.from(decoded)]);
}

export function assertSolanaPublicKey(value, field = "public key") {
  let decoded;
  try {
    decoded = base58Decode(value);
  } catch (error) {
    if (error instanceof ProofPayError) {
      fail("INVALID_PUBLIC_KEY", `${field} is not valid base58`);
    }
    throw error;
  }
  if (decoded.length !== 32 || base58Encode(decoded) !== value) {
    fail(
      "INVALID_PUBLIC_KEY",
      `${field} must be a canonical base58-encoded 32-byte key`,
    );
  }
  if (decoded.every((byte) => byte === 0)) {
    fail("INVALID_PUBLIC_KEY", `${field} cannot be the all-zero key`);
  }
  return value;
}

const ED25519_FIELD = (1n << 255n) - 19n;

function mod(value) {
  const reduced = value % ED25519_FIELD;
  return reduced >= 0n ? reduced : reduced + ED25519_FIELD;
}

function modPow(base, exponent) {
  let result = 1n;
  let factor = mod(base);
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) {
      result = mod(result * factor);
    }
    factor = mod(factor * factor);
    power >>= 1n;
  }
  return result;
}

const ED25519_D = mod(
  -121665n * modPow(121666n, ED25519_FIELD - 2n),
);
const ED25519_SQRT_MINUS_ONE = modPow(
  2n,
  (ED25519_FIELD - 1n) / 4n,
);

function littleEndianBigInt(bytes) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = value * 256n + BigInt(bytes[index]);
  }
  return value;
}

function isEd25519Point(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    return false;
  }
  const encoded = Buffer.from(bytes);
  const sign = encoded[31] >>> 7;
  encoded[31] &= 0x7f;
  const y = littleEndianBigInt(encoded);
  if (y >= ED25519_FIELD) {
    return false;
  }

  const ySquared = mod(y * y);
  const numerator = mod(ySquared - 1n);
  const denominator = mod(ED25519_D * ySquared + 1n);
  if (denominator === 0n) {
    return false;
  }
  const xSquared = mod(
    numerator * modPow(denominator, ED25519_FIELD - 2n),
  );
  let x = modPow(xSquared, (ED25519_FIELD + 3n) / 8n);
  if (mod(x * x - xSquared) !== 0n) {
    x = mod(x * ED25519_SQRT_MINUS_ONE);
  }
  if (mod(x * x - xSquared) !== 0n) {
    return false;
  }
  return !(x === 0n && sign === 1);
}

function createProgramAddress(seeds, programId) {
  const programBytes = base58Decode(programId);
  if (
    seeds.length > 16 ||
    seeds.some(
      (seed) => !(seed instanceof Uint8Array) || seed.length > 32,
    )
  ) {
    fail("INVALID_PDA_SEEDS", "Program-derived address seeds are invalid");
  }
  const digest = createHash("sha256")
    .update(Buffer.concat([
      ...seeds.map((seed) => Buffer.from(seed)),
      programBytes,
      Buffer.from("ProgramDerivedAddress", "utf8"),
    ]))
    .digest();
  return isEd25519Point(digest) ? null : digest;
}

export function deriveAssociatedTokenAddress(owner, mint) {
  const ownerBytes = base58Decode(
    assertSolanaPublicKey(owner, "token account owner"),
  );
  const mintBytes = base58Decode(assertSolanaPublicKey(mint, "token mint"));
  const tokenProgramBytes = base58Decode(SPL_TOKEN_PROGRAM_ID);
  for (let bump = 255; bump >= 0; bump -= 1) {
    const address = createProgramAddress(
      [
        ownerBytes,
        tokenProgramBytes,
        mintBytes,
        Uint8Array.of(bump),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    if (address !== null) {
      return base58Encode(address);
    }
  }
  fail(
    "ASSOCIATED_TOKEN_ADDRESS_FAILED",
    "Unable to derive the canonical associated token account",
  );
}

function assertSignature(value) {
  let decoded;
  try {
    decoded = base58Decode(value);
  } catch {
    fail("INVALID_SIGNATURE", "RPC returned a malformed signature");
  }
  if (decoded.length !== 64 || base58Encode(decoded) !== value) {
    fail("INVALID_SIGNATURE", "RPC returned a malformed signature");
  }
  return value;
}

export function normalizeInvoiceId(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
  ) {
    fail(
      "INVALID_INVOICE_ID",
      "Invoice id must be 1-64 letters, digits, underscores, or hyphens",
    );
  }
  return value.toLowerCase();
}

export function parseAmount(value) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(value)
  ) {
    fail(
      "INVALID_AMOUNT",
      "Amount must be a positive canonical decimal with at most 6 fractional digits",
    );
  }

  const [whole, fraction = ""] = value.split(".");
  const atomic = BigInt(whole) * 10n ** 6n + BigInt(fraction.padEnd(6, "0"));
  if (atomic <= 0n) {
    fail("INVALID_AMOUNT", "Amount must be greater than zero");
  }

  const trimmedFraction = fraction.replace(/0+$/, "");
  return Object.freeze({
    amount: trimmedFraction.length > 0 ? `${whole}.${trimmedFraction}` : whole,
    amountAtomic: atomic.toString(),
    decimals: EURC_DECIMALS,
  });
}

function normalizeNetwork(value = "devnet") {
  if (!Object.hasOwn(NETWORKS, value)) {
    fail("INVALID_NETWORK", "Network must be devnet or mainnet");
  }
  return value;
}

function normalizeRelativeDeliverable(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.isAbsolute(value)
  ) {
    fail(
      "INVALID_DELIVERABLE_PATH",
      "Deliverable must be a relative path under the deliverables directory",
    );
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment),
    )
  ) {
    fail(
      "INVALID_DELIVERABLE_PATH",
      "Deliverable path segments may contain only letters, digits, dot, underscore, and hyphen",
    );
  }

  return segments.join("/");
}

async function statDirectoryWithoutSymlink(directory, code) {
  let stat;
  try {
    stat = await lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(code, `Directory does not exist: ${directory}`);
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(code, `Expected a real directory, not a symlink: ${directory}`);
  }
}

export async function hashDeliverable(
  deliverable,
  { deliverablesDir = DEFAULT_PATHS.deliverablesDir } = {},
) {
  const relativePath = normalizeRelativeDeliverable(deliverable);
  const root = path.resolve(deliverablesDir);
  await statDirectoryWithoutSymlink(root, "UNSAFE_DELIVERABLE_ROOT");
  const rootReal = await realpath(root);

  let cursor = root;
  let targetStat;
  for (const segment of relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    try {
      targetStat = await lstat(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail("DELIVERABLE_NOT_FOUND", `Deliverable not found: ${relativePath}`);
      }
      throw error;
    }
    if (targetStat.isSymbolicLink()) {
      fail(
        "SYMLINK_DELIVERABLE",
        "Deliverable path cannot contain symbolic links",
      );
    }
  }

  if (!targetStat?.isFile()) {
    fail("INVALID_DELIVERABLE", "Deliverable must be a regular file");
  }
  if (targetStat.size > MAX_DELIVERABLE_BYTES) {
    fail("DELIVERABLE_TOO_LARGE", "Deliverable exceeds the 1 GiB safety limit");
  }

  const target = path.join(root, ...relativePath.split("/"));
  const targetReal = await realpath(target);
  if (
    targetReal !== path.join(rootReal, ...relativePath.split("/")) ||
    !targetReal.startsWith(`${rootReal}${path.sep}`)
  ) {
    fail(
      "DELIVERABLE_ESCAPE",
      "Deliverable resolves outside the approved directory",
    );
  }

  const noFollow =
    typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ELOOP") {
      fail("SYMLINK_DELIVERABLE", "Deliverable cannot be a symbolic link");
    }
    throw error;
  }

  try {
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== targetStat.dev ||
      openedStat.ino !== targetStat.ino
    ) {
      fail(
        "DELIVERABLE_CHANGED",
        "Deliverable changed while it was being opened",
      );
    }
    if (openedStat.size === 0) {
      fail("EMPTY_DELIVERABLE", "Deliverable cannot be empty");
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }

    const finalStat = await handle.stat();
    if (
      finalStat.size !== openedStat.size ||
      finalStat.mtimeMs !== openedStat.mtimeMs
    ) {
      fail(
        "DELIVERABLE_CHANGED",
        "Deliverable changed while it was being hashed",
      );
    }

    return Object.freeze({
      path: relativePath,
      size: finalStat.size,
      sha256: hash.digest("hex"),
    });
  } finally {
    await handle.close();
  }
}

function strictEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

export function buildMemo(invoiceId, deliverableSha256) {
  const normalizedInvoiceId = normalizeInvoiceId(invoiceId);
  if (!/^[a-f0-9]{64}$/.test(deliverableSha256)) {
    fail("INVALID_DIGEST", "Deliverable SHA-256 digest is invalid");
  }
  return `PROOFPAY:${normalizedInvoiceId}:${deliverableSha256.slice(0, 16)}`;
}

export function deriveReference({
  invoiceId,
  network,
  recipient,
  amountAtomic,
  deliverableSha256,
  validForSeconds = PAYMENT_WINDOW_SECONDS,
}) {
  if (validForSeconds !== PAYMENT_WINDOW_SECONDS) {
    fail(
      "INVALID_PAYMENT_WINDOW",
      `Payment window must be exactly ${PAYMENT_WINDOW_SECONDS} seconds`,
    );
  }
  const digest = createHash("sha256")
    .update("ProofPay EURC reference v2\0", "utf8")
    .update(normalizeInvoiceId(invoiceId), "utf8")
    .update("\0", "utf8")
    .update(normalizeNetwork(network), "utf8")
    .update("\0", "utf8")
    .update(assertSolanaPublicKey(recipient, "recipient"), "utf8")
    .update("\0", "utf8")
    .update(String(amountAtomic), "utf8")
    .update("\0", "utf8")
    .update(deliverableSha256, "utf8")
    .update("\0", "utf8")
    .update(String(validForSeconds), "utf8")
    .digest();
  return base58Encode(digest);
}

export function buildSolanaPayUri({
  recipient,
  amount,
  mint,
  reference,
  label,
  message,
  memo,
}) {
  assertSolanaPublicKey(recipient, "recipient");
  const normalizedAmount = parseAmount(amount).amount;
  assertSolanaPublicKey(mint, "EURC mint");
  assertSolanaPublicKey(reference, "reference");
  for (const [field, value] of Object.entries({ label, message, memo })) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      fail("INVALID_URI_FIELD", `${field} is invalid`);
    }
  }

  const query = [
    ["amount", normalizedAmount],
    ["spl-token", mint],
    ["reference", reference],
    ["label", label],
    ["message", message],
    ["memo", memo],
  ]
    .map(([key, value]) => `${key}=${strictEncode(value)}`)
    .join("&");

  return `solana:${recipient}?${query}`;
}

function prepareInvoiceTerms(
  { invoiceId, recipient, amount, network = "devnet" },
  deliverable,
) {
  const id = normalizeInvoiceId(invoiceId);
  const normalizedNetwork = normalizeNetwork(network);
  const normalizedRecipient = assertSolanaPublicKey(recipient, "recipient");
  const normalizedAmount = parseAmount(amount);
  const mint = NETWORKS[normalizedNetwork].eurcMint;
  const memo = buildMemo(id, deliverable.sha256);
  const reference = deriveReference({
    invoiceId: id,
    network: normalizedNetwork,
    recipient: normalizedRecipient,
    amountAtomic: normalizedAmount.amountAtomic,
    deliverableSha256: deliverable.sha256,
    validForSeconds: PAYMENT_WINDOW_SECONDS,
  });
  const label = "ProofPay EURC";
  const message = `ProofPay invoice ${id}`;
  const solanaPayUri = buildSolanaPayUri({
    recipient: normalizedRecipient,
    amount: normalizedAmount.amount,
    mint,
    reference,
    label,
    message,
    memo,
  });

  return Object.freeze({
    id,
    network: normalizedNetwork,
    rpcUrl: NETWORKS[normalizedNetwork].rpcUrl,
    currency: "EURC",
    mint,
    decimals: EURC_DECIMALS,
    recipient: normalizedRecipient,
    amount: normalizedAmount.amount,
    amountAtomic: normalizedAmount.amountAtomic,
    validForSeconds: PAYMENT_WINDOW_SECONDS,
    reference,
    memo,
    label,
    message,
    deliverable,
    solanaPayUri,
  });
}

export async function previewInvoice(
  input,
  { deliverablesDir = DEFAULT_PATHS.deliverablesDir } = {},
) {
  const deliverable = await hashDeliverable(input.deliverable, {
    deliverablesDir,
  });
  const terms = prepareInvoiceTerms(input, deliverable);
  return {
    schemaVersion: INVOICE_SCHEMA_VERSION,
    status: "preview",
    ...terms,
    approval: {
      schemaVersion: APPROVAL_SCHEMA_VERSION,
      deliverableSha256: terms.deliverable.sha256,
      reference: terms.reference,
      solanaPayUri: terms.solanaPayUri,
    },
  };
}

function assertPreviewApproval(approval, preview) {
  if (
    approval === null ||
    typeof approval !== "object" ||
    Array.isArray(approval) ||
    Object.getPrototypeOf(approval) !== Object.prototype ||
    approval.schemaVersion !== APPROVAL_SCHEMA_VERSION ||
    typeof approval.deliverableSha256 !== "string" ||
    typeof approval.reference !== "string" ||
    typeof approval.solanaPayUri !== "string"
  ) {
    fail(
      "APPROVAL_REQUIRED",
      "Create requires the digest, reference, and Solana Pay URI returned by preview",
    );
  }
  if (
    approval.deliverableSha256 !== preview.deliverable.sha256 ||
    approval.reference !== preview.reference ||
    approval.solanaPayUri !== preview.solanaPayUri
  ) {
    fail(
      "PREVIEW_CHANGED",
      "Current invoice terms or deliverable no longer match the approved preview",
    );
  }
}

function emptyStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    invoices: {},
  };
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateStoredInvoice(invoice, key) {
  assertPlainObject(
    invoice,
    "CORRUPT_STORE",
    `Stored invoice ${key} is malformed`,
  );
  if (invoice.id !== key || invoice.schemaVersion !== INVOICE_SCHEMA_VERSION) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has an invalid identity`);
  }
  if (normalizeInvoiceId(invoice.id) !== invoice.id) {
    fail("CORRUPT_STORE", `Stored invoice ${key} is not canonical`);
  }
  const network = normalizeNetwork(invoice.network);
  if (
    invoice.rpcUrl !== NETWORKS[network].rpcUrl ||
    invoice.mint !== NETWORKS[network].eurcMint ||
    invoice.currency !== "EURC" ||
    invoice.decimals !== EURC_DECIMALS ||
    invoice.validForSeconds !== PAYMENT_WINDOW_SECONDS
  ) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has invalid EURC terms`);
  }
  assertSolanaPublicKey(invoice.recipient, "stored recipient");
  assertSolanaPublicKey(invoice.reference, "stored reference");
  const amount = parseAmount(invoice.amount);
  if (
    amount.amount !== invoice.amount ||
    amount.amountAtomic !== invoice.amountAtomic
  ) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has inconsistent amount`);
  }
  if (
    !invoice.deliverable ||
    typeof invoice.deliverable !== "object" ||
    Array.isArray(invoice.deliverable) ||
    normalizeRelativeDeliverable(invoice.deliverable.path) !==
      invoice.deliverable.path ||
    !Number.isSafeInteger(invoice.deliverable.size) ||
    invoice.deliverable.size <= 0 ||
    !/^[a-f0-9]{64}$/.test(invoice.deliverable.sha256) ||
    invoice.memo !== buildMemo(invoice.id, invoice.deliverable.sha256)
  ) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has invalid evidence terms`);
  }
  if (
    invoice.label !== "ProofPay EURC" ||
    invoice.message !== `ProofPay invoice ${invoice.id}`
  ) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has invalid display terms`);
  }
  const expectedReference = deriveReference({
    invoiceId: invoice.id,
    network,
    recipient: invoice.recipient,
    amountAtomic: invoice.amountAtomic,
    deliverableSha256: invoice.deliverable.sha256,
    validForSeconds: invoice.validForSeconds,
  });
  if (invoice.reference !== expectedReference) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has invalid reference`);
  }
  const expectedUri = buildSolanaPayUri(invoice);
  if (invoice.solanaPayUri !== expectedUri) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has invalid Solana Pay URI`);
  }
  assertPlainObject(
    invoice.approval,
    "CORRUPT_STORE",
    `Stored invoice ${key} has invalid preview commitment`,
  );
  if (
    invoice.approval.schemaVersion !== APPROVAL_SCHEMA_VERSION ||
    invoice.approval.kind !== "preview-match" ||
    invoice.approval.deliverableSha256 !== invoice.deliverable.sha256 ||
    invoice.approval.reference !== invoice.reference ||
    invoice.approval.solanaPayUri !== invoice.solanaPayUri ||
    invoice.approval.recordedAt !== invoice.createdAt
  ) {
    fail(
      "CORRUPT_STORE",
      `Stored invoice ${key} has inconsistent preview commitment`,
    );
  }
  if (!["pending", "paid"].includes(invoice.status)) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has invalid status`);
  }
  for (const [field, timestamp] of [
    ["createdAt", invoice.createdAt],
    ["expiresAt", invoice.expiresAt],
    ["updatedAt", invoice.updatedAt],
  ]) {
    if (
      !isCanonicalIsoTimestamp(timestamp)
    ) {
      fail(
        "CORRUPT_STORE",
        `Stored invoice ${key} has invalid ${field}`,
      );
    }
  }
  if (
    Date.parse(invoice.expiresAt) - Date.parse(invoice.createdAt) !==
      PAYMENT_WINDOW_MS ||
    Date.parse(invoice.updatedAt) < Date.parse(invoice.createdAt)
  ) {
    fail("CORRUPT_STORE", `Stored invoice ${key} has invalid time bounds`);
  }
  if (invoice.status === "paid") {
    assertPlainObject(
      invoice.payment,
      "CORRUPT_STORE",
      `Stored payment ${key} is malformed`,
    );
    assertSignature(invoice.payment.signature);
    if (
      !Number.isSafeInteger(invoice.payment.slot) ||
      invoice.payment.slot <= 0 ||
      !Number.isSafeInteger(invoice.payment.blockTime) ||
      invoice.payment.blockTime <= 0 ||
      invoice.payment.blockTime * 1000 <
        Date.parse(invoice.createdAt) - BLOCK_TIME_SKEW_MS ||
      invoice.payment.blockTime * 1000 >
        Date.parse(invoice.expiresAt) + BLOCK_TIME_SKEW_MS ||
      invoice.payment.blockTime * 1000 >
        Date.parse(invoice.payment.verifiedAt) + BLOCK_TIME_SKEW_MS ||
      invoice.payment.confirmedAtomic !== invoice.amountAtomic ||
      invoice.payment.confirmedAmount !== invoice.amount ||
      invoice.payment.confirmationStatus !== "finalized" ||
      invoice.payment.rpcUrl !== invoice.rpcUrl ||
      !isCanonicalIsoTimestamp(invoice.payment.verifiedAt)
    ) {
      fail("CORRUPT_STORE", `Stored payment ${key} is inconsistent`);
    }
  } else if (invoice.payment !== null) {
    fail("CORRUPT_STORE", `Pending invoice ${key} cannot contain a payment`);
  }
}

async function assertSafeStoragePath(storagePath, { createParent = false } = {}) {
  const resolved = path.resolve(storagePath);
  const parent = path.dirname(resolved);
  if (createParent) {
    await mkdir(parent, { recursive: true, mode: 0o700 });
  }
  let parentStat;
  try {
    parentStat = await lstat(parent);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("STORAGE_NOT_FOUND", `Storage directory does not exist: ${parent}`);
    }
    throw error;
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    fail("UNSAFE_STORAGE", "Storage directory cannot be a symbolic link");
  }

  try {
    const storageStat = await lstat(resolved);
    if (storageStat.isSymbolicLink() || !storageStat.isFile()) {
      fail("UNSAFE_STORAGE", "Storage file must be a regular file");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return resolved;
}

export async function loadStore(
  storagePath = DEFAULT_PATHS.storagePath,
  { allowMissing = true } = {},
) {
  const resolved = await assertSafeStoragePath(storagePath, {
    createParent: allowMissing,
  });
  let raw;
  try {
    raw = await readFile(resolved, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" && allowMissing) {
      return emptyStore();
    }
    throw error;
  }
  if (Buffer.byteLength(raw, "utf8") > 2 * 1024 * 1024) {
    fail("CORRUPT_STORE", "Invoice store exceeds the 2 MiB safety limit");
  }

  let store;
  try {
    store = JSON.parse(raw);
  } catch {
    fail("CORRUPT_STORE", "Invoice store is not valid JSON");
  }
  assertPlainObject(store, "CORRUPT_STORE", "Invoice store is malformed");
  if (store.schemaVersion !== STORE_SCHEMA_VERSION) {
    fail("CORRUPT_STORE", "Unsupported invoice store schema");
  }
  assertPlainObject(
    store.invoices,
    "CORRUPT_STORE",
    "Invoice store is malformed",
  );
  for (const [key, invoice] of Object.entries(store.invoices)) {
    validateStoredInvoice(invoice, key);
  }
  return store;
}

async function atomicWriteFile(filePath, contents) {
  const resolved = await assertSafeStoragePath(filePath, {
    createParent: true,
  });
  const parent = path.dirname(resolved);
  const temporary = path.join(
    parent,
    `.${path.basename(resolved)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
    await handle.close();
    handle = undefined;
    await rename(temporary, resolved);
    const finalHandle = await open(resolved, "r");
    try {
      await finalHandle.chmod(0o600);
      await finalHandle.sync();
    } finally {
      await finalHandle.close();
    }
    await syncDirectory(parent);
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

async function writeExclusiveFile(filePath, contents) {
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function saveStore(store, storagePath) {
  await atomicWriteFile(storagePath, `${JSON.stringify(store, null, 2)}\n`);
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function clearStaleLock(lockPath) {
  const noFollow =
    typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(lockPath, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    if (error?.code === "ELOOP") {
      fail("UNSAFE_STORAGE_LOCK", "Storage lock cannot be a symbolic link");
    }
    throw error;
  }

  let lockStat;
  let metadata;
  let metadataValid = false;
  try {
    lockStat = await handle.stat();
    if (!lockStat.isFile()) {
      return false;
    }
    if (lockStat.size <= 1024) {
      try {
        metadata = JSON.parse(await handle.readFile("utf8"));
      } catch {
        metadata = undefined;
      }
      metadataValid =
        metadata !== null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        Number.isSafeInteger(metadata.pid) &&
        typeof metadata.token === "string" &&
        /^[a-f0-9]{32}$/.test(metadata.token) &&
        Number.isSafeInteger(metadata.createdAt);
    }
  } finally {
    await handle.close();
  }

  const newestKnownTimestamp = metadataValid
    ? Math.max(metadata.createdAt, lockStat.mtimeMs)
    : lockStat.mtimeMs;
  if (Date.now() - newestKnownTimestamp < STORE_LOCK_STALE_MS) {
    return false;
  }
  if (metadataValid && processIsAlive(metadata.pid)) {
    return false;
  }

  let currentStat;
  try {
    currentStat = await lstat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
  if (
    currentStat.isSymbolicLink() ||
    !currentStat.isFile() ||
    currentStat.dev !== lockStat.dev ||
    currentStat.ino !== lockStat.ino
  ) {
    return false;
  }
  await unlink(lockPath);
  return true;
}

async function acquireFileLock(targetPath, timeoutMs = STORE_LOCK_TIMEOUT_MS) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > 60_000
  ) {
    fail("INVALID_LOCK_TIMEOUT", "Lock timeout must be 0-60000 milliseconds");
  }
  const resolved = await assertSafeStoragePath(targetPath, {
    createParent: true,
  });
  const lockPath = `${resolved}.lock`;
  const token = randomBytes(16).toString("hex");
  const deadline = Date.now() + timeoutMs;

  while (true) {
    let handle;
    let created = false;
    try {
      handle = await open(lockPath, "wx", 0o600);
      created = true;
      const metadata = {
        pid: process.pid,
        token,
        createdAt: Date.now(),
      };
      await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
      await handle.sync();
      await handle.chmod(0o600);
      return async () => {
        await handle.close();
        let current;
        try {
          current = JSON.parse(await readFile(lockPath, "utf8"));
        } catch {
          fail(
            "LOCK_OWNERSHIP_LOST",
            "Storage lock changed before it could be released",
          );
        }
        if (current?.token !== token || current?.pid !== process.pid) {
          fail(
            "LOCK_OWNERSHIP_LOST",
            "Storage lock ownership was lost",
          );
        }
        await unlink(lockPath);
      };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      if (created) {
        await unlink(lockPath).catch(() => {});
      }
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    if (await clearStaleLock(lockPath)) {
      continue;
    }
    if (Date.now() >= deadline) {
      fail("STORE_LOCKED", "Invoice store is busy; retry the operation");
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20 + Math.floor(Math.random() * 31));
    });
  }
}

async function withFileLock(targetPath, fn, timeoutMs) {
  const release = await acquireFileLock(targetPath, timeoutMs);
  let operationError;
  try {
    return await fn();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await release();
    } catch (releaseError) {
      if (!operationError) {
        throw releaseError;
      }
    }
  }
}

function storedInvoiceMatchesPreview(invoice, preview) {
  const keys = [
    "schemaVersion",
    "id",
    "network",
    "rpcUrl",
    "currency",
    "mint",
    "decimals",
    "recipient",
    "amount",
    "amountAtomic",
    "validForSeconds",
    "reference",
    "memo",
    "label",
    "message",
    "solanaPayUri",
  ];
  return (
    keys.every((key) => invoice[key] === preview[key]) &&
    JSON.stringify(invoice.deliverable) ===
      JSON.stringify(preview.deliverable) &&
    invoice.approval?.deliverableSha256 ===
      preview.approval.deliverableSha256 &&
    invoice.approval?.reference === preview.approval.reference &&
    invoice.approval?.solanaPayUri === preview.approval.solanaPayUri
  );
}

export async function createInvoice(
  input,
  {
    deliverablesDir = DEFAULT_PATHS.deliverablesDir,
    storagePath = DEFAULT_PATHS.storagePath,
    clock,
    lockTimeoutMs,
  } = {},
) {
  const preview = await previewInvoice(input, { deliverablesDir });
  assertPreviewApproval(input.approval, preview);
  return await withFileLock(
    storagePath,
    async () => {
      const store = await loadStore(storagePath);
      if (Object.hasOwn(store.invoices, preview.id)) {
        const existing = store.invoices[preview.id];
        if (storedInvoiceMatchesPreview(existing, preview)) {
          return {
            ...jsonClone(existing),
            idempotent: true,
          };
        }
        fail(
          "INVOICE_CONFLICT",
          `Invoice id already belongs to different immutable terms: ${preview.id}`,
        );
      }
      if (
        Object.values(store.invoices).some(
          (invoice) => invoice.reference === preview.reference,
        )
      ) {
        fail(
          "REFERENCE_COLLISION",
          "Derived reference already belongs to an invoice",
        );
      }

      const timestamp = nowIso(clock);
      const expiresAt = new Date(
        Date.parse(timestamp) + PAYMENT_WINDOW_MS,
      ).toISOString();
      const { approval, ...approvedTerms } = preview;
      const invoice = {
        ...approvedTerms,
        approval: {
          ...approval,
          kind: "preview-match",
          recordedAt: timestamp,
        },
        status: "pending",
        createdAt: timestamp,
        expiresAt,
        updatedAt: timestamp,
        payment: null,
      };
      store.invoices[invoice.id] = invoice;
      await saveStore(store, storagePath);
      return {
        ...jsonClone(invoice),
        idempotent: false,
      };
    },
    lockTimeoutMs,
  );
}

export async function listInvoices({
  storagePath = DEFAULT_PATHS.storagePath,
  clock,
} = {}) {
  const store = await loadStore(storagePath);
  const listedAtMs = Date.parse(nowIso(clock));
  return Object.values(store.invoices)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((invoice) => {
      const listed = jsonClone(invoice);
      if (
        listed.status === "pending" &&
        listedAtMs > Date.parse(listed.expiresAt) + BLOCK_TIME_SKEW_MS
      ) {
        listed.status = "expired";
        listed.statusDerivedAt = new Date(listedAtMs).toISOString();
      }
      return listed;
    });
}

function validateRpcUrl(rpcUrl) {
  if (!ALLOWED_RPC_URLS.has(rpcUrl)) {
    fail("RPC_NOT_ALLOWED", "RPC URL is not on the ProofPay allowlist");
  }
  return rpcUrl;
}

export async function rpcRequest(
  rpcUrl,
  method,
  params,
  { timeoutMs = 15_000 } = {},
) {
  validateRpcUrl(rpcUrl);
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(method)) {
    fail("INVALID_RPC_METHOD", "RPC method is invalid");
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });

  return await new Promise((resolve, reject) => {
    const request = httpsRequest(
      rpcUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          accept: "application/json",
        },
        timeout: timeoutMs,
      },
      (response) => {
        let size = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RPC_RESPONSE_BYTES) {
            request.destroy(
              new ProofPayError(
                "RPC_RESPONSE_TOO_LARGE",
                "RPC response exceeded the 2 MiB safety limit",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (
            response.statusCode === undefined ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(
              new ProofPayError(
                "RPC_HTTP_ERROR",
                `RPC returned HTTP ${response.statusCode ?? "unknown"}`,
              ),
            );
            return;
          }
          let payload;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            reject(
              new ProofPayError("RPC_INVALID_JSON", "RPC returned invalid JSON"),
            );
            return;
          }
          if (payload?.error) {
            reject(
              new ProofPayError(
                "RPC_ERROR",
                "Solana RPC rejected the request",
                {
                  code: payload.error.code,
                  message: String(payload.error.message ?? "").slice(0, 200),
                },
              ),
            );
            return;
          }
          if (!Object.hasOwn(payload ?? {}, "result")) {
            reject(
              new ProofPayError(
                "RPC_INVALID_RESPONSE",
                "RPC response has no result",
              ),
            );
            return;
          }
          resolve(payload.result);
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(
        new ProofPayError("RPC_TIMEOUT", "Solana RPC request timed out"),
      );
    });
    request.on("error", (error) => {
      reject(
        error instanceof ProofPayError
          ? error
          : new ProofPayError("RPC_NETWORK_ERROR", "Solana RPC request failed"),
      );
    });
    request.end(body);
  });
}

function resolveAccountKeys(transaction) {
  const message = transaction?.transaction?.message;
  const staticKeys = message?.accountKeys;
  const header = message?.header;
  if (
    !Array.isArray(staticKeys) ||
    staticKeys.length === 0 ||
    !header ||
    typeof header !== "object" ||
    !Number.isInteger(header.numRequiredSignatures) ||
    !Number.isInteger(header.numReadonlySignedAccounts) ||
    !Number.isInteger(header.numReadonlyUnsignedAccounts)
  ) {
    fail(
      "MISSING_ACCOUNT_KEYS",
      "Raw transaction account keys or header are missing",
    );
  }
  for (const value of [
    header.numRequiredSignatures,
    header.numReadonlySignedAccounts,
    header.numReadonlyUnsignedAccounts,
  ]) {
    if (value < 0 || value > staticKeys.length) {
      fail("INVALID_ACCOUNT_HEADER", "Transaction account header is invalid");
    }
  }
  if (
    header.numReadonlySignedAccounts > header.numRequiredSignatures ||
    header.numRequiredSignatures +
      header.numReadonlyUnsignedAccounts >
      staticKeys.length
  ) {
    fail("INVALID_ACCOUNT_HEADER", "Transaction account header is invalid");
  }

  const normalizedStatic = staticKeys.map((key) =>
    assertSolanaPublicKey(key, "transaction account key"),
  );
  const loadedAddresses = transaction?.meta?.loadedAddresses;
  const loadedWritable = loadedAddresses?.writable ?? [];
  const loadedReadonly = loadedAddresses?.readonly ?? [];
  if (!Array.isArray(loadedWritable) || !Array.isArray(loadedReadonly)) {
    fail("INVALID_LOADED_ADDRESSES", "Loaded transaction addresses are invalid");
  }
  const normalizedLoadedWritable = loadedWritable.map((key) =>
    assertSolanaPublicKey(key, "loaded writable account key"),
  );
  const normalizedLoadedReadonly = loadedReadonly.map((key) =>
    assertSolanaPublicKey(key, "loaded readonly account key"),
  );

  const writableSigned =
    header.numRequiredSignatures - header.numReadonlySignedAccounts;
  const writableUnsignedEnd =
    staticKeys.length - header.numReadonlyUnsignedAccounts;
  return [
    ...normalizedStatic.map((pubkey, index) => ({
      pubkey,
      signer: index < header.numRequiredSignatures,
      writable:
        index < header.numRequiredSignatures
          ? index < writableSigned
          : index < writableUnsignedEnd,
    })),
    ...normalizedLoadedWritable.map((pubkey) => ({
      pubkey,
      signer: false,
      writable: true,
    })),
    ...normalizedLoadedReadonly.map((pubkey) => ({
      pubkey,
      signer: false,
      writable: false,
    })),
  ];
}

function decodeInstructionData(value) {
  if (typeof value !== "string" || value.length > 4096) {
    fail("INVALID_INSTRUCTION_DATA", "Instruction data is malformed");
  }
  if (value.length === 0) {
    return Buffer.alloc(0);
  }
  try {
    return base58Decode(value, { maxLength: 4096 });
  } catch {
    fail("INVALID_INSTRUCTION_DATA", "Instruction data is not canonical base58");
  }
}

function resolveInstruction(instruction, accountKeys) {
  if (
    !instruction ||
    typeof instruction !== "object" ||
    !Number.isInteger(instruction.programIdIndex) ||
    instruction.programIdIndex < 0 ||
    instruction.programIdIndex >= accountKeys.length ||
    !Array.isArray(instruction.accounts)
  ) {
    fail("INVALID_COMPILED_INSTRUCTION", "Compiled instruction is malformed");
  }
  const accounts = instruction.accounts.map((index) => {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= accountKeys.length
    ) {
      fail(
        "INVALID_COMPILED_INSTRUCTION",
        "Compiled instruction account index is invalid",
      );
    }
    return {
      index,
      ...accountKeys[index],
    };
  });
  return {
    programId: accountKeys[instruction.programIdIndex].pubkey,
    accounts,
    data: decodeInstructionData(instruction.data),
  };
}

function memoText(instruction) {
  const text = instruction.data.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(instruction.data)) {
    fail("UNPARSED_MEMO", "Memo instruction is not valid UTF-8");
  }
  return text;
}

function extractMemos(transaction, accountKeys) {
  const outer = transaction?.transaction?.message?.instructions;
  const innerGroups = transaction?.meta?.innerInstructions ?? [];
  if (!Array.isArray(outer) || !Array.isArray(innerGroups)) {
    fail("INVALID_INSTRUCTIONS", "Transaction instructions are malformed");
  }
  const instructions = [
    ...outer,
    ...innerGroups.flatMap((group) => {
      if (!group || !Array.isArray(group.instructions)) {
        fail("INVALID_INSTRUCTIONS", "Inner instructions are malformed");
      }
      return group.instructions;
    }),
  ];
  const memos = [];
  for (const compiled of instructions) {
    const instruction = resolveInstruction(compiled, accountKeys);
    if (MEMO_PROGRAM_IDS.has(instruction.programId)) {
      memos.push(memoText(instruction));
    }
  }
  return memos;
}

function validateTokenBalanceArray(value, field) {
  if (!Array.isArray(value)) {
    fail("MISSING_TOKEN_BALANCES", `Transaction ${field} are missing`);
  }
  const seen = new Set();
  for (const balance of value) {
    if (
      !balance ||
      typeof balance !== "object" ||
      !Number.isInteger(balance.accountIndex) ||
      balance.accountIndex < 0 ||
      typeof balance.mint !== "string" ||
      !balance.uiTokenAmount ||
      !/^(?:0|[1-9][0-9]*)$/.test(balance.uiTokenAmount.amount) ||
      balance.uiTokenAmount.decimals !== EURC_DECIMALS
    ) {
      fail("INVALID_TOKEN_BALANCE", `Transaction ${field} are malformed`);
    }
    if (seen.has(balance.accountIndex)) {
      fail("DUPLICATE_TOKEN_BALANCE", `Transaction ${field} are ambiguous`);
    }
    seen.add(balance.accountIndex);
  }
}

function recipientMintTotal(balances, recipient, mint) {
  return balances.reduce((total, balance) => {
    if (balance.owner === recipient && balance.mint === mint) {
      return total + BigInt(balance.uiTokenAmount.amount);
    }
    return total;
  }, 0n);
}

function tokenBalanceAt(balances, accountIndex, recipient, mint) {
  const balance = balances.find(
    (candidate) => candidate.accountIndex === accountIndex,
  );
  if (!balance) {
    return 0n;
  }
  if (balance.owner !== recipient || balance.mint !== mint) {
    fail(
      "TRANSFER_DESTINATION_MISMATCH",
      "Transfer destination is not an EURC account owned by the recipient",
    );
  }
  return BigInt(balance.uiTokenAmount.amount);
}

function verifyPaymentInstruction(
  transaction,
  invoice,
  accountKeys,
  preTokenBalances,
  postTokenBalances,
) {
  const instructions = transaction.transaction?.message?.instructions;
  if (!Array.isArray(instructions) || instructions.length < 2) {
    fail(
      "PAYMENT_INSTRUCTION_MISSING",
      "Transaction must end with the invoice memo and SPL token transfer",
    );
  }

  const memoInstruction = resolveInstruction(instructions.at(-2), accountKeys);
  const transferInstruction = resolveInstruction(
    instructions.at(-1),
    accountKeys,
  );
  if (
    !MEMO_PROGRAM_IDS.has(memoInstruction.programId) ||
    memoText(memoInstruction) !== invoice.memo
  ) {
    fail(
      "PAYMENT_INSTRUCTION_ORDER",
      "Exact invoice memo must be the penultimate outer instruction",
    );
  }

  if (transferInstruction.programId !== SPL_TOKEN_PROGRAM_ID) {
    fail(
      "PAYMENT_INSTRUCTION_MISSING",
      "Last outer instruction must be an SPL token transfer",
    );
  }

  const opcode = transferInstruction.data[0];
  const transferType =
    opcode === 3 ? "transfer" : opcode === 12 ? "transferChecked" : null;
  const expectedDataLength = transferType === "transfer" ? 9 : 10;
  const requiredAccounts = transferType === "transfer" ? 3 : 4;
  if (
    transferType === null ||
    transferInstruction.data.length !== expectedDataLength ||
    transferInstruction.accounts.length < requiredAccounts
  ) {
    fail(
      "PAYMENT_INSTRUCTION_MISSING",
      "Last outer instruction is not a canonical SPL transfer or transferChecked",
    );
  }

  const transferAmount = transferInstruction.data
    .readBigUInt64LE(1)
    .toString();
  const transferDecimals =
    transferType === "transferChecked"
      ? transferInstruction.data[9]
      : EURC_DECIMALS;
  if (
    transferAmount !== invoice.amountAtomic ||
    transferDecimals !== EURC_DECIMALS
  ) {
    fail(
      "TRANSFER_AMOUNT_MISMATCH",
      "SPL transfer amount does not exactly match the invoice",
    );
  }

  const sourceAccount = transferInstruction.accounts[0];
  const mintAccount =
    transferType === "transferChecked"
      ? transferInstruction.accounts[1]
      : null;
  const destinationAccount =
    transferInstruction.accounts[transferType === "transferChecked" ? 2 : 1];
  const authorityAccount =
    transferInstruction.accounts[transferType === "transferChecked" ? 3 : 2];
  if (
    !sourceAccount.writable ||
    !destinationAccount.writable ||
    (transferType === "transferChecked" &&
      (mintAccount.pubkey !== invoice.mint || mintAccount.writable)) ||
    typeof authorityAccount.pubkey !== "string"
  ) {
    fail(
      "TRANSFER_MINT_MISMATCH",
      "SPL transfer accounts do not match the invoice EURC transfer",
    );
  }
  if (
    destinationAccount.pubkey !==
    deriveAssociatedTokenAddress(invoice.recipient, invoice.mint)
  ) {
    fail(
      "TRANSFER_DESTINATION_MISMATCH",
      "SPL destination must be the recipient's canonical associated token account",
    );
  }

  const referenceAccounts = transferInstruction.accounts.filter(
    ({ pubkey }) => pubkey === invoice.reference,
  );
  const referencePosition = transferInstruction.accounts.findIndex(
    ({ pubkey }) => pubkey === invoice.reference,
  );
  if (
    transferInstruction.accounts.length !== requiredAccounts + 1 ||
    referenceAccounts.length !== 1 ||
    referencePosition !== requiredAccounts ||
    referenceAccounts[0].signer !== false ||
    referenceAccounts[0].writable !== false
  ) {
    fail(
      "REFERENCE_INSTRUCTION_MISMATCH",
      "Reference must be an additional readonly non-signer account on the final SPL transfer",
    );
  }

  const destinationMatches = postTokenBalances.filter((balance) => {
    if (balance.owner !== invoice.recipient || balance.mint !== invoice.mint) {
      return false;
    }
    const account = accountKeys[balance.accountIndex];
    return (
      account &&
      account.pubkey === destinationAccount.pubkey
    );
  });
  if (destinationMatches.length !== 1) {
    fail(
      "TRANSFER_DESTINATION_MISMATCH",
      "SPL destination must uniquely map to the recipient EURC token account",
    );
  }

  const destinationIndex = destinationMatches[0].accountIndex;
  const destinationBefore = tokenBalanceAt(
    preTokenBalances,
    destinationIndex,
    invoice.recipient,
    invoice.mint,
  );
  const destinationAfter = tokenBalanceAt(
    postTokenBalances,
    destinationIndex,
    invoice.recipient,
    invoice.mint,
  );
  if (
    destinationAfter - destinationBefore !==
    BigInt(invoice.amountAtomic)
  ) {
    fail(
      "TRANSFER_DESTINATION_MISMATCH",
      "Destination token account delta does not match the transfer",
    );
  }
}

export async function verifyPayment(
  invoice,
  {
    rpcCall = (rpcUrl, method, params) =>
      rpcRequest(rpcUrl, method, params),
    clock,
  } = {},
) {
  validateStoredInvoice(invoice, invoice.id);
  validateRpcUrl(invoice.rpcUrl);
  const checkedAtMs = Date.parse(nowIso(clock));
  const expiresAtMs = Date.parse(invoice.expiresAt);

  const signatures = await rpcCall(
    invoice.rpcUrl,
    "getSignaturesForAddress",
    [
      invoice.reference,
      {
        commitment: "finalized",
        limit: 20,
      },
    ],
  );
  if (!Array.isArray(signatures)) {
    fail("RPC_INVALID_RESPONSE", "RPC signature result is malformed");
  }
  if (signatures.length >= 20) {
    fail(
      "REFERENCE_HISTORY_TRUNCATED",
      "Reference history reached the bounded RPC limit and is ambiguous",
    );
  }
  if (signatures.length === 0) {
    if (checkedAtMs > expiresAtMs + BLOCK_TIME_SKEW_MS) {
      return {
        status: "expired",
        code: "PAYMENT_WINDOW_EXPIRED",
        message: "No finalized payment was found before the request expired",
        expiresAt: invoice.expiresAt,
      };
    }
    return {
      status: "pending",
      code: "PAYMENT_NOT_FOUND",
      message: "No transaction references this invoice yet",
    };
  }

  const successfulFinalized = signatures.filter(
    (entry) =>
      entry &&
      entry.err === null &&
      entry.confirmationStatus === "finalized" &&
      typeof entry.signature === "string",
  );
  if (successfulFinalized.length === 0) {
    const failed = signatures.some((entry) => entry?.err !== null);
    if (failed) {
      fail("PAYMENT_TRANSACTION_FAILED", "Referenced transaction failed");
    }
    return {
      status: "pending",
      code: "PAYMENT_NOT_FINALIZED",
      message: "Referenced transaction is not finalized",
    };
  }
  if (successfulFinalized.length !== 1) {
    fail(
      "AMBIGUOUS_REFERENCE",
      "More than one finalized transaction uses this reference",
    );
  }

  const signature = assertSignature(successfulFinalized[0].signature);
  const transaction = await rpcCall(invoice.rpcUrl, "getTransaction", [
    signature,
    {
      commitment: "finalized",
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  if (transaction === null) {
    return {
      status: "pending",
      code: "PAYMENT_NOT_FINALIZED",
      message: "Finalized transaction data is not available yet",
    };
  }
  if (!transaction || typeof transaction !== "object") {
    fail("RPC_INVALID_RESPONSE", "RPC transaction result is malformed");
  }
  if (transaction.meta?.err !== null) {
    fail("PAYMENT_TRANSACTION_FAILED", "Payment transaction failed");
  }
  if (
    !Number.isSafeInteger(transaction.blockTime) ||
    transaction.blockTime <= 0
  ) {
    fail(
      "INVALID_BLOCK_TIME",
      "Finalized transaction must have a valid block time",
    );
  }
  const createdAtMs = Date.parse(invoice.createdAt);
  const blockTimeMs = transaction.blockTime * 1000;
  if (blockTimeMs < createdAtMs - BLOCK_TIME_SKEW_MS) {
    fail(
      "PAYMENT_PREDATES_INVOICE",
      "Finalized transaction predates the invoice creation window",
    );
  }
  if (blockTimeMs > checkedAtMs + BLOCK_TIME_SKEW_MS) {
    fail(
      "PAYMENT_BLOCK_TIME_IN_FUTURE",
      "Finalized transaction block time is ahead of the verification window",
    );
  }
  if (blockTimeMs > expiresAtMs + BLOCK_TIME_SKEW_MS) {
    fail(
      "PAYMENT_AFTER_EXPIRY",
      "Finalized transaction falls outside the approved payment window",
    );
  }
  const signatureBlockTime = successfulFinalized[0].blockTime;
  if (
    !Number.isSafeInteger(signatureBlockTime) ||
    signatureBlockTime <= 0
  ) {
    fail(
      "INVALID_BLOCK_TIME",
      "Finalized signature history must have a valid block time",
    );
  }
  if (signatureBlockTime !== transaction.blockTime) {
    fail(
      "BLOCK_TIME_MISMATCH",
      "Signature history and transaction block times do not match",
    );
  }

  const transactionSignatures = transaction.transaction?.signatures;
  if (
    !Array.isArray(transactionSignatures) ||
    transactionSignatures.filter((value) => value === signature).length !== 1
  ) {
    fail(
      "SIGNATURE_MISMATCH",
      "Transaction does not contain the selected unique signature",
    );
  }

  const accountKeys = resolveAccountKeys(transaction);
  const references = accountKeys.filter(
    ({ pubkey }) => pubkey === invoice.reference,
  );
  if (
    references.length !== 1 ||
    references[0].signer !== false ||
    references[0].writable !== false
  ) {
    fail(
      "REFERENCE_MISMATCH",
      "Transaction must include the exact reference once as readonly non-signer",
    );
  }

  const memos = extractMemos(transaction, accountKeys);
  if (memos.length !== 1 || memos[0] !== invoice.memo) {
    fail("MEMO_MISMATCH", "Transaction memo does not exactly match the invoice");
  }

  const preTokenBalances = transaction.meta?.preTokenBalances;
  const postTokenBalances = transaction.meta?.postTokenBalances;
  validateTokenBalanceArray(preTokenBalances, "preTokenBalances");
  validateTokenBalanceArray(postTokenBalances, "postTokenBalances");

  const expectedMintPresent = [...preTokenBalances, ...postTokenBalances].some(
    (balance) => balance.mint === invoice.mint,
  );
  if (!expectedMintPresent) {
    fail("MINT_MISMATCH", "Transaction does not transfer the invoice EURC mint");
  }

  const before = recipientMintTotal(
    preTokenBalances,
    invoice.recipient,
    invoice.mint,
  );
  const after = recipientMintTotal(
    postTokenBalances,
    invoice.recipient,
    invoice.mint,
  );
  const delta = after - before;
  const expected = BigInt(invoice.amountAtomic);
  if (delta !== expected) {
    fail(
      "AMOUNT_OR_RECIPIENT_MISMATCH",
      "Recipient EURC balance delta does not exactly match the invoice",
      {
        expectedAtomic: expected.toString(),
        observedAtomic: delta.toString(),
      },
    );
  }
  verifyPaymentInstruction(
    transaction,
    invoice,
    accountKeys,
    preTokenBalances,
    postTokenBalances,
  );

  if (!Number.isInteger(transaction.slot) || transaction.slot <= 0) {
    fail("INVALID_SLOT", "Finalized transaction slot is invalid");
  }
  return {
    status: "paid",
    signature,
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    confirmedAtomic: delta.toString(),
    confirmedAmount: invoice.amount,
    confirmationStatus: "finalized",
    checkedRpcUrl: invoice.rpcUrl,
  };
}

export async function checkInvoice(
  invoiceId,
  {
    storagePath = DEFAULT_PATHS.storagePath,
    rpcCall,
    clock,
    lockTimeoutMs,
  } = {},
) {
  const id = normalizeInvoiceId(invoiceId);
  const initialStore = await loadStore(storagePath);
  const invoice = initialStore.invoices[id];
  if (!invoice) {
    fail("INVOICE_NOT_FOUND", `Invoice not found: ${id}`);
  }
  if (invoice.status === "paid") {
    return {
      invoiceId: id,
      status: "paid",
      payment: jsonClone(invoice.payment),
      idempotent: true,
    };
  }

  const verification = await verifyPayment(invoice, { rpcCall, clock });
  if (verification.status !== "paid") {
    return {
      invoiceId: id,
      ...verification,
    };
  }

  return await withFileLock(
    storagePath,
    async () => {
      const store = await loadStore(storagePath);
      const currentInvoice = store.invoices[id];
      if (!currentInvoice) {
        fail("INVOICE_NOT_FOUND", `Invoice not found: ${id}`);
      }
      if (currentInvoice.status === "paid") {
        return {
          invoiceId: id,
          status: "paid",
          payment: jsonClone(currentInvoice.payment),
          idempotent: true,
        };
      }
      if (
        currentInvoice.reference !== invoice.reference ||
        currentInvoice.deliverable.sha256 !== invoice.deliverable.sha256 ||
        currentInvoice.solanaPayUri !== invoice.solanaPayUri
      ) {
        fail(
          "INVOICE_CHANGED",
          "Invoice terms changed while payment was being verified",
        );
      }

      for (const other of Object.values(store.invoices)) {
        if (
          other.id !== id &&
          other.payment?.signature === verification.signature
        ) {
          fail(
            "SIGNATURE_REUSED",
            "Payment signature is already attached to another invoice",
          );
        }
      }

      const timestamp = nowIso(clock);
      currentInvoice.status = "paid";
      currentInvoice.updatedAt = timestamp;
      currentInvoice.payment = {
        signature: verification.signature,
        slot: verification.slot,
        blockTime: verification.blockTime,
        confirmedAtomic: verification.confirmedAtomic,
        confirmedAmount: verification.confirmedAmount,
        confirmationStatus: verification.confirmationStatus,
        verifiedAt: timestamp,
        rpcUrl: verification.checkedRpcUrl,
      };
      await saveStore(store, storagePath);

      return {
        invoiceId: id,
        status: "paid",
        payment: jsonClone(currentInvoice.payment),
        idempotent: false,
      };
    },
    lockTimeoutMs,
  );
}

export async function generateEvidence(
  invoiceId,
  {
    storagePath = DEFAULT_PATHS.storagePath,
    clock,
  } = {},
) {
  const id = normalizeInvoiceId(invoiceId);
  const store = await loadStore(storagePath);
  const invoice = store.invoices[id];
  if (!invoice) {
    fail("INVOICE_NOT_FOUND", `Invoice not found: ${id}`);
  }
  if (invoice.status !== "paid" || !invoice.payment) {
    fail("INVOICE_UNPAID", "Evidence is available only after verified payment");
  }

  return {
    schemaVersion: 3,
    generatedAt: nowIso(clock),
    approval: jsonClone(invoice.approval),
    invoice: {
      id: invoice.id,
      network: invoice.network,
      currency: invoice.currency,
      mint: invoice.mint,
      recipient: invoice.recipient,
      amount: invoice.amount,
      amountAtomic: invoice.amountAtomic,
      validForSeconds: invoice.validForSeconds,
      expiresAt: invoice.expiresAt,
      reference: invoice.reference,
      memo: invoice.memo,
      solanaPayUri: invoice.solanaPayUri,
    },
    deliverable: jsonClone(invoice.deliverable),
    payment: jsonClone(invoice.payment),
    assertions: {
      finalized: true,
      transactionSucceeded: true,
      uniqueSuccessfulFinalizedReference: true,
      exactMemo: true,
      exactMint: true,
      exactRecipientDelta: true,
      withinPaymentWindow: true,
      previewMatchedAtCreation: true,
      nonCustodial: true,
    },
    limitations: [
      "Records a finalized on-chain payment verified by ProofPay; offline verification independently checks only the schema, canonical terms, timestamps, and deliverable digest.",
      "The preview commitment proves that create received matching digest, reference, and URI values; the external checkpoint audit is the source for who approved them.",
      "Does not prove authorship, identity, legal acceptance, tax treatment, or refund entitlement.",
    ],
  };
}

const EVIDENCE_ASSERTION_KEYS = Object.freeze([
  "exactMemo",
  "exactMint",
  "exactRecipientDelta",
  "finalized",
  "nonCustodial",
  "previewMatchedAtCreation",
  "transactionSucceeded",
  "uniqueSuccessfulFinalizedReference",
  "withinPaymentWindow",
]);

const EVIDENCE_LIMITATIONS = Object.freeze([
  "Records a finalized on-chain payment verified by ProofPay; offline verification independently checks only the schema, canonical terms, timestamps, and deliverable digest.",
  "The preview commitment proves that create received matching digest, reference, and URI values; the external checkpoint audit is the source for who approved them.",
  "Does not prove authorship, identity, legal acceptance, tax treatment, or refund entitlement.",
]);

function invalidEvidence(message, details) {
  fail("INVALID_EVIDENCE", message, details);
}

function assertExactEvidenceKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalidEvidence(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalidEvidence(`${label} has unexpected or missing fields`);
  }
}

function assertEvidenceIsoTimestamp(value, label) {
  if (!isCanonicalIsoTimestamp(value)) {
    invalidEvidence(`${label} must be a canonical ISO-8601 timestamp`);
  }
  return Date.parse(value);
}

function normalizeVerifierFilePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes("\0")
  ) {
    fail(
      `INVALID_${label.toUpperCase()}_PATH`,
      `${label} path must be a non-empty filesystem path`,
    );
  }
  return path.resolve(value);
}

async function openVerifierFile(
  inputPath,
  { label, maxBytes, emptyCode, tooLargeCode },
) {
  const resolved = normalizeVerifierFilePath(inputPath, label);
  const parent = path.dirname(resolved);
  await statDirectoryWithoutSymlink(
    parent,
    `UNSAFE_${label.toUpperCase()}_PATH`,
  );

  let pathStat;
  try {
    pathStat = await lstat(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(
        `${label.toUpperCase()}_NOT_FOUND`,
        `${label} file does not exist: ${resolved}`,
      );
    }
    throw error;
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    fail(
      `UNSAFE_${label.toUpperCase()}_PATH`,
      `${label} path must identify a regular file, not a symlink`,
    );
  }
  if (pathStat.size === 0) {
    fail(emptyCode, `${label} file cannot be empty`);
  }
  if (pathStat.size > maxBytes) {
    fail(tooLargeCode, `${label} file exceeds the safety limit`);
  }

  const [parentReal, targetReal] = await Promise.all([
    realpath(parent),
    realpath(resolved),
  ]);
  if (targetReal !== path.join(parentReal, path.basename(resolved))) {
    fail(
      `UNSAFE_${label.toUpperCase()}_PATH`,
      `${label} path resolves through an unsafe filesystem entry`,
    );
  }

  const noFollow =
    typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(resolved, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    if (error?.code === "ELOOP") {
      fail(
        `UNSAFE_${label.toUpperCase()}_PATH`,
        `${label} file cannot be a symbolic link`,
      );
    }
    throw error;
  }

  const openedStat = await handle.stat();
  if (
    !openedStat.isFile() ||
    openedStat.dev !== pathStat.dev ||
    openedStat.ino !== pathStat.ino ||
    openedStat.size !== pathStat.size
  ) {
    await handle.close();
    fail(
      `${label.toUpperCase()}_CHANGED`,
      `${label} file changed while it was being opened`,
    );
  }
  return { handle, openedStat };
}

async function readEvidenceFile(evidencePath) {
  const opened = await openVerifierFile(evidencePath, {
    label: "evidence",
    maxBytes: MAX_EVIDENCE_BYTES,
    emptyCode: "EMPTY_EVIDENCE",
    tooLargeCode: "EVIDENCE_TOO_LARGE",
  });
  try {
    const bytes = await opened.handle.readFile();
    const finalStat = await opened.handle.stat();
    if (
      finalStat.size !== opened.openedStat.size ||
      finalStat.mtimeMs !== opened.openedStat.mtimeMs ||
      finalStat.ctimeMs !== opened.openedStat.ctimeMs ||
      bytes.length !== opened.openedStat.size
    ) {
      fail(
        "EVIDENCE_CHANGED",
        "Evidence file changed while it was being read",
      );
    }

    let raw;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      invalidEvidence("Evidence must be valid UTF-8 JSON");
    }
    try {
      return JSON.parse(raw);
    } catch {
      invalidEvidence("Evidence must be valid JSON");
    }
  } finally {
    await opened.handle.close();
  }
}

async function hashVerifierDeliverable(deliverablePath) {
  const opened = await openVerifierFile(deliverablePath, {
    label: "deliverable",
    maxBytes: MAX_DELIVERABLE_BYTES,
    emptyCode: "EMPTY_DELIVERABLE",
    tooLargeCode: "DELIVERABLE_TOO_LARGE",
  });
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await opened.handle.read(
        buffer,
        0,
        buffer.length,
        offset,
      );
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const finalStat = await opened.handle.stat();
    if (
      finalStat.size !== opened.openedStat.size ||
      finalStat.mtimeMs !== opened.openedStat.mtimeMs ||
      finalStat.ctimeMs !== opened.openedStat.ctimeMs
    ) {
      fail(
        "DELIVERABLE_CHANGED",
        "Deliverable changed while it was being hashed",
      );
    }
    return {
      size: finalStat.size,
      sha256: hash.digest("hex"),
    };
  } finally {
    await opened.handle.close();
  }
}

function deriveEvidenceTerms(evidence, deliverable) {
  let expected;
  try {
    expected = prepareInvoiceTerms(
      {
        invoiceId: evidence.invoice.id,
        network: evidence.invoice.network,
        recipient: evidence.invoice.recipient,
        amount: evidence.invoice.amount,
      },
      deliverable,
    );
  } catch (error) {
    if (error instanceof ProofPayError) {
      invalidEvidence("Invoice contains invalid canonical terms", {
        cause: error.code,
      });
    }
    throw error;
  }
  return expected;
}

function assertEvidenceSignature(value) {
  let decoded;
  try {
    decoded = base58Decode(value);
  } catch {
    invalidEvidence("Payment signature is not valid base58");
  }
  if (decoded.length !== 64 || base58Encode(decoded) !== value) {
    invalidEvidence(
      "Payment signature must be a canonical base58-encoded 64-byte value",
    );
  }
}

export async function verifyEvidence({
  evidencePath,
  deliverablePath,
  online = false,
  rpcCall,
  clock,
} = {}) {
  const [evidence, actualDeliverable] = await Promise.all([
    readEvidenceFile(evidencePath),
    hashVerifierDeliverable(deliverablePath),
  ]);

  assertExactEvidenceKeys(
    evidence,
    [
      "schemaVersion",
      "generatedAt",
      "approval",
      "invoice",
      "deliverable",
      "payment",
      "assertions",
      "limitations",
    ],
    "Evidence",
  );
  if (evidence.schemaVersion !== 3) {
    invalidEvidence("Unsupported evidence schema version");
  }
  const generatedAtMs = assertEvidenceIsoTimestamp(
    evidence.generatedAt,
    "generatedAt",
  );

  assertExactEvidenceKeys(
    evidence.deliverable,
    ["path", "size", "sha256"],
    "Deliverable evidence",
  );
  let recordedDeliverablePath;
  try {
    recordedDeliverablePath = normalizeRelativeDeliverable(
      evidence.deliverable.path,
    );
  } catch (error) {
    if (error instanceof ProofPayError) {
      invalidEvidence("Evidence contains an invalid deliverable path", {
        cause: error.code,
      });
    }
    throw error;
  }
  if (
    !Number.isSafeInteger(evidence.deliverable.size) ||
    evidence.deliverable.size <= 0 ||
    evidence.deliverable.size > MAX_DELIVERABLE_BYTES ||
    typeof evidence.deliverable.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(evidence.deliverable.sha256)
  ) {
    invalidEvidence("Evidence contains invalid deliverable metadata");
  }
  if (actualDeliverable.size !== evidence.deliverable.size) {
    fail(
      "DELIVERABLE_SIZE_MISMATCH",
      "Provided deliverable size does not match the evidence",
    );
  }
  if (actualDeliverable.sha256 !== evidence.deliverable.sha256) {
    fail(
      "DELIVERABLE_DIGEST_MISMATCH",
      "Provided deliverable SHA-256 does not match the evidence",
    );
  }

  assertExactEvidenceKeys(
    evidence.invoice,
    [
      "id",
      "network",
      "currency",
      "mint",
      "recipient",
      "amount",
      "amountAtomic",
      "validForSeconds",
      "expiresAt",
      "reference",
      "memo",
      "solanaPayUri",
    ],
    "Invoice evidence",
  );
  const expectedTerms = deriveEvidenceTerms(evidence, {
    path: recordedDeliverablePath,
    size: actualDeliverable.size,
    sha256: actualDeliverable.sha256,
  });
  for (const key of [
    "id",
    "network",
    "currency",
    "mint",
    "recipient",
    "amount",
    "amountAtomic",
    "validForSeconds",
    "reference",
    "memo",
    "solanaPayUri",
  ]) {
    if (evidence.invoice[key] !== expectedTerms[key]) {
      invalidEvidence(`Invoice ${key} does not match canonical terms`);
    }
  }

  assertExactEvidenceKeys(
    evidence.approval,
    [
      "schemaVersion",
      "kind",
      "deliverableSha256",
      "reference",
      "solanaPayUri",
      "recordedAt",
    ],
    "Approval evidence",
  );
  const recordedAtMs = assertEvidenceIsoTimestamp(
    evidence.approval.recordedAt,
    "approval.recordedAt",
  );
  const expiresAtMs = assertEvidenceIsoTimestamp(
    evidence.invoice.expiresAt,
    "invoice.expiresAt",
  );
  if (
    evidence.approval.schemaVersion !== APPROVAL_SCHEMA_VERSION ||
    evidence.approval.kind !== "preview-match" ||
    evidence.approval.deliverableSha256 !== actualDeliverable.sha256 ||
    evidence.approval.reference !== expectedTerms.reference ||
    evidence.approval.solanaPayUri !== expectedTerms.solanaPayUri
  ) {
    invalidEvidence(
      "Approval checkpoint does not match the canonical invoice terms",
    );
  }
  if (
    evidence.invoice.validForSeconds !== PAYMENT_WINDOW_SECONDS ||
    expiresAtMs - recordedAtMs !== PAYMENT_WINDOW_MS
  ) {
    invalidEvidence(
      "Invoice expiry does not match the approved fixed payment window",
    );
  }

  assertExactEvidenceKeys(
    evidence.payment,
    [
      "signature",
      "slot",
      "blockTime",
      "confirmedAtomic",
      "confirmedAmount",
      "confirmationStatus",
      "verifiedAt",
      "rpcUrl",
    ],
    "Payment evidence",
  );
  assertEvidenceSignature(evidence.payment.signature);
  const verifiedAtMs = assertEvidenceIsoTimestamp(
    evidence.payment.verifiedAt,
    "payment.verifiedAt",
  );
  if (
    !Number.isSafeInteger(evidence.payment.slot) ||
    evidence.payment.slot <= 0 ||
    !Number.isSafeInteger(evidence.payment.blockTime) ||
    evidence.payment.blockTime <= 0 ||
    evidence.payment.confirmedAtomic !== expectedTerms.amountAtomic ||
    evidence.payment.confirmedAmount !== expectedTerms.amount ||
    evidence.payment.confirmationStatus !== "finalized" ||
    evidence.payment.rpcUrl !== expectedTerms.rpcUrl
  ) {
    invalidEvidence("Payment record is inconsistent with the invoice terms");
  }
  const blockTimeMs = evidence.payment.blockTime * 1000;
  if (
    blockTimeMs < recordedAtMs - BLOCK_TIME_SKEW_MS ||
    blockTimeMs > expiresAtMs + BLOCK_TIME_SKEW_MS ||
    blockTimeMs > verifiedAtMs + BLOCK_TIME_SKEW_MS ||
    verifiedAtMs < recordedAtMs ||
    generatedAtMs < verifiedAtMs
  ) {
    invalidEvidence("Evidence timestamps are inconsistent");
  }

  assertExactEvidenceKeys(
    evidence.assertions,
    EVIDENCE_ASSERTION_KEYS,
    "Evidence assertions",
  );
  if (
    EVIDENCE_ASSERTION_KEYS.some(
      (key) => evidence.assertions[key] !== true,
    )
  ) {
    invalidEvidence("All generated evidence assertions must be true");
  }
  if (
    !Array.isArray(evidence.limitations) ||
    evidence.limitations.length !== EVIDENCE_LIMITATIONS.length ||
    evidence.limitations.some(
      (limitation, index) => limitation !== EVIDENCE_LIMITATIONS[index],
    )
  ) {
    invalidEvidence("Evidence limitations are missing or modified");
  }

  const result = {
    ok: true,
    verification: online
      ? "proofpay-online-evidence-v1"
      : "proofpay-offline-evidence-v1",
    evidenceSchemaVersion: evidence.schemaVersion,
    invoiceId: expectedTerms.id,
    network: expectedTerms.network,
    paymentSignature: evidence.payment.signature,
    deliverable: {
      recordedPath: recordedDeliverablePath,
      size: actualDeliverable.size,
      sha256: actualDeliverable.sha256,
    },
    checks: {
      evidenceSchema: true,
      deliverableDigest: true,
      deliverableSize: true,
      canonicalInvoiceTerms: true,
      previewCommitment: true,
      paymentRecordSelfConsistent: true,
      paymentWindow: true,
      requiredLimitationsPresent: true,
    },
    scope: {
      onChainLookupPerformed: online,
      evidenceProducerAuthenticated: false,
      statement: online
        ? "This independently re-verifies the recorded payment against Solana and checks artifact integrity; it does not authenticate the evidence producer."
        : "This verifies artifact integrity and evidence self-consistency offline; it does not independently query Solana or authenticate the evidence producer.",
    },
  };

  if (!online) {
    return result;
  }

  const syntheticInvoice = {
    schemaVersion: INVOICE_SCHEMA_VERSION,
    ...expectedTerms,
    approval: jsonClone(evidence.approval),
    status: "pending",
    createdAt: evidence.approval.recordedAt,
    expiresAt: evidence.invoice.expiresAt,
    updatedAt: evidence.approval.recordedAt,
    payment: null,
  };
  const chainPayment = await verifyPayment(syntheticInvoice, {
    rpcCall,
    clock,
  });
  if (
    chainPayment.status !== "paid" ||
    chainPayment.signature !== evidence.payment.signature ||
    chainPayment.slot !== evidence.payment.slot ||
    chainPayment.blockTime !== evidence.payment.blockTime ||
    chainPayment.confirmedAtomic !== evidence.payment.confirmedAtomic ||
    chainPayment.confirmedAmount !== evidence.payment.confirmedAmount ||
    chainPayment.confirmationStatus !== evidence.payment.confirmationStatus ||
    chainPayment.checkedRpcUrl !== evidence.payment.rpcUrl
  ) {
    fail(
      "EVIDENCE_CHAIN_MISMATCH",
      "Live Solana verification does not match the recorded payment evidence",
    );
  }
  result.checks.onChainPayment = true;
  return result;
}

function evidenceMarkdown(evidence) {
  const { approval, invoice, deliverable, payment } = evidence;
  return [
    `# ProofPay evidence: ${invoice.id}`,
    "",
    `- Network: ${invoice.network}`,
    `- Asset: ${invoice.currency}`,
    `- Mint: \`${invoice.mint}\``,
    `- Recipient: \`${invoice.recipient}\``,
    `- Amount: ${invoice.amount} ${invoice.currency}`,
    `- Payment window: ${invoice.validForSeconds} seconds`,
    `- Expires at: ${invoice.expiresAt}`,
    `- Reference: \`${invoice.reference}\``,
    `- Memo: \`${invoice.memo}\``,
    `- Deliverable: \`${deliverable.path}\``,
    `- Deliverable SHA-256: \`${deliverable.sha256}\``,
    `- Preview commitment recorded at: ${approval.recordedAt}`,
    `- Finalized signature: \`${payment.signature}\``,
    `- Slot: ${payment.slot}`,
    `- Verified at: ${payment.verifiedAt}`,
    "",
    "The payment was verified read-only against the allowlisted Solana RPC.",
    "ProofPay is non-custodial: it did not hold a private key and did not sign, send, or refund funds.",
    "The stored preview commitment confirms that create received the same digest, reference, and URI that were previewed.",
    "Identity and checkpoint attribution remain in the external operator/SOP audit trail.",
    "",
    "Limitations: this evidence verifies payment and a stored content digest only.",
    "It does not prove authorship, identity, legal acceptance, tax treatment, or refund entitlement.",
    "",
  ].join("\n");
}

export async function writeEvidence(
  invoiceId,
  {
    storagePath = DEFAULT_PATHS.storagePath,
    evidenceDir = DEFAULT_PATHS.evidenceDir,
    clock,
  } = {},
) {
  const evidence = await generateEvidence(invoiceId, { storagePath, clock });
  const directory = path.resolve(evidenceDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await statDirectoryWithoutSymlink(directory, "UNSAFE_EVIDENCE_DIR");

  const finalBundle = path.join(directory, `${evidence.invoice.id}.evidence`);
  const lockTarget = path.join(
    directory,
    `.${evidence.invoice.id}.evidence-write`,
  );
  return await withFileLock(lockTarget, async () => {
    try {
      await lstat(finalBundle);
      fail(
        "EVIDENCE_EXISTS",
        `Evidence already exists for invoice: ${evidence.invoice.id}`,
      );
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const temporary = path.join(
      directory,
      `.${evidence.invoice.id}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
    );
    const jsonPath = path.join(finalBundle, "evidence.json");
    const markdownPath = path.join(finalBundle, "evidence.md");
    let committed = false;
    await mkdir(temporary, { mode: 0o700 });
    try {
      await writeExclusiveFile(
        path.join(temporary, "evidence.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
      await writeExclusiveFile(
        path.join(temporary, "evidence.md"),
        evidenceMarkdown(evidence),
      );
      await syncDirectory(temporary);
      try {
        await rename(temporary, finalBundle);
      } catch (error) {
        if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) {
          fail(
            "EVIDENCE_EXISTS",
            `Evidence already exists for invoice: ${evidence.invoice.id}`,
          );
        }
        throw error;
      }
      committed = true;
      await syncDirectory(directory);
    } finally {
      if (!committed) {
        await unlink(path.join(temporary, "evidence.json")).catch(() => {});
        await unlink(path.join(temporary, "evidence.md")).catch(() => {});
        await rmdir(temporary).catch(() => {});
      }
    }

    return {
      evidence,
      bundle: finalBundle,
      files: {
        json: jsonPath,
        markdown: markdownPath,
      },
    };
  });
}
