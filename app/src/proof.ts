export const PUBLIC_PROOF = {
  hookAddress: "0x0399aa2C8e39aAC071A5ce36ef4a6502492A1aC0",
  vaultAddress: "0x4CE73a41011B8C24A970BD6728C30090CF82f5a5",
  agentAddress: "0xB806498D8bB4172E30F3921fa930573ba5BF9FB8",
  token0: "0x776bFCc40Fb3d226008e9E673F80bbbaD60a6B82",
  token1: "0xd96cd09862171cC0A24F34915445069993354753",
  poolId: "0x71c6d1a391493f9e73a64e8256cc39b134e57b2042178272f1b59e02c01dea50",
  actionId: "0x57f1b8b4ef7380c57a96c33845f92f58e6f59d398d48b4a5956243c868a06dd0",
  proofTxs: [
    {
      label: "Hook deploy",
      hash: "0x0a9557596145b8bfcf2f1e94244475537c187ec3ffb914c453c925c9314f4a6c",
    },
    {
      label: "Vault deploy",
      hash: "0x0b5058260fb9f55346ca2fd788eca925862b4c858b64c5a6247a87867d212574",
    },
    {
      label: "Pool initialize + initial liquidity",
      hash: "0xda1c6d68456f4693d7377d6f96bcf2a7de50e6e71b4aaa32c61a5cf57cdfb500",
    },
    {
      label: "Agentic Wallet pool authorization",
      hash: "0xd03e1816d33fc8da51c788b8131841cc84a24a00363ab2d10d5e8cccd1c4fea4",
    },
    {
      label: "Agentic Wallet Hook signal",
      hash: "0x778127126524bef07aad0c8da5ee62c97264561bc5bc55c63783e9879c6f3754",
    },
    {
      label: "Agentic Wallet proposal",
      hash: "0x040fa1f4516568e6cb06fa4c8e28c10d3efa04666b1e81633a6f332874025378",
    },
    {
      label: "Hook-validated LP action",
      hash: "0x357651309319b38b2c7c454bd6db776f1b71637908f3cc0b407ead5c22f8a011",
    },
  ],
} as const;

export function explorerAddress(address: string) {
  return `https://www.okx.com/web3/explorer/xlayer/address/${address}`;
}

