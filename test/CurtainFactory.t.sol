// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {CurtainEvent} from "../src/CurtainEvent.sol";
import {CurtainFactory} from "../src/CurtainFactory.sol";
import {CurtainTestBase} from "./utils/CurtainTestBase.sol";

/// @dev Organizers create shows by signing `CreateShow`; the relayer pays.
contract CurtainFactoryTest is CurtainTestBase {
    string internal constant NAME = "Ember Comedy Night";
    string internal constant VENUE = "The Ember Room, Yaba";

    function _signShow(
        uint256 key,
        address org,
        CurtainEvent.EventParams memory p,
        string memory name,
        string memory venue,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                factory.CREATE_SHOW_TYPEHASH(),
                org,
                keccak256(bytes(name)),
                keccak256(bytes(venue)),
                factory.hashShow(p),
                nonce,
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", factory.domainSeparator(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _createFor(CurtainEvent.EventParams memory p, bytes memory sig, uint256 deadline)
        internal
        returns (address)
    {
        vm.prank(relayer);
        return factory.createEventFor(organizer, p, NAME, VENUE, 0, deadline, sig);
    }

    function test_relayedCreateMakesTheSignerTheOrganizer() public {
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signShow(ORGANIZER_KEY, organizer, p, NAME, VENUE, 0, deadline);

        vm.recordLogs();
        CurtainEvent show = CurtainEvent(_createFor(p, sig, deadline));

        assertEq(show.organizer(), organizer);
        assertEq(show.payout(), payout);
        assertEq(show.price(), PRICE);
        assertTrue(show.isGate(gate));
        (string memory name, string memory venue) = factory.details(address(show));
        assertEq(name, NAME);
        assertEq(venue, VENUE);
        assertEq(factory.nonces(organizer), 1);
        assertEq(vm.getRecordedLogs().length, 4); // GateSet, Initialized, EventCreated, ShowDetails
    }

    function test_emitsShowDetails() public {
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signShow(ORGANIZER_KEY, organizer, p, NAME, VENUE, 0, deadline);
        vm.expectEmit(false, false, false, true, address(factory));
        emit CurtainFactory.ShowDetails(address(0), NAME, VENUE);
        _createFor(p, sig, deadline);
    }

    function test_revert_signedBySomeoneElse_BadSignature() public {
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        bytes memory sig = _signShow(strangerKey, organizer, p, NAME, VENUE, 0, deadline);
        vm.expectRevert(CurtainFactory.BadSignature.selector);
        _createFor(p, sig, deadline);
    }

    function test_revert_relayerChangesThePrice_BadSignature() public {
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signShow(ORGANIZER_KEY, organizer, p, NAME, VENUE, 0, deadline);
        p.price = PRICE * 2;
        vm.expectRevert(CurtainFactory.BadSignature.selector);
        _createFor(p, sig, deadline);
    }

    function test_revert_relayerAddsAGate_BadSignature() public {
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signShow(ORGANIZER_KEY, organizer, p, NAME, VENUE, 0, deadline);
        address[] memory gates = new address[](2);
        gates[0] = gate;
        gates[1] = relayer;
        p.gates = gates;
        vm.expectRevert(CurtainFactory.BadSignature.selector);
        _createFor(p, sig, deadline);
    }

    function test_revert_relayerRenamesTheShow_BadSignature() public {
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signShow(ORGANIZER_KEY, organizer, p, NAME, VENUE, 0, deadline);
        vm.prank(relayer);
        vm.expectRevert(CurtainFactory.BadSignature.selector);
        factory.createEventFor(organizer, p, "Another show", VENUE, 0, deadline, sig);
    }

    function test_revert_replay_InvalidAccountNonce() public {
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signShow(ORGANIZER_KEY, organizer, p, NAME, VENUE, 0, deadline);
        _createFor(p, sig, deadline);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, organizer, 1));
        _createFor(p, sig, deadline);
    }

    function test_revert_expired_SignatureExpired() public {
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signShow(ORGANIZER_KEY, organizer, p, NAME, VENUE, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(CurtainFactory.SignatureExpired.selector);
        _createFor(p, sig, deadline);
    }

    function test_directCreateHasNoDetails() public view {
        (string memory name, string memory venue) = factory.details(address(ev));
        assertEq(bytes(name).length, 0);
        assertEq(bytes(venue).length, 0);
        assertEq(ev.organizer(), organizer);
    }

    function test_createdShowSignsForItsOrganizer() public {
        // The organizer of a relayed show can act by signature like any other.
        CurtainEvent.EventParams memory p = _params();
        uint256 deadline = block.timestamp + 1 hours;
        CurtainEvent show =
            CurtainEvent(_createFor(p, _signShow(ORGANIZER_KEY, organizer, p, NAME, VENUE, 0, deadline), deadline));
        bytes32 structHash = keccak256(abi.encode(show.CANCEL_TYPEHASH(), uint256(0), deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(ORGANIZER_KEY, keccak256(abi.encodePacked("\x19\x01", show.domainSeparator(), structHash)));
        vm.prank(relayer);
        show.cancel(0, deadline, abi.encodePacked(r, s, v));
        assertEq(uint8(show.status()), uint8(CurtainEvent.EventStatus.Cancelled));
    }
}
