import { encodeAbiParameters, getAddress, isAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";

import { DEFAULTS } from "./contracts";

export type StrategyMode = "Conservative" | "Balanced" | "Aggressive";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type Opportunity = {
  id: string;
  title: string;
  pair: string;
  token0: Address;
  token1: Address;
  volume24h: number;
  tvl: number;
  feeApr: number;
  volatility: number;
  concentrationRisk: number;
  strategy: StrategyMode;
  recommendedRangeBps: number;
  maxCapitalBps: number;
  minRangeWidth: number;
  maxDailyActions: number;
  autoMode: boolean;
  thesis: string;
};

export function safeAddress(value: string, fallback = DEFAULTS.hook): Address {
  return isAddress(value) ? getAddress(value) : fallback;
}

export function sortCurrencies(tokenA: string, tokenB: string): [Address, Address] {
  const a = safeAddress(tokenA);
  const b = safeAddress(tokenB);
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

export function buildPoolKey(tokenA: string, tokenB: string, hook: string): PoolKey {
  const [currency0, currency1] = sortCurrencies(tokenA, tokenB);
  return {
    currency0,
    currency1,
    fee: DEFAULTS.dynamicFee,
    tickSpacing: DEFAULTS.tickSpacing,
    hooks: safeAddress(hook),
  };
}

export function poolIdFor(key: PoolKey): Hex {
  const encoded = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
    ],
    [key],
  );
  return keccak256(encoded);
}

export function actionIdFor(opportunityId: string, address: string): Hex {
  return keccak256(stringToBytes(`${opportunityId}:${address}:${Date.now()}`));
}

export function opportunityIdFor(opportunity: Opportunity): Hex {
  return keccak256(stringToBytes(opportunity.id));
}

export function scoreOpportunity(opportunity: Opportunity): number {
  const volumeScore = Math.min(100, opportunity.volume24h / 12_000);
  const liquidityScore = Math.min(100, opportunity.tvl / 35_000);
  const aprScore = Math.min(100, opportunity.feeApr * 2.8);
  const volatilityPenalty = Math.min(45, opportunity.volatility * 0.9);
  const concentrationPenalty = Math.min(30, opportunity.concentrationRisk * 0.8);
  return Math.max(
    0,
    Math.round(aprScore * 0.35 + volumeScore * 0.25 + liquidityScore * 0.2 - volatilityPenalty * 0.15 - concentrationPenalty * 0.05),
  );
}

export function riskLabel(opportunity: Opportunity): "Low" | "Medium" | "High" {
  const risk = opportunity.volatility * 0.7 + opportunity.concentrationRisk * 0.3;
  if (risk < 28) return "Low";
  if (risk < 58) return "Medium";
  return "High";
}

export function strategyIndex(strategy: StrategyMode): number {
  if (strategy === "Conservative") return 0;
  if (strategy === "Balanced") return 1;
  return 2;
}

export function makeOpportunities(token0: string, token1: string): Opportunity[] {
  const [currency0, currency1] = sortCurrencies(token0, token1);
  return [
    {
      id: "agent-demo-balanced",
      title: "Agent Treasury Demo Pool",
      pair: "aiUSD / gFLOW",
      token0: currency0,
      token1: currency1,
      volume24h: 820_000,
      tvl: 1_250_000,
      feeApr: 18.4,
      volatility: 32,
      concentrationRisk: 22,
      strategy: "Balanced",
      recommendedRangeBps: 800,
      maxCapitalBps: 3000,
      minRangeWidth: 600,
      maxDailyActions: 3,
      autoMode: true,
      thesis: "Balanced LP opportunity for the hackathon demo pair. Good enough volume, moderate range, limited treasury exposure.",
    },
    {
      id: "agent-conservative-wide",
      title: "Conservative Wide-Range LP",
      pair: "aiUSD / gFLOW",
      token0: currency0,
      token1: currency1,
      volume24h: 410_000,
      tvl: 1_800_000,
      feeApr: 9.8,
      volatility: 18,
      concentrationRisk: 16,
      strategy: "Conservative",
      recommendedRangeBps: 1800,
      maxCapitalBps: 1800,
      minRangeWidth: 1200,
      maxDailyActions: 2,
      autoMode: false,
      thesis: "Lower return target, wider range, fewer rebalances. Best default for first-time user treasury authorization.",
    },
    {
      id: "agent-aggressive-fees",
      title: "Aggressive Fee Capture",
      pair: "aiUSD / gFLOW",
      token0: currency0,
      token1: currency1,
      volume24h: 1_120_000,
      tvl: 640_000,
      feeApr: 31.6,
      volatility: 68,
      concentrationRisk: 44,
      strategy: "Aggressive",
      recommendedRangeBps: 360,
      maxCapitalBps: 1500,
      minRangeWidth: 300,
      maxDailyActions: 6,
      autoMode: false,
      thesis: "High fee target but high volatility. The Agent can propose it, but user approval and tighter capital caps are required.",
    },
  ];
}

export function explorerTx(hash: Hex): string {
  return `https://www.okx.com/web3/explorer/xlayer/tx/${hash}`;
}
