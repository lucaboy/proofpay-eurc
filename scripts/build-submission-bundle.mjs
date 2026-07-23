#!/usr/bin/env node

/**
 * Build the deterministic ProofPay submission archive from committed Git
 * objects. The archive never reads working-tree file contents, so ignored
 * credentials and local runtime state cannot enter the artifact.
 *
 * Maintainer: lucaboy
 */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ARCHIVE_ROOT = "proofpay-eurc-submission";
const ARCHIVE_NAME = `${ARCHIVE_ROOT}.tar.gz`;
const BLOCK_SIZE = 512;

function fail(message) {
  console.error(`bundle: ${message}`);
  process.exitCode = 1;
}

function git(args, encoding = "utf8") {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr;
    throw new Error(`git ${args[0]} failed: ${detail.trim()}`);
  }
  return result.stdout;
}

function parseArgs(argv) {
  let sourceRef = "HEAD";
  let verify = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source-ref") {
      sourceRef = argv[index + 1];
      if (!sourceRef) {
        throw new Error("--source-ref requires a Git revision");
      }
      index += 1;
    } else if (argument === "--verify") {
      verify = true;
    } else if (argument === "--help") {
      console.log(
        "Usage: node scripts/build-submission-bundle.mjs " +
          "[--source-ref <commit>] [--verify]",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  return { sourceRef, verify };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function splitTarPath(filePath) {
  const encoded = Buffer.byteLength(filePath, "utf8");
  if (encoded <= 100) {
    return { name: filePath, prefix: "" };
  }

  const slashes = [];
  for (let index = 0; index < filePath.length; index += 1) {
    if (filePath[index] === "/") {
      slashes.push(index);
    }
  }

  for (const slash of slashes.reverse()) {
    const prefix = filePath.slice(0, slash);
    const name = filePath.slice(slash + 1);
    if (
      Buffer.byteLength(prefix, "utf8") <= 155 &&
      Buffer.byteLength(name, "utf8") <= 100
    ) {
      return { name, prefix };
    }
  }

  throw new Error(`path cannot be represented in ustar: ${filePath}`);
}

function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) {
    throw new Error(`ustar field is too long: ${value}`);
  }
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  const octal = value.toString(8);
  if (octal.length > length - 1) {
    throw new Error(`ustar numeric field overflow: ${value}`);
  }
  writeString(header, offset, length, `${octal.padStart(length - 1, "0")}\0`);
}

function tarHeader(entry, epoch) {
  const header = Buffer.alloc(BLOCK_SIZE);
  const { name, prefix } = splitTarPath(entry.archivePath);

  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.content.length);
  writeOctal(header, 136, 12, epoch);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, "0");
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 345, 155, prefix);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function tar(entries, epoch) {
  const parts = [];
  for (const entry of entries) {
    parts.push(tarHeader(entry, epoch));
    parts.push(entry.content);
    const remainder = entry.content.length % BLOCK_SIZE;
    if (remainder !== 0) {
      parts.push(Buffer.alloc(BLOCK_SIZE - remainder));
    }
  }
  parts.push(Buffer.alloc(BLOCK_SIZE * 2));
  return Buffer.concat(parts);
}

function crc32(content) {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function deterministicGzip(content) {
  const parts = [
    // No filename, comment, timestamp, platform, or implementation metadata.
    Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff]),
  ];
  let offset = 0;

  // DEFLATE stored blocks avoid implementation/version-dependent compression.
  do {
    const length = Math.min(65_535, content.length - offset);
    const final = offset + length === content.length;
    const header = Buffer.alloc(5);
    header[0] = final ? 0x01 : 0x00;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE((~length) & 0xffff, 3);
    parts.push(header, content.subarray(offset, offset + length));
    offset += length;
  } while (offset < content.length);

  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(content), 0);
  trailer.writeUInt32LE(content.length >>> 0, 4);
  parts.push(trailer);
  return Buffer.concat(parts);
}

function readTree(commit) {
  const raw = git(["ls-tree", "-rz", "--full-tree", commit], null);
  const records = raw.toString("utf8").split("\0").filter(Boolean);
  const entries = [];

  for (const record of records) {
    const tab = record.indexOf("\t");
    if (tab < 0) {
      throw new Error("unexpected git ls-tree output");
    }

    const [modeText, objectType, objectId] = record.slice(0, tab).split(" ");
    const filePath = record.slice(tab + 1);
    if (objectType !== "blob") {
      throw new Error(`unsupported Git object ${objectType}: ${filePath}`);
    }
    if (!/^(100644|100755)$/.test(modeText)) {
      throw new Error(`unsupported Git mode ${modeText}: ${filePath}`);
    }
    const pathParts = filePath.split("/");
    if (
      filePath.startsWith("/") ||
      filePath.includes("\\") ||
      filePath.includes("\n") ||
      filePath.includes("\r") ||
      pathParts.includes("") ||
      pathParts.includes(".") ||
      pathParts.includes("..")
    ) {
      throw new Error(`unsafe bundled path: ${filePath}`);
    }
    if (filePath === "SOURCE_COMMIT" || filePath === "SHA256SUMS") {
      throw new Error(`reserved bundled path: ${filePath}`);
    }

    entries.push({
      archivePath: `${ARCHIVE_ROOT}/${filePath}`,
      content: git(["cat-file", "blob", objectId], null),
      mode: modeText === "100755" ? 0o755 : 0o644,
      relativePath: filePath,
    });
  }

  return entries.sort((left, right) =>
    compareUtf8(left.relativePath, right.relativePath),
  );
}

function build(sourceRef) {
  const commit = git(["rev-parse", "--verify", `${sourceRef}^{commit}`]).trim();
  const epochText = git(["show", "-s", "--format=%ct", commit]).trim();
  if (!/^[1-9][0-9]*$/.test(epochText)) {
    throw new Error(`invalid commit timestamp: ${epochText}`);
  }
  const epoch = Number(epochText);
  if (!Number.isSafeInteger(epoch)) {
    throw new Error(`commit timestamp is out of range: ${epochText}`);
  }

  const trackedEntries = readTree(commit);
  const sourceCommit = {
    archivePath: `${ARCHIVE_ROOT}/SOURCE_COMMIT`,
    content: Buffer.from(`${commit}\n`, "utf8"),
    mode: 0o644,
    relativePath: "SOURCE_COMMIT",
  };
  const checksummedEntries = [...trackedEntries, sourceCommit].sort(
    (left, right) => compareUtf8(left.relativePath, right.relativePath),
  );
  const internalChecksums = checksummedEntries
    .map((entry) => `${sha256(entry.content)}  ${entry.relativePath}\n`)
    .join("");
  const checksumEntry = {
    archivePath: `${ARCHIVE_ROOT}/SHA256SUMS`,
    content: Buffer.from(internalChecksums, "utf8"),
    mode: 0o644,
    relativePath: "SHA256SUMS",
  };
  const archiveEntries = [...checksummedEntries, checksumEntry].sort(
    (left, right) => compareUtf8(left.relativePath, right.relativePath),
  );
  const tarball = deterministicGzip(tar(archiveEntries, epoch));

  return { commit, tarball };
}

async function atomicWrite(destination, content) {
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, content, { mode: 0o644 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  const { sourceRef, verify } = parseArgs(process.argv.slice(2));
  const first = build(sourceRef);
  if (verify) {
    const second = build(sourceRef);
    if (!first.tarball.equals(second.tarball)) {
      throw new Error("reproducibility check produced different archive bytes");
    }
  }

  const outputDirectory = path.resolve(process.cwd(), "dist");
  const archivePath = path.join(outputDirectory, ARCHIVE_NAME);
  const checksumsPath = path.join(outputDirectory, "SHA256SUMS");
  const digest = sha256(first.tarball);

  await mkdir(outputDirectory, { recursive: true });
  await atomicWrite(archivePath, first.tarball);
  await atomicWrite(
    checksumsPath,
    Buffer.from(`${digest}  ${ARCHIVE_NAME}\n`, "utf8"),
  );

  console.log(`source_commit=${first.commit}`);
  console.log(`sha256=${digest}`);
  console.log(`archive=${path.relative(process.cwd(), archivePath)}`);
  if (verify) {
    console.log("reproducible=true");
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : error));
