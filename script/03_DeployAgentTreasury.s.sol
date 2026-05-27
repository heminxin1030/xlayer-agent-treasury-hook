// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2, Script} from "forge-std/Script.sol";

import {AgentTreasuryVault} from "../src/AgentTreasuryVault.sol";

/// @notice Deploys a user-owned Agent Treasury vault.
contract DeployAgentTreasuryScript is Script {
    function run() external {
        address owner = vm.envOr("TREASURY_OWNER", _getDeployer());
        address agent = vm.envOr("AGENT_ADDRESS", owner);
        address hook = vm.envAddress("HOOK_ADDRESS");

        vm.startBroadcast();
        AgentTreasuryVault vault = new AgentTreasuryVault(owner, agent, hook);
        vm.stopBroadcast();

        console2.log("Agent Treasury Vault:", address(vault));
        console2.log("Owner:", owner);
        console2.log("Agent:", agent);
        console2.log("Hook:", hook);
    }

    function _getDeployer() internal returns (address) {
        address[] memory wallets = vm.getWallets();
        return wallets.length > 0 ? wallets[0] : msg.sender;
    }
}
