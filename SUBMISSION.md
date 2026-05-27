# Build X Hackathon Submission Draft

## Project Name

AI Agent Treasury Hook

## Short Description

AI Agent Treasury Hook lets a user describe an LP treasury goal in natural language, lets OKX Agentic Wallet execute the resulting strategy, and uses a Uniswap v4 Hook/Vault policy layer to stop the Agent from exceeding user-approved risk limits.

## Problem

Agentic wallets can hold assets and make decisions, but they usually cannot manage LP capital safely. If an Agent can move funds freely, users face uncontrolled loss, overtrading, and bad pool selection. If the Agent can only suggest actions offchain, the product becomes a dashboard instead of an onchain primitive.

The missing piece is a pool-level execution boundary: the Agent should discover and propose LP opportunities, while the Hook and Vault enforce what the Agent is allowed to do.

## Solution

AI Agent Treasury Hook creates a bounded Agent LP manager:

- User describes a treasury goal in the Agent chat, such as low-risk LP, max 30% capital, and max 3 rebalances per day.
- The deterministic local Agent planner converts that sentence into a structured LP policy.
- User funds the Agentic Wallet receive address from OKX Wallet, an exchange, or another wallet.
- The app displays Agentic Wallet funds on X Layer, including OKB gas and usable ERC20 assets.
- Agent ranks LP opportunities by volume, TVL, fee APR, volatility, and concentration risk.
- User authorizes a specific v4 pool with limits: max capital bps, minimum LP range width, max daily actions, strategy mode, and manual/autopilot mode.
- Agentic Wallet prepares approve, deposit, authorization, signal, and proposal calls.
- Each prepared call can be scanned with OKX security `tx-scan` before execution.
- AgentTreasuryVault checks pool policy, action uniqueness, daily quota, pause state, and allowed target.
- AgentTreasuryHook checks the same policy during v4 liquidity callbacks, so direct LP actions with Agent hookData cannot bypass the Vault limits.
- Hook signal reporter can update pool risk and dynamic fee override for swap flow.

## Why It Is Innovative

This is not another dynamic-fee Hook. The Hook is the execution layer for a conversational Agent-owned treasury workflow.

The core idea is that Agentic Wallets are for Agents, not just humans clicking wallet buttons. Users should state goals; Agents should operate; Hooks should make those Agents governable. If this model works, it becomes a new X Layer entry point: users fund an Agentic Wallet, authorize a pool, and let Agents operate within visible Hook rules.

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
- React + Vite + viem conversational Agent app.
- Chinese/English Agent chat, deterministic local planner, structured LP policy card, execution path, live proof ledger, and advanced Agentic Wallet execution controls hidden by default.
- OKX Agentic Wallet CLI bridge for status, balances, `/agent/plan`, `/proof/live`, `tx-scan`, and optional `wallet contract-call`.
- X Layer mainnet, chain ID `196`.

## Agent And Hook Strategy

The MVP does not need an LLM to hold keys or directly move funds. The LLM is an offchain strategy analyst that explains and ranks LP opportunities. Execution is deterministic:

- Vault policy authorizes a specific pool.
- Hook enforces pool id, capital cap, min range width, daily action count, and replay protection.
- Dynamic fee is adjusted by a bounded reporter signal, not by free-form text output.
- Agentic Wallet executes only the prepared calldata the user chooses to authorize.

## Demo Plan

1. Run `npm run test:all`.
2. Open the app and show the conversational Agent treasury page.
3. Type a natural-language goal: low-risk gFLOW/aiUSD LP, max 30% capital, max 3 daily actions.
4. Show the generated Agent Plan, Hook boundaries, and execution path.
5. Start `npm run agentic:bridge:local` and connect Agentic Wallet.
6. Show Agentic Wallet receive address, funds display, and local proof.
7. Prepare strategy authorization, Hook signal, and Agent proposal from the plan.
8. Run `tx-scan`, then execute through Agentic Wallet only in write mode.
9. Show explorer links for the already completed mainnet authorization, signal, proposal, and Hook-validated LP action.
10. Run `npm run verify:live` to prove the onchain Hook/Vault state.

## Required Links

- GitHub repository: https://github.com/heminxin1030/xlayer-agent-treasury-hook
- Live app: https://heminxin1030.github.io/xlayer-agent-treasury-hook/
- Hook contract on X Layer: `0x0399aa2C8e39aAC071A5ce36ef4a6502492A1aC0`
- Treasury Vault on X Layer: `0x4CE73a41011B8C24A970BD6728C30090CF82f5a5`
- Demo token pair on X Layer: `0x776bFCc40Fb3d226008e9E673F80bbbaD60a6B82` / `0xd96cd09862171cC0A24F34915445069993354753`
- PoolId: `0x71c6d1a391493f9e73a64e8256cc39b134e57b2042178272f1b59e02c01dea50`
- V4 pool initialize + initial liquidity tx: `0xda1c6d68456f4693d7377d6f96bcf2a7de50e6e71b4aaa32c61a5cf57cdfb500`
- Pool authorization tx by Agentic Wallet: `0xd03e1816d33fc8da51c788b8131841cc84a24a00363ab2d10d5e8cccd1c4fea4`
- Hook signal tx by Agentic Wallet: `0x778127126524bef07aad0c8da5ee62c97264561bc5bc55c63783e9879c6f3754`
- Agent proposal tx by Agentic Wallet: `0x040fa1f4516568e6cb06fa4c8e28c10d3efa04666b1e81633a6f332874025378`
- Hook-validated liquidity action tx: `0x357651309319b38b2c7c454bd6db776f1b71637908f3cc0b407ead5c22f8a011`
- Demo video: pending owner approval.
- X thread: pending owner approval.

## One-Liner For X

Built for Build X: AI Agent Treasury Hook turns natural-language treasury goals into Agentic Wallet LP actions on X Layer, with Uniswap v4 Hook enforcement for pool selection, capital caps, range width, daily action limits, and dynamic fee signals.
