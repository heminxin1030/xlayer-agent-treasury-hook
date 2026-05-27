import type { Address } from "viem";

export const X_LAYER_CHAIN_ID = 196;
export const X_LAYER_CHAIN_ID_HEX = "0xc4";

export const X_LAYER = {
  id: X_LAYER_CHAIN_ID,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.xlayer.tech"] },
    public: { http: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"] },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.okx.com/web3/explorer/xlayer" },
  },
} as const;

export const DEFAULTS = {
  poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32" as Address,
  positionManager: "0xcF1EAFC6928dC385A342E7C6491d371d2871458b" as Address,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  hook: "0x0000000000000000000000000000000000000000" as Address,
  vault: "0x0000000000000000000000000000000000000000" as Address,
  token0: "0x0000000000000000000000000000000000000000" as Address,
  token1: "0x0000000000000000000000000000000000000000" as Address,
  dynamicFee: 0x800000,
  tickSpacing: 60,
};

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const VAULT_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizePool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "mode", type: "uint8" },
      { name: "maxCapitalBps", type: "uint16" },
      { name: "minRangeWidth", type: "uint16" },
      { name: "maxDailyActions", type: "uint8" },
      { name: "autoMode", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "submitProposal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "actionId", type: "bytes32" },
      { name: "poolId", type: "bytes32" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "capitalBps", type: "uint16" },
      { name: "rationale", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAllowedTarget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export const HOOK_ABI = [
  {
    type: "function",
    name: "reportOpportunity",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "opportunityId", type: "bytes32" },
      { name: "riskScore", type: "uint16" },
      { name: "feeOverride", type: "uint24" },
    ],
    outputs: [],
  },
] as const;
