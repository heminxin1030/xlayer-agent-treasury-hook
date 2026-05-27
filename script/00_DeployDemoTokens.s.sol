// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2, Script} from "forge-std/Script.sol";

import {MockAgentToken} from "../src/MockAgentToken.sol";

/// @notice Deploys two ERC-20 demo tokens for the X Layer v4 pool.
contract DeployDemoTokensScript is Script {
    function run() external {
        address deployer = _getDeployer();
        uint256 initialSupply = vm.envOr("DEMO_TOKEN_SUPPLY", uint256(1_000_000 ether));

        vm.startBroadcast();
        MockAgentToken tokenA = new MockAgentToken("Agentic Intent USD", "aiUSD", deployer, initialSupply);
        MockAgentToken tokenB = new MockAgentToken("Guarded Flow Token", "gFLOW", deployer, initialSupply);
        vm.stopBroadcast();

        console2.log("aiUSD:", address(tokenA));
        console2.log("gFLOW:", address(tokenB));

        if (address(tokenA) < address(tokenB)) {
            console2.log("TOKEN0:", address(tokenA));
            console2.log("TOKEN1:", address(tokenB));
        } else {
            console2.log("TOKEN0:", address(tokenB));
            console2.log("TOKEN1:", address(tokenA));
        }
    }

    function _getDeployer() internal returns (address) {
        address[] memory wallets = vm.getWallets();
        return wallets.length > 0 ? wallets[0] : msg.sender;
    }
}
