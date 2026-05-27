// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {CurrencyLibrary, Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

import {BaseScript} from "./base/BaseScript.sol";
import {LiquidityHelpers} from "./base/LiquidityHelpers.sol";

import {AgentTreasuryHook} from "../src/AgentTreasuryHook.sol";

contract AddLiquidityScript is BaseScript, LiquidityHelpers {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    /////////////////////////////////////
    // --- Configure These ---
    /////////////////////////////////////

    uint24 lpFee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 tickSpacing = 60;

    // --- liquidity position configuration --- //
    uint256 public token0Amount = 1e18;
    uint256 public token1Amount = 1e18;

    /////////////////////////////////////

    int24 tickLower;
    int24 tickUpper;

    function run() external {
        PoolKey memory poolKey = PoolKey({
            currency0: currency0, currency1: currency1, fee: lpFee, tickSpacing: tickSpacing, hooks: hookContract
        });
        bytes memory hookData = _agentTreasuryHookData();

        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());

        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);

        tickLower = truncateTickSpacing((currentTick - 1000 * tickSpacing), tickSpacing);
        tickUpper = truncateTickSpacing((currentTick + 1000 * tickSpacing), tickSpacing);

        // Converts token amounts to liquidity units
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            token0Amount,
            token1Amount
        );

        // slippage limits
        uint256 amount0Max = token0Amount + 1 wei;
        uint256 amount1Max = token1Amount + 1 wei;

        (bytes memory actions, bytes[] memory mintParams) = _mintLiquidityParams(
            poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, deployerAddress, hookData
        );

        // multicall parameters
        bytes[] memory params = new bytes[](1);

        // Mint Liquidity
        params[0] = abi.encodeWithSelector(
            positionManager.modifyLiquidities.selector, abi.encode(actions, mintParams), block.timestamp + 60
        );

        // If the pool is an ETH pair, native tokens are to be transferred
        uint256 valueToPass = currency0.isAddressZero() ? amount0Max : 0;

        vm.startBroadcast();
        tokenApprovals();

        // Add liquidity to existing pool
        positionManager.multicall{value: valueToPass}(params);
        vm.stopBroadcast();
    }

    function _agentTreasuryHookData() internal view returns (bytes memory) {
        address vault = vm.envOr("VAULT_ADDRESS", address(0));
        if (vault == address(0)) {
            return new bytes(0);
        }

        uint256 capitalBps = vm.envOr("CAPITAL_BPS", uint256(1000));
        require(capitalBps <= type(uint16).max, "CAPITAL_BPS too large");

        bytes32 actionId =
            vm.envOr("ACTION_ID", keccak256(abi.encodePacked(block.chainid, deployerAddress, block.timestamp)));
        return abi.encode(
            AgentTreasuryHook.TreasuryHookData({vault: vault, actionId: actionId, capitalBps: uint16(capitalBps)})
        );
    }
}
