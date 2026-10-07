// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {CurtainFactory} from "../src/CurtainFactory.sol";
import {CurtainEvent} from "../src/CurtainEvent.sol";
import {CurtainKeeper} from "../src/CurtainKeeper.sol";

/// Deploys the CurtainKeeper that the CRE workflow reports to, plus two small shows for it to work on:
/// one cancelled with three tickets sold, and one that ends a few minutes after deploy with two tickets sold and
/// nobody checked in. The relayer key deploys the keeper and submits the buys; the organizer key creates the shows,
/// pays the demo buyers 0.2 USDC each and cancels. Buyers are throwaway keys that never need gas.
/// forge script script/DeployKeeper.s.sol --rpc-url monad_testnet --broadcast --slow --gas-estimate-multiplier 110
contract DeployKeeper is Script {
    address internal constant USDC_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    /// CRE MockKeystoneForwarder on Monad testnet, used by `cre workflow simulate --broadcast`.
    address internal constant MOCK_FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
    string internal constant RP_ID = "curtaintickets.vercel.app";
    uint96 internal constant PRICE = 0.2e6;
    uint256 internal constant P256_N_MINUS_1 = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632550;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint256 internal relayerKey;
    uint256 internal organizerKey;

    function run() external returns (CurtainKeeper keeper, address cancelledShow, address endingShow) {
        relayerKey = vm.envUint("RELAYER_PRIVATE_KEY");
        organizerKey = vm.envUint("ORGANIZER_PRIVATE_KEY");
        CurtainFactory factory = CurtainFactory(vm.envAddress("CURTAIN_FACTORY"));

        vm.startBroadcast(relayerKey);
        keeper = new CurtainKeeper(
            vm.envOr("KEEPER_FORWARDER", MOCK_FORWARDER), factory.implementation(), 10, vm.addr(relayerKey)
        );
        vm.stopBroadcast();

        console.log("CurtainKeeper:", address(keeper));
        // KEEPER_DEMO_SHOWS=false deploys only the keeper.
        if (!vm.envOr("KEEPER_DEMO_SHOWS", true)) return (keeper, address(0), address(0));

        uint64 endsIn = uint64(vm.envOr("ENDING_SHOW_MINUTES", uint256(4))) * 60;
        cancelledShow = _createShow(factory, uint64(block.timestamp + 7 days));
        endingShow = _createShow(factory, uint64(block.timestamp) + endsIn);

        for (uint256 i = 0; i < 3; ++i) {
            _buy(CurtainEvent(cancelledShow), _buyerKey(cancelledShow, i));
        }
        for (uint256 i = 0; i < 2; ++i) {
            _buy(CurtainEvent(endingShow), _buyerKey(endingShow, i));
        }

        vm.startBroadcast(organizerKey);
        CurtainEvent(cancelledShow).cancel(0, 0, "");
        vm.stopBroadcast();

        console.log("Cancelled show (3 tickets):", cancelledShow);
        console.log("Show ending soon (2 tickets, none scanned):", endingShow);
    }

    function _createShow(CurtainFactory factory, uint64 endTime) internal returns (address show) {
        address organizer = vm.addr(organizerKey);
        address[] memory gates = new address[](1);
        gates[0] = vm.addr(vm.envUint("GATE_PRIVATE_KEY"));
        CurtainEvent.EventParams memory p = CurtainEvent.EventParams({
            payout: organizer,
            token: IERC20(USDC_TESTNET),
            price: PRICE,
            capacity: 20,
            salesEnd: endTime,
            doorsOpen: uint64(block.timestamp),
            endTime: endTime,
            settleDelay: 0,
            maxChallengeAge: 300,
            maxPerBuyer: 0,
            rpIdHash: sha256(bytes(RP_ID)),
            gates: gates
        });
        vm.startBroadcast(organizerKey);
        show = factory.createEvent(p);
        vm.stopBroadcast();
    }

    function _buyerKey(address show, uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("curtain/cre-demo-buyer", show, i)));
    }

    /// The organizer pays the buyer 0.2 USDC, the buyer signs an intent and a permit, and the relayer submits.
    function _buy(CurtainEvent show, uint256 buyerKey) internal {
        address buyer = vm.addr(buyerKey);
        vm.startBroadcast(organizerKey);
        require(IERC20(USDC_TESTNET).transfer(buyer, PRICE), "transfer failed");
        vm.stopBroadcast();

        uint256 deadline = block.timestamp + 1 hours;
        (CurtainEvent.BuyIntent memory intent, bytes memory intentSig) = _signIntent(show, buyerKey, deadline);
        CurtainEvent.Permit memory permit = _signPermit(address(show), buyerKey, deadline);

        vm.startBroadcast(relayerKey);
        show.buy(intent, intentSig, permit);
        vm.stopBroadcast();
    }

    function _signIntent(CurtainEvent show, uint256 buyerKey, uint256 deadline)
        internal
        view
        returns (CurtainEvent.BuyIntent memory intent, bytes memory sig)
    {
        address buyer = vm.addr(buyerKey);
        // Any valid P-256 key works for a ticket nobody will scan.
        (uint256 x, uint256 y) = vm.publicKeyP256(buyerKey % P256_N_MINUS_1 + 1);
        intent = CurtainEvent.BuyIntent({
            buyer: buyer,
            ticketId: 0,
            qx: bytes32(x),
            qy: bytes32(y),
            price: PRICE,
            nonce: show.nonces(buyer),
            deadline: deadline
        });
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", show.domainSeparator(), keccak256(abi.encode(show.BUY_INTENT_TYPEHASH(), intent))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _signPermit(address spender, uint256 buyerKey, uint256 deadline)
        internal
        view
        returns (CurtainEvent.Permit memory permit)
    {
        address buyer = vm.addr(buyerKey);
        IERC20Permit usdc = IERC20Permit(USDC_TESTNET);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, buyer, spender, PRICE, usdc.nonces(buyer), deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(buyerKey, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
        permit = CurtainEvent.Permit(PRICE, deadline, v, r, s);
    }
}
