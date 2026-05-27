// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";

import {V4RouterDeployer} from "hookmate/artifacts/V4Router.sol";

import {BaseScript} from "./base/BaseScript.sol";

/// @notice Deploys Hookmate's simple v4 router so the demo app can execute swaps with hookData.
contract DeployDemoRouterScript is BaseScript {
    function run() external {
        vm.startBroadcast();
        address router = V4RouterDeployer.deploy(address(poolManager), address(permit2));
        vm.stopBroadcast();

        console2.log("Hookmate V4 demo router:", router);
    }
}
