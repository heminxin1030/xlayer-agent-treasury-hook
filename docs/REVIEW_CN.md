# 本地审核说明

## 项目定位

项目名：AI Agent Treasury Hook

核心一句话：用户把资产转入 Agentic Wallet，Agentic Wallet / AI Agent 负责显示资金、发现 LP 机会、准备执行动作，Uniswap v4 Hook 和 Vault 在链上限制 Agent 只能在用户授权的池子、资金比例、价格区间和每日动作次数内执行。

这个方向比普通动态手续费、限价单、TWAP 更适合冲奖，因为它不是单纯优化交易，而是把 X Layer、OKX Wallet、Agentic Wallet、Uniswap v4 Hook 和 LP 资金管理串成了一个新的 AgentFi 入口。

## 用户能用它做什么

- 只连接 Agentic Wallet。
- 复制 Agentic Wallet 收款地址，从 OKX Wallet、交易所或其它钱包转入极小额测试资金。
- 查看 Agentic Wallet 在 X Layer 上的 OKB 和 ERC20 资金状况，知道有哪些资产可以交易。
- 部署或填入 demo token、Hook、Vault 地址。
- 由 Agentic Wallet 准备 ERC20 授权、Vault 入金、Pool 授权、Hook 信号和 Agent proposal。
- 每个动作先做安全扫描，再由用户决定是否让 Agentic Wallet 执行。
- 查看 Agent LP Opportunity Finder 给出的 LP 机会列表。
- 选择一个机会，授权这个 pool 的策略边界：
  - 最大资金比例。
  - 最小 LP range 宽度。
  - 每日最多执行次数。
  - Conservative / Balanced / Aggressive 策略模式。
  - 是否每次都要用户手动确认。
- 让 Agent 提交 rebalance proposal。
- 让 Hook 记录机会信号，并在 swap 时使用动态 fee。

## Agent 是不是自己管理资金

是，但不是无限制地管理。

资金路径是：

用户 OKX Wallet / 交易所 -> Agentic Wallet 收款地址 -> Agentic Wallet 显示资金 -> Treasury Vault -> 用户授权某个 pool -> Agent 提 proposal / 执行允许目标 -> Vault 检查策略 -> Uniswap v4 PositionManager -> Hook 再检查一次 -> 通过才允许 LP 动作。

Agent 不能随便找任意池子动钱。MVP 里 Agent 可以显示 LP 机会列表，用户主动选择授权。授权之后，Agent 才能对这个 pool 做加 LP、移除 LP、调区间、复投一类动作。

## 策略亏钱怎么办

策略当然可能亏钱，所以这个项目不是承诺收益，而是把 Agent 的权限限制在链上：

- 没授权的 pool 不能动。
- 超过资金比例不能动。
- LP 区间太窄不能动。
- 每日动作次数超限不能动。
- 重复 actionId 不能重放。
- Vault 可以暂停。
- 用户可以撤换 Agent。
- 用户可以提走 Vault 里的资金。

也就是说，Hook 不保证策略赚钱，但保证 Agent 不能越权执行。

## Agent 需要接入大模型吗

MVP 不要求大模型直接管钱。大模型最适合做链下策略分析员：

- 解释为什么推荐某个 LP 机会。
- 给机会打分和排序。
- 生成 proposal rationale。
- 帮用户理解风险和收益来源。

真正能动钱的部分不是大模型自由输出，而是确定性的 Vault + Hook 规则。这样既符合 AI Agent 叙事，又不会让评委觉得“AI 黑盒直接动钱”太危险。

## Hook 策略是什么

Hook 策略是链上硬规则：

- `poolId` 白名单，没授权的池子不能动。
- `maxCapitalBps` 限制最多使用多少资金。
- `minRangeWidth` 防止 Agent 把 LP 区间调得过窄。
- `maxDailyActions` 防止高频乱动。
- `actionId` 防重放。
- `manual/autopilot` 决定是否每次都需要用户确认。
- `reportOpportunity` 给池子上报风险和动态 fee 信号。

## 实际已经做了什么

- `AgentTreasuryHook.sol`
  - 支持 Uniswap v4 `beforeAddLiquidity` / `beforeRemoveLiquidity`。
  - 解析 Agent hookData。
  - 调 Vault 检查 pool policy。
  - 阻止重复 actionId。
  - 记录 Treasury LP action。
  - 支持 `beforeSwap` 动态 fee override。
  - 支持 signal reporter 上报机会风险和 fee。

- `AgentTreasuryVault.sol`
  - 用户拥有 Vault。
  - Agent 地址可配置。
  - Hook 地址可配置。
  - 支持 deposit / withdraw。
  - 支持授权 pool policy。
  - 支持 Agent proposal。
  - 支持执行 allowed target。
  - 支持 pause、每日动作限制、资金比例限制、range 宽度限制、action replay 防护。

- React 操作台
- 只支持 Agentic Wallet 连接。
- 钱包按钮二级菜单：连接、断开、刷新资产、复制收款地址。
- Agentic Wallet 资金状况显示：OKB gas 余额、Agentic Wallet ERC20 资产、导入资产余额。
- 中英语言切换。
- Agentic Wallet 资产选择菜单：显示 OKB 和已配置/导入 ERC20 的余额，充值时选择真实资产而不是 Token A/B。
- 本地 Agentic Wallet bridge 连接。
- 引导式流程：连接 Agentic Wallet、查看资金、选择 LP 策略、准备授权、扫描、执行。
- LP 策略卡片和评分。
- Pool 授权 calldata 准备。
- Hook signal calldata 准备。
- Agent proposal calldata 准备。
- Explorer proof log。

- 本地工具
  - `scripts/agentic-wallet-bridge.mjs` 读取 Agentic Wallet 状态、地址、资金状况，并支持 tx-scan。默认不签名、不广播；只有设置 `AGENTIC_BRIDGE_WRITE=1` 才开放真实 `contract-call`。
  - Foundry 部署脚本。
  - `deployment/xlayer-mainnet.review.json` 审核用部署 manifest。
  - `SUBMISSION.md` 活动提交草稿。

## 目前不会做的事

这些需要你审核通过后再执行：

- 不推 GitHub。
- 不提交 hackathon。
- 不连接浏览器注入钱包。
- 默认不使用 Agentic Wallet 签名或广播；真实执行需要你确认并开启 bridge write mode。
- 不部署 X Layer 主网合约。
- 不发 X/Twitter。

## 建议你重点审核

- 项目方向是否定为 AI Agent Treasury Hook。
- UI 是否像 OKX Wallet / X Layer 产品，而不是普通 demo 页面。
- 用户资金和 Agent 权限边界是否讲清楚。
- README / SUBMISSION 的叙事是否足够冲一、二等奖。
- 是否需要把 demo token 名称从 `aiUSD / gFLOW` 改成更 OKX 或 AgentFi 的名字。

## 通过审核后的下一步

1. 用 Foundry keystore 绑定部署地址。
2. 部署 demo tokens。
3. 部署 Hook。
4. 部署 Treasury Vault。
5. 创建 dynamic-fee v4 pool 并添加极小额 liquidity。
6. 启动 `npm run agentic:bridge`，打开本地 app，连接 Agentic Wallet。
7. 查看 Agentic Wallet 资金状况，确认有哪些资产可用。
8. 从 OKX Wallet / 交易所给 Agentic Wallet 转入极小额测试资产。
9. 在 app 准备 approve / deposit / authorize / signal / proposal。
10. 每个动作先 tx-scan，再决定是否开启 `AGENTIC_BRIDGE_WRITE=1` 执行。
11. 把所有地址和 tx 填进 `deployment/xlayer-mainnet.review.json`。
12. 你确认后再录视频、提交活动页面。
