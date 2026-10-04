// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PasskeyCanary} from "../src/PasskeyCanary.sol";

/// forge script script/Deploy.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external returns (PasskeyCanary canary) {
        // Monad testnet blocks are about 0.3s, so 300 blocks leaves about 90s for Face ID and relay.
        uint256 maxAge = vm.envOr("MAX_CHALLENGE_AGE", uint256(300));
        vm.startBroadcast();
        canary = new PasskeyCanary(maxAge);
        vm.stopBroadcast();
        console.log("PasskeyCanary:", address(canary));
        console.log("maxChallengeAge:", maxAge);
    }
}
