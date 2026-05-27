import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.AGENTIC_BRIDGE_PORT || 8789);
const writeEnabled = process.env.AGENTIC_BRIDGE_WRITE === "1";
const allowDefaultHome = process.env.AGENTIC_GATEWAY_ALLOW_DEFAULT_HOME === "1";
const dataDir = process.env.AGENTIC_GATEWAY_DATA_DIR || path.join(os.homedir(), ".agent-treasury-gateway");
const allowedOrigins = new Set(
  (process.env.AGENTIC_BRIDGE_ALLOWED_ORIGINS ||
    "http://127.0.0.1:5173,http://localhost:5173,https://heminxin1030.github.io")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

async function runOnchainos(args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync("onchainos", args, {
      timeout: options.timeout ?? 12000,
      maxBuffer: 1024 * 1024,
      env: options.home ? { ...process.env, HOME: options.home } : process.env,
    });
    return { ok: true, stdout, stderr, exitCode: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
      exitCode: error?.code ?? 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    timeout: options.timeout ?? 12000,
    maxBuffer: 1024 * 1024,
    env: options.home ? { ...process.env, HOME: options.home } : process.env,
  });
}

function parseJsonLike(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function collectTokens(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTokens(item, output));
    return output;
  }

  const symbol = value.symbol ?? value.tokenSymbol ?? value.token ?? value.currency;
  const balance = value.balance ?? value.amount ?? value.tokenAmount ?? value.readableAmount;
  const address =
    value.tokenAddress || value.tokenContractAddress || value.contractAddress || (String(symbol).toUpperCase() === "OKB" ? undefined : value.address);
  if (symbol && balance !== undefined) {
    output.push({
      symbol: String(symbol),
      name: String(value.name ?? value.tokenName ?? symbol),
      address: address ? String(address) : undefined,
      balance: String(balance),
      decimals: value.decimals === undefined && value.decimal === undefined ? undefined : Number(value.decimals ?? value.decimal),
      chain: String(value.chain ?? value.chainName ?? value.chainIndex ?? "xlayer"),
    });
  }

  Object.values(value).forEach((item) => collectTokens(item, output));
  return output;
}

function parseBalanceText(stdout) {
  const tokens = [];
  const seen = new Set();
  for (const line of stdout.split("\n")) {
    const match = line.match(/\b([A-Z][A-Z0-9]{1,12})\b[^0-9]*(\d[\d,]*(?:\.\d+)?)/);
    if (!match) continue;
    const symbol = match[1];
    const balance = match[2].replaceAll(",", "");
    const key = `${symbol}:${balance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push({ symbol, name: symbol, balance, chain: "xlayer" });
  }
  return tokens;
}

function summarizeScan(stdout, stderr) {
  const parsed = parseJsonLike(stdout);
  const action = parsed?.action ?? parsed?.data?.action ?? "";
  const details = parsed?.riskItemDetail ?? parsed?.data?.riskItemDetail ?? [];
  const names = Array.isArray(details)
    ? details
        .map((item) => item?.name)
        .filter(Boolean)
        .join(", ")
    : "";
  return {
    action: action || "",
    summary: names || stdout.trim().slice(0, 600) || stderr.trim().slice(0, 600) || "scan completed",
  };
}

function parseTxHash(stdout) {
  const parsed = parseJsonLike(stdout);
  const hash = parsed?.txHash ?? parsed?.data?.txHash ?? parsed?.transactionHash ?? parsed?.hash;
  if (typeof hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(hash)) return hash;
  return stdout.match(/0x[a-fA-F0-9]{64}/)?.[0] ?? null;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sessionIdFrom(value) {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value) ? value : "";
}

async function homeForSession(sessionId) {
  if (!sessionId) return undefined;
  const home = path.join(dataDir, "sessions", sessionId);
  await mkdir(home, { recursive: true, mode: 0o700 });
  return home;
}

function validCallPayload(payload) {
  return (
    typeof payload?.from === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(payload.from) &&
    typeof payload?.to === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(payload.to) &&
    typeof payload?.data === "string" &&
    /^0x[a-fA-F0-9]*$/.test(payload.data)
  );
}

async function readStatus(sessionId = "") {
  if (!sessionId && !allowDefaultHome) {
    return { ok: false, loggedIn: false, error: "session_required" };
  }
  const home = await homeForSession(sessionId);
  try {
    const status = await runCommand("onchainos", ["wallet", "status"], { home });
    const addresses = await runCommand("onchainos", ["wallet", "addresses", "--chain", "xlayer"], { home });
    const address = addresses.stdout.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null;
    const parsedStatus = parseJsonLike(status.stdout);
    return {
      ok: true,
      address,
      loggedIn: Boolean(parsedStatus?.data?.loggedIn ?? address),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readBalance(sessionId = "") {
  if (!sessionId && !allowDefaultHome) {
    return { ok: false, error: "session_required", tokens: [] };
  }
  const home = await homeForSession(sessionId);
  const status = await readStatus(sessionId);
  const balance = await runOnchainos(["wallet", "balance", "--chain", "xlayer"], { timeout: 20000, home });
  if (!balance.ok) {
    return {
      ok: false,
      address: status.address,
      error: balance.error || balance.stderr || "balance_failed",
      raw: balance.stdout || balance.stderr,
      tokens: [],
    };
  }

  const parsed = parseJsonLike(balance.stdout);
  const tokens = parsed ? collectTokens(parsed) : parseBalanceText(balance.stdout);
  return {
    ok: true,
    address: status.address,
    tokens,
    totalValueUsd: parsed?.data?.totalValueUsd ?? parsed?.totalValueUsd ?? null,
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const origin = req.headers.origin;
  if (typeof origin === "string" && allowedOrigins.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
  }
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-private-network", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, writeEnabled, mode: "agentic-gateway" }));
    return;
  }

  if (requestUrl.pathname === "/login" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const email = typeof payload.email === "string" ? payload.email.trim() : "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_email" }));
        return;
      }
      const sessionId = randomUUID();
      const home = await homeForSession(sessionId);
      const result = await runOnchainos(["wallet", "login", email, "--locale", "zh_CN", "--chain", "xlayer"], {
        timeout: 30000,
        home,
      });
      res.writeHead(result.ok ? 200 : 502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: result.ok, sessionId, stdout: result.stdout, stderr: result.stderr, error: result.error }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (requestUrl.pathname === "/verify" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const sessionId = sessionIdFrom(payload.sessionId);
      const otp = typeof payload.otp === "string" ? payload.otp.trim() : "";
      if (!sessionId || !/^[0-9A-Za-z-]{4,16}$/.test(otp)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_session_or_otp" }));
        return;
      }
      const home = await homeForSession(sessionId);
      const verified = await runOnchainos(["wallet", "verify", otp, "--chain", "xlayer"], { timeout: 30000, home });
      const status = verified.ok ? await readStatus(sessionId) : {};
      res.writeHead(verified.ok ? 200 : 502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: verified.ok, sessionId, ...status, stdout: verified.stdout, stderr: verified.stderr, error: verified.error }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (requestUrl.pathname === "/status") {
    const payload = await readStatus(sessionIdFrom(requestUrl.searchParams.get("sessionId")));
    res.writeHead(payload.ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  if (requestUrl.pathname === "/balance") {
    const payload = await readBalance(sessionIdFrom(requestUrl.searchParams.get("sessionId")));
    res.writeHead(payload.ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  if (requestUrl.pathname === "/tx-scan" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      if (!validCallPayload(payload)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_payload" }));
        return;
      }
      const home = await homeForSession(sessionIdFrom(payload.sessionId));
      const result = await runOnchainos(
        [
          "security",
          "tx-scan",
          "--chain",
          "xlayer",
          "--from",
          payload.from,
          "--to",
          payload.to,
          "--data",
          payload.data,
          "--value",
          String(payload.value ?? "0"),
        ],
        { timeout: 20000, home },
      );
      const summary = summarizeScan(result.stdout, result.stderr);
      res.writeHead(result.ok ? 200 : 502, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: result.ok, ...summary, stdout: result.stdout, stderr: result.stderr, error: result.error }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (requestUrl.pathname === "/contract-call" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      if (!validCallPayload(payload)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_payload" }));
        return;
      }
      if (!writeEnabled) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: "write_disabled",
            command: `AGENTIC_BRIDGE_WRITE=1 npm run agentic:bridge`,
          }),
        );
        return;
      }
      const home = await homeForSession(sessionIdFrom(payload.sessionId));
      const result = await runOnchainos(
        [
          "wallet",
          "contract-call",
          "--chain",
          "xlayer",
          "--from",
          payload.from,
          "--to",
          payload.to,
          "--input-data",
          payload.data,
          "--amt",
          String(payload.value ?? "0"),
        ],
        { timeout: 60000, home },
      );
      const txHash = parseTxHash(result.stdout);
      const parsed = parseJsonLike(result.stdout);
      res.writeHead(result.ok ? 200 : result.exitCode === 2 ? 409 : 502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: result.ok,
          txHash,
          confirming: result.exitCode === 2 || Boolean(parsed?.confirming),
          message: parsed?.message,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error,
        }),
      );
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

server.listen(port, "127.0.0.1", () => {
  const mode = writeEnabled ? "write-enabled" : "read/scan-only";
  console.log(`Agentic Wallet gateway (${mode}) listening on http://127.0.0.1:${port}`);
});
