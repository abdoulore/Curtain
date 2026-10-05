// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {CurtainEvent} from "../src/CurtainEvent.sol";
import {CurtainFactory} from "../src/CurtainFactory.sol";
import {CurtainTestBase} from "./utils/CurtainTestBase.sol";

contract CurtainEventTest is CurtainTestBase {
    Buyer internal alice;
    Buyer internal bob;
    Buyer internal carol;

    function setUp() public override {
        super.setUp();
        alice = _buyer("alice");
        bob = _buyer("bob");
        carol = _buyer("carol");
    }

    // =====================================================================
    // Happy paths
    // =====================================================================

    function test_buy_escrowsPaymentAndBindsPasskey() public {
        (bytes32 qx, bytes32 qy) = _passkeyXY(alice.passkey);
        vm.expectEmit(address(ev));
        emit CurtainEvent.Purchased(1, alice.addr, qx, qy, PRICE);
        uint256 id = _buy(alice);

        CurtainEvent.Ticket memory t = ev.getTicket(id);
        assertEq(id, 1);
        assertEq(t.holder, alice.addr);
        assertEq(t.qx, qx);
        assertEq(t.qy, qy);
        assertEq(uint8(t.state), uint8(CurtainEvent.TicketState.Active));
        assertEq(ev.sold(), 1);
        assertEq(ev.escrowed(), PRICE);
        assertEq(ev.totalPaidIn(), PRICE);
        assertEq(usdc.balanceOf(address(ev)), PRICE);
        assertEq(usdc.balanceOf(alice.addr), 100e6 - PRICE);
        assertEq(ev.nonces(alice.addr), 1);
    }

    function test_buy_succeedsWhenPermitWasAlreadyUsed() public {
        CurtainEvent.BuyIntent memory i = _intent(alice, PRICE);
        bytes memory sig = _signIntent(alice.key, i);
        CurtainEvent.Permit memory p = _permit(alice, PRICE);
        // Someone front-runs the permit; the buy still works off the resulting allowance.
        usdc.permit(alice.addr, address(ev), p.value, p.deadline, p.v, p.r, p.s);
        vm.prank(relayer);
        ev.buy(i, sig, p);
        assertEq(ev.sold(), 1);
    }

    function test_checkIn_releasesTicketPrice() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 challenge = _checkIn(id, alice.passkey);

        assertEq(uint8(ev.getTicket(id).state), uint8(CurtainEvent.TicketState.CheckedIn));
        assertTrue(ev.challengeUsed(challenge));
        assertEq(ev.checkedIn(), 1);
        assertEq(ev.escrowed(), 0);
        assertEq(ev.released(), PRICE);
        assertEq(ev.availableToWithdraw(), PRICE);
    }

    function test_withdraw_paysPayoutUpToReleased() public {
        uint256 a = _buy(alice);
        _buy(bob);
        _openDoors();
        _checkIn(a, alice.passkey);

        vm.prank(organizer);
        ev.withdraw(PRICE, 0, 0, "");
        assertEq(usdc.balanceOf(payout), PRICE);
        assertEq(ev.withdrawn(), PRICE);
        assertEq(ev.availableToWithdraw(), 0);
        assertEq(usdc.balanceOf(address(ev)), PRICE); // bob's money is still escrowed
    }

    function test_cancel_thenPushRefunds_refundsUnscannedOnly() public {
        uint256 a = _buy(alice);
        uint256 b = _buy(bob);
        uint256 c = _buy(carol);
        _openDoors();
        _checkIn(a, alice.passkey);

        vm.prank(organizer);
        ev.cancel(0, 0, "");
        vm.prank(relayer);
        uint256 processed = ev.pushRefunds(10);

        assertEq(processed, 3);
        assertEq(ev.refundCursor(), 3);
        assertEq(uint8(ev.getTicket(a).state), uint8(CurtainEvent.TicketState.CheckedIn));
        assertEq(uint8(ev.getTicket(b).state), uint8(CurtainEvent.TicketState.Refunded));
        assertEq(uint8(ev.getTicket(c).state), uint8(CurtainEvent.TicketState.Refunded));
        assertEq(usdc.balanceOf(bob.addr), 100e6);
        assertEq(usdc.balanceOf(carol.addr), 100e6);
        assertEq(ev.refunded(), 2 * uint256(PRICE));
        assertEq(ev.escrowed(), 0);

        // Scanned money stays paid to the organizer.
        vm.prank(organizer);
        ev.withdraw(PRICE, 0, 0, "");
        assertEq(usdc.balanceOf(payout), PRICE);
        assertEq(usdc.balanceOf(address(ev)), 0);
    }

    function test_pushRefunds_walksInBatches() public {
        _buy(alice);
        _buy(bob);
        _buy(carol);
        vm.prank(organizer);
        ev.cancel(0, 0, "");

        assertEq(ev.pushRefunds(2), 2);
        assertEq(ev.refundCursor(), 2);
        assertEq(usdc.balanceOf(carol.addr), 100e6 - PRICE);
        assertEq(ev.pushRefunds(2), 1);
        assertEq(usdc.balanceOf(carol.addr), 100e6);
        assertEq(ev.pushRefunds(2), 0);
    }

    function test_claimRefund_paysHolderAfterCancel() public {
        uint256 id = _buy(alice);
        vm.prank(organizer);
        ev.cancel(0, 0, "");
        vm.prank(relayer); // anyone may trigger it; the money goes to the holder
        ev.claimRefund(id);
        assertEq(usdc.balanceOf(alice.addr), 100e6);
        assertEq(uint8(ev.getTicket(id).state), uint8(CurtainEvent.TicketState.Refunded));
    }

    function test_settle_held_releasesUnscanned() public {
        uint256 a = _buy(alice);
        _buy(bob);
        _openDoors();
        _checkIn(a, alice.passkey); // 1 of 2 = 50%, meets the 5000 bps threshold

        vm.warp(uint256(endTime) + SETTLE_DELAY);
        vm.expectEmit(address(ev));
        emit CurtainEvent.Settled(true, PRICE);
        ev.settle();

        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.Held));
        assertEq(ev.released(), 2 * uint256(PRICE));
        assertEq(ev.escrowed(), 0);
        vm.prank(organizer);
        ev.withdraw(2 * uint256(PRICE), 0, 0, "");
        assertEq(usdc.balanceOf(payout), 2 * uint256(PRICE));
    }

    function test_settle_notHeld_refundsUnscanned() public {
        uint256 a = _buy(alice);
        _buy(bob);
        _buy(carol);
        _openDoors();
        _checkIn(a, alice.passkey); // 1 of 3 is below 50%

        vm.warp(uint256(endTime) + SETTLE_DELAY);
        ev.settle();
        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.NotHeld));
        assertEq(ev.released(), PRICE);

        ev.pushRefunds(10);
        assertEq(usdc.balanceOf(bob.addr), 100e6);
        assertEq(usdc.balanceOf(carol.addr), 100e6);
        assertEq(ev.escrowed(), 0);
    }

    function test_resale_rebindsHolderAndPasskey() public {
        uint256 id = _buy(alice);
        uint256 resalePrice = PRICE - 1e6;
        _list(alice, id, resalePrice); // gasless: relayer submits alice's signature
        assertEq(ev.getTicket(id).resalePrice, resalePrice);

        vm.expectEmit(address(ev));
        emit CurtainEvent.Resold(id, alice.addr, bob.addr, resalePrice);
        _buyResale(bob, id, resalePrice);

        CurtainEvent.Ticket memory t = ev.getTicket(id);
        (bytes32 qx, bytes32 qy) = _passkeyXY(bob.passkey);
        assertEq(t.holder, bob.addr);
        assertEq(t.qx, qx);
        assertEq(t.qy, qy);
        assertEq(t.resalePrice, 0);
        assertEq(usdc.balanceOf(alice.addr), 100e6 - PRICE + resalePrice);
        assertEq(usdc.balanceOf(bob.addr), 100e6 - resalePrice);
        assertEq(ev.escrowed(), PRICE); // the face value stays escrowed for the new holder

        _openDoors();
        _checkIn(id, bob.passkey);
        assertEq(ev.released(), PRICE);
    }

    function test_listForResale_directlyByHolder() public {
        uint256 id = _buy(alice);
        vm.prank(alice.addr);
        ev.listForResale(id, PRICE, 0, 0, "");
        assertEq(ev.getTicket(id).resalePrice, PRICE);
        vm.prank(alice.addr);
        ev.listForResale(id, 0, 0, 0, ""); // delist
        assertEq(ev.getTicket(id).resalePrice, 0);
    }

    function test_giftClaim_rebindsToFriend() public {
        uint256 id = _buy(alice);
        (address claimKey, uint256 claimPk) = makeAddrAndKey("gift link key");
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = ev.nonces(alice.addr); // buying used nonce 0; intents and holder actions share one counter
        bytes memory setSig = _setClaimSig(alice, id, claimKey, deadline);
        vm.prank(relayer);
        ev.setClaim(id, claimKey, nonce, deadline, setSig);
        assertEq(ev.getTicket(id).claimKey, claimKey);

        (bytes32 qx, bytes32 qy) = _passkeyXY(bob.passkey);
        bytes memory claimSig = _claimSig(claimPk, id, bob.addr, qx, qy);
        vm.expectEmit(address(ev));
        emit CurtainEvent.Claimed(id, alice.addr, bob.addr);
        vm.prank(relayer);
        ev.claim(id, bob.addr, qx, qy, claimSig);

        CurtainEvent.Ticket memory t = ev.getTicket(id);
        assertEq(t.holder, bob.addr);
        assertEq(t.qx, qx);
        assertEq(t.claimKey, address(0));

        _openDoors();
        _checkIn(id, bob.passkey);
    }

    function test_setGate_organizerAddsGate() public {
        address gate2 = makeAddr("gate2");
        vm.prank(organizer);
        ev.setGate(gate2, true, 0, 0, "");
        assertTrue(ev.isGate(gate2));
    }

    // =====================================================================
    // Unhappy paths, each with its exact error
    // =====================================================================

    function test_revert_replayedAssertion_ChallengeAlreadyUsed() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        uint256 challengeBlock = block.number;
        bytes32 challenge = ev.challengeFor(id, nonce, challengeBlock);
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, challenge, RP_ID);
        vm.prank(gate);
        ev.checkIn(id, nonce, challengeBlock, "", auth);

        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.ChallengeAlreadyUsed.selector, challenge));
        vm.prank(gate);
        ev.checkIn(id, nonce, challengeBlock, "", auth);
    }

    function test_revert_staleChallenge_ChallengeExpired() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        uint256 challengeBlock = block.number;
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, ev.challengeFor(id, nonce, challengeBlock), RP_ID);
        vm.roll(challengeBlock + MAX_AGE + 1);

        vm.expectRevert(
            abi.encodeWithSelector(CurtainEvent.ChallengeExpired.selector, challengeBlock, challengeBlock + MAX_AGE + 1)
        );
        vm.prank(gate);
        ev.checkIn(id, nonce, challengeBlock, "", auth);
    }

    function test_revert_futureChallenge_ChallengeFromFuture() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        uint256 challengeBlock = block.number + 1;
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, ev.challengeFor(id, nonce, challengeBlock), RP_ID);

        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.ChallengeFromFuture.selector, challengeBlock, block.number));
        vm.prank(gate);
        ev.checkIn(id, nonce, challengeBlock, "", auth);
    }

    function test_revert_secondScanWithFreshNonce_TicketNotActive() public {
        uint256 id = _buy(alice);
        _openDoors();
        _checkIn(id, alice.passkey);
        vm.roll(block.number + 1);

        bytes32 nonce = _gateNonce(id);
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, ev.challengeFor(id, nonce, block.number), RP_ID);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.TicketNotActive.selector, id));
        vm.prank(gate);
        ev.checkIn(id, nonce, block.number, "", auth);
    }

    function test_revert_wrongPasskey_InvalidAssertion() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        WebAuthn.WebAuthnAuth memory auth = _assertion(bob.passkey, ev.challengeFor(id, nonce, block.number), RP_ID);
        vm.expectRevert(CurtainEvent.InvalidAssertion.selector);
        vm.prank(gate);
        ev.checkIn(id, nonce, block.number, "", auth);
    }

    function test_revert_passkeyFromAnotherDomain_WrongRpId() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        WebAuthn.WebAuthnAuth memory auth =
            _assertion(alice.passkey, ev.challengeFor(id, nonce, block.number), "evil.example");
        vm.expectRevert(CurtainEvent.WrongRpId.selector);
        vm.prank(gate);
        ev.checkIn(id, nonce, block.number, "", auth);
    }

    function test_revert_callerNotGate_NotGate() public {
        uint256 id = _buy(alice);
        _openDoors();
        bytes32 nonce = _gateNonce(id);
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, ev.challengeFor(id, nonce, block.number), RP_ID);
        vm.expectRevert(CurtainEvent.NotGate.selector);
        vm.prank(relayer);
        ev.checkIn(id, nonce, block.number, "", auth);
    }

    function test_revert_checkInBeforeDoors_NotDoorTime() public {
        uint256 id = _buy(alice);
        bytes32 nonce = _gateNonce(id);
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, ev.challengeFor(id, nonce, block.number), RP_ID);
        vm.expectRevert(CurtainEvent.NotDoorTime.selector);
        vm.prank(gate);
        ev.checkIn(id, nonce, block.number, "", auth);
    }

    function test_revert_sellerEntersAfterResale_InvalidAssertion() public {
        uint256 id = _buy(alice);
        _list(alice, id, PRICE);
        _buyResale(bob, id, PRICE);
        _openDoors();

        bytes32 nonce = _gateNonce(id);
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, ev.challengeFor(id, nonce, block.number), RP_ID);
        vm.expectRevert(CurtainEvent.InvalidAssertion.selector);
        vm.prank(gate);
        ev.checkIn(id, nonce, block.number, "", auth);
    }

    function test_revert_resaleAboveFaceValue_PriceAboveCap() public {
        uint256 id = _buy(alice);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.PriceAboveCap.selector, PRICE + 1, PRICE));
        vm.prank(alice.addr);
        ev.listForResale(id, PRICE + 1, 0, 0, "");
    }

    function test_revert_buyResaleOfUnlistedTicket_NotListed() public {
        uint256 id = _buy(alice);
        CurtainEvent.BuyIntent memory i = _intent(bob, PRICE);
        bytes memory sig = _signIntent(bob.key, i);
        CurtainEvent.Permit memory p = _permit(bob, PRICE);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.NotListed.selector, id));
        ev.buyResale(id, i, sig, p);
    }

    function test_revert_listWithForgedSignature_BadSignature() public {
        uint256 id = _buy(alice);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = ev.nonces(alice.addr);
        // Bob signs a List for Alice's ticket with Alice's current nonce.
        bytes memory sig = _sign(bob.key, keccak256(abi.encode(ev.LIST_TYPEHASH(), id, PRICE, nonce, deadline)));
        vm.expectRevert(CurtainEvent.BadSignature.selector);
        vm.prank(relayer);
        ev.listForResale(id, PRICE, nonce, deadline, sig);
    }

    function test_revert_organizerOverWithdraw_ExceedsReleased() public {
        uint256 id = _buy(alice);
        _buy(bob);
        _openDoors();
        _checkIn(id, alice.passkey);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.ExceedsReleased.selector, PRICE + 1, PRICE));
        vm.prank(organizer);
        ev.withdraw(PRICE + 1, 0, 0, "");
    }

    function test_revert_withdrawByStranger_NotOrganizer() public {
        vm.expectRevert(CurtainEvent.NotOrganizer.selector);
        vm.prank(relayer);
        ev.withdraw(0, 0, 0, "");
    }

    function test_revert_checkInAfterCancel_EventNotOpen() public {
        uint256 id = _buy(alice);
        _openDoors();
        vm.prank(organizer);
        ev.cancel(0, 0, "");
        bytes32 nonce = _gateNonce(id);
        WebAuthn.WebAuthnAuth memory auth = _assertion(alice.passkey, ev.challengeFor(id, nonce, block.number), RP_ID);
        vm.expectRevert(CurtainEvent.EventNotOpen.selector);
        vm.prank(gate);
        ev.checkIn(id, nonce, block.number, "", auth);
    }

    function test_revert_buyWhenSoldOut_SoldOut() public {
        for (uint256 i = 0; i < CAPACITY; ++i) {
            _buy(_buyer(string.concat("fan", vm.toString(i))));
        }
        CurtainEvent.BuyIntent memory intent = _intent(alice, PRICE);
        bytes memory sig = _signIntent(alice.key, intent);
        CurtainEvent.Permit memory p = _permit(alice, PRICE);
        vm.expectRevert(CurtainEvent.SoldOut.selector);
        ev.buy(intent, sig, p);
    }

    function test_revert_buyAfterSalesEnd_SalesClosed() public {
        CurtainEvent.BuyIntent memory intent = _intent(alice, PRICE);
        bytes memory sig = _signIntent(alice.key, intent);
        CurtainEvent.Permit memory p = _permit(alice, PRICE);
        vm.warp(salesEnd);
        vm.expectRevert(CurtainEvent.SalesClosed.selector);
        ev.buy(intent, sig, p);
    }

    function test_revert_buyWithForgedIntent_BadSignature() public {
        CurtainEvent.BuyIntent memory intent = _intent(alice, PRICE);
        bytes memory sig = _signIntent(bob.key, intent);
        CurtainEvent.Permit memory p = _permit(alice, PRICE);
        vm.expectRevert(CurtainEvent.BadSignature.selector);
        ev.buy(intent, sig, p);
    }

    function test_revert_buyIntentReplayed_InvalidAccountNonce() public {
        CurtainEvent.BuyIntent memory intent = _intent(alice, PRICE);
        bytes memory sig = _signIntent(alice.key, intent);
        CurtainEvent.Permit memory p = _permit(alice, 2 * uint256(PRICE));
        ev.buy(intent, sig, p);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, alice.addr, 1));
        ev.buy(intent, sig, p);
    }

    function test_revert_buyWithWrongPrice_PriceMismatch() public {
        CurtainEvent.BuyIntent memory intent = _intent(alice, PRICE - 1);
        bytes memory sig = _signIntent(alice.key, intent);
        CurtainEvent.Permit memory p = _permit(alice, PRICE);
        vm.expectRevert(CurtainEvent.PriceMismatch.selector);
        ev.buy(intent, sig, p);
    }

    function test_revert_buyWithInvalidPasskey_InvalidPublicKey() public {
        CurtainEvent.BuyIntent memory intent = _intent(alice, PRICE);
        intent.qy = bytes32(uint256(intent.qy) ^ 1);
        bytes memory sig = _signIntent(alice.key, intent);
        CurtainEvent.Permit memory p = _permit(alice, PRICE);
        vm.expectRevert(CurtainEvent.InvalidPublicKey.selector);
        ev.buy(intent, sig, p);
    }

    function test_revert_buyWithoutAllowance_InsufficientAllowance() public {
        CurtainEvent.BuyIntent memory intent = _intent(alice, PRICE);
        bytes memory sig = _signIntent(alice.key, intent);
        CurtainEvent.Permit memory none;
        vm.expectRevert(CurtainEvent.InsufficientAllowance.selector);
        ev.buy(intent, sig, none);
    }

    function test_refundToRevertingHolder_becomesRefundOwed_thenClaimRefundPays() public {
        uint256 a = _buy(alice);
        uint256 b = _buy(bob);
        vm.prank(organizer);
        ev.cancel(0, 0, "");
        usdc.setBlocked(alice.addr, true);

        vm.expectEmit(address(ev));
        emit CurtainEvent.RefundOwed(a, alice.addr, PRICE);
        ev.pushRefunds(10);

        // Alice's failure did not block Bob's refund.
        assertEq(uint8(ev.getTicket(a).state), uint8(CurtainEvent.TicketState.RefundOwed));
        assertEq(uint8(ev.getTicket(b).state), uint8(CurtainEvent.TicketState.Refunded));
        assertEq(usdc.balanceOf(bob.addr), 100e6);
        assertEq(ev.escrowed(), PRICE);

        usdc.setBlocked(alice.addr, false);
        ev.claimRefund(a);
        assertEq(uint8(ev.getTicket(a).state), uint8(CurtainEvent.TicketState.Refunded));
        assertEq(usdc.balanceOf(alice.addr), 100e6);
        assertEq(ev.escrowed(), 0);
    }

    function test_revert_refundWhileOpen_NotRefundable() public {
        uint256 id = _buy(alice);
        vm.expectRevert(CurtainEvent.NotRefundable.selector);
        ev.claimRefund(id);
        vm.expectRevert(CurtainEvent.NotRefundable.selector);
        ev.pushRefunds(1);
    }

    function test_revert_refundScannedTicket_NothingToRefund() public {
        uint256 id = _buy(alice);
        _openDoors();
        _checkIn(id, alice.passkey);
        vm.prank(organizer);
        ev.cancel(0, 0, "");
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.NothingToRefund.selector, id));
        ev.claimRefund(id);
    }

    function test_revert_claimWithWrongKey_BadSignature() public {
        uint256 id = _buy(alice);
        (address claimKey,) = makeAddrAndKey("gift link key");
        (, uint256 wrongPk) = makeAddrAndKey("not the gift link key");
        vm.prank(alice.addr);
        ev.setClaim(id, claimKey, 0, 0, "");

        (bytes32 qx, bytes32 qy) = _passkeyXY(bob.passkey);
        bytes memory sig = _claimSig(wrongPk, id, bob.addr, qx, qy);
        vm.expectRevert(CurtainEvent.BadSignature.selector);
        ev.claim(id, bob.addr, qx, qy, sig);
    }

    function test_revert_claimAfterRevoke_NoClaimKey() public {
        uint256 id = _buy(alice);
        (address claimKey, uint256 claimPk) = makeAddrAndKey("gift link key");
        vm.startPrank(alice.addr);
        ev.setClaim(id, claimKey, 0, 0, "");
        ev.setClaim(id, address(0), 0, 0, ""); // revoke
        vm.stopPrank();

        (bytes32 qx, bytes32 qy) = _passkeyXY(bob.passkey);
        bytes memory sig = _claimSig(claimPk, id, bob.addr, qx, qy);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.NoClaimKey.selector, id));
        ev.claim(id, bob.addr, qx, qy, sig);
    }

    function test_revert_oldGiftLinkAfterRegenerate_BadSignature() public {
        uint256 id = _buy(alice);
        (address claimKey, uint256 claimPk) = makeAddrAndKey("gift link key");
        (bytes32 qx, bytes32 qy) = _passkeyXY(bob.passkey);
        vm.prank(alice.addr);
        ev.setClaim(id, claimKey, 0, 0, "");
        bytes memory oldSig = _claimSig(claimPk, id, bob.addr, qx, qy);

        // Regenerating the link with the same key bumps the claim nonce, so the old link dies.
        vm.prank(alice.addr);
        ev.setClaim(id, claimKey, 0, 0, "");
        vm.expectRevert(CurtainEvent.BadSignature.selector);
        ev.claim(id, bob.addr, qx, qy, oldSig);
    }

    function test_revert_settleTooEarly_NotSettleable() public {
        _buy(alice);
        vm.warp(uint256(endTime) + SETTLE_DELAY - 1);
        vm.expectRevert(CurtainEvent.NotSettleable.selector);
        ev.settle();
    }

    function test_revert_settleAfterCancel_NotSettleable() public {
        vm.prank(organizer);
        ev.cancel(0, 0, "");
        vm.warp(uint256(endTime) + SETTLE_DELAY);
        vm.expectRevert(CurtainEvent.NotSettleable.selector);
        ev.settle();
    }

    function test_revert_cancelByStranger_NotOrganizer() public {
        vm.expectRevert(CurtainEvent.NotOrganizer.selector);
        ev.cancel(0, 0, "");
    }

    // =====================================================================
    // A BuyIntent is bound to one sale
    // =====================================================================

    function test_revert_primaryIntentSpentOnResale_WrongSale() public {
        uint256 id = _buy(alice);
        _list(alice, id, PRICE);
        // Bob signed a primary buy (ticketId 0) at the same price; a relayer tries it on the resale.
        CurtainEvent.BuyIntent memory i = _intent(bob, PRICE);
        bytes memory sig = _signIntent(bob.key, i);
        CurtainEvent.Permit memory p = _permit(bob, PRICE);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.WrongSale.selector, 0, id));
        vm.prank(relayer);
        ev.buyResale(id, i, sig, p);
    }

    function test_revert_resaleIntentSpentOnAnotherTicket_WrongSale() public {
        uint256 a = _buy(alice);
        uint256 c = _buy(carol);
        _list(alice, a, PRICE);
        _list(carol, c, PRICE);
        // Bob agreed to buy Alice's ticket; a relayer tries to use that intent on Carol's.
        CurtainEvent.BuyIntent memory i = _intentFor(bob, a, PRICE);
        bytes memory sig = _signIntent(bob.key, i);
        CurtainEvent.Permit memory p = _permit(bob, PRICE);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.WrongSale.selector, a, c));
        vm.prank(relayer);
        ev.buyResale(c, i, sig, p);
    }

    function test_revert_resaleIntentSpentOnPrimaryBuy_WrongSale() public {
        CurtainEvent.BuyIntent memory i = _intentFor(bob, 1, PRICE);
        bytes memory sig = _signIntent(bob.key, i);
        CurtainEvent.Permit memory p = _permit(bob, PRICE);
        vm.expectRevert(abi.encodeWithSelector(CurtainEvent.WrongSale.selector, 1, 0));
        ev.buy(i, sig, p);
    }

    // =====================================================================
    // Organizer actions by signature (the organizer key stays off servers)
    // =====================================================================

    function _orgSig(bytes32 structHash) internal view returns (bytes memory) {
        return _sign(ORGANIZER_KEY, structHash);
    }

    function test_withdrawBySignature_paysTheFixedPayout() public {
        uint256 id = _buy(alice);
        _openDoors();
        _checkIn(id, alice.passkey);
        uint256 nonce = ev.nonces(organizer);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _orgSig(keccak256(abi.encode(ev.WITHDRAW_TYPEHASH(), PRICE, nonce, deadline)));

        vm.prank(relayer);
        ev.withdraw(PRICE, nonce, deadline, sig);
        assertEq(usdc.balanceOf(payout), PRICE);
        assertEq(usdc.balanceOf(relayer), 0);
        assertEq(ev.nonces(organizer), nonce + 1);
    }

    function test_cancelBySignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _orgSig(keccak256(abi.encode(ev.CANCEL_TYPEHASH(), 0, deadline)));
        vm.prank(relayer);
        ev.cancel(0, deadline, sig);
        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.Cancelled));
    }

    function test_setGateBySignature() public {
        address gate2 = makeAddr("gate2");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _orgSig(keccak256(abi.encode(ev.SET_GATE_TYPEHASH(), gate2, true, 0, deadline)));
        vm.prank(relayer);
        ev.setGate(gate2, true, 0, deadline, sig);
        assertTrue(ev.isGate(gate2));
    }

    function test_revert_withdrawWithForgedSignature_BadSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(bob.key, keccak256(abi.encode(ev.WITHDRAW_TYPEHASH(), 0, 0, deadline)));
        vm.expectRevert(CurtainEvent.BadSignature.selector);
        vm.prank(relayer);
        ev.withdraw(0, 0, deadline, sig);
    }

    function test_revert_organizerSignatureReplayed_InvalidAccountNonce() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _orgSig(keccak256(abi.encode(ev.WITHDRAW_TYPEHASH(), 0, 0, deadline)));
        ev.withdraw(0, 0, deadline, sig);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, organizer, 1));
        ev.withdraw(0, 0, deadline, sig);
    }

    function test_revert_organizerSignatureExpired_SignatureExpired() public {
        uint256 deadline = block.timestamp - 1;
        bytes memory sig = _orgSig(keccak256(abi.encode(ev.CANCEL_TYPEHASH(), 0, deadline)));
        vm.expectRevert(CurtainEvent.SignatureExpired.selector);
        ev.cancel(0, deadline, sig);
    }

    function test_revert_strangerHolderActionWithoutSignature_NotHolder() public {
        uint256 id = _buy(alice);
        vm.expectRevert(CurtainEvent.NotHolder.selector);
        vm.prank(bob.addr);
        ev.listForResale(id, PRICE, 0, 0, "");
    }

    // =====================================================================
    // Factory and initialization
    // =====================================================================

    function test_factory_createEvent_initializesClone() public {
        CurtainEvent.EventParams memory p = _params();
        vm.expectEmit(false, true, true, false, address(factory));
        emit CurtainFactory.EventCreated(
            address(0), organizer, address(usdc), PRICE, CAPACITY, salesEnd, doorsOpen, endTime, p.rpIdHash
        );
        vm.prank(organizer);
        CurtainEvent e = CurtainEvent(factory.createEvent(p));

        assertEq(e.organizer(), organizer);
        assertEq(e.payout(), payout);
        assertEq(address(e.token()), address(usdc));
        assertEq(e.price(), PRICE);
        assertEq(e.capacity(), CAPACITY);
        assertEq(e.rpIdHash(), p.rpIdHash);
        assertTrue(e.isGate(gate));
        assertTrue(e.domainSeparator() != ev.domainSeparator()); // each clone signs under its own address
    }

    function test_factory_defaultsForZeroThresholdAndAge() public {
        CurtainEvent.EventParams memory p = _params();
        p.heldThresholdBps = 0;
        p.maxChallengeAge = 0;
        CurtainEvent e = CurtainEvent(factory.createEvent(p));
        assertEq(e.heldThresholdBps(), 5000);
        assertEq(e.maxChallengeAge(), 300);
    }

    function test_revert_factory_badParams_InvalidParams() public {
        CurtainEvent.EventParams memory p = _params();
        p.price = 0;
        vm.expectRevert(CurtainEvent.InvalidParams.selector);
        factory.createEvent(p);

        p = _params();
        p.doorsOpen = p.endTime + 1;
        vm.expectRevert(CurtainEvent.InvalidParams.selector);
        factory.createEvent(p);

        p = _params();
        p.heldThresholdBps = 10_001;
        vm.expectRevert(CurtainEvent.InvalidParams.selector);
        factory.createEvent(p);
    }

    function test_revert_cloneCannotBeReinitialized() public {
        CurtainEvent.EventParams memory p = _params();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        ev.initialize(relayer, p);
    }

    function test_revert_implementationCannotBeInitialized() public {
        CurtainEvent.EventParams memory p = _params();
        CurtainEvent impl = CurtainEvent(factory.implementation());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(relayer, p);
    }
}
