import https from "node:https";
import { promises as fs } from "node:fs";
import path from "node:path";

export const DEFAULT_BASE_URL = "https://superteam.fun";
export const DEFAULT_SECRETS_PATH = path.resolve(
  process.cwd(),
  ".secrets",
  "superteam-agent.json",
);

const ALLOWED_LISTING_TYPES = new Set(["bounty", "project", "hackathon"]);
const SENSITIVE_OUTPUT_KEYS = new Set([
  "apikey",
  "claimcode",
  "authorization",
]);

export const MAX_API_RESPONSE_BYTES = 2_000_000;
export const REDACTED_VALUE = "[REDACTED]";

export class SuperteamApiError extends Error {
  constructor(message, { statusCode, code } = {}) {
    super(message);
    this.name = "SuperteamApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizedSensitiveKey(key) {
  return String(key).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function redactString(value, secrets) {
  let redacted = value;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      redacted = redacted.split(secret).join(REDACTED_VALUE);
    }
  }
  return redacted;
}

export function redactSensitiveOutput(
  value,
  { secrets = [] } = {},
  seen = new WeakMap(),
) {
  if (typeof value === "string") return redactString(value, secrets);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) {
      result.push(redactSensitiveOutput(item, { secrets }, seen));
    }
    return result;
  }

  const result = {};
  seen.set(value, result);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_OUTPUT_KEYS.has(normalizedSensitiveKey(key))) {
      result[key] = REDACTED_VALUE;
    } else {
      result[key] = redactSensitiveOutput(nestedValue, { secrets }, seen);
    }
  }
  return result;
}

async function lstatIfPresent(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function rejectSymlink(stat, label) {
  if (stat?.isSymbolicLink()) {
    throw new Error(`Refusing to use a symlink as the credentials ${label}`);
  }
}

async function inspectCredentialsPath(secretsPath) {
  const directory = path.dirname(secretsPath);
  const directoryStat = await lstatIfPresent(directory);
  rejectSymlink(directoryStat, "directory");
  if (directoryStat && !directoryStat.isDirectory()) {
    throw new Error("Credentials directory path is not a directory");
  }

  const fileStat = await lstatIfPresent(secretsPath);
  rejectSymlink(fileStat, "file");
  if (fileStat && !fileStat.isFile()) {
    throw new Error("Credentials file path is not a regular file");
  }

  return { directory, directoryStat, fileStat };
}

async function ensureSafeCredentialsDirectory(secretsPath) {
  const inspected = await inspectCredentialsPath(secretsPath);
  if (!inspected.directoryStat) {
    await fs.mkdir(inspected.directory, { recursive: true, mode: 0o700 });
  }

  const verified = await inspectCredentialsPath(secretsPath);
  if (!verified.directoryStat) {
    throw new Error("Credentials directory could not be created");
  }
  await fs.chmod(verified.directory, 0o700);
  return verified;
}

export function buildLiveListingsUrl(
  baseUrl,
  { take = 20, deadline, type } = {},
) {
  const normalizedTake = Number(take);
  if (!Number.isInteger(normalizedTake) || normalizedTake < 1 || normalizedTake > 100) {
    throw new Error("--take must be an integer between 1 and 100");
  }

  if (type && !ALLOWED_LISTING_TYPES.has(type)) {
    throw new Error("--type must be bounty, project, or hackathon");
  }

  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    throw new Error("--deadline must use YYYY-MM-DD");
  }

  const url = new URL("/api/agents/listings/live", baseUrl);
  url.searchParams.set("take", String(normalizedTake));
  if (deadline) url.searchParams.set("deadline", deadline);
  if (type) url.searchParams.set("type", type);
  return url;
}

export function validateRegistrationResponse(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Registration response is not a JSON object");
  }

  const required = ["apiKey", "claimCode", "agentId", "username"];
  const missing = required.filter(
    (key) => typeof payload[key] !== "string" || payload[key].length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`Registration response is missing: ${missing.join(", ")}`);
  }

  return {
    apiKey: payload.apiKey,
    claimCode: payload.claimCode,
    agentId: payload.agentId,
    username: payload.username,
  };
}

export async function writeCredentials(
  credentials,
  secretsPath = DEFAULT_SECRETS_PATH,
) {
  const validated = validateRegistrationResponse(credentials);
  const { directory, fileStat } =
    await ensureSafeCredentialsDirectory(secretsPath);
  if (fileStat) {
    throw new Error(
      `Credentials already exist at ${secretsPath}; refusing to overwrite them`,
    );
  }

  const temporaryPath = path.join(
    directory,
    `.${path.basename(secretsPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;

  try {
    await fs.writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.link(temporaryPath, secretsPath);
    await fs.unlink(temporaryPath);
    const storedFile = await lstatIfPresent(secretsPath);
    rejectSymlink(storedFile, "file");
    if (!storedFile?.isFile()) {
      throw new Error("Credentials file was not created as a regular file");
    }
    await fs.chmod(secretsPath, 0o600);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error(
        `Credentials already exist at ${secretsPath}; refusing to overwrite them`,
      );
    }
    throw error;
  }

  return secretsPath;
}

export async function readCredentials(
  secretsPath = DEFAULT_SECRETS_PATH,
) {
  const inspected = await inspectCredentialsPath(secretsPath);
  if (!inspected.fileStat) {
    throw new Error(
      `No agent credentials found at ${secretsPath}. Register an agent first.`,
    );
  }

  let raw;
  try {
    raw = await fs.readFile(secretsPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `No agent credentials found at ${secretsPath}. Register an agent first.`,
      );
    }
    throw error;
  }

  return validateRegistrationResponse(JSON.parse(raw));
}

function safeApiMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  for (const key of ["message", "error", "detail"]) {
    if (typeof payload[key] === "string" && payload[key].length > 0) {
      return payload[key].slice(0, 500);
    }
  }
  return fallback;
}

export function appendBoundedResponseChunk(
  chunks,
  totalBytes,
  chunk,
  maxBytes = MAX_API_RESPONSE_BYTES,
) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const nextTotal = totalBytes + buffer.length;
  if (nextTotal > maxBytes) {
    throw new SuperteamApiError("API response exceeded 2 MB");
  }
  chunks.push(buffer);
  return nextTotal;
}

export function requestJson(
  url,
  { method = "GET", apiKey, body, timeoutMs = 30_000 } = {},
) {
  const target = url instanceof URL ? url : new URL(url);
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = https.request(
      target,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(serializedBody
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(serializedBody),
              }
            : {}),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        let totalBytes = 0;
        let responseTerminated = false;

        response.on("data", (chunk) => {
          if (responseTerminated) return;
          try {
            totalBytes = appendBoundedResponseChunk(
              chunks,
              totalBytes,
              chunk,
            );
          } catch (error) {
            responseTerminated = true;
            reject(error);
            request.destroy(error);
          }
        });

        response.on("end", () => {
          if (responseTerminated) return;
          const text = Buffer.concat(chunks).toString("utf8");
          let payload = null;
          if (text.length > 0) {
            try {
              payload = JSON.parse(text);
            } catch {
              reject(
                new SuperteamApiError("Superteam returned invalid JSON", {
                  statusCode: response.statusCode,
                }),
              );
              return;
            }
          }

          if (
            typeof response.statusCode !== "number" ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(
              new SuperteamApiError(
                redactSensitiveOutput(
                  safeApiMessage(
                    payload,
                    `Superteam request failed with HTTP ${response.statusCode ?? "unknown"}`,
                  ),
                  { secrets: [apiKey] },
                ),
                {
                  statusCode: response.statusCode,
                  code:
                    payload && typeof payload.code === "string"
                      ? redactString(payload.code, [apiKey])
                      : undefined,
                },
              ),
            );
            return;
          }

          resolve(payload);
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new SuperteamApiError("Superteam request timed out"));
    });
    request.on("error", reject);

    if (serializedBody) request.write(serializedBody);
    request.end();
  });
}

export async function registerAgent({
  name,
  baseUrl = DEFAULT_BASE_URL,
  secretsPath = DEFAULT_SECRETS_PATH,
  transport = requestJson,
}) {
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/.test(name)) {
    throw new Error(
      "Agent name must be 3-64 characters using letters, numbers, _ or -",
    );
  }

  const inspected = await inspectCredentialsPath(secretsPath);
  if (inspected.fileStat) {
    throw new Error(
      `Credentials already exist at ${secretsPath}; refusing to register a duplicate agent`,
    );
  }

  const payload = await transport(new URL("/api/agents", baseUrl), {
    method: "POST",
    body: { name },
  });
  const credentials = validateRegistrationResponse(payload);
  await writeCredentials(credentials, secretsPath);

  return {
    registered: true,
    agentId: credentials.agentId,
    username: credentials.username,
    credentialsPath: secretsPath,
  };
}

export async function fetchLiveListings({
  take,
  deadline,
  type,
  baseUrl = DEFAULT_BASE_URL,
  secretsPath = DEFAULT_SECRETS_PATH,
  transport = requestJson,
}) {
  const credentials = await readCredentials(secretsPath);
  const payload = await transport(
    buildLiveListingsUrl(baseUrl, { take, deadline, type }),
    {
      apiKey: credentials.apiKey,
    },
  );
  return redactSensitiveOutput(payload, {
    secrets: [credentials.apiKey, credentials.claimCode],
  });
}

function listingsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["listings", "data", "items"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function listingDeadline(listing) {
  const timestamp = Date.parse(listing?.deadline);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function listingReward(listing) {
  for (const key of [
    "rewardAmount",
    "reward",
    "totalReward",
    "prizePool",
    "totalPrize",
  ]) {
    const value = Number(listing?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function listingSubmissionCount(listing) {
  for (const key of [
    "submissionCount",
    "submissionsCount",
    "totalSubmissions",
  ]) {
    const value = Number(listing?.[key]);
    if (Number.isFinite(value)) return value;
  }
  const nestedValue = Number(listing?._count?.Submission);
  if (Number.isFinite(nestedValue)) return nestedValue;
  return Number.POSITIVE_INFINITY;
}

export function filterActionableListings(payload, { now = new Date() } = {}) {
  const nowTimestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowTimestamp)) {
    throw new Error("Actionable-listings reference time is invalid");
  }

  return listingsFromPayload(payload)
    .filter((listing) => {
      const status =
        typeof listing?.status === "string"
          ? listing.status.trim().toUpperCase()
          : "";
      return (
        status === "OPEN" &&
        !listing.isWinnersAnnounced &&
        listingDeadline(listing) > nowTimestamp
      );
    })
    .sort((left, right) => {
      const deadlineDifference =
        listingDeadline(left) - listingDeadline(right);
      if (deadlineDifference !== 0) return deadlineDifference;

      const rewardDifference = listingReward(right) - listingReward(left);
      if (rewardDifference !== 0) return rewardDifference;

      const submissionDifference =
        listingSubmissionCount(left) - listingSubmissionCount(right);
      if (submissionDifference !== 0) return submissionDifference;

      return String(left?.title ?? left?.name ?? "").localeCompare(
        String(right?.title ?? right?.name ?? ""),
      );
    });
}

export async function fetchActionableListings(options = {}) {
  return filterActionableListings(await fetchLiveListings(options), {
    now: options.now ?? new Date(),
  });
}

export async function fetchListingDetails({
  slug,
  baseUrl = DEFAULT_BASE_URL,
  secretsPath = DEFAULT_SECRETS_PATH,
  transport = requestJson,
}) {
  if (!slug || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) {
    throw new Error("Listing slug is missing or invalid");
  }
  const credentials = await readCredentials(secretsPath);
  const url = new URL(
    `/api/agents/listings/details/${encodeURIComponent(slug)}`,
    baseUrl,
  );
  const payload = await transport(url, { apiKey: credentials.apiKey });
  return redactSensitiveOutput(payload, {
    secrets: [credentials.apiKey, credentials.claimCode],
  });
}

export async function fetchComments({
  listingId,
  skip = 0,
  take = 20,
  baseUrl = DEFAULT_BASE_URL,
  secretsPath = DEFAULT_SECRETS_PATH,
  transport = requestJson,
}) {
  if (!listingId || !/^[a-zA-Z0-9_-]+$/.test(listingId)) {
    throw new Error("Listing id is missing or invalid");
  }
  if (!Number.isInteger(Number(skip)) || Number(skip) < 0) {
    throw new Error("--skip must be a non-negative integer");
  }
  if (
    !Number.isInteger(Number(take)) ||
    Number(take) < 1 ||
    Number(take) > 100
  ) {
    throw new Error("--take must be an integer between 1 and 100");
  }

  const credentials = await readCredentials(secretsPath);
  const url = new URL(
    `/api/agents/comments/${encodeURIComponent(listingId)}`,
    baseUrl,
  );
  url.searchParams.set("skip", String(Number(skip)));
  url.searchParams.set("take", String(Number(take)));
  const payload = await transport(url, { apiKey: credentials.apiKey });
  return redactSensitiveOutput(payload, {
    secrets: [credentials.apiKey, credentials.claimCode],
  });
}

export async function heartbeat({
  secretsPath = DEFAULT_SECRETS_PATH,
  lastAction = "initialized secure Superteam Earn client",
  nextAction = "discover agent-eligible listings",
} = {}) {
  const credentials = await readCredentials(secretsPath);
  return {
    status: "ok",
    agentName: credentials.username,
    time: new Date().toISOString(),
    version: "superteam-earn-agent/0.1.0",
    capabilities: [
      "listings",
      "actionable-listings",
      "details",
      "comments",
      "heartbeat",
    ],
    lastAction,
    nextAction,
  };
}
