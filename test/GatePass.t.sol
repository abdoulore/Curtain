// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {CurtainEvent} from "../src/CurtainEvent.sol";
import {CurtainTestBase} from "./utils/CurtainTestBase.sol";

/// @dev Paired gate devices hold a key that signs each nonce they show; a relayer submits the check-in.
contract GatePassTest is CurtainTestBase {
    Buyer internal alice;
    address internal device;
    uint256 internal deviceKey;

    function setUp() public override {
        super.setUp();
        alice = _buyer("alice");
        (device, deviceKey) = makeAddrAndKey("gate device");
        vm.prank(organizer);
        ev.setGate(device, true, 0, 0, "");
    }

    function _gatePass(uint256 key, bytes32 gateNonce, uint256 challengeBlock) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(ev.GATE_PASS_TYPEHASH(), gateNonce, challengeBlock));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", ev.domainSeparator(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _relayCheckIn(uint256 id, bytes memory pass, bytes32 nonce) internal returns (bytes32) {
        return _relayCheckIn(id, pass, nonce, "");
    }

    /// @dev Builds the assertion first, so an expected revert applies to the check-in itself.
    function _relayCheckIn(uint256 id, bytes memory pass, bytes32 nonce, bytes memory expectedRevert)
        internal
        returns (bytes32)
    {
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, ev.challengeFor(id, nonce, block.number), RP_ID);
        if (expectedRevert.length != 0) vm.expectRevert(expectedRevert);
        vm.prank(relayer);
        return ev.checkIn(id, nonce, block.number, pass, auth);
    }

    function test_relayerChecksInWithTheDevicesGatePass() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        bytes32 challenge = ev.challengeFor(id, nonce, block.number);

        vm.expectEmit(address(ev));
        emit CurtainEvent.CheckedIn(id, device, challenge, PRICE);
        _relayCheckIn(id, _gatePass(deviceKey, nonce, block.number), nonce);

        assertEq(uint8(ev.getTicket(id).state), uint8(CurtainEvent.TicketState.CheckedIn));
        assertEq(ev.released(), PRICE);
    }

    function test_revert_unpairedKey_NotGate() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        bytes memory pass = _gatePass(strangerKey, nonce, block.number);
        _relayCheckIn(id, pass, nonce, abi.encodeWithSelector(CurtainEvent.NotGate.selector));
    }

    function test_revert_passForAnotherNonce_NotGate() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        bytes memory pass = _gatePass(deviceKey, keccak256("another nonce"), block.number);
        _relayCheckIn(id, pass, nonce, abi.encodeWithSelector(CurtainEvent.NotGate.selector));
    }

    function test_revert_passForAnotherEvent_NotGate() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        // Same struct, signed for a different verifying contract.
        bytes32 structHash = keccak256(abi.encode(ev.GATE_PASS_TYPEHASH(), nonce, block.number));
        bytes32 otherDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Curtain"),
                keccak256("1"),
                block.chainid,
                address(0xBEEF)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(deviceKey, keccak256(abi.encodePacked("\x19\x01", otherDomain, structHash)));
        _relayCheckIn(id, abi.encodePacked(r, s, v), nonce, abi.encodeWithSelector(CurtainEvent.NotGate.selector));
    }

    function test_revert_removedDevice_NotGate() public {
        uint256 id = _buy(alice);
        vm.prank(organizer);
        ev.setGate(device, false, 0, 0, "");
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        bytes memory pass = _gatePass(deviceKey, nonce, block.number);
        _relayCheckIn(id, pass, nonce, abi.encodeWithSelector(CurtainEvent.NotGate.selector));
    }

    function test_revert_malformedPass_NotGate() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        _relayCheckIn(id, hex"1234", nonce, abi.encodeWithSelector(CurtainEvent.NotGate.selector));
    }

    function test_revert_relayerWithoutPass_NotGate() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        _relayCheckIn(id, "", nonce, abi.encodeWithSelector(CurtainEvent.NotGate.selector));
    }

    function test_revert_secondScanWithAFreshPass_TicketNotActive() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        _relayCheckIn(id, _gatePass(deviceKey, nonce, block.number), nonce);

        vm.roll(block.number + 1);
        bytes32 fresh = _gateNonce(id);
        bytes memory pass = _gatePass(deviceKey, fresh, block.number);
        _relayCheckIn(id, pass, fresh, abi.encodeWithSelector(CurtainEvent.TicketNotActive.selector, id));
    }
}
