// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

import {BaseScript} from "./base/BaseScript.sol";

contract SwapScript is BaseScript {
    function run() external {
        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hookContract // This must match the pool
        });
        bytes memory hookData = vm.envOr("HOOK_DATA", bytes(""));
        uint256 amountIn = vm.envOr("AMOUNT_IN", uint256(1e18));
        uint256 amountOutMin = vm.envOr("AMOUNT_OUT_MIN", uint256(0));
        bool zeroForOne = vm.envOr("ZERO_FOR_ONE", true);

        require(address(swapRouter) != address(0), "SWAP_ROUTER required outside local tests");

        vm.startBroadcast();

        // We'll approve both, just for testing.
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(swapRouter), type(uint256).max);

        // Execute swap
        swapRouter.swapExactTokensForTokens({
            amountIn: amountIn,
            amountOutMin: amountOutMin,
            zeroForOne: zeroForOne,
            poolKey: poolKey,
            hookData: hookData,
            receiver: address(this),
            deadline: block.timestamp + 30
        });

        vm.stopBroadcast();
    }
}
