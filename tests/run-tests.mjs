import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendBoundedResponseChunk,
  buildLiveListingsUrl,
  fetchLiveListings,
  filterActionableListings,
  MAX_API_RESPONSE_BYTES,
  readCredentials,
  redactSensitiveOutput,
  registerAgent,
  SuperteamApiError,
  validateRegistrationResponse,
  writeCredentials,
} from "../scripts/lib/superteam-agent.mjs";

let passed = 0;

async function test(name, callback) {
  try {
    await callback();
    passed += 1;
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

await test("builds a bounded live-listings URL", async () => {
  const url = buildLiveListingsUrl("https://superteam.fun", {
    take: 25,
    deadline: "2026-12-31",
    type: "project",
  });
  assert.equal(url.pathname, "/api/agents/listings/live");
  assert.equal(url.searchParams.get("take"), "25");
  assert.equal(url.searchParams.get("deadline"), "2026-12-31");
  assert.equal(url.searchParams.get("type"), "project");
});

await test("rejects invalid listing filters", async () => {
  assert.throws(
    () => buildLiveListingsUrl("https://superteam.fun", { take: 0 }),
    /between 1 and 100/,
  );
  assert.throws(
    () =>
      buildLiveListingsUrl("https://superteam.fun", { type: "job" }),
    /bounty, project, or hackathon/,
  );
  assert.throws(
    () =>
      buildLiveListingsUrl("https://superteam.fun", {
        deadline: "31-12-2026",
      }),
    /YYYY-MM-DD/,
  );
});

await test("validates the complete registration response", async () => {
  const payload = {
    apiKey: "sk_secret",
    claimCode: "CLAIM",
    agentId: "agent-id",
    username: "agent-name",
  };
  assert.deepEqual(validateRegistrationResponse(payload), payload);
  assert.throws(
    () => validateRegistrationResponse({ agentId: "only-one-field" }),
    /apiKey, claimCode, username/,
  );
});

await test("stores credentials with owner-only permissions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "superteam-agent-"));
  const secretsPath = path.join(directory, ".secrets", "agent.json");
  const credentials = {
    apiKey: "sk_secret",
    claimCode: "CLAIM",
    agentId: "agent-id",
    username: "agent-name",
  };

  await writeCredentials(credentials, secretsPath);
  assert.deepEqual(await readCredentials(secretsPath), credentials);
  const mode = (await fs.stat(secretsPath)).mode & 0o777;
  assert.equal(mode, 0o600);
});

await test("rejects symlinks for the credentials directory and file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "superteam-agent-"));
  const realSecretsDirectory = path.join(directory, "real-secrets");
  const linkedSecretsDirectory = path.join(directory, "linked-secrets");
  await fs.mkdir(realSecretsDirectory);
  await fs.symlink(realSecretsDirectory, linkedSecretsDirectory);

  const credentials = {
    apiKey: "sk_secret",
    claimCode: "CLAIM",
    agentId: "agent-id",
    username: "agent-name",
  };
  await assert.rejects(
    writeCredentials(
      credentials,
      path.join(linkedSecretsDirectory, "agent.json"),
    ),
    /symlink.*credentials directory/,
  );

  const targetPath = path.join(realSecretsDirectory, "target.json");
  const linkedFilePath = path.join(realSecretsDirectory, "linked.json");
  await fs.writeFile(targetPath, `${JSON.stringify(credentials)}\n`, {
    mode: 0o600,
  });
  await fs.symlink(targetPath, linkedFilePath);
  await assert.rejects(
    readCredentials(linkedFilePath),
    /symlink.*credentials file/,
  );
});

await test("recursively redacts sensitive keys and exact secret values", async () => {
  const input = {
    apiKey: "sk_secret",
    nested: {
      Claim_Code: "CLAIM",
      headers: { Authorization: "Bearer sk_secret" },
      note: "never echo sk_secret or CLAIM",
    },
    entries: ["safe", { text: "CLAIM" }],
  };

  assert.deepEqual(
    redactSensitiveOutput(input, { secrets: ["sk_secret", "CLAIM"] }),
    {
      apiKey: "[REDACTED]",
      nested: {
        Claim_Code: "[REDACTED]",
        headers: { Authorization: "[REDACTED]" },
        note: "never echo [REDACTED] or [REDACTED]",
      },
      entries: ["safe", { text: "[REDACTED]" }],
    },
  );
  assert.equal(input.apiKey, "sk_secret");
});

await test("redacts exact credentials from live API output", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "superteam-agent-"));
  const secretsPath = path.join(directory, ".secrets", "agent.json");
  await writeCredentials(
    {
      apiKey: "sk_secret",
      claimCode: "CLAIM",
      agentId: "agent-id",
      username: "agent-name",
    },
    secretsPath,
  );

  const result = await fetchLiveListings({
    take: 1,
    secretsPath,
    transport: async () => [
      {
        title: "safe",
        metadata: {
          note: "leaked sk_secret and CLAIM",
          authorization: "Bearer sk_secret",
        },
      },
    ],
  });

  assert.deepEqual(result, [
    {
      title: "safe",
      metadata: {
        note: "leaked [REDACTED] and [REDACTED]",
        authorization: "[REDACTED]",
      },
    },
  ]);
});

await test("enforces the two-megabyte API response cap", async () => {
  const chunks = [];
  let total = appendBoundedResponseChunk(
    chunks,
    0,
    Buffer.alloc(MAX_API_RESPONSE_BYTES),
  );
  assert.equal(total, 2_000_000);
  assert.throws(
    () => appendBoundedResponseChunk(chunks, total, Buffer.from("x")),
    (error) =>
      error instanceof SuperteamApiError &&
      error.message === "API response exceeded 2 MB",
  );
});

await test("filters stale listings and orders actionable work", async () => {
  const listings = [
    {
      title: "Closed",
      status: "CLOSED",
      deadline: "2026-08-01T00:00:00.000Z",
      isWinnersAnnounced: false,
    },
    {
      title: "Expired",
      status: "OPEN",
      deadline: "2026-07-20T00:00:00.000Z",
      isWinnersAnnounced: false,
    },
    {
      title: "Already awarded",
      status: "OPEN",
      deadline: "2026-08-01T00:00:00.000Z",
      isWinnersAnnounced: true,
    },
    {
      title: "Soon and high reward",
      status: "OPEN",
      deadline: "2026-07-25T00:00:00.000Z",
      isWinnersAnnounced: false,
      rewardAmount: 2_000,
      submissionCount: 20,
    },
    {
      title: "Soon and low reward",
      status: "open",
      deadline: "2026-07-25T00:00:00.000Z",
      isWinnersAnnounced: false,
      rewardAmount: 500,
      submissionCount: 1,
    },
    {
      title: "Later",
      status: "OPEN",
      deadline: "2026-07-30T00:00:00.000Z",
      isWinnersAnnounced: false,
      rewardAmount: 10_000,
    },
  ];

  assert.deepEqual(
    filterActionableListings(
      { listings },
      { now: new Date("2026-07-23T00:00:00.000Z") },
    ).map((listing) => listing.title),
    ["Soon and high reward", "Soon and low reward", "Later"],
  );
});

await test("registers without leaking credentials in the result", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "superteam-agent-"));
  const secretsPath = path.join(directory, ".secrets", "agent.json");
  let requestBody;
  const transport = async (_url, options) => {
    requestBody = options.body;
    return {
      apiKey: "sk_secret",
      claimCode: "CLAIM",
      agentId: "agent-id",
      username: "agent-name",
    };
  };

  const result = await registerAgent({
    name: "agent-name",
    secretsPath,
    transport,
  });

  assert.deepEqual(requestBody, { name: "agent-name" });
  assert.equal(result.agentId, "agent-id");
  assert.equal(result.username, "agent-name");
  assert.equal("apiKey" in result, false);
  assert.equal("claimCode" in result, false);
});

await test("refuses to register over existing credentials", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "superteam-agent-"));
  const secretsPath = path.join(directory, "agent.json");
  await fs.writeFile(secretsPath, "already here", { mode: 0o600 });

  await assert.rejects(
    registerAgent({
      name: "agent-name",
      secretsPath,
      transport: async () => {
        throw new Error("transport must not be called");
      },
    }),
    /refusing to register a duplicate agent/,
  );
});

if (process.exitCode) {
  process.stderr.write(`\n${passed} tests passed before failure\n`);
} else {
  process.stdout.write(`\n${passed} tests passed\n`);
}
