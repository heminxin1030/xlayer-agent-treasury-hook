// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

interface IAgentTreasuryVault {
    function validateHookAction(bytes32 poolId, bytes32 actionId, int24 tickLower, int24 tickUpper, uint16 capitalBps)
        external
        returns (bool);
}

/// @notice Uniswap v4 hook that enforces user-approved AI Agent treasury LP policies.
contract AgentTreasuryHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    uint24 public constant BASE_FEE = 1500; // 0.15%
    uint24 public constant HIGH_RISK_FEE = 8000; // 0.80%
    uint24 public constant MAX_DEMO_FEE = 30_000; // 3.00%

    struct PoolSignal {
        uint16 riskScore;
        uint24 feeOverride;
        uint64 updatedAt;
        bytes32 opportunityId;
    }

    struct TreasuryHookData {
        address vault;
        bytes32 actionId;
        uint16 capitalBps;
    }

    address public signalReporter;

    mapping(PoolId poolId => PoolSignal signal) public poolSignals;
    mapping(PoolId poolId => uint256 count) public swapCount;
    mapping(PoolId poolId => uint256 count) public treasuryActionCount;
    mapping(PoolId poolId => uint24 fee) public lastFee;

    event SignalReporterUpdated(address indexed previousReporter, address indexed nextReporter);
    event OpportunitySignal(PoolId indexed poolId, bytes32 indexed opportunityId, uint16 riskScore, uint24 feeOverride);
    event TreasuryLiquidityAction(
        PoolId indexed poolId,
        address indexed vault,
        bytes32 indexed actionId,
        bool addLiquidity,
        int24 tickLower,
        int24 tickUpper,
        uint16 capitalBps
    );
    event ManualLiquidityAction(PoolId indexed poolId, address indexed sender, bool addLiquidity);
    event SwapObserved(PoolId indexed poolId, address indexed sender, uint24 fee, int128 amount0, int128 amount1);

    error NotDynamicFeePool();
    error NotSignalReporter();
    error FeeTooHigh();
    error InvalidTreasuryHookData();

    modifier onlySignalReporter() {
        if (msg.sender != signalReporter) revert NotSignalReporter();
        _;
    }

    constructor(IPoolManager _poolManager, address _signalReporter) BaseHook(_poolManager) {
        signalReporter = _signalReporter == address(0) ? msg.sender : _signalReporter;
        emit SignalReporterUpdated(address(0), signalReporter);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function setSignalReporter(address nextReporter) external onlySignalReporter {
        emit SignalReporterUpdated(signalReporter, nextReporter);
        signalReporter = nextReporter;
    }

    function reportOpportunity(PoolKey calldata key, bytes32 opportunityId, uint16 riskScore, uint24 feeOverride)
        external
        onlySignalReporter
    {
        if (feeOverride > MAX_DEMO_FEE) revert FeeTooHigh();
        PoolId poolId = key.toId();
        poolSignals[poolId] = PoolSignal({
            riskScore: riskScore,
            feeOverride: feeOverride,
            updatedAt: uint64(block.timestamp),
            opportunityId: opportunityId
        });

        emit OpportunitySignal(poolId, opportunityId, riskScore, feeOverride);
    }

    function _afterInitialize(address, PoolKey calldata key, uint160, int24) internal pure override returns (bytes4) {
        if (!key.fee.isDynamicFee()) revert NotDynamicFeePool();
        return BaseHook.afterInitialize.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();
        PoolSignal memory signal = poolSignals[poolId];
        uint24 fee = signal.feeOverride;
        if (fee == 0) {
            fee = signal.riskScore > 70 ? HIGH_RISK_FEE : BASE_FEE;
        }
        lastFee[poolId] = fee;

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId poolId = key.toId();
        swapCount[poolId]++;
        emit SwapObserved(poolId, sender, lastFee[poolId], delta.amount0(), delta.amount1());
        return (BaseHook.afterSwap.selector, 0);
    }

    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4) {
        _validateTreasuryAction(sender, key, params, hookData, true);
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4) {
        _validateTreasuryAction(sender, key, params, hookData, false);
        return BaseHook.beforeRemoveLiquidity.selector;
    }

    function _validateTreasuryAction(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData,
        bool addLiquidity
    ) internal {
        PoolId poolId = key.toId();

        if (hookData.length == 0) {
            emit ManualLiquidityAction(poolId, sender, addLiquidity);
            return;
        }

        TreasuryHookData memory data = abi.decode(hookData, (TreasuryHookData));
        if (data.vault == address(0) || data.actionId == bytes32(0) || data.capitalBps == 0) {
            revert InvalidTreasuryHookData();
        }

        IAgentTreasuryVault(data.vault)
            .validateHookAction(
                PoolId.unwrap(poolId), data.actionId, params.tickLower, params.tickUpper, data.capitalBps
            );

        treasuryActionCount[poolId]++;
        emit TreasuryLiquidityAction(
            poolId, data.vault, data.actionId, addLiquidity, params.tickLower, params.tickUpper, data.capitalBps
        );
    }
}
