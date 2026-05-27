# Judge Guide

AI Agent Treasury Hook is intended to be judged as an Agentic Wallet-native Uniswap v4 Hook project, not as a generic dashboard.

## 60-Second Judge Path

1. Open the app and connect OKX Agentic Wallet with email OTP.
2. Confirm the app reads the Agentic Wallet X Layer address and assets.
3. Inspect the deployed Hook, Treasury Vault, demo tokens, and PoolId in `deployment/xlayer-mainnet.review.json`.
4. Verify the Hook address permission bits and deployed bytecode:

```bash
npm run verify:live
```

5. Follow the proof ledger:
   - Hook deploy tx,
   - Vault deploy tx,
   - Pool initialize tx,
   - initial liquidity tx,
   - Treasury funding tx,
   - pool authorization tx,
   - Hook signal tx,
   - Agent proposal tx,
   - Agent liquidity action tx.

6. Confirm the Agentic Wallet proof:

```bash
npm run agentic:bridge:local
npm run proof:agentic
```

`deployment/agentic-wallet.proof.local.json` is local-only and gitignored because it contains the demo wallet address and live balances. The public submission should include a reviewed screenshot/video instead of this local file.

## What The Hook Proves

The project is not "AI says yes, money moves." The Agent proposes or executes only within deterministic onchain limits:

- selected `PoolId` allowlist,
- max capital basis points,
- minimum LP range width,
- max daily actions,
- replay-protected action ids,
- manual/autopilot policy mode,
- Hook-level liquidity callback enforcement.

## Live X Layer Proof

| Proof | Address / tx |
| --- | --- |
| Hook | `0x0399aa2C8e39aAC071A5ce36ef4a6502492A1aC0` |
| Treasury Vault | `0x4CE73a41011B8C24A970BD6728C30090CF82f5a5` |
| PoolId | `0x71c6d1a391493f9e73a64e8256cc39b134e57b2042178272f1b59e02c01dea50` |
| Pool initialize + initial liquidity | `0xda1c6d68456f4693d7377d6f96bcf2a7de50e6e71b4aaa32c61a5cf57cdfb500` |
| Agentic Wallet pool authorization | `0xd03e1816d33fc8da51c788b8131841cc84a24a00363ab2d10d5e8cccd1c4fea4` |
| Agentic Wallet Hook signal | `0x778127126524bef07aad0c8da5ee62c97264561bc5bc55c63783e9879c6f3754` |
| Agentic Wallet proposal | `0x040fa1f4516568e6cb06fa4c8e28c10d3efa04666b1e81633a6f332874025378` |
| Hook-validated LP action | `0x357651309319b38b2c7c454bd6db776f1b71637908f3cc0b407ead5c22f8a011` |

## Still Needed Before Final Submission

- Demo video showing Agentic Wallet login, asset read, security scan, and execution.
- Owner-reviewed X/Twitter post.
- Final owner approval for the hackathon form.

## Honest Scope

Agentic Wallet holds and executes user-approved actions. The Hook and Vault constrain what the Agent can do. The LLM is an offchain strategy analyst; the safety boundary is Solidity policy enforcement, not free-form model output.
