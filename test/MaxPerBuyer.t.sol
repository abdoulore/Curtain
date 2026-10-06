// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurtainEvent} from "../src/CurtainEvent.sol";
import {CurtainTestBase} from "./utils/CurtainTestBase.sol";

/// @dev Each account holds at most maxPerBuyer tickets, across new tickets, resale and gift claims.
contract MaxPerBuyerTest is CurtainTestBase {
    Buyer internal alice;
    Buyer internal bob;

    function setUp() public override {
        super.setUp();
        alice = _buyer("alice");
        bob = _buyer("bob");
    }

    function _buyMany(Buyer memory b, uint256 n) internal returns (uint256 last) {
        for (uint256 i = 0; i < n; ++i) {
            last = _buy(b);
        }
    }

    /// Builds the intent and permit first, so an expected revert applies to the buy itself.
    function _expectBuyReverts(Buyer memory b, bytes memory reason) internal {
        CurtainEvent.BuyIntent memory i = _intent(b, PRICE);
        bytes memory sig = _signIntent(b.key, i);
        CurtainEvent.Permit memory p = _permit(b, PRICE);
        vm.expectRevert(reason);
        vm.prank(relayer);
        ev.buy(i, sig, p);
    }

    function _giftTo(Buyer memory from, uint256 id, Buyer memory to, bytes memory expectedRevert) internal {
        (address claimKey, uint256 claimPk) = makeAddrAndKey(string(abi.encodePacked("gift", vm.toString(id))));
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = ev.nonces(from.addr);
        bytes memory setSig = _setClaimSig(from, id, claimKey, deadline);
        vm.prank(relayer);
        ev.setClaim(id, claimKey, nonce, deadline, setSig);
        (bytes32 qx, bytes32 qy) = _passkeyXY(to.passkey);
        bytes memory claimSig = _claimSig(claimPk, id, to.addr, qx, qy);
        if (expectedRevert.length != 0) vm.expectRevert(expectedRevert);
        vm.prank(relayer);
        ev.claim(id, to.addr, qx, qy, claimSig);
    }

    function test_defaultCapIsFour() public view {
        assertEq(ev.maxPerBuyer(), 4);
        assertEq(ev.DEFAULT_MAX_PER_BUYER(), 4);
    }

    function test_countsTicketsHeld() public {
        _buyMany(alice, 3);
        assertEq(ev.ticketsHeld(alice.addr), 3);
    }

    function test_revert_fifthTicket_TooManyTickets() public {
        _buyMany(alice, 4);
        _expectBuyReverts(alice, abi.encodeWithSelector(CurtainEvent.TooManyTickets.selector, alice.addr, 4));
        assertEq(ev.sold(), 4);
    }

    function test_revert_resaleOverCap_TooManyTickets() public {
        _buyMany(alice, 4);
        uint256 id = _buy(bob);
        _list(bob, id, PRICE);

        CurtainEvent.BuyIntent memory i = _intentFor(alice, id, PRICE);
        bytes memory sig = _signIntent(alice.key, i);
        CurtainEvent.Permit memory p = _permit(alice, PRICE);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.TooManyTickets.selector, alice.addr, 4));
        vm.prank(relayer);
        ev.buyResale(id, i, sig, p);
        assertEq(ev.getTicket(id).holder, bob.addr);
    }

    function test_revert_claimOverCap_TooManyTickets() public {
        _buyMany(alice, 4);
        uint256 id = _buy(bob);
        _giftTo(bob, id, alice, abi.encodeWithSelector(CurtainEvent.TooManyTickets.selector, alice.addr, 4));
        assertEq(ev.getTicket(id).holder, bob.addr);
    }

    function test_holderAtCapSellsOneAndBuysAgain() public {
        uint256 last = _buyMany(alice, 4);
        _list(alice, last, PRICE);
        _buyResale(bob, last, PRICE);
        assertEq(ev.ticketsHeld(alice.addr), 3);
        assertEq(ev.ticketsHeld(bob.addr), 1);

        _buy(alice);
        assertEq(ev.ticketsHeld(alice.addr), 4);
    }

    function test_giftMovesTheCount() public {
        uint256 id = _buy(alice);
        _giftTo(alice, id, bob, "");
        assertEq(ev.ticketsHeld(alice.addr), 0);
        assertEq(ev.ticketsHeld(bob.addr), 1);
    }

    function test_organizerSetsTheCap() public {
        CurtainEvent.EventParams memory p = _params();
        p.maxPerBuyer = 2;
        vm.prank(organizer);
        ev = CurtainEvent(factory.createEvent(p));
        assertEq(ev.maxPerBuyer(), 2);
        _buyMany(alice, 2);
        _expectBuyReverts(alice, abi.encodeWithSelector(CurtainEvent.TooManyTickets.selector, alice.addr, 2));
    }
}
