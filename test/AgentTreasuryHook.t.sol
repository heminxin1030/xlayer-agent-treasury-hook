// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";

import {EasyPosm} from "./utils/libraries/EasyPosm.sol";

import {AgentTreasuryHook} from "../src/AgentTreasuryHook.sol";
import {AgentTreasuryVault} from "../src/AgentTreasuryVault.sol";
import {BaseTest} from "./utils/BaseTest.sol";

contract AgentTreasuryHookTest is BaseTest {
    using EasyPosm for IPositionManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    Currency currency0;
    Currency currency1;

    PoolKey poolKey;
    AgentTreasuryHook hook;
    AgentTreasuryVault vault;
    PoolId poolId;

    uint256 tokenId;
    int24 tickLower;
    int24 tickUpper;

    function setUp() public {
        deployArtifactsAndLabel();

        (currency0, currency1) = deployCurrencyPair();

        address flags = address(
            uint160(
                Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
                    | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
            ) ^ (0xA677 << 144)
        );
        bytes memory constructorArgs = abi.encode(poolManager, address(this));
        deployCodeTo("AgentTreasuryHook.sol:AgentTreasuryHook", constructorArgs, flags);
        hook = AgentTreasuryHook(flags);
        vault = new AgentTreasuryVault(address(this), address(this), address(hook));

        poolKey = PoolKey(currency0, currency1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(hook));
        poolId = poolKey.toId();
        poolManager.initialize(poolKey, Constants.SQRT_PRICE_1_1);

        tickLower = TickMath.minUsableTick(poolKey.tickSpacing);
        tickUpper = TickMath.maxUsableTick(poolKey.tickSpacing);

        vault.authorizePool(
            PoolId.unwrap(poolId),
            Currency.unwrap(currency0),
            Currency.unwrap(currency1),
            AgentTreasuryVault.StrategyMode.Balanced,
            3000,
            600,
            3,
            true
        );

        uint128 liquidityAmount = 100e18;

        (uint256 amount0Expected, uint256 amount1Expected) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityAmount
        );

        (tokenId,) = positionManager.mint(
            poolKey,
            tickLower,
            tickUpper,
            liquidityAmount,
            amount0Expected + 1,
            amount1Expected + 1,
            address(this),
            block.timestamp,
            Constants.ZERO_BYTES
        );
    }

    function testManualLiquidityAndSwapWorks() public {
        assertEq(hook.treasuryActionCount(poolId), 0);

        BalanceDelta swapDelta = _swap(true, 1e18);

        assertEq(int256(swapDelta.amount0()), -1e18);
        assertEq(hook.lastFee(poolId), hook.BASE_FEE());
        assertEq(hook.swapCount(poolId), 1);
    }

    function testSignalReporterCanUpdateOpportunityFee() public {
        hook.reportOpportunity(poolKey, keccak256("okb-usdt-balanced"), 82, 12_000);

        _swap(true, 1e18);

        assertEq(hook.lastFee(poolId), 12_000);
    }

    function testTreasuryHookDataAllowsAuthorizedLiquidityAction() public {
        bytes memory hookData = abi.encode(
            AgentTreasuryHook.TreasuryHookData({
                vault: address(vault), actionId: keccak256("rebalance-1"), capitalBps: 1500
            })
        );

        uint128 liquidityAmount = 1e18;
        (uint256 amount0Expected, uint256 amount1Expected) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            liquidityAmount
        );

        positionManager.mint(
            poolKey,
            tickLower,
            tickUpper,
            liquidityAmount,
            amount0Expected + 1,
            amount1Expected + 1,
            address(this),
            block.timestamp,
            hookData
        );

        assertEq(hook.treasuryActionCount(poolId), 1);
        assertEq(vault.actionCount(PoolId.unwrap(poolId)), 1);
        assertTrue(vault.executedActions(keccak256("rebalance-1")));
    }

    function testTreasuryHookDataRejectsTooMuchCapital() public {
        bytes memory hookData = abi.encode(
            AgentTreasuryHook.TreasuryHookData({
                vault: address(vault), actionId: keccak256("rebalance-too-large"), capitalBps: 5000
            })
        );

        vm.expectRevert();
        vm.prank(address(poolManager));
        hook.beforeAddLiquidity(
            address(positionManager),
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 1e18, salt: 0}),
            hookData
        );
    }

    function testTreasuryHookDataRejectsReplayedAction() public {
        bytes32 actionId = keccak256("rebalance-replay");
        bytes memory hookData = abi.encode(
            AgentTreasuryHook.TreasuryHookData({vault: address(vault), actionId: actionId, capitalBps: 1500})
        );

        vm.prank(address(poolManager));
        hook.beforeAddLiquidity(
            address(positionManager),
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 1e18, salt: 0}),
            hookData
        );

        vm.expectRevert(AgentTreasuryVault.ActionAlreadyExecuted.selector);
        vm.prank(address(poolManager));
        hook.beforeAddLiquidity(
            address(positionManager),
            poolKey,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 1e18, salt: 0}),
            hookData
        );
    }

    function testVaultRejectsNarrowRangeProposal() public {
        vm.expectRevert(AgentTreasuryVault.RangeTooNarrow.selector);
        vault.submitProposal(keccak256("bad-range"), PoolId.unwrap(poolId), 0, 60, 1000, "too narrow");
    }

    function testVaultCountsDailyActions() public {
        vault.executeTreasuryAction(keccak256("a1"), PoolId.unwrap(poolId), -600, 600, 1000, address(0), 0, "");
        vault.executeTreasuryAction(keccak256("a2"), PoolId.unwrap(poolId), -600, 600, 1000, address(0), 0, "");
        vault.executeTreasuryAction(keccak256("a3"), PoolId.unwrap(poolId), -600, 600, 1000, address(0), 0, "");

        vm.expectRevert(AgentTreasuryVault.DailyLimitExceeded.selector);
        vault.executeTreasuryAction(keccak256("a4"), PoolId.unwrap(poolId), -600, 600, 1000, address(0), 0, "");
    }

    function _swap(bool zeroForOne, uint256 amountIn) internal returns (BalanceDelta) {
        return swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: 0,
            zeroForOne: zeroForOne,
            poolKey: poolKey,
            hookData: Constants.ZERO_BYTES,
            receiver: address(this),
            deadline: block.timestamp + 1
        });
    }
}
