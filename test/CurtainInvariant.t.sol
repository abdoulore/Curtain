// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {console} from "forge-std/Test.sol";
import {CurtainEvent} from "../src/CurtainEvent.sol";
import {MockUSDC} from "./utils/MockUSDC.sol";
import {CurtainTestBase} from "./utils/CurtainTestBase.sol";

/// @dev Drives random sequences of every money-moving action. Failed calls are swallowed; ghost totals only
/// move on success.
contract EscrowHandler is CurtainTestBase {
    Buyer[] internal actors;
    mapping(address => uint256) internal passkeyOf;

    uint256 public ghostPaidIn;
    uint256 public calls;
    // Success counters, to confirm the run reaches every path.
    mapping(bytes32 => uint256) public ok;

    constructor(CurtainEvent ev_, MockUSDC usdc_) {
        ev = ev_;
        usdc = usdc_;
        doorsOpen = ev_.doorsOpen();
        endTime = ev_.endTime();
        salesEnd = ev_.salesEnd();
        for (uint256 i = 0; i < 5; ++i) {
            Buyer memory b = _buyer(string.concat("actor", vm.toString(i)));
            actors.push(b);
            passkeyOf[b.addr] = b.passkey;
        }
    }

    function _actor(uint256 seed) internal view returns (Buyer memory) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    function _ticket(uint256 seed) internal view returns (uint256) {
        uint256 sold = ev.sold();
        return sold == 0 ? 0 : bound(seed, 1, sold);
    }

    function buy(uint256 actorSeed) external {
        ++calls;
        Buyer memory b = _actor(actorSeed);
        usdc.mint(b.addr, PRICE);
        CurtainEvent.BuyIntent memory i = _intent(b, PRICE);
        bytes memory sig = _signIntent(b.key, i);
        CurtainEvent.Permit memory p = _permit(b, PRICE);
        try ev.buy(i, sig, p) {
            ghostPaidIn += PRICE;
            ++ok["buy"];
        } catch {}
    }

    function checkIn(uint256 ticketSeed) external {
        ++calls;
        uint256 id = _ticket(ticketSeed);
        if (id == 0) return;
        vm.roll(block.number + 1);
        bytes32 nonce = _gateNonce(id);
        uint256 passkey = passkeyOf[ev.getTicket(id).holder];
        WebAuthn.WebAuthnAuth memory auth = _assertion(passkey, ev.challengeFor(id, nonce, block.number), RP_ID);
        vm.prank(gate);
        try ev.checkIn(id, nonce, block.number, "", auth) {
            ++ok["checkIn"];
        } catch {}
    }

    function withdraw(uint256 amountSeed) external {
        ++calls;
        uint256 amount = bound(amountSeed, 0, ev.availableToWithdraw() + 1);
        vm.prank(organizer);
        try ev.withdraw(amount, 0, 0, "") {
            ++ok["withdraw"];
        } catch {}
    }

    function cancel(uint256 seed) external {
        ++calls;
        // Hashed so the fuzzer's favourite small seeds do not cancel most runs; about one run in four cancels.
        if (uint256(keccak256(abi.encode(seed))) % 32 != 0) return;
        vm.prank(organizer);
        try ev.cancel(0, 0, "") {
            ++ok["cancel"];
        } catch {}
    }

    function settle() external {
        ++calls;
        try ev.settle() {
            ++ok["settle"];
        } catch {}
    }

    function pushRefunds(uint256 maxSeed) external {
        ++calls;
        try ev.pushRefunds(bound(maxSeed, 0, 6)) {
            ++ok["pushRefunds"];
        } catch {}
    }

    function claimRefund(uint256 ticketSeed) external {
        ++calls;
        uint256 id = _ticket(ticketSeed);
        if (id == 0) return;
        try ev.claimRefund(id) {
            ++ok["claimRefund"];
        } catch {}
    }

    function toggleBlocked(uint256 actorSeed) external {
        ++calls;
        Buyer memory b = _actor(actorSeed);
        usdc.setBlocked(b.addr, !usdc.blocked(b.addr));
    }

    function resale(uint256 ticketSeed, uint256 buyerSeed, uint256 priceSeed) external {
        ++calls;
        uint256 id = _ticket(ticketSeed);
        if (id == 0) return;
        uint256 listPrice = bound(priceSeed, 1, PRICE);
        address holder = ev.getTicket(id).holder;
        vm.prank(holder);
        try ev.listForResale(id, listPrice, 0, 0, "") {}
        catch {
            return;
        }
        Buyer memory b = _actor(buyerSeed);
        usdc.mint(b.addr, listPrice);
        CurtainEvent.BuyIntent memory i = _intent(b, listPrice);
        bytes memory sig = _signIntent(b.key, i);
        CurtainEvent.Permit memory p = _permit(b, listPrice);
        try ev.buyResale(id, i, sig, p) {
            ++ok["resale"];
        } catch {}
    }

    function gift(uint256 ticketSeed, uint256 friendSeed) external {
        ++calls;
        uint256 id = _ticket(ticketSeed);
        if (id == 0) return;
        (address claimKey, uint256 claimPk) = makeAddrAndKey("invariant gift key");
        vm.prank(ev.getTicket(id).holder);
        try ev.setClaim(id, claimKey, 0, 0, "") {}
        catch {
            return;
        }
        Buyer memory f = _actor(friendSeed);
        (bytes32 qx, bytes32 qy) = _passkeyXY(f.passkey);
        bytes memory sig = _claimSig(claimPk, id, f.addr, qx, qy);
        try ev.claim(id, f.addr, qx, qy, sig) {
            ++ok["gift"];
        } catch {}
    }

    function warp(uint256 secondsSeed) external {
        ++calls;
        vm.warp(block.timestamp + bound(secondsSeed, 0, 12 hours));
        vm.roll(block.number + 1);
    }
}

contract CurtainInvariantTest is CurtainTestBase {
    EscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        // Own event with doors open from the start, so random runs reach check-in, settlement and refunds.
        CurtainEvent.EventParams memory p = _params();
        p.doorsOpen = uint64(block.timestamp);
        vm.prank(organizer);
        ev = CurtainEvent(factory.createEvent(p));
        handler = new EscrowHandler(ev, usdc);
        targetContract(address(handler));
        // Only the actions. The handler inherits a public setUp() that would swap in a fresh event.
        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = EscrowHandler.buy.selector;
        selectors[1] = EscrowHandler.checkIn.selector;
        selectors[2] = EscrowHandler.withdraw.selector;
        selectors[3] = EscrowHandler.cancel.selector;
        selectors[4] = EscrowHandler.settle.selector;
        selectors[5] = EscrowHandler.pushRefunds.selector;
        selectors[6] = EscrowHandler.claimRefund.selector;
        selectors[7] = EscrowHandler.toggleBlocked.selector;
        selectors[8] = EscrowHandler.resale.selector;
        selectors[9] = EscrowHandler.gift.selector;
        selectors[10] = EscrowHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice Money paid in equals released plus refunded plus still escrowed, at every step.
    function invariant_paidInEqualsReleasedPlusRefundedPlusEscrowed() public view {
        assertEq(ev.totalPaidIn(), ev.released() + ev.refunded() + ev.escrowed());
    }

    function invariant_paidInMatchesSuccessfulBuys() public view {
        assertEq(ev.totalPaidIn(), handler.ghostPaidIn());
    }

    /// @notice The contract holds exactly what has not left through withdrawals or refunds.
    function invariant_tokenBalanceMatchesAccounting() public view {
        assertEq(usdc.balanceOf(address(ev)), ev.escrowed() + ev.released() - ev.withdrawn());
    }

    function invariant_withdrawnNeverExceedsReleased() public view {
        assertLe(ev.withdrawn(), ev.released());
    }

    /// @notice Escrow is backed ticket by ticket: unscanned and owed tickets carry exactly one face value each,
    /// except after a Held settlement released them all.
    function invariant_escrowMatchesTickets() public view {
        uint256 sold = ev.sold();
        uint256 owed;
        uint256 scanned;
        for (uint256 id = 1; id <= sold; ++id) {
            CurtainEvent.TicketState s = ev.getTicket(id).state;
            if (s == CurtainEvent.TicketState.Active || s == CurtainEvent.TicketState.RefundOwed) ++owed;
            if (s == CurtainEvent.TicketState.CheckedIn) ++scanned;
        }
        assertEq(scanned, ev.checkedIn());
        if (ev.status() == CurtainEvent.EventStatus.Held) {
            assertEq(ev.escrowed(), 0);
        } else {
            assertEq(ev.escrowed(), owed * PRICE);
        }
    }

    function afterInvariant() public view {
        string[9] memory names =
            ["buy", "checkIn", "withdraw", "cancel", "settle", "pushRefunds", "claimRefund", "resale", "gift"];
        for (uint256 i = 0; i < names.length; ++i) {
            console.log(names[i], handler.ok(bytes32(bytes(names[i]))));
        }
    }
}
