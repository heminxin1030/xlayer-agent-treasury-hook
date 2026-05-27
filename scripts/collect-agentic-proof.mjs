#!/usr/bin/env node
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const gatewayUrl = (process.env.AGENTIC_GATEWAY_URL || "http://127.0.0.1:8789").replace(/\/$/, "");
const outFile = process.env.AGENTIC_PROOF_FILE || "deployment/agentic-wallet.proof.local.json";

async function run(command, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: options.timeout ?? 20000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function firstXLayerAddress(addresses) {
  const xlayer = addresses?.data?.xlayer;
  if (Array.isArray(xlayer)) {
    const entry = xlayer.find((item) => /^0x[a-fA-F0-9]{40}$/.test(String(item?.address ?? "")));
    if (entry) return entry.address;
  }
  return JSON.stringify(addresses).match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null;
}

function collectTokens(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTokens(item, output));
    return output;
  }

  const symbol = value.symbol ?? value.tokenSymbol ?? value.token ?? value.currency;
  const balance = value.balance ?? value.amount ?? value.tokenAmount ?? value.readableAmount;
  if (symbol && balance !== undefined) {
    output.push({
      symbol: String(symbol),
      name: String(value.name ?? value.tokenName ?? symbol),
      balance: String(balance),
      usdValue: value.usdValue === undefined ? undefined : String(value.usdValue),
      decimals: value.decimals === undefined && value.decimal === undefined ? undefined : Number(value.decimals ?? value.decimal),
      chain: String(value.chain ?? value.chainName ?? value.chainIndex ?? "xlayer"),
      tokenAddress: value.tokenAddress ? String(value.tokenAddress) : undefined,
    });
  }

  Object.values(value).forEach((item) => collectTokens(item, output));
  return output;
}

async function getJson(url) {
  try {
    const response = await fetch(url);
    const payload = await response.json();
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const version = await run("onchainos", ["--version"]);
const status = await run("onchainos", ["wallet", "status"]);
const addresses = await run("onchainos", ["wallet", "addresses", "--chain", "xlayer"]);
const balance = await run("onchainos", ["wallet", "balance", "--chain", "xlayer"], { timeout: 30000 });

const statusJson = parseJson(status.stdout);
const addressesJson = parseJson(addresses.stdout);
const balanceJson = parseJson(balance.stdout);
const tokens = balanceJson ? collectTokens(balanceJson) : [];

const gatewayHealth = await getJson(`${gatewayUrl}/health`);
const gatewayStatus = await getJson(`${gatewayUrl}/status`);
const gatewayBalance = await getJson(`${gatewayUrl}/balance`);

const proof = {
  generatedAt: new Date().toISOString(),
  localOnly: true,
  note: "Local proof is intentionally gitignored. It proves the developer machine can log in to OKX Agentic Wallet and read X Layer assets without exposing email, account id, API keys, or raw wallet responses.",
  cli: {
    ok: version.ok,
    version: version.stdout.trim(),
  },
  agenticWallet: {
    loggedIn: Boolean(statusJson?.data?.loggedIn),
    loginType: statusJson?.data?.loginType ?? statusJson?.data?.lastLoginMode ?? null,
    accountCount: statusJson?.data?.accountCount ?? null,
    xLayerAddress: firstXLayerAddress(addressesJson),
    totalValueUsd: balanceJson?.data?.totalValueUsd ?? balanceJson?.totalValueUsd ?? null,
    tokens,
  },
  gateway: {
    url: gatewayUrl,
    healthOk: Boolean(gatewayHealth.ok && gatewayHealth.payload?.ok),
    writeEnabled: Boolean(gatewayHealth.payload?.writeEnabled),
    statusOk: Boolean(gatewayStatus.ok && gatewayStatus.payload?.ok),
    balanceOk: Boolean(gatewayBalance.ok && gatewayBalance.payload?.ok),
    balanceTokenCount: Array.isArray(gatewayBalance.payload?.tokens) ? gatewayBalance.payload.tokens.length : 0,
  },
  remainingSubmissionItems: [
    "owner-reviewed demo video that shows Agentic Wallet login, asset read, security scan, and execution proof",
    "owner-reviewed X/Twitter post",
    "final hackathon form submission",
  ],
};

await writeFile(outFile, `${JSON.stringify(proof, null, 2)}\n`);

console.log(`Agentic Wallet proof written to ${outFile}`);
console.log(`loggedIn=${proof.agenticWallet.loggedIn}`);
console.log(`address=${proof.agenticWallet.xLayerAddress ?? "missing"}`);
console.log(`tokens=${proof.agenticWallet.tokens.map((token) => `${token.symbol}:${token.balance}`).join(",") || "none"}`);
console.log(`gateway=${proof.gateway.healthOk ? "ok" : "offline"} status=${proof.gateway.statusOk ? "ok" : "blocked"} balance=${proof.gateway.balanceOk ? "ok" : "blocked"}`);
