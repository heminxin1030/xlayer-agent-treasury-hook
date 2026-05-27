import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.AGENTIC_BRIDGE_PORT || 8789);
const writeEnabled = process.env.AGENTIC_BRIDGE_WRITE === "1";
const allowDefaultHome = process.env.AGENTIC_GATEWAY_ALLOW_DEFAULT_HOME === "1";
const dataDir = process.env.AGENTIC_GATEWAY_DATA_DIR || path.join(os.homedir(), ".agent-treasury-gateway");
const manifestUrl = new URL("../deployment/xlayer-mainnet.review.json", import.meta.url);
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

function short(value) {
  return typeof value === "string" && value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value || "-";
}

function strategyFromIntent(intent, fallback = "Balanced") {
  const text = String(intent || "").toLowerCase();
  if (/保守|低风险|low|conservative|wide|暂停|pause/.test(text)) return "Conservative";
  if (/激进|高收益|aggressive|high fee|收益|capture/.test(text)) return "Aggressive";
  return fallback;
}

function extractCapitalBps(intent, fallback) {
  const percent = String(intent || "").match(/(\d{1,2})(?:\s*)%/);
  if (!percent) return fallback;
  const parsed = Number(percent[1]) * 100;
  return Number.isFinite(parsed) ? Math.max(500, Math.min(3000, parsed)) : fallback;
}

function extractDailyActions(intent, fallback) {
  const match = String(intent || "").match(/(?:每天|每日|day|daily|per day)[^\d]*(\d{1,2})|(\d{1,2})[^\d]*(?:次|times).*?(?:day|每天|每日)/i);
  const value = Number(match?.[1] ?? match?.[2]);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(6, value)) : fallback;
}

function buildPlan(payload) {
  const language = payload.language === "en" ? "en" : "zh";
  const opportunity = payload.opportunity || {};
  const strategy = strategyFromIntent(payload.intent, opportunity.strategy || "Balanced");
  const risk = strategy === "Conservative" ? "Low" : strategy === "Aggressive" ? "High" : "Medium";
  const pair = opportunity.pair || "gFLOW / aiUSD";
  const maxCapitalBps = extractCapitalBps(payload.intent, Number(opportunity.maxCapitalBps || 3000));
  const maxDailyActions = extractDailyActions(payload.intent, Number(opportunity.maxDailyActions || 3));
  const minRangeWidth = Math.max(Number(opportunity.minRangeWidth || 600), strategy === "Conservative" ? 1200 : strategy === "Aggressive" ? 300 : 600);
  const autoMode = /自动|autopilot|auto/i.test(String(payload.intent || "")) && !/不要|manual|confirm|确认/i.test(String(payload.intent || ""));
  const poolId = payload.poolId || "pending";

  if (language === "en") {
    return {
      title: `${pair} ${strategy} Agent Plan`,
      summary: `The local Agent planner converted the treasury intent into a ${strategy} LP policy for ${pair}. Agentic Wallet can execute the calls, while the Vault and Hook enforce max capital, LP range width, daily action limits, and replay protection.`,
      strategy,
      risk,
      pool: pair,
      maxCapitalBps,
      minRangeWidth,
      maxDailyActions,
      autoMode,
      actions: ["Read Agentic Wallet assets", "Authorize selected Pool policy", "Report Hook risk and fee signal", "Submit LP management proposal", "Execute only after tx-scan"],
      boundaries: [`Only PoolId ${short(poolId)}`, `Capital cap ${maxCapitalBps / 100}%`, `Range width >= ${minRangeWidth} ticks`, `Max ${maxDailyActions} daily actions`, "Replay-protected actionId"],
      proof: ["Live Hook and Vault bytecode exist on X Layer", "Agentic Wallet authorization/signal/proposal txs are linked", "npm run verify:live verifies onchain state"],
    };
  }

  return {
    title: `${pair} ${strategy} Agent Plan`,
    summary: `本地 Agent planner 已把资金目标转换成 ${pair} 的 ${strategy} LP 策略。Agentic Wallet 可以执行调用，但 Vault 和 Hook 会限制最大资金比例、LP 区间宽度、每日动作次数和 actionId 防重放。`,
    strategy,
    risk,
    pool: pair,
    maxCapitalBps,
    minRangeWidth,
    maxDailyActions,
    autoMode,
    actions: ["读取 Agentic Wallet 资产", "授权指定 Pool policy", "上报 Hook 风险/手续费信号", "提交 LP 管理 proposal", "通过 tx-scan 后执行"],
    boundaries: [`只允许 PoolId ${short(poolId)}`, `资金上限 ${maxCapitalBps / 100}%`, `LP 区间宽度 >= ${minRangeWidth} ticks`, `每天最多 ${maxDailyActions} 次动作`, "actionId 防重放"],
    proof: ["X Layer 上已有 Hook 和 Vault bytecode", "Agentic Wallet 授权/signal/proposal tx 已链接", "npm run verify:live 可验证链上状态"],
  };
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

  if (requestUrl.pathname === "/agent/plan" && req.method === "POST") {
    try {
      const payload = await readBody(req);
      const intent = typeof payload.intent === "string" ? payload.intent.trim() : "";
      if (!intent) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "intent_required" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, planner: "deterministic-local-agent", plan: buildPlan(payload) }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
    return;
  }

  if (requestUrl.pathname === "/proof/live") {
    try {
      const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
      const project = manifest.project || {};
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          status: manifest.status,
          chain: manifest.chain,
          hookAddress: project.hookAddress,
          vaultAddress: project.treasuryVaultAddress,
          agentAddress: project.agentAddress,
          poolId: project.poolId,
          actionId: project.actionId,
          proofLedger: project.proofLedger,
        }),
      );
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
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
