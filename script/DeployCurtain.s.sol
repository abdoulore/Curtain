// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurtainFactory} from "../src/CurtainFactory.sol";
import {CurtainEvent} from "../src/CurtainEvent.sol";

/// Deploys the factory and a demo show, both paid by the relayer key. The organizer key only signs the show's
/// `CreateShow` request, the same way the create page has an organizer passkey sign it; the gate key's address is
/// registered as the first gate device. The organizer key only ever lives in the local .env.
/// Monad charges the gas limit, so keep the multiplier low:
/// forge script script/DeployCurtain.s.sol --rpc-url monad_testnet --broadcast --slow --gas-estimate-multiplier 110
contract DeployCurtain is Script {
    /// Circle USDC on Monad testnet. EIP-712 domain: name "USDC", version "2".
    address internal constant USDC_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    string internal constant RP_ID = "curtaintickets.vercel.app";
    string internal constant NAME = "Curtain Demo Night";
    string internal constant VENUE = "The Velvet Room, Victoria Island, Lagos";

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
            maxPerBuyer: 0,
            rpIdHash: sha256(bytes(RP_ID)),
            gates: gates
        });

        vm.startBroadcast(deployerKey);
        factory = new CurtainFactory();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signShow(factory, organizerKey, p, deadline);
        demoEvent = factory.createEventFor(organizer, p, NAME, VENUE, 0, deadline, sig);
        vm.stopBroadcast();

        console.log("CurtainFactory:", address(factory));
        console.log("Implementation:", factory.implementation());
        console.log("Demo event:", demoEvent);
        console.log("Organizer and payout:", organizer);
        console.log("Gate:", gate);
    }

    function _signShow(CurtainFactory factory, uint256 key, CurtainEvent.EventParams memory p, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                factory.CREATE_SHOW_TYPEHASH(),
                vm.addr(key),
                keccak256(bytes(NAME)),
                keccak256(bytes(VENUE)),
                factory.hashShow(p),
                factory.nonces(vm.addr(key)),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked(hex"1901", factory.domainSeparator(), structHash)));
        return abi.encodePacked(r, s, v);
    }
}
