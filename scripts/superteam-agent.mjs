#!/usr/bin/env node

import path from "node:path";
import {
  DEFAULT_BASE_URL,
  DEFAULT_SECRETS_PATH,
  fetchComments,
  fetchActionableListings,
  fetchListingDetails,
  fetchLiveListings,
  heartbeat,
  redactSensitiveOutput,
  registerAgent,
} from "./lib/superteam-agent.mjs";

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return { command, options, positional };
}

function printHelp() {
  process.stdout.write(`Superteam Earn agent client

Usage:
  npm run agent -- register --name <agent-name>
  npm run agent -- live [--take 20] [--deadline YYYY-MM-DD] [--type bounty|project|hackathon]
  npm run agent -- actionable [--take 20] [--type bounty|project|hackathon]
  npm run agent -- details <listing-slug>
  npm run agent -- comments <listing-id> [--skip 0] [--take 20]
  npm run agent -- heartbeat

Shared options:
  --base-url <url>       Defaults to ${DEFAULT_BASE_URL}
  --secrets <path>       Defaults to ${DEFAULT_SECRETS_PATH}

The client never prints the API key or claim code.
`);
}

function sharedOptions(options) {
  return {
    baseUrl: options["base-url"] || DEFAULT_BASE_URL,
    secretsPath: options.secrets
      ? path.resolve(options.secrets)
      : DEFAULT_SECRETS_PATH,
  };
}

async function main() {
  const { command, options, positional } = parseArguments(
    process.argv.slice(2),
  );
  const shared = sharedOptions(options);
  let result;

  switch (command) {
    case "register":
      result = await registerAgent({
        ...shared,
        name: options.name,
      });
      break;
    case "live":
      result = await fetchLiveListings({
        ...shared,
        take: options.take ?? 20,
        deadline: options.deadline,
        type: options.type,
      });
      break;
    case "actionable":
      result = await fetchActionableListings({
        ...shared,
        take: options.take ?? 20,
        deadline: options.deadline,
        type: options.type,
      });
      break;
    case "details":
      result = await fetchListingDetails({
        ...shared,
        slug: positional[0],
      });
      break;
    case "comments":
      result = await fetchComments({
        ...shared,
        listingId: positional[0],
        skip: options.skip ?? 0,
        take: options.take ?? 20,
      });
      break;
    case "heartbeat":
      result = await heartbeat(shared);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  process.stdout.write(
    `${JSON.stringify(redactSensitiveOutput(result), null, 2)}\n`,
  );
}

main().catch((error) => {
  const safe = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...(typeof error?.statusCode === "number"
      ? { statusCode: error.statusCode }
      : {}),
  };
  process.stderr.write(`${JSON.stringify(redactSensitiveOutput(safe))}\n`);
  process.exitCode = 1;
});
