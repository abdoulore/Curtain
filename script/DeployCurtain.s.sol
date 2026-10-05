// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurtainFactory} from "../src/CurtainFactory.sol";
import {CurtainEvent} from "../src/CurtainEvent.sol";

/// Deploys the factory (paid by the relayer key) and one demo event created by the organizer key, with the gate
/// key registered. The organizer key only ever lives in the local .env; its later actions are signed and relayed.
/// Monad charges the gas limit, so keep the multiplier low:
/// forge script script/DeployCurtain.s.sol --rpc-url monad_testnet --broadcast --slow --gas-estimate-multiplier 110
contract DeployCurtain is Script {
    /// Circle USDC on Monad testnet. EIP-712 domain: name "USDC", version "2".
    address internal constant USDC_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    string internal constant RP_ID = "curtaintickets.vercel.app";

    function run() external returns (CurtainFactory factory, address demoEvent) {
        uint256 deployerKey = vm.envUint("RELAYER_PRIVATE_KEY");
        uint256 organizerKey = vm.envUint("ORGANIZER_PRIVATE_KEY");
        address organizer = vm.addr(organizerKey);
        address gate = vm.addr(vm.envUint("GATE_PRIVATE_KEY"));

        // Demo event: doors open now so check-ins work right away, and it runs through judging.
        address[] memory gates = new address[](1);
        gates[0] = gate;
        CurtainEvent.EventParams memory p = CurtainEvent.EventParams({
            payout: organizer,
            token: IERC20(USDC_TESTNET),
            price: uint96(vm.envOr("DEMO_PRICE", uint256(1e6))), // 1 USDC
            capacity: uint32(vm.envOr("DEMO_CAPACITY", uint256(200))),
            salesEnd: uint64(block.timestamp + 30 days),
            doorsOpen: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            settleDelay: 1 hours,
            heldThresholdBps: 5000,
            maxChallengeAge: 300,
            rpIdHash: sha256(bytes(RP_ID)),
            gates: gates
        });

        vm.startBroadcast(deployerKey);
        factory = new CurtainFactory();
        vm.stopBroadcast();

        vm.startBroadcast(organizerKey);
        demoEvent = factory.createEvent(p);
        vm.stopBroadcast();

        console.log("CurtainFactory:", address(factory));
        console.log("Implementation:", factory.implementation());
        console.log("Demo event:", demoEvent);
        console.log("Organizer and payout:", organizer);
        console.log("Gate:", gate);
    }
}
