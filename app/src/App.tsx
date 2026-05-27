import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  Braces,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileCheck2,
  Languages,
  LogOut,
  MessageSquare,
  Play,
  RefreshCcw,
  ScanSearch,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
} from "lucide-react";
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import { DEFAULTS, ERC20_ABI, HOOK_ABI, VAULT_ABI, X_LAYER } from "./contracts";
import { explorerAddress, PUBLIC_PROOF } from "./proof";
import {
  actionIdFor,
  buildPoolKey,
  explorerTx,
  makeOpportunities,
  opportunityIdFor,
  poolIdFor,
  riskLabel,
  scoreOpportunity,
  strategyIndex,
  type Opportunity,
} from "./treasury";

type Config = {
  gatewayUrl: string;
  token0: string;
  token1: string;
  hook: string;
  vault: string;
  agent: string;
  importedAsset: string;
  manualApproval: boolean;
};

type AgenticStatus = {
  ok: boolean;
  address?: Address;
  error?: string;
  status?: string;
};

type BridgeToken = {
  id?: string;
  symbol?: string;
  name?: string;
  address?: string;
  balance?: string;
  decimals?: number;
  chain?: string;
};

type BalancePayload = {
  ok: boolean;
  address?: Address;
  tokens?: BridgeToken[];
  totalValueUsd?: string | null;
  raw?: string;
  error?: string;
};

type Asset = {
  id: string;
  symbol: string;
  name: string;
  address?: Address;
  balance: string;
  decimals: number;
  canVaultDeposit: boolean;
  source: "native" | "agentic" | "configured" | "imported";
};

type AssetInfo = {
  symbol: string;
  decimals: number;
  name: string;
};

type PreparedAction = {
  kind: "approve" | "deposit" | "authorize" | "proposal" | "signal";
  title: string;
  target: Address;
  calldata: Hex;
  value: string;
  command: string;
};

type ScanState = {
  ok: boolean;
  action?: "" | "warn" | "block";
  summary: string;
};

type AgentPlan = {
  title: string;
  summary: string;
  strategy: "Conservative" | "Balanced" | "Aggressive";
  risk: "Low" | "Medium" | "High";
  pool: string;
  maxCapitalBps: number;
  minRangeWidth: number;
  maxDailyActions: number;
  autoMode: boolean;
  actions: string[];
  boundaries: string[];
  proof: string[];
};

type ChatMessage = {
  role: "user" | "agent";
  content: string;
};

type Language = "zh" | "en";
type Menu = "wallet" | "asset" | "advanced" | null;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const STORAGE_KEY = "agent-treasury-hook:v3";
const LANGUAGE_KEY = "agent-treasury-hook:language";
const SESSION_KEY = "agent-treasury-hook:session";
const DEFAULT_INTENTS = {
  zh: "帮我用低风险方式管理 gFLOW/aiUSD LP，最多用 30% 资金，每天最多调仓 3 次，风险升高就暂停。",
  en: "Manage gFLOW/aiUSD LP with low risk, use at most 30% capital, rebalance no more than 3 times per day, and pause if risk rises.",
};

function defaultGatewayUrl() {
  const fromQuery = new URLSearchParams(window.location.search).get("gateway");
  if (fromQuery) return fromQuery;
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") return "http://127.0.0.1:8789";
  return "";
}

const COPY = {
  zh: {
    brand: "Agent Treasury",
    brandSub: "X Layer Hook",
    language: "语言",
    heroTitle: "Conversational LP Agent",
    heroCopy: "用自然语言给 Agent 下达资金管理目标。Agentic Wallet 负责执行，Uniswap v4 Hook 和 Vault 在链上限制 Agent 不能越权。",
    progressTitle: "流程进度",
    steps: ["用户意图", "Agent Plan", "Agentic Wallet", "安全扫描", "链上执行", "Live Proof"],
    ready: "输入一句资金管理目标，让 Agent 生成可执行的 LP 策略。",
    agent: {
      chatTitle: "告诉 Agent 你的资金目标",
      chatSubtitle: "主交互是对话，不是让用户手动点一堆 DeFi 表单。Agent 生成策略，钱包执行，Hook 限制边界。",
      placeholder: "例如：帮我用低风险方式管理 gFLOW/aiUSD LP，最多用 30% 资金，每天最多调仓 3 次，风险升高就暂停。",
      generate: "生成 Agent Plan",
      examples: ["低风险 LP，每天最多调仓 3 次", "最多用 30% 资金做 gFLOW/aiUSD", "如果风险升高就暂停，不要自动乱动钱"],
      userLabel: "User intent",
      agentLabel: "Agent response",
      planTitle: "Agent 生成的策略计划",
      planSubtitle: "这是 Agentic Wallet 后续要执行的结构化策略。真正的安全边界在 Vault 和 Hook 里。",
      intentReady: "已解析自然语言目标",
      localPlanner: "本地 deterministic planner",
      prepareAuthorize: "准备授权策略边界",
      prepareSignal: "准备 Hook 风险信号",
      prepareProposal: "准备 Agent 提案",
      scan: "安全扫描",
      execute: "交给 Agentic Wallet",
    },
    proof: {
      title: "Live X Layer Proof",
      subtitle: "评委即使不运行本地 Agent，也能直接验证这些主网交易和 Hook/Vault 状态。",
      hook: "Hook",
      vault: "Vault",
      agent: "Agentic Wallet",
      pool: "PoolId",
      action: "Executed actionId",
      verify: "复现验证命令",
      verified: "verify:live 已通过：Hook signal、Vault policy、actionId executed 都在链上成立。",
    },
    local: {
      title: "本地 Agent Runtime 和高级执行",
      subtitle: "线上页面负责展示和证明；真实 Agentic Wallet 执行建议在本地或可信 HTTPS Agent Gateway 里运行。",
      run: "本地运行顺序",
      security: "默认只读和安全扫描；真实写交易必须显式开启 AGENTIC_BRIDGE_WRITE=1。",
    },
    wallet: {
      title: "连接 Agentic Wallet",
      connected: "已连接",
      disconnected: "未连接",
      connect: "连接 Agentic Wallet",
      disconnect: "断开本地连接",
      refresh: "刷新资产",
      copy: "复制收款地址",
      menu: "钱包菜单",
      okb: "OKB 余额",
      bridge: "Agent Gateway",
      gateway: "Gateway URL",
      email: "邮箱",
      otp: "验证码",
      sendOtp: "发送 OTP",
      verifyOtp: "验证并连接",
      loginHint: "输入邮箱，验证码验证后即可连接你的 Agentic Wallet。",
    },
    strategy: {
      title: "选择 LP 机会",
      subtitle: "Agent 负责发现和排序，用户决定授权哪一个池子和风险上限。",
      selected: "已选择",
      choose: "选择策略",
    },
    fund: {
      title: "给 Agentic Wallet 充值",
      subtitle: "这里显示 Agentic Wallet 里的资产。要充值时，从你的 OKX 钱包或交易所把资产转到下方收款地址。",
      assetButton: "选择 Agentic 资产",
      amount: "本次计划使用数量",
      receive: "Agentic Wallet 收款地址",
      copyAddress: "复制地址",
      approve: "准备 ERC20 授权",
      deposit: "准备入 Vault",
      gasOnly: "OKB 用作 X Layer gas，不直接存入 ERC20 Vault。",
      empty: "未发现可入 Vault 的 ERC20。可以在高级信息里导入资产地址。",
    },
    permission: {
      title: "授权 Agent 权限",
      subtitle: "Agentic Wallet 可以执行，但链上 Vault 和 Hook 会限制它能做什么。",
      can: "Agent 可以",
      cannot: "Agent 不可以",
      canItems: ["管理用户授权的池子", "按策略提交调仓", "在资金比例内调整 LP 区间", "上报风险和手续费信号"],
      cannotItems: ["触碰未授权池子", "超过资金比例上限", "绕过每日动作次数", "绕过 Vault 提走资金"],
      authorize: "准备池子授权",
      proposal: "准备 Agent 提案",
      signal: "准备 Hook 信号",
      manual: "每次提案都需要我确认",
    },
    advanced: {
      title: "高级信息",
      subtitle: "给评委、开发者和部署时使用。普通用户不需要先看这里。",
      vault: "Vault 地址",
      hook: "Hook 地址",
      agent: "Agent 地址",
      token0: "池子资产 0",
      token1: "池子资产 1",
      import: "导入资产地址",
      poolId: "PoolId",
      tx: "最新交易",
      action: "待执行动作",
      target: "调用目标",
      calldata: "Calldata",
      command: "Agentic Wallet 命令",
      scan: "安全扫描",
      copy: "复制 PoolId",
    },
    status: {
      connected: (address: string) => `Agentic Wallet 已连接：${address}`,
      disconnected: "已断开本地 Agentic Wallet 连接。",
      refreshed: "Agentic Wallet 资产已刷新。",
      bridgeOff: "Agent Gateway 不可用。请配置线上 Gateway，或本地执行 npm run agentic:bridge。",
      needGateway: "当前页面未配置线上 Agent Gateway。请在高级信息中填入部署好的 Gateway 地址。",
      otpSent: "OTP 已发送，请输入邮箱验证码。",
      verified: "Agentic Wallet 已验证并连接。",
      needAgentic: "请先连接 Agentic Wallet。",
      needVault: "请先在高级信息里填入 Vault 地址。",
      needHook: "请先在高级信息里填入 Hook 地址。",
      needAsset: "请选择可入 Vault 的 ERC20 资产。",
      needAmount: "请输入正数数量。",
      prepared: "动作已生成。建议先安全扫描，再由 Agentic Wallet 执行。",
      scannedSafe: "安全扫描通过，可以进入 Agentic Wallet 执行。",
      scannedWarn: "安全扫描有警告，需要你确认后再执行。",
      scannedBlock: "安全扫描阻断，不建议执行。",
      writeDisabled: "本地 bridge 默认禁止真实写入。设置 AGENTIC_BRIDGE_WRITE=1 后才会调用 Agentic Wallet。",
      confirming: "Agentic Wallet 返回二次确认，需要用户明确确认后再继续。",
      executed: "Agentic Wallet 已提交交易。",
      copied: "已复制。",
      noPrepared: "请先准备一个动作。",
    },
    risk: { Low: "低", Medium: "中", High: "高" },
    opportunityStatus: { authorized: "已准备", pending: "待授权" },
    opportunities: {
      "agent-demo-balanced": {
        strategy: "均衡",
        title: "推荐均衡策略",
        thesis: "交易量、收益和风险比较平衡，适合作为演示主策略。",
      },
      "agent-conservative-wide": {
        strategy: "保守",
        title: "保守宽区间策略",
        thesis: "波动容忍更高，调仓更少，适合首次授权。",
      },
      "agent-aggressive-fees": {
        strategy: "激进",
        title: "高手续费捕获",
        thesis: "收益目标更高，但波动更大，需要更严格的资金上限。",
      },
    },
  },
  en: {
    brand: "Agent Treasury",
    brandSub: "X Layer Hook",
    language: "Language",
    heroTitle: "Conversational LP Agent",
    heroCopy: "Tell an Agent how to manage treasury liquidity. Agentic Wallet executes, while the Uniswap v4 Hook and Vault enforce the rules on X Layer.",
    progressTitle: "Progress",
    steps: ["Intent", "Agent Plan", "Agentic Wallet", "Security Scan", "Execution", "Live Proof"],
    ready: "Describe a treasury goal and let the Agent turn it into an executable LP strategy.",
    agent: {
      chatTitle: "Tell the Agent your treasury goal",
      chatSubtitle: "The main interaction is conversation, not a stack of DeFi forms. The Agent plans, Agentic Wallet executes, and the Hook constrains the boundaries.",
      placeholder: "Example: manage gFLOW/aiUSD LP with low risk, use at most 30% capital, rebalance no more than 3 times per day, pause if risk rises.",
      generate: "Generate Agent Plan",
      examples: ["Low-risk LP, max 3 rebalances per day", "Use at most 30% capital on gFLOW/aiUSD", "Pause if risk rises; do not move funds freely"],
      userLabel: "User intent",
      agentLabel: "Agent response",
      planTitle: "Agent-generated strategy plan",
      planSubtitle: "This is the structured strategy Agentic Wallet can execute. The actual safety boundary is enforced by the Vault and Hook.",
      intentReady: "Natural-language goal parsed",
      localPlanner: "Local deterministic planner",
      prepareAuthorize: "Prepare strategy boundary",
      prepareSignal: "Prepare Hook risk signal",
      prepareProposal: "Prepare Agent proposal",
      scan: "Security scan",
      execute: "Hand to Agentic Wallet",
    },
    proof: {
      title: "Live X Layer Proof",
      subtitle: "Judges can verify these mainnet transactions and Hook/Vault state even without running the local Agent.",
      hook: "Hook",
      vault: "Vault",
      agent: "Agentic Wallet",
      pool: "PoolId",
      action: "Executed actionId",
      verify: "Reproducible command",
      verified: "verify:live passed: Hook signal, Vault policy, and actionId execution are all proven onchain.",
    },
    local: {
      title: "Local Agent Runtime and Advanced Execution",
      subtitle: "The public page explains and proves the system; real Agentic Wallet execution should run locally or behind a trusted HTTPS Agent Gateway.",
      run: "Local run order",
      security: "Read/scan-only by default; real writes require explicit AGENTIC_BRIDGE_WRITE=1.",
    },
    wallet: {
      title: "Connect Agentic Wallet",
      connected: "Connected",
      disconnected: "Not connected",
      connect: "Connect Agentic Wallet",
      disconnect: "Disconnect local",
      refresh: "Refresh assets",
      copy: "Copy receive address",
      menu: "Wallet menu",
      okb: "OKB balance",
      bridge: "Agent Gateway",
      gateway: "Gateway URL",
      email: "Email",
      otp: "OTP",
      sendOtp: "Send OTP",
      verifyOtp: "Verify and connect",
      loginHint: "Enter email, verify OTP, and connect your Agentic Wallet.",
    },
    strategy: {
      title: "Choose LP Opportunity",
      subtitle: "The Agent discovers and ranks opportunities. The user decides which pool and limits to authorize.",
      selected: "Selected",
      choose: "Choose",
    },
    fund: {
      title: "Fund Agentic Wallet",
      subtitle: "Assets shown here belong to Agentic Wallet. To fund it, send assets from OKX Wallet or an exchange to the receive address below.",
      assetButton: "Choose Agentic asset",
      amount: "Planned amount",
      receive: "Agentic Wallet receive address",
      copyAddress: "Copy address",
      approve: "Prepare ERC20 approval",
      deposit: "Prepare Vault deposit",
      gasOnly: "OKB is used for X Layer gas and is not deposited into the ERC20 Vault.",
      empty: "No Vault-depositable ERC20 found. Import an asset in Advanced.",
    },
    permission: {
      title: "Authorize Agent",
      subtitle: "Agentic Wallet can execute, while the onchain Vault and Hook constrain what it is allowed to do.",
      can: "Agent can",
      cannot: "Agent cannot",
      canItems: ["Manage the authorized pool", "Submit rebalance proposals", "Adjust LP ranges within capital caps", "Report risk and fee signals"],
      cannotItems: ["Touch unauthorized pools", "Exceed capital caps", "Bypass daily action limits", "Withdraw funds outside Vault rules"],
      authorize: "Prepare pool authorization",
      proposal: "Prepare Agent proposal",
      signal: "Prepare Hook signal",
      manual: "Require my approval for every proposal",
    },
    advanced: {
      title: "Advanced",
      subtitle: "For judges, developers, and deployment. Normal users do not need to start here.",
      vault: "Vault address",
      hook: "Hook address",
      agent: "Agent address",
      token0: "Pool asset 0",
      token1: "Pool asset 1",
      import: "Import asset address",
      poolId: "PoolId",
      tx: "Last tx",
      action: "Prepared action",
      target: "Call target",
      calldata: "Calldata",
      command: "Agentic Wallet command",
      scan: "Security scan",
      copy: "Copy PoolId",
    },
    status: {
      connected: (address: string) => `Agentic Wallet connected: ${address}`,
      disconnected: "Local Agentic Wallet connection cleared.",
      refreshed: "Agentic Wallet assets refreshed.",
      bridgeOff: "Agent Gateway is unavailable. Configure an online gateway, or run npm run agentic:bridge locally.",
      needGateway: "No online Agent Gateway is configured. Set the deployed Gateway URL in Advanced.",
      otpSent: "OTP sent. Enter the email code to continue.",
      verified: "Agentic Wallet verified and connected.",
      needAgentic: "Connect Agentic Wallet first.",
      needVault: "Set the Vault address in Advanced first.",
      needHook: "Set the Hook address in Advanced first.",
      needAsset: "Choose a Vault-depositable ERC20 asset.",
      needAmount: "Enter a positive amount.",
      prepared: "Action prepared. Scan first, then let Agentic Wallet execute it.",
      scannedSafe: "Security scan passed. Ready for Agentic Wallet execution.",
      scannedWarn: "Security scan returned a warning. User confirmation is required.",
      scannedBlock: "Security scan blocked this action.",
      writeDisabled: "Local bridge write mode is disabled. Set AGENTIC_BRIDGE_WRITE=1 before calling Agentic Wallet.",
      confirming: "Agentic Wallet returned a confirmation step. Explicit user confirmation is required.",
      executed: "Agentic Wallet submitted the transaction.",
      copied: "Copied.",
      noPrepared: "Prepare an action first.",
    },
    risk: { Low: "Low", Medium: "Medium", High: "High" },
    opportunityStatus: { authorized: "Prepared", pending: "Pending" },
    opportunities: {
      "agent-demo-balanced": {
        strategy: "Balanced",
        title: "Recommended Balanced",
        thesis: "Balanced volume, return, and risk. Best for the main demo path.",
      },
      "agent-conservative-wide": {
        strategy: "Conservative",
        title: "Wide-Range Conservative",
        thesis: "Wider range, fewer rebalances, and better fit for first authorization.",
      },
      "agent-aggressive-fees": {
        strategy: "Aggressive",
        title: "High Fee Capture",
        thesis: "Higher return target with higher volatility and tighter capital caps.",
      },
    },
  },
} as const;

const initialConfig: Config = {
  gatewayUrl: defaultGatewayUrl(),
  token0: DEFAULTS.token0,
  token1: DEFAULTS.token1,
  hook: DEFAULTS.hook,
  vault: DEFAULTS.vault,
  agent: DEFAULTS.vault,
  importedAsset: "",
  manualApproval: true,
};

function loadConfig(): Config {
  try {
    return { ...initialConfig, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return initialConfig;
  }
}

function loadLanguage(): Language {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored === "zh" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function initialAgentMessage(language: Language) {
  if (language === "zh") {
    return "告诉我资金目标。我会把它转换成 Agentic Wallet 可以执行、Hook 可以限制的 Pool 策略。";
  }
  return "Tell me the treasury objective. I will convert it into pool limits that Agentic Wallet can execute and the Hook can enforce.";
}

function short(value: string): string {
  if (!value || value.length < 12) return value || "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function isConfiguredAddress(value: string): value is Address {
  return isAddress(value) && getAddress(value) !== ZERO_ADDRESS;
}

function opportunityText(opportunity: Opportunity, language: Language) {
  const item = COPY[language].opportunities[opportunity.id as keyof typeof COPY.en.opportunities];
  return item ?? { strategy: opportunity.strategy, title: opportunity.title, thesis: opportunity.thesis };
}

export function App() {
  const [language, setLanguage] = useState<Language>(() => loadLanguage());
  const [config, setConfig] = useState<Config>(() => loadConfig());
  const [agentic, setAgentic] = useState<AgenticStatus>({ ok: false });
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(SESSION_KEY) || "");
  const [loginEmail, setLoginEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [selectedId, setSelectedId] = useState("agent-demo-balanced");
  const [selectedAssetId, setSelectedAssetId] = useState("okb");
  const [amount, setAmount] = useState("0.001");
  const [balances, setBalances] = useState<Record<string, string>>({ okb: "0" });
  const [assetInfo, setAssetInfo] = useState<Record<string, AssetInfo>>({});
  const [bridgeTokens, setBridgeTokens] = useState<BridgeToken[]>([]);
  const [totalValueUsd, setTotalValueUsd] = useState<string | null>(null);
  const [preparedAction, setPreparedAction] = useState<PreparedAction | null>(null);
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const [authorized, setAuthorized] = useState<Record<string, boolean>>({});
  const [lastTx, setLastTx] = useState<Hex | "">("");
  const [menu, setMenu] = useState<Menu>(null);
  const [status, setStatus] = useState<string>(() => COPY[loadLanguage()].ready);
  const [intent, setIntent] = useState(() => DEFAULT_INTENTS[loadLanguage()]);
  const [chat, setChat] = useState<ChatMessage[]>(() => [
    {
      role: "agent",
      content: initialAgentMessage(loadLanguage()),
    },
  ]);
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);

  const c = COPY[language];
  const publicClient = useMemo(() => createPublicClient({ chain: X_LAYER, transport: http("https://rpc.xlayer.tech") }), []);
  const opportunities = useMemo(() => makeOpportunities(config.token0, config.token1), [config.token0, config.token1]);
  const selected = opportunities.find((item) => item.id === selectedId) ?? opportunities[0];
  const selectedText = opportunityText(selected, language);
  const selectedRisk = riskLabel(selected);
  const poolKey = useMemo(
    () => buildPoolKey(selected.token0, selected.token1, config.hook),
    [config.hook, selected.token0, selected.token1],
  );
  const poolId = useMemo(() => poolIdFor(poolKey), [poolKey]);
  const activePlan = useMemo(() => agentPlan ?? buildAgentPlan(intent, selected, language), [agentPlan, intent, language, selected]);
  const assets = useMemo(() => buildAssets(config, balances, assetInfo, bridgeTokens), [assetInfo, balances, bridgeTokens, config]);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0];
  const hasAgenticWallet = Boolean(agentic.ok && agentic.address);
  const hasVaultAsset = assets.some((asset) => asset.canVaultDeposit);
  const isAuthorized = Boolean(authorized[selected.id]);
  const scanDone = Boolean(scanState?.ok && scanState.action !== "block");
  const hasExecutionProof = Boolean(lastTx);
  const gatewayUrl = config.gatewayUrl.trim().replace(/\/$/, "");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
    document.title = c.heroTitle;
  }, [c.heroTitle, language]);

  useEffect(() => {
    if (agentic.address) void refreshAssets(agentic.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentic.address, config.token0, config.token1, config.importedAsset]);

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    setStatus(COPY[nextLanguage].ready);
  }

  function gatewayEndpoint(path: string) {
    return `${gatewayUrl}${path}`;
  }

  function sessionQuery() {
    return sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  }

  async function sendOtp() {
    if (!gatewayUrl) {
      setStatus(c.status.needGateway);
      return;
    }
    const response = await fetch(gatewayEndpoint("/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: loginEmail }),
    });
    const payload = await response.json();
    if (payload.sessionId) {
      setSessionId(payload.sessionId);
      localStorage.setItem(SESSION_KEY, payload.sessionId);
    }
    setStatus(response.ok ? c.status.otpSent : payload.error || c.status.bridgeOff);
  }

  async function verifyOtp() {
    if (!gatewayUrl) {
      setStatus(c.status.needGateway);
      return;
    }
    const response = await fetch(gatewayEndpoint("/verify"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, otp }),
    });
    const payload = (await response.json()) as AgenticStatus & { sessionId?: string; error?: string };
    if (payload.sessionId) {
      setSessionId(payload.sessionId);
      localStorage.setItem(SESSION_KEY, payload.sessionId);
    }
    const address = payload.address && isAddress(payload.address) ? getAddress(payload.address) : undefined;
    const next = { ...payload, address };
    setAgentic(next);
    if (address) {
      setConfig((current) => ({ ...current, agent: address }));
      await refreshAssets(address, payload.sessionId ?? sessionId);
    }
    setStatus(response.ok && address ? c.status.verified : payload.error || c.status.bridgeOff);
  }

  async function connectAgenticWallet() {
    if (!gatewayUrl) {
      setStatus(c.status.needGateway);
      return;
    }
    try {
      const response = await fetch(gatewayEndpoint(`/status${sessionQuery()}`));
      const payload = (await response.json()) as AgenticStatus;
      const address = payload.address && isAddress(payload.address) ? getAddress(payload.address) : undefined;
      const next = { ...payload, address };
      setAgentic(next);
      if (address) {
        setConfig((current) => ({ ...current, agent: address }));
        await refreshAssets(address);
      }
      setMenu(null);
      setStatus(next.ok && address ? c.status.connected(short(address)) : c.status.bridgeOff);
    } catch {
      setAgentic({ ok: false, error: c.status.bridgeOff });
      setStatus(c.status.bridgeOff);
    }
  }

  function disconnectAgenticWallet() {
    setAgentic({ ok: false });
    setSessionId("");
    localStorage.removeItem(SESSION_KEY);
    setBridgeTokens([]);
    setBalances({ okb: "0" });
    setPreparedAction(null);
    setScanState(null);
    setMenu(null);
    setStatus(c.status.disconnected);
  }

  async function refreshAssets(target = agentic.address, session = sessionId) {
    if (!target) {
      setStatus(c.status.needAgentic);
      return;
    }
    const next: Record<string, string> = {};
    const nativeBalance = await publicClient.getBalance({ address: target });
    next.okb = trimBalance(formatEther(nativeBalance));

    try {
      const query = session ? `?sessionId=${encodeURIComponent(session)}` : "";
      const response = await fetch(gatewayEndpoint(`/balance${query}`));
      const payload = (await response.json()) as BalancePayload;
      setBridgeTokens(payload.tokens ?? []);
      setTotalValueUsd(payload.totalValueUsd ?? null);
    } catch {
      setBridgeTokens([]);
      setTotalValueUsd(null);
    }

    const nextInfo: Record<string, AssetInfo> = { ...assetInfo };
    const configuredAssets = buildAssets(config, next, assetInfo, []).filter((item) => item.address);
    for (const asset of configuredAssets) {
      try {
        const [symbol, decimals] = await Promise.all([
          publicClient
            .readContract({ address: asset.address as Address, abi: ERC20_ABI, functionName: "symbol" })
            .catch(() => asset.symbol),
          publicClient
            .readContract({ address: asset.address as Address, abi: ERC20_ABI, functionName: "decimals" })
            .catch(() => asset.decimals),
        ]);
        nextInfo[asset.id] = {
          symbol: String(symbol),
          decimals: Number(decimals),
          name: asset.name,
        };
        const balance = await publicClient.readContract({
          address: asset.address as Address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [target],
        });
        next[asset.id] = trimBalance(formatUnits(balance, Number(decimals)));
      } catch {
        next[asset.id] = "0";
      }
    }

    setAssetInfo(nextInfo);
    setBalances(next);
    setStatus(c.status.refreshed);
  }

  async function copyReceiveAddress() {
    if (!agentic.address) {
      setStatus(c.status.needAgentic);
      return;
    }
    await navigator.clipboard.writeText(agentic.address);
    setStatus(c.status.copied);
  }

  async function generateAgentPlan(nextIntent = intent) {
    const cleanIntent = nextIntent.trim() || DEFAULT_INTENTS[language];
    const plannedOpportunity = chooseOpportunityForIntent(cleanIntent, opportunities);
    setSelectedId(plannedOpportunity.id);

    let nextPlan: AgentPlan | null = null;
    if (gatewayUrl) {
      try {
        const response = await fetch(gatewayEndpoint("/agent/plan"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent: cleanIntent,
            language,
            poolId,
            opportunity: plannedOpportunity,
          }),
        });
        const payload = await response.json();
        if (response.ok && payload.plan) nextPlan = normalizePlan(payload.plan, plannedOpportunity, language);
      } catch {
        nextPlan = null;
      }
    }

    const plan = nextPlan ?? buildAgentPlan(cleanIntent, plannedOpportunity, language);
    setAgentPlan(plan);
    setChat([
      { role: "user", content: cleanIntent },
      { role: "agent", content: plan.summary },
    ]);
    setStatus(c.agent.intentReady);
  }

  function useExample(example: string) {
    setIntent(example);
    void generateAgentPlan(example);
  }

  function prepareApprove() {
    if (!agentic.address) {
      setStatus(c.status.needAgentic);
      return;
    }
    if (!isConfiguredAddress(config.vault)) {
      setStatus(c.status.needVault);
      return;
    }
    if (!selectedAsset?.canVaultDeposit || !selectedAsset.address) {
      setStatus(selectedAsset?.source === "native" ? c.fund.gasOnly : c.status.needAsset);
      return;
    }
    const parsed = parseSelectedAmount(selectedAsset, amount);
    if (parsed <= 0n) {
      setStatus(c.status.needAmount);
      return;
    }
    const target = selectedAsset.address;
    const calldata = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [getAddress(config.vault), parsed],
    });
    setAction({
      kind: "approve",
      title: `${selectedAsset.symbol} approve -> Vault`,
      target,
      calldata,
      value: "0",
      command: buildContractCallCommand(target, calldata, agentic.address),
    });
  }

  function prepareDeposit() {
    if (!agentic.address) {
      setStatus(c.status.needAgentic);
      return;
    }
    if (!isConfiguredAddress(config.vault)) {
      setStatus(c.status.needVault);
      return;
    }
    if (!selectedAsset?.canVaultDeposit || !selectedAsset.address) {
      setStatus(selectedAsset?.source === "native" ? c.fund.gasOnly : c.status.needAsset);
      return;
    }
    const parsed = parseSelectedAmount(selectedAsset, amount);
    if (parsed <= 0n) {
      setStatus(c.status.needAmount);
      return;
    }
    const target = getAddress(config.vault);
    const calldata = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "deposit",
      args: [selectedAsset.address, parsed],
    });
    setAction({
      kind: "deposit",
      title: `${selectedAsset.symbol} deposit -> Treasury Vault`,
      target,
      calldata,
      value: "0",
      command: buildContractCallCommand(target, calldata, agentic.address),
    });
  }

  function prepareAuthorizeSelectedPool() {
    if (!agentic.address) {
      setStatus(c.status.needAgentic);
      return;
    }
    if (!isConfiguredAddress(config.vault)) {
      setStatus(c.status.needVault);
      return;
    }
    const target = getAddress(config.vault);
    const calldata = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "authorizePool",
      args: [
        poolId,
        selected.token0,
        selected.token1,
        strategyIndex(selected.strategy),
        selected.maxCapitalBps,
        selected.minRangeWidth,
        selected.maxDailyActions,
        selected.autoMode && !config.manualApproval,
      ],
    });
    setAuthorized((current) => ({ ...current, [selected.id]: true }));
    setAction({
      kind: "authorize",
      title: `Authorize ${selectedText.title}`,
      target,
      calldata,
      value: "0",
      command: buildContractCallCommand(target, calldata, agentic.address),
    });
  }

  function prepareOpportunitySignal() {
    if (!agentic.address) {
      setStatus(c.status.needAgentic);
      return;
    }
    if (!isConfiguredAddress(config.hook)) {
      setStatus(c.status.needHook);
      return;
    }
    const fee = selectedRisk === "High" ? 8000 : selectedRisk === "Medium" ? 3000 : 1200;
    const riskScore = selectedRisk === "High" ? 80 : selectedRisk === "Medium" ? 45 : 18;
    const target = getAddress(config.hook);
    const calldata = encodeFunctionData({
      abi: HOOK_ABI,
      functionName: "reportOpportunity",
      args: [poolKey, opportunityIdFor(selected), riskScore, fee],
    });
    setAction({
      kind: "signal",
      title: `Report ${selectedRisk} Hook signal`,
      target,
      calldata,
      value: "0",
      command: buildContractCallCommand(target, calldata, agentic.address),
    });
  }

  function prepareAgentProposal() {
    if (!agentic.address) {
      setStatus(c.status.needAgentic);
      return;
    }
    if (!isConfiguredAddress(config.vault)) {
      setStatus(c.status.needVault);
      return;
    }
    const halfWidth = Math.max(selected.minRangeWidth / 2, 60);
    const target = getAddress(config.vault);
    const calldata = encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "submitProposal",
      args: [
        actionIdFor(selected.id, agentic.address),
        poolId,
        -Math.round(halfWidth),
        Math.round(halfWidth),
        selected.maxCapitalBps,
        selectedText.thesis,
      ],
    });
    setAction({
      kind: "proposal",
      title: `Agent proposal: ${selectedText.title}`,
      target,
      calldata,
      value: "0",
      command: buildContractCallCommand(target, calldata, agentic.address),
    });
  }

  function setAction(action: PreparedAction) {
    setPreparedAction(action);
    setScanState(null);
    setStatus(c.status.prepared);
  }

  async function scanPreparedAction() {
    if (!agentic.address) {
      setStatus(c.status.needAgentic);
      return;
    }
    if (!preparedAction) {
      setStatus(c.status.noPrepared);
      return;
    }
    try {
      if (!gatewayUrl) {
        setStatus(c.status.needGateway);
        return;
      }
      const response = await fetch(gatewayEndpoint("/tx-scan"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: agentic.address,
          sessionId,
          to: preparedAction.target,
          data: preparedAction.calldata,
          value: preparedAction.value,
        }),
      });
      const payload = await response.json();
      const action = (payload.action ?? "") as "" | "warn" | "block";
      const summary = payload.summary ?? payload.stdout ?? payload.error ?? "scan completed";
      setScanState({ ok: response.ok, action, summary });
      setStatus(action === "block" ? c.status.scannedBlock : action === "warn" ? c.status.scannedWarn : c.status.scannedSafe);
    } catch {
      setScanState({ ok: false, summary: c.status.bridgeOff });
      setStatus(c.status.bridgeOff);
    }
  }

  async function executePreparedAction() {
    if (!agentic.address) {
      setStatus(c.status.needAgentic);
      return;
    }
    if (!preparedAction) {
      setStatus(c.status.noPrepared);
      return;
    }
    try {
      if (!gatewayUrl) {
        setStatus(c.status.needGateway);
        return;
      }
      const response = await fetch(gatewayEndpoint("/contract-call"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: agentic.address,
          sessionId,
          to: preparedAction.target,
          data: preparedAction.calldata,
          value: preparedAction.value,
        }),
      });
      const payload = await response.json();
      if (payload.txHash && isHex(payload.txHash)) {
        setLastTx(payload.txHash);
        setStatus(c.status.executed);
        return;
      }
      if (payload.confirming) {
        setStatus(c.status.confirming);
        return;
      }
      if (payload.error === "write_disabled") {
        setStatus(c.status.writeDisabled);
        return;
      }
      setStatus(payload.error || c.status.bridgeOff);
    } catch {
      setStatus(c.status.bridgeOff);
    }
  }

  async function copyPoolId() {
    await navigator.clipboard.writeText(poolId);
    setStatus(c.status.copied);
  }

  return (
    <main className="app-shell">
      <aside className="progress-rail">
        <div className="brand">
          <div className="brand-mark">AT</div>
          <div>
            <strong>{c.brand}</strong>
            <span>{c.brandSub}</span>
          </div>
        </div>

        <div className="rail-section">
          <span className="rail-title">{c.progressTitle}</span>
          <ProgressItem label={c.steps[0]} done={intent.trim().length > 0} detail={intent.trim() ? short(intent) : "-"} />
          <ProgressItem label={c.steps[1]} done={Boolean(activePlan)} detail={activePlan.strategy} />
          <ProgressItem label={c.steps[2]} done={hasAgenticWallet} detail={agentic.address ? short(agentic.address) : c.wallet.disconnected} />
          <ProgressItem label={c.steps[3]} done={scanDone} detail={scanState?.action || "-"} />
          <ProgressItem label={c.steps[4]} done={isAuthorized || hasExecutionProof} detail={lastTx ? short(lastTx) : c.opportunityStatus.pending} />
          <ProgressItem label={c.steps[5]} done detail={short(PUBLIC_PROOF.agentAddress)} />
        </div>

        <div className="rail-card">
          <span>{c.wallet.okb}</span>
          <strong>{balances.okb ?? "0"} OKB</strong>
          {totalValueUsd ? <small>${totalValueUsd}</small> : null}
        </div>
        <div className="rail-card">
          <span>{c.wallet.bridge}</span>
          <strong>{agentic.ok ? c.wallet.connected : c.wallet.disconnected}</strong>
          <small>{gatewayUrl || c.status.needGateway}</small>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">OKX Agentic Wallet / X Layer AgentFi</p>
            <h1>{c.heroTitle}</h1>
            <p className="hero-copy">{c.heroCopy}</p>
          </div>

          <div className="top-actions">
            <div className="segmented" aria-label={c.language}>
              <Languages size={16} />
              <button className={language === "zh" ? "active" : ""} onClick={() => changeLanguage("zh")}>
                中文
              </button>
              <button className={language === "en" ? "active" : ""} onClick={() => changeLanguage("en")}>
                EN
              </button>
            </div>

            <div className="menu-wrap">
              <button className="primary" onClick={() => setMenu(menu === "wallet" ? null : "wallet")}>
                <Wallet size={18} /> {agentic.address ? short(agentic.address) : c.wallet.connect} <ChevronDown size={16} />
              </button>
              {menu === "wallet" ? (
                <div className="dropdown">
                  <button onClick={connectAgenticWallet}>
                    <Bot size={16} /> {c.wallet.connect}
                  </button>
                  <button onClick={() => refreshAssets()}>
                    <RefreshCcw size={16} /> {c.wallet.refresh}
                  </button>
                  <button onClick={copyReceiveAddress}>
                    <Copy size={16} /> {c.wallet.copy}
                  </button>
                  <button onClick={disconnectAgenticWallet}>
                    <LogOut size={16} /> {c.wallet.disconnect}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="status-line">
          <span>{status}</span>
          <strong>{hasAgenticWallet ? "Agentic" : "Offline"}</strong>
          <strong>{config.manualApproval ? c.permission.manual : "Autopilot"}</strong>
        </div>

        <div className="agent-board">
          <section className="agent-card chat-card">
            <div className="section-heading">
              <span className="section-icon"><MessageSquare size={18} /></span>
              <div>
                <h2>{c.agent.chatTitle}</h2>
                <p>{c.agent.chatSubtitle}</p>
              </div>
            </div>
            <div className="chat-window">
              {chat.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
                  <span>{message.role === "user" ? c.agent.userLabel : c.agent.agentLabel}</span>
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
            <textarea value={intent} onChange={(event) => setIntent(event.target.value)} placeholder={c.agent.placeholder} />
            <div className="intent-chips">
              {c.agent.examples.map((example) => (
                <button key={example} onClick={() => useExample(example)}>
                  <Sparkles size={15} /> {example}
                </button>
              ))}
            </div>
            <button className="primary wide-action" onClick={() => generateAgentPlan()}>
              <Send size={18} /> {c.agent.generate}
            </button>
          </section>

          <section className="agent-card plan-card">
            <div className="section-heading">
              <span className="section-icon"><Braces size={18} /></span>
              <div>
                <h2>{c.agent.planTitle}</h2>
                <p>{c.agent.planSubtitle}</p>
              </div>
            </div>
            <div className="plan-summary">
              <strong>{activePlan.title}</strong>
              <p>{activePlan.summary}</p>
            </div>
            <div className="plan-metrics">
              <Metric label="Strategy" value={activePlan.strategy} />
              <Metric label="Risk" value={c.risk[activePlan.risk]} />
              <Metric label="Capital cap" value={`${activePlan.maxCapitalBps / 100}%`} />
              <Metric label="Daily actions" value={String(activePlan.maxDailyActions)} />
            </div>
            <div className="agent-lists">
              <PlanList title="Agent actions" items={activePlan.actions} />
              <PlanList title="Hook boundaries" items={activePlan.boundaries} />
            </div>
            <div className="execution-path">
              <PathNode label="Intent" detail={short(intent)} />
              <PathNode label="Agent Plan" detail={activePlan.strategy} />
              <PathNode label="Agentic Wallet" detail={agentic.address ? short(agentic.address) : c.wallet.disconnected} />
              <PathNode label="Vault + Hook" detail="policy enforced" />
              <PathNode label="X Layer Proof" detail={short(PUBLIC_PROOF.poolId)} />
            </div>
            <div className="quick-actions">
              <button className="primary" onClick={prepareAuthorizeSelectedPool}>
                <ShieldCheck size={18} /> {c.agent.prepareAuthorize}
              </button>
              <button onClick={prepareOpportunitySignal}>{c.agent.prepareSignal}</button>
              <button onClick={prepareAgentProposal}>{c.agent.prepareProposal}</button>
              <button onClick={scanPreparedAction}>
                <ScanSearch size={18} /> {c.agent.scan}
              </button>
              <button onClick={executePreparedAction}>
                <Play size={18} /> {c.agent.execute}
              </button>
            </div>
          </section>
        </div>

        <section className="agent-card proof-card">
          <div className="section-heading">
            <span className="section-icon"><FileCheck2 size={18} /></span>
            <div>
              <h2>{c.proof.title}</h2>
              <p>{c.proof.subtitle}</p>
            </div>
          </div>
          <div className="proof-grid proof-grid-live">
            <KeyValue label={c.proof.hook} value={explorerAddress(PUBLIC_PROOF.hookAddress)} link />
            <KeyValue label={c.proof.vault} value={explorerAddress(PUBLIC_PROOF.vaultAddress)} link />
            <KeyValue label={c.proof.agent} value={PUBLIC_PROOF.agentAddress} />
            <KeyValue label={c.proof.pool} value={PUBLIC_PROOF.poolId} />
            <KeyValue label={c.proof.action} value={PUBLIC_PROOF.actionId} />
            <KeyValue label={c.proof.verify} value="npm run verify:live" />
          </div>
          <div className="tx-ledger">
            {PUBLIC_PROOF.proofTxs.map((tx) => (
              <a key={tx.hash} href={explorerTx(tx.hash as Hex)} target="_blank" rel="noreferrer">
                <span>{tx.label}</span>
                <code>{short(tx.hash)}</code>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>
          <p className="inline-note">{c.proof.verified}</p>
        </section>

        <section className="advanced-block">
          <button className="advanced-toggle" onClick={() => setMenu(menu === "advanced" ? null : "advanced")}>
            <Settings2 size={18} /> {c.local.title} <ChevronDown size={16} />
          </button>
          {menu === "advanced" ? (
            <div className="advanced-panel execution-lab">
              <p>{c.local.subtitle}</p>
              <div className="runbook-grid">
                <div>
                  <span>{c.local.run}</span>
                  <code>npm run agentic:bridge:local</code>
                  <code>npm run proof:agentic</code>
                  <code>npm run verify:live</code>
                </div>
                <div>
                  <span>{c.wallet.bridge}</span>
                  <strong>{gatewayUrl || c.status.needGateway}</strong>
                  <p>{c.local.security}</p>
                </div>
              </div>

              <section className="step-panel embedded-panel">
                <div className="step-copy">
                  <span className="step-index">1</span>
                  <div>
                    <h2>{c.wallet.title}</h2>
                    <p>{agentic.address ? c.status.connected(short(agentic.address)) : c.ready}</p>
                  </div>
                </div>
                <div className="login-grid">
                  <Field label={c.wallet.email}>
                    <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="name@example.com" />
                  </Field>
                  <Field label={c.wallet.otp}>
                    <input value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="123456" />
                  </Field>
                  <div className="login-hint">{c.wallet.loginHint}</div>
                </div>
                <div className="quick-actions">
                  <button className="primary" onClick={sendOtp}>{c.wallet.sendOtp}</button>
                  <button onClick={verifyOtp}>
                    <Bot size={18} /> {c.wallet.verifyOtp}
                  </button>
                  <button onClick={connectAgenticWallet}>{c.wallet.connect}</button>
                  <button onClick={() => refreshAssets()}>
                    <RefreshCcw size={18} /> {c.wallet.refresh}
                  </button>
                  <button onClick={disconnectAgenticWallet}>
                    <LogOut size={18} /> {c.wallet.disconnect}
                  </button>
                </div>
              </section>

              <section className="step-panel embedded-panel">
                <div className="step-copy">
                  <span className="step-index">2</span>
                  <div>
                    <h2>{c.fund.title}</h2>
                    <p>{c.fund.subtitle}</p>
                  </div>
                </div>
                <div className="receive-box">
                  <span>{c.fund.receive}</span>
                  <code>{agentic.address ?? "-"}</code>
                  <button onClick={copyReceiveAddress}>
                    <Copy size={18} /> {c.fund.copyAddress}
                  </button>
                </div>
                <div className="assets-strip">
                  {assets.map((asset) => (
                    <button
                      key={asset.id}
                      className={asset.id === selectedAssetId ? "asset-pill selected" : "asset-pill"}
                      onClick={() => setSelectedAssetId(asset.id)}
                    >
                      <span>{asset.symbol}</span>
                      <strong>{asset.balance}</strong>
                      <small>{asset.canVaultDeposit ? "Vault" : "Gas"}</small>
                    </button>
                  ))}
                </div>
                <div className="fund-grid">
                  <div className="selected-asset-box">
                    <span>{c.fund.assetButton}</span>
                    <strong>{selectedAsset ? `${selectedAsset.balance} ${selectedAsset.symbol}` : c.fund.empty}</strong>
                  </div>
                  <label className="field compact-field">
                    <span>{c.fund.amount}</span>
                    <input value={amount} onChange={(event) => setAmount(event.target.value)} />
                  </label>
                  <button onClick={prepareApprove} disabled={!hasVaultAsset}>
                    <ClipboardCheck size={18} /> {c.fund.approve}
                  </button>
                  <button className="primary" onClick={prepareDeposit} disabled={!hasVaultAsset}>
                    <Wallet size={18} /> {c.fund.deposit}
                  </button>
                </div>
                {selectedAsset && !selectedAsset.canVaultDeposit ? <p className="inline-note">{c.fund.gasOnly}</p> : null}
              </section>

              <section className="step-panel embedded-panel">
                <div className="step-copy">
                  <span className="step-index">3</span>
                  <div>
                    <h2>{c.strategy.title}</h2>
                    <p>{c.strategy.subtitle}</p>
                  </div>
                </div>
                <div className="strategy-grid">
                  {opportunities.map((opportunity) => (
                    <StrategyCard
                      key={opportunity.id}
                      opportunity={opportunity}
                      selected={selected.id === opportunity.id}
                      authorized={Boolean(authorized[opportunity.id])}
                      language={language}
                      onSelect={() => setSelectedId(opportunity.id)}
                    />
                  ))}
                </div>
              </section>

              <section className="step-panel embedded-panel">
                <div className="step-copy">
                  <span className="step-index">4</span>
                  <div>
                    <h2>{c.permission.title}</h2>
                    <p>{c.permission.subtitle}</p>
                  </div>
                </div>
                <div className="permission-grid">
                  <PermissionList title={c.permission.can} items={c.permission.canItems} positive />
                  <PermissionList title={c.permission.cannot} items={c.permission.cannotItems} />
                  <div className="policy-box">
                    <Metric label="APR" value={`${selected.feeApr.toFixed(1)}%`} />
                    <Metric label="Risk" value={c.risk[selectedRisk]} />
                    <Metric label="Capital cap" value={`${selected.maxCapitalBps / 100}%`} />
                    <Metric label="Daily actions" value={String(selected.maxDailyActions)} />
                  </div>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={config.manualApproval}
                    onChange={(event) => update("manualApproval", event.target.checked)}
                  />
                  {c.permission.manual}
                </label>
                <div className="quick-actions">
                  <button className="primary" onClick={prepareAuthorizeSelectedPool}>
                    <ShieldCheck size={18} /> {c.permission.authorize}
                  </button>
                  <button onClick={prepareAgentProposal}>{c.permission.proposal}</button>
                  <button onClick={prepareOpportunitySignal}>{c.permission.signal}</button>
                  <button onClick={scanPreparedAction}>
                    <ScanSearch size={18} /> {c.advanced.scan}
                  </button>
                  <button onClick={executePreparedAction}>
                    <Play size={18} /> Agentic
                  </button>
                </div>
              </section>

              <div className="section-heading">
                <span className="section-icon"><Terminal size={18} /></span>
                <div>
                  <h2>{c.advanced.title}</h2>
                  <p>{c.advanced.subtitle}</p>
                </div>
              </div>
              <div className="advanced-grid">
                <Field label={c.wallet.gateway}>
                  <input value={config.gatewayUrl} onChange={(event) => update("gatewayUrl", event.target.value)} placeholder="https://agent-gateway.example.com" />
                </Field>
                <Field label={c.advanced.vault}>
                  <input value={config.vault} onChange={(event) => update("vault", event.target.value)} />
                </Field>
                <Field label={c.advanced.hook}>
                  <input value={config.hook} onChange={(event) => update("hook", event.target.value)} />
                </Field>
                <Field label={c.advanced.agent}>
                  <input value={config.agent} onChange={(event) => update("agent", event.target.value)} />
                </Field>
                <Field label={c.advanced.import}>
                  <input value={config.importedAsset} onChange={(event) => update("importedAsset", event.target.value)} />
                </Field>
                <Field label={c.advanced.token0}>
                  <input value={config.token0} onChange={(event) => update("token0", event.target.value)} />
                </Field>
                <Field label={c.advanced.token1}>
                  <input value={config.token1} onChange={(event) => update("token1", event.target.value)} />
                </Field>
              </div>
              <div className="proof-grid">
                <KeyValue label={c.advanced.poolId} value={poolId} />
                <KeyValue label="Currency0" value={poolKey.currency0} />
                <KeyValue label="Currency1" value={poolKey.currency1} />
                <KeyValue label={c.advanced.tx} value={lastTx ? explorerTx(lastTx) : "-"} link={Boolean(lastTx)} />
                <KeyValue label={c.advanced.action} value={preparedAction?.title ?? "-"} />
                <KeyValue label={c.advanced.target} value={preparedAction?.target ?? "-"} />
                <KeyValue label={c.advanced.calldata} value={preparedAction?.calldata ?? "-"} />
                <KeyValue label={c.advanced.scan} value={scanState?.summary ?? "-"} />
              </div>
              <div className="command-box">
                <span>{c.advanced.command}</span>
                <code>{preparedAction?.command ?? "-"}</code>
              </div>
              <button onClick={copyPoolId}>
                <Copy size={18} /> {c.advanced.copy}
              </button>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function buildAssets(
  config: Config,
  balances: Record<string, string>,
  assetInfo: Record<string, AssetInfo>,
  bridgeTokens: BridgeToken[],
): Asset[] {
  const assets: Asset[] = [
    {
      id: "okb",
      symbol: "OKB",
      name: "X Layer gas asset",
      balance: balances.okb ?? bridgeTokens.find((token) => token.symbol?.toUpperCase() === "OKB")?.balance ?? "0",
      decimals: 18,
      canVaultDeposit: false,
      source: "native",
    },
  ];
  const seen = new Set<string>();
  const configured = [
    { id: "token0", value: config.token0, symbol: "Asset 0", name: "Pool configured asset", source: "configured" as const },
    { id: "token1", value: config.token1, symbol: "Asset 1", name: "Pool configured asset", source: "configured" as const },
    { id: "imported", value: config.importedAsset, symbol: "Imported", name: "Imported Agentic asset", source: "imported" as const },
  ];

  for (const item of configured) {
    if (!isConfiguredAddress(item.value)) continue;
    const address = getAddress(item.value);
    if (seen.has(address)) continue;
    seen.add(address);
    const info = assetInfo[item.id];
    assets.push({
      id: item.id,
      symbol: info?.symbol ?? item.symbol,
      name: info?.name ?? item.name,
      address,
      balance: balances[item.id] ?? "0",
      decimals: info?.decimals ?? 18,
      canVaultDeposit: true,
      source: item.source,
    });
  }

  bridgeTokens.forEach((token, index) => {
    if (!token.symbol || !token.balance) return;
    if (token.symbol.toUpperCase() === "OKB") return;
    const address = token.address && isConfiguredAddress(token.address) ? getAddress(token.address) : undefined;
    if (address && seen.has(address)) return;
    if (address) seen.add(address);
    assets.push({
      id: `agentic-${address ?? token.symbol}-${index}`,
      symbol: token.symbol,
      name: token.name || "Agentic Wallet asset",
      address,
      balance: token.balance,
      decimals: token.decimals ?? 18,
      canVaultDeposit: Boolean(address),
      source: "agentic",
    });
  });

  return assets;
}

function parseSelectedAmount(asset: Asset, value: string) {
  try {
    return parseUnits(value || "0", asset.decimals);
  } catch {
    return 0n;
  }
}

function trimBalance(value: string) {
  const [integer, fraction = ""] = value.split(".");
  if (!fraction) return integer;
  return `${integer}.${fraction.slice(0, 6)}`.replace(/\.?0+$/, "");
}

function buildContractCallCommand(target: Address, calldata: Hex, from?: Address) {
  const fromPart = from ? ` --from ${from}` : "";
  return `onchainos security tx-scan --chain xlayer${fromPart} --to ${target} --data ${calldata} && onchainos wallet contract-call --chain xlayer${fromPart} --to ${target} --input-data ${calldata}`;
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]+$/.test(value);
}

function chooseOpportunityForIntent(intent: string, opportunities: Opportunity[]) {
  const text = intent.toLowerCase();
  if (/保守|低风险|low|conservative|wide|暂停|pause/.test(text)) {
    return opportunities.find((item) => item.strategy === "Conservative") ?? opportunities[0];
  }
  if (/激进|高收益|aggressive|high fee|收益|capture/.test(text)) {
    return opportunities.find((item) => item.strategy === "Aggressive") ?? opportunities[0];
  }
  return opportunities.find((item) => item.strategy === "Balanced") ?? opportunities[0];
}

function extractCapitalBps(intent: string, fallback: number) {
  const percent = intent.match(/(\d{1,2})(?:\s*)%/);
  if (!percent) return fallback;
  const parsed = Number(percent[1]) * 100;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(500, Math.min(3000, parsed));
}

function extractDailyActions(intent: string, fallback: number) {
  const match = intent.match(/(?:每天|每日|day|daily|per day)[^\d]*(\d{1,2})|(\d{1,2})[^\d]*(?:次|times).*?(?:day|每天|每日)/i);
  const value = Number(match?.[1] ?? match?.[2]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.min(6, value));
}

function buildAgentPlan(intent: string, opportunity: Opportunity, language: Language): AgentPlan {
  const conservative = opportunity.strategy === "Conservative";
  const aggressive = opportunity.strategy === "Aggressive";
  const risk = conservative ? "Low" : aggressive ? "High" : "Medium";
  const maxCapitalBps = extractCapitalBps(intent, opportunity.maxCapitalBps);
  const maxDailyActions = extractDailyActions(intent, opportunity.maxDailyActions);
  const autoMode = /自动|autopilot|auto/i.test(intent) && !/不要|manual|confirm|确认/i.test(intent);
  const minRangeWidth = conservative ? Math.max(opportunity.minRangeWidth, 1200) : aggressive ? opportunity.minRangeWidth : Math.max(opportunity.minRangeWidth, 600);

  if (language === "zh") {
    return {
      title: `${opportunity.pair} ${opportunity.strategy} Agent Plan`,
      summary: `我会把你的目标转换为 ${opportunity.pair} 的 ${opportunity.strategy} LP 策略：最多使用 ${maxCapitalBps / 100}% 资金，每天最多 ${maxDailyActions} 次动作，风险等级 ${risk}。Agentic Wallet 只负责执行，Vault 和 Hook 会在链上限制它不能越权。`,
      strategy: opportunity.strategy,
      risk,
      pool: opportunity.pair,
      maxCapitalBps,
      minRangeWidth,
      maxDailyActions,
      autoMode,
      actions: ["读取 Agentic Wallet 资产", "授权指定 Pool policy", "上报 Hook 风险/手续费信号", "提交 LP 管理 proposal", "通过安全扫描后执行"],
      boundaries: [
        `只允许 PoolId ${short(PUBLIC_PROOF.poolId)}`,
        `资金上限 ${maxCapitalBps / 100}%`,
        `LP 区间宽度不少于 ${minRangeWidth} ticks`,
        `每天最多 ${maxDailyActions} 次动作`,
        "actionId 防重放，超出策略会 revert",
      ],
      proof: ["Agentic Wallet 已执行授权、signal、proposal", "Hook 已校验 LP action", "npm run verify:live 可复现验证"],
    };
  }

  return {
    title: `${opportunity.pair} ${opportunity.strategy} Agent Plan`,
    summary: `I converted the intent into a ${opportunity.strategy} LP strategy for ${opportunity.pair}: use at most ${maxCapitalBps / 100}% capital, allow no more than ${maxDailyActions} daily actions, and keep risk at ${risk}. Agentic Wallet executes; the Vault and Hook enforce the boundaries onchain.`,
    strategy: opportunity.strategy,
    risk,
    pool: opportunity.pair,
    maxCapitalBps,
    minRangeWidth,
    maxDailyActions,
    autoMode,
    actions: ["Read Agentic Wallet assets", "Authorize the selected Pool policy", "Report Hook risk and fee signal", "Submit LP management proposal", "Execute only after security scan"],
    boundaries: [
      `Only PoolId ${short(PUBLIC_PROOF.poolId)}`,
      `Capital cap ${maxCapitalBps / 100}%`,
      `LP range width at least ${minRangeWidth} ticks`,
      `Max ${maxDailyActions} daily actions`,
      "Replay-protected actionId; policy violations revert",
    ],
    proof: ["Agentic Wallet executed authorization, signal, and proposal", "Hook validated the LP action", "npm run verify:live reproduces the proof"],
  };
}

function normalizePlan(plan: Partial<AgentPlan>, opportunity: Opportunity, language: Language): AgentPlan {
  const fallback = buildAgentPlan("", opportunity, language);
  return {
    ...fallback,
    ...plan,
    strategy: plan.strategy ?? fallback.strategy,
    risk: plan.risk ?? fallback.risk,
    actions: Array.isArray(plan.actions) && plan.actions.length ? plan.actions : fallback.actions,
    boundaries: Array.isArray(plan.boundaries) && plan.boundaries.length ? plan.boundaries : fallback.boundaries,
    proof: Array.isArray(plan.proof) && plan.proof.length ? plan.proof : fallback.proof,
  };
}

function ProgressItem({ label, done, detail }: { label: string; done: boolean; detail: string }) {
  return (
    <div className={done ? "progress-item done" : "progress-item"}>
      <CheckCircle2 size={18} />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function PlanList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="plan-list">
      <h3>{title}</h3>
      {items.map((item) => (
        <div key={item}>
          <CheckCircle2 size={16} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function PathNode({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="path-node">
      <span>{label}</span>
      <strong>{detail}</strong>
    </div>
  );
}

function StrategyCard({
  opportunity,
  selected,
  authorized,
  language,
  onSelect,
}: {
  opportunity: Opportunity;
  selected: boolean;
  authorized: boolean;
  language: Language;
  onSelect: () => void;
}) {
  const c = COPY[language];
  const text = opportunityText(opportunity, language);
  const risk = riskLabel(opportunity);
  return (
    <button className={selected ? "strategy-card selected" : "strategy-card"} onClick={onSelect}>
      <span>{text.strategy}</span>
      <strong>{text.title}</strong>
      <small>{text.thesis}</small>
      <div className="strategy-meta">
        <b>{scoreOpportunity(opportunity)}</b>
        <em>{c.risk[risk]}</em>
        <em>{authorized ? c.opportunityStatus.authorized : c.opportunityStatus.pending}</em>
      </div>
    </button>
  );
}

function PermissionList({ title, items, positive = false }: { title: string; items: readonly string[]; positive?: boolean }) {
  return (
    <div className={positive ? "permission-list positive" : "permission-list"}>
      <h3>{title}</h3>
      {items.map((item) => (
        <div key={item}>
          <CheckCircle2 size={16} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function KeyValue({ label, value, link = false }: { label: string; value: string; link?: boolean }) {
  return (
    <div className="kv">
      <span>{label}</span>
      {link ? (
        <a href={value} target="_blank" rel="noreferrer">
          {short(value)} <ExternalLink size={13} />
        </a>
      ) : (
        <code>{value}</code>
      )}
    </div>
  );
}
