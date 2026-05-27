# Build X Hackathon Submission Draft

## Project Name

AI Agent Treasury Hook

## Short Description

AI Agent Treasury Hook lets an OKX/X Layer user fund an Agentic Wallet, authorize selected Uniswap v4 LP opportunities, and let that Agentic Wallet manage liquidity only inside Hook-enforced risk limits.

## Problem

Agentic wallets can hold assets and make decisions, but they usually cannot manage LP capital safely. If an Agent can move funds freely, users face uncontrolled loss, overtrading, and bad pool selection. If the Agent can only suggest actions offchain, the product becomes a dashboard instead of an onchain primitive.

The missing piece is a pool-level execution boundary: the Agent should discover and propose LP opportunities, while the Hook and Vault enforce what the Agent is allowed to do.

## Solution

AI Agent Treasury Hook creates a bounded Agent LP manager:

- User funds the Agentic Wallet receive address from OKX Wallet, an exchange, or another wallet.
- The app displays Agentic Wallet funds on X Layer, including OKB gas and usable ERC20 assets.
- Agent discovers LP opportunities and ranks them by volume, TVL, fee APR, volatility, and concentration risk.
- User authorizes a specific v4 pool with limits: max capital bps, minimum LP range width, max daily actions, strategy mode, and manual/autopilot mode.
- Agentic Wallet prepares approve, deposit, authorization, signal, and proposal calls.
- Each prepared call can be scanned with OKX security `tx-scan` before execution.
- AgentTreasuryVault checks pool policy, action uniqueness, daily quota, pause state, and allowed target.
- AgentTreasuryHook checks the same policy during v4 liquidity callbacks, so direct LP actions with Agent hookData cannot bypass the Vault limits.
- Hook signal reporter can update pool risk and dynamic fee override for swap flow.

## Why It Is Innovative

This is not another dynamic-fee Hook. The Hook is the execution layer for an Agent-owned treasury workflow.

The core idea is that Agentic Wallets should not only swap tokens. They should be able to manage productive DeFi positions under user-approved onchain constraints. If this model works, it becomes a new X Layer entry point: users fund an Agentic Wallet, authorize a pool, and let Agents operate within visible Hook rules.

## Market Potential

First users:

- OKX Wallet users who want managed LP exposure while keeping Agent permissions bounded.
- Agentic Wallet builders that need safe onchain execution boundaries.
- X Layer DeFi projects that want more LP capital and more Agent-driven activity.
- Strategy marketplaces that want proposals, execution limits, and proof logs in one flow.

Longer term, the same pattern can support multiple Agent strategies: stablecoin ranges, meme launch pools, volatility capture, treasury buybacks, and protocol-owned liquidity.

## Technical Stack

- Uniswap v4 PoolManager, PoolKey, dynamic fee flag, and liquidity callbacks.
- OpenZeppelin Uniswap Hooks `BaseHook`.
- Solidity `AgentTreasuryHook` and `AgentTreasuryVault`.
- Foundry tests and deployment scripts.
- React + Vite + viem app.
- Chinese/English guided operator UI with Agentic Wallet-only connection, receive address, funds display, asset picker, imported-token balances, prepared actions, security scan, and advanced deployment details hidden by default.
- OKX Agentic Wallet CLI bridge for status, balances, `tx-scan`, and optional `wallet contract-call`.
- X Layer mainnet, chain ID `196`.

## Agent And Hook Strategy

The MVP does not need an LLM to hold keys or directly move funds. The LLM is an offchain strategy analyst that explains and ranks LP opportunities. Execution is deterministic:

- Vault policy authorizes a specific pool.
- Hook enforces pool id, capital cap, min range width, daily action count, and replay protection.
- Dynamic fee is adjusted by a bounded reporter signal, not by free-form text output.
- Agentic Wallet executes only the prepared calldata the user chooses to authorize.

## Demo Plan

1. Run `npm run test:all`.
2. Open the app and show the OKX-style console.
3. Start `npm run agentic:bridge` and connect Agentic Wallet.
4. Show Agentic Wallet receive address and funds display.
5. Fund the Agentic Wallet with tiny test assets if needed.
6. Show demo token pair, Hook, Vault, Agent address, and pool id.
7. Prepare ERC20 approval and Vault deposit calldata, run `tx-scan`, then execute through Agentic Wallet only in write mode.
8. Select an LP opportunity and prepare pool policy authorization.
9. Prepare Hook signal and Agent rebalance proposal.
10. Show explorer links and emitted events in the proof log.

## Required Links

- GitHub repository: pending owner approval.
- Hook contract on X Layer: pending owner approval.
- Treasury Vault on X Layer: pending owner approval.
- Demo token pair on X Layer: pending owner approval.
- V4 pool initialize tx: pending owner approval.
- Treasury funding txs: pending owner approval.
- Pool authorization tx: pending owner approval.
- Hook signal tx: pending owner approval.
- Agent proposal / liquidity tx: pending owner approval.
- Demo video: pending owner approval.
- X thread: pending owner approval.

## One-Liner For X

Built for Build X: AI Agent Treasury Hook turns OKX Agentic Wallet funds into user-approved Agent LP treasuries on X Layer, with Uniswap v4 Hook enforcement for pool selection, capital caps, range width, daily action limits, and dynamic fee signals.
