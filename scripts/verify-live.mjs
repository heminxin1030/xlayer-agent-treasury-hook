#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { decodeFunctionResult, encodeFunctionData, getAddress } from "viem";

const manifestPath = process.env.DEPLOYMENT_MANIFEST || "deployment/xlayer-mainnet.review.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const rpcUrl = process.env.X_LAYER_RPC_URL || manifest.chain?.rpcUrl || "https://rpc.xlayer.tech";

const requiredAddresses = [
  ["project.hookAddress", manifest.project?.hookAddress],
  ["project.treasuryVaultAddress", manifest.project?.treasuryVaultAddress],
  ["project.token0", manifest.project?.token0],
  ["project.token1", manifest.project?.token1],
  ["uniswapV4.poolManager", manifest.uniswapV4?.poolManager],
  ["uniswapV4.positionManager", manifest.uniswapV4?.positionManager],
];

const proofTxs = [
  ["project.hookDeployTx", manifest.project?.hookDeployTx],
  ["project.vaultDeployTx", manifest.project?.vaultDeployTx],
  ["project.poolInitializeTx", manifest.project?.poolInitializeTx],
  ["project.initialLiquidityTx", manifest.project?.initialLiquidityTx],
  ["project.poolAuthorizationTx", manifest.project?.poolAuthorizationTx],
  ["project.opportunitySignalTx", manifest.project?.opportunitySignalTx],
  ["project.agentProposalTx", manifest.project?.agentProposalTx],
  ["project.agentLiquidityActionTx", manifest.project?.agentLiquidityActionTx],
];

function isAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isTx(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message || JSON.stringify(payload.error)}`);
  return payload.result;
}

async function call(address, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc("eth_call", [{ to: address, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: result });
}

const missingAddresses = requiredAddresses.filter(([, value]) => !isAddress(value));
const missingProofTxs = proofTxs.filter(([, value]) => !isTx(value));

if (missingAddresses.length || missingProofTxs.length) {
  console.error("Live verification cannot run yet. Missing deployment proof fields:");
  missingAddresses.forEach(([name]) => console.error(`- ${name}`));
  missingProofTxs.forEach(([name]) => console.error(`- ${name}`));
  process.exit(1);
}

const hookFlags = Number(BigInt(manifest.project.hookAddress) & 0x3fffn);
const expectedHookFlags = 0x1ac0;
if (hookFlags !== expectedHookFlags) {
  console.error(`Hook address permission bits mismatch: got 0x${hookFlags.toString(16)}, expected 0x${expectedHookFlags.toString(16)}`);
  process.exit(1);
}

for (const [name, address] of requiredAddresses) {
  const code = await rpc("eth_getCode", [address, "latest"]);
  if (!code || code === "0x") {
    console.error(`${name} has no bytecode at ${address}`);
    process.exit(1);
  }
  console.log(`✓ ${name} bytecode exists at ${address}`);
}

for (const [name, txHash] of proofTxs) {
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
  if (!receipt) {
    console.error(`${name} receipt not found: ${txHash}`);
    process.exit(1);
  }
  if (receipt.status !== "0x1") {
    console.error(`${name} failed onchain: ${txHash}`);
    process.exit(1);
  }
  console.log(`✓ ${name} succeeded: ${txHash}`);
}

const hookReadAbi = [
  { type: "function", name: "signalReporter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "poolSignals",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint16" }, { type: "uint24" }, { type: "uint64" }, { type: "bytes32" }],
  },
  {
    type: "function",
    name: "treasuryActionCount",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
];

const vaultReadAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "agent", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "hook", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "executedActions", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "poolPolicies",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { type: "bool" },
      { type: "bool" },
      { type: "address" },
      { type: "address" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint8" },
      { type: "uint8" },
      { type: "uint64" },
    ],
  },
];

const agent = getAddress(manifest.project.agentAddress);
const hook = getAddress(manifest.project.hookAddress);
const vault = getAddress(manifest.project.treasuryVaultAddress);
const signalReporter = getAddress(await call(hook, hookReadAbi, "signalReporter"));
if (signalReporter !== agent) {
  console.error(`Hook signalReporter mismatch: got ${signalReporter}, expected ${agent}`);
  process.exit(1);
}
console.log(`✓ Hook signalReporter is Agentic Wallet: ${signalReporter}`);

const [riskScore, feeOverride] = await call(hook, hookReadAbi, "poolSignals", [manifest.project.poolId]);
if (Number(riskScore) !== 37 || Number(feeOverride) !== 2500) {
  console.error(`Hook signal mismatch: risk=${riskScore}, fee=${feeOverride}`);
  process.exit(1);
}
console.log(`✓ Hook signal stored: risk=${riskScore}, feeOverride=${feeOverride}`);

const treasuryActionCount = await call(hook, hookReadAbi, "treasuryActionCount", [manifest.project.poolId]);
if (treasuryActionCount < 1n) {
  console.error("Hook treasuryActionCount was not incremented");
  process.exit(1);
}
console.log(`✓ Hook treasury action count: ${treasuryActionCount}`);

const vaultOwner = getAddress(await call(vault, vaultReadAbi, "owner"));
const vaultAgent = getAddress(await call(vault, vaultReadAbi, "agent"));
const vaultHook = getAddress(await call(vault, vaultReadAbi, "hook"));
if (vaultOwner !== agent || vaultAgent !== agent || vaultHook !== hook) {
  console.error(`Vault binding mismatch: owner=${vaultOwner}, agent=${vaultAgent}, hook=${vaultHook}`);
  process.exit(1);
}
console.log("✓ Vault owner and agent are Agentic Wallet, and Vault is bound to Hook");

const policy = await call(vault, vaultReadAbi, "poolPolicies", [manifest.project.poolId]);
if (!policy[0] || getAddress(policy[2]) !== getAddress(manifest.project.token0) || getAddress(policy[3]) !== getAddress(manifest.project.token1)) {
  console.error("Vault pool policy was not authorized as expected");
  process.exit(1);
}
console.log(`✓ Vault pool policy authorized: maxCapitalBps=${policy[4]}, minRangeWidth=${policy[5]}, maxDailyActions=${policy[6]}`);

if (!manifest.project.actionId) {
  console.error("Missing project.actionId for executed action verification");
  process.exit(1);
}
const executed = await call(vault, vaultReadAbi, "executedActions", [manifest.project.actionId]);
if (!executed) {
  console.error("Vault actionId was not marked executed");
  process.exit(1);
}
console.log(`✓ Vault actionId executed: ${manifest.project.actionId}`);

console.log("Live X Layer proof passed.");
