import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.AGENTIC_BRIDGE_PORT || 8789);
const writeEnabled = process.env.AGENTIC_BRIDGE_WRITE === "1";

async function runOnchainos(args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync("onchainos", args, {
      timeout: options.timeout ?? 12000,
      maxBuffer: 1024 * 1024,
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

async function readStatus() {
  try {
    const status = await runCommand("onchainos", ["wallet", "status"]);
    const addresses = await runCommand("onchainos", ["wallet", "addresses", "--chain", "xlayer"]);
    const address = addresses.stdout.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null;
    return {
      ok: true,
      status: status.stdout,
      address,
      addresses: addresses.stdout,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readBalance() {
  const status = await readStatus();
  const balance = await runOnchainos(["wallet", "balance", "--chain", "xlayer"], { timeout: 20000 });
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
    raw: balance.stdout,
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "http://127.0.0.1:5173");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.url === "/status") {
    const payload = await readStatus();
    res.writeHead(payload.ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.url === "/balance") {
    const payload = await readBalance();
    res.writeHead(payload.ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.url === "/tx-scan" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      if (!validCallPayload(payload)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_payload" }));
        return;
      }
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
        { timeout: 20000 },
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

  if (req.url === "/contract-call" && req.method === "POST") {
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
        { timeout: 60000 },
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
  console.log(`Agentic Wallet bridge (${mode}) listening on http://127.0.0.1:${port}`);
});
