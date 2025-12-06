#!/usr/bin/env node
/**
 * Fetch logs for the latest Cloudflare Workers Builds deployment.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... bun run logs:cf-build
 *
 * Optional environment variables:
 *   CLOUDFLARE_ACCOUNT_ID      - overrides the default account id
 *   CF_ACCOUNT_ID              - alternative name for account id
 *   CLOUDFLARE_WORKERS_BUILD_SERVICE / CF_WORKERS_BUILD_SERVICE
 *   CLOUDFLARE_BUILD_BRANCH / CF_BUILD_BRANCH - restricts builds to a branch
 *   CLOUDFLARE_BUILDS_LIMIT                 - number of builds to fetch (default 5)
 */

const DEFAULT_ACCOUNT_ID = "308fe458f7948f9b6aa6a82c4a698c37";
const DEFAULT_SERVICE_NAME = "mineflare-test";

const accountId =
  process.env.CLOUDFLARE_ACCOUNT_ID ??
  process.env.CF_ACCOUNT_ID ??
  DEFAULT_ACCOUNT_ID;

const serviceName =
  process.env.CLOUDFLARE_WORKERS_BUILD_SERVICE ??
  process.env.CF_WORKERS_BUILD_SERVICE ??
  DEFAULT_SERVICE_NAME;

const apiToken =
  process.env.CLOUDFLARE_API_TOKEN ??
  process.env.CF_API_TOKEN ??
  process.env.CLOUDFLARE_TOKEN;

const branchFilter =
  process.env.CLOUDFLARE_BUILD_BRANCH ?? process.env.CF_BUILD_BRANCH;

const buildsLimit = parseInt(
  process.env.CLOUDFLARE_BUILDS_LIMIT ?? "5",
  10,
);

if (!apiToken) {
  console.error(
    "Missing CLOUDFLARE_API_TOKEN (or CF_API_TOKEN). Please export a token with Workers Builds > Read permissions.",
  );
  process.exit(1);
}

if (!accountId || !serviceName) {
  console.error(
    "Missing Cloudflare account id or service name. Override via CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_WORKERS_BUILD_SERVICE.",
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiToken}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

function printBuildSummary(build) {
  const parts = [];
  if (build.build_number) parts.push(`#${build.build_number}`);
  if (build.status) parts.push(`status=${build.status}`);
  if (build.branch) parts.push(`branch=${build.branch}`);
  if (build.commit_sha) parts.push(`commit=${build.commit_sha.slice(0, 7)}`);
  if (build.ended_on) parts.push(`completed=${build.ended_on}`);
  console.log(`[workers-build] Latest build ${parts.join(" | ")}`);
  if (build.build_uuid) {
    console.log(`[workers-build] Build UUID: ${build.build_uuid}`);
  }
  if (build.deployment_id) {
    console.log(`[workers-build] Deployment ID: ${build.deployment_id}`);
  }
}

async function cfFetch(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Cloudflare API request failed (${response.status} ${response.statusText}): ${body}`,
    );
  }
  const payload = await response.json();
  if (payload.success === false) {
    const apiErrors = (payload.errors ?? [])
      .map((err) => err.message ?? JSON.stringify(err))
      .join("; ");
    throw new Error(apiErrors || "Cloudflare API returned success=false.");
  }
  return payload;
}

function pickLatestBuild(builds) {
  if (!Array.isArray(builds) || builds.length === 0) return null;
  if (builds.length === 1) return builds[0];
  const sorted = [...builds].sort((a, b) => {
    const aTime = new Date(
      a.ended_on ?? a.updated_on ?? a.started_on ?? a.created_on ?? 0,
    ).getTime();
    const bTime = new Date(
      b.ended_on ?? b.updated_on ?? b.started_on ?? b.created_on ?? 0,
    ).getTime();
    return bTime - aTime;
  });
  return sorted[0];
}

function normalizeLogLines(result) {
  if (!result) return [];
  if (Array.isArray(result.lines)) return result.lines.map(formatLogLine);
  if (Array.isArray(result.logs)) return result.logs.map(formatLogLine);
  if (Array.isArray(result)) return result.map(formatLogLine);
  if (typeof result === "string") {
    return result.split(/\r?\n/).filter(Boolean);
  }
  return [];
}

function formatLogLine(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  const message =
    entry.message ?? entry.log ?? entry.text ?? entry.line ?? JSON.stringify(entry);
  const timestamp = entry.timestamp ?? entry.time ?? entry.ts;
  const level = entry.level ?? entry.severity;
  const prefix = [
    timestamp ? `[${timestamp}]` : null,
    level ? level.toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(" ");
  return prefix ? `${prefix} ${message}` : message;
}

async function main() {
  try {
    const buildsUrl = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/workers/${serviceName}/builds`,
    );
    buildsUrl.searchParams.set("per_page", String(Math.max(1, buildsLimit)));
    if (branchFilter) buildsUrl.searchParams.set("branch", branchFilter);

    const buildsPayload = await cfFetch(buildsUrl);
    const builds = Array.isArray(buildsPayload.result)
      ? buildsPayload.result
      : [];
    if (!builds.length) {
      console.log(
        "No builds found for the configured service. Trigger a deployment first.",
      );
      return;
    }

    const latestBuild = pickLatestBuild(builds);
    if (!latestBuild) {
      console.log("Unable to determine the latest build.");
      return;
    }
    printBuildSummary(latestBuild);

    const buildUuid =
      latestBuild.build_uuid ?? latestBuild.id ?? latestBuild.uuid;
    if (!buildUuid) {
      console.error("Latest build does not expose a build UUID. Cannot fetch logs.");
      process.exit(1);
    }

    const logsUrl = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${buildUuid}/logs`,
    );

    const logsPayload = await cfFetch(logsUrl);
    const logLines = normalizeLogLines(logsPayload.result);

    if (!logLines.length) {
      console.log("No log output returned for the latest build.");
      return;
    }

    console.log("\n--- Build Logs ---");
    for (const line of logLines) {
      if (line) console.log(line);
    }
  } catch (error) {
    console.error(`Failed to fetch Workers build logs: ${error.message}`);
    process.exit(1);
  }
}

await main();
