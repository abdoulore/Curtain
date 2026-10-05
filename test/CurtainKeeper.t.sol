// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CurtainEvent} from "../src/CurtainEvent.sol";
import {CurtainKeeper, IReceiver} from "../src/CurtainKeeper.sol";
import {CurtainTestBase} from "./utils/CurtainTestBase.sol";

contract CurtainKeeperTest is CurtainTestBase {
    CurtainKeeper internal keeper;
    address internal forwarder = makeAddr("forwarder");
    address internal keeperOwner = makeAddr("keeperOwner");

    function setUp() public override {
        super.setUp();
        keeper = new CurtainKeeper(forwarder, factory.implementation(), 2, keeperOwner);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _events() internal view returns (address[] memory list) {
        list = new address[](1);
        list[0] = address(ev);
    }

    function _report(address eventAddress, CurtainKeeper.Action action) internal pure returns (bytes memory) {
        CurtainKeeper.Job[] memory jobs = new CurtainKeeper.Job[](1);
        jobs[0] = CurtainKeeper.Job(eventAddress, action);
        return abi.encode(jobs);
    }

    function _deliver(bytes memory report) internal {
        vm.prank(forwarder);
        keeper.onReport("", report);
    }

    /// The workflow's loop: read what is pending, report it, until nothing is left.
    function _runWorkflowUntilIdle() internal returns (uint256 reports) {
        for (;;) {
            CurtainKeeper.Job[] memory jobs = keeper.pending(_events());
            if (jobs.length == 0) return reports;
            _deliver(abi.encode(jobs));
            ++reports;
        }
    }

    function _buyers(uint256 n) internal returns (Buyer[] memory list) {
        list = new Buyer[](n);
        for (uint256 i = 0; i < n; ++i) {
            list[i] = _buyer(string(abi.encodePacked("buyer", vm.toString(i))));
            _buy(list[i]);
        }
    }

    function _cancel() internal {
        vm.prank(organizer);
        ev.cancel(0, 0, "");
    }

    // ---------------------------------------------------------------------
    // pending
    // ---------------------------------------------------------------------

    function test_pendingIsEmptyWhileTheShowRuns() public {
        _buyers(1);
        vm.warp(endTime + SETTLE_DELAY - 1);
        assertEq(keeper.pending(_events()).length, 0);
    }

    function test_pendingSettlesAfterTheDelay() public {
        _buyers(1);
        vm.warp(endTime + SETTLE_DELAY);
        CurtainKeeper.Job[] memory jobs = keeper.pending(_events());
        assertEq(jobs.length, 1);
        assertEq(jobs[0].eventAddress, address(ev));
        assertEq(uint8(jobs[0].action), uint8(CurtainKeeper.Action.Settle));
    }

    function test_pendingPushesRefundsAfterCancel() public {
        _buyers(1);
        _cancel();
        CurtainKeeper.Job[] memory jobs = keeper.pending(_events());
        assertEq(jobs.length, 1);
        assertEq(uint8(jobs[0].action), uint8(CurtainKeeper.Action.PushRefunds));
    }

    function test_pendingIgnoresOtherContracts() public {
        address[] memory list = new address[](2);
        list[0] = address(usdc);
        list[1] = makeAddr("eoa");
        assertEq(keeper.pending(list).length, 0);
    }

    function test_pendingIsEmptyOnceHeld() public {
        Buyer[] memory b = _buyers(1);
        _openDoors();
        _checkIn(1, b[0].passkey);
        vm.warp(endTime + SETTLE_DELAY);
        _deliver(_report(address(ev), CurtainKeeper.Action.Settle));
        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.Held));
        assertEq(keeper.pending(_events()).length, 0);
    }

    // ---------------------------------------------------------------------
    // onReport
    // ---------------------------------------------------------------------

    function test_cancelledShowRefundsEveryBuyerWithoutAManualPush() public {
        Buyer[] memory b = _buyers(5);
        _cancel();

        // Batches of 2: three reports cover five tickets.
        assertEq(_runWorkflowUntilIdle(), 3);

        for (uint256 i = 0; i < b.length; ++i) {
            assertEq(usdc.balanceOf(b[i].addr), 100e6);
            assertEq(uint8(ev.getTicket(i + 1).state), uint8(CurtainEvent.TicketState.Refunded));
        }
        assertEq(ev.escrowed(), 0);
        assertEq(ev.refunded(), 5 * uint256(PRICE));
    }

    function test_showNotHeldSettlesAndRefundsInOneReport() public {
        Buyer[] memory b = _buyers(2);
        vm.warp(endTime + SETTLE_DELAY);

        vm.expectEmit(address(keeper));
        emit CurtainKeeper.Kept(address(ev), CurtainKeeper.Action.Settle, 2);
        _deliver(_report(address(ev), CurtainKeeper.Action.Settle));

        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.NotHeld));
        assertEq(usdc.balanceOf(b[0].addr), 100e6);
        assertEq(usdc.balanceOf(b[1].addr), 100e6);
        assertEq(keeper.pending(_events()).length, 0);
    }

    function test_heldShowReleasesUnscannedMoney() public {
        Buyer[] memory b = _buyers(2);
        _openDoors();
        _checkIn(1, b[0].passkey);
        vm.warp(endTime + SETTLE_DELAY);

        assertEq(_runWorkflowUntilIdle(), 1);
        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.Held));
        assertEq(ev.released(), 2 * uint256(PRICE));
        assertEq(ev.escrowed(), 0);
    }

    function test_onlyTheForwarderDelivers() public {
        _cancel();
        vm.expectRevert(abi.encodeWithSelector(CurtainKeeper.NotForwarder.selector, address(this)));
        keeper.onReport("", _report(address(ev), CurtainKeeper.Action.PushRefunds));
    }

    function test_staleReportIsSkippedNotReverted() public {
        _buyers(1);
        vm.warp(endTime + SETTLE_DELAY);
        _deliver(_report(address(ev), CurtainKeeper.Action.Settle));

        // The same report again: settle now reverts inside the event, and the keeper logs it instead.
        vm.expectEmit(address(keeper));
        emit CurtainKeeper.Skipped(
            address(ev), CurtainKeeper.Action.Settle, abi.encodeWithSelector(CurtainEvent.NotSettleable.selector)
        );
        _deliver(_report(address(ev), CurtainKeeper.Action.Settle));
    }

    function test_refundsBeforeCancelAreSkipped() public {
        _buyers(1);
        vm.expectEmit(address(keeper));
        emit CurtainKeeper.Skipped(
            address(ev), CurtainKeeper.Action.PushRefunds, abi.encodeWithSelector(CurtainEvent.NotRefundable.selector)
        );
        _deliver(_report(address(ev), CurtainKeeper.Action.PushRefunds));
        assertEq(ev.escrowed(), PRICE);
    }

    function test_nonCurtainTargetIsSkipped() public {
        vm.expectEmit(address(keeper));
        emit CurtainKeeper.Skipped(address(usdc), CurtainKeeper.Action.Settle, "not a Curtain event");
        _deliver(_report(address(usdc), CurtainKeeper.Action.Settle));
    }

    function test_oneBadJobDoesNotBlockTheRest() public {
        Buyer[] memory b = _buyers(1);
        _cancel();
        CurtainKeeper.Job[] memory jobs = new CurtainKeeper.Job[](2);
        jobs[0] = CurtainKeeper.Job(address(usdc), CurtainKeeper.Action.PushRefunds);
        jobs[1] = CurtainKeeper.Job(address(ev), CurtainKeeper.Action.PushRefunds);
        _deliver(abi.encode(jobs));
        assertEq(usdc.balanceOf(b[0].addr), 100e6);
    }

    // ---------------------------------------------------------------------
    // Setup and admin
    // ---------------------------------------------------------------------

    function test_supportsReceiverInterface() public view {
        assertTrue(keeper.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(keeper.supportsInterface(type(IERC165).interfaceId));
        assertFalse(keeper.supportsInterface(0xffffffff));
    }

    function test_recognisesFactoryClones() public view {
        assertTrue(keeper.isCurtainEvent(address(ev)));
        assertFalse(keeper.isCurtainEvent(factory.implementation()));
        assertFalse(keeper.isCurtainEvent(address(usdc)));
    }

    function test_ownerSwitchesForwarder() public {
        address production = makeAddr("production");
        vm.prank(keeperOwner);
        keeper.setForwarder(production);
        assertEq(keeper.forwarder(), production);

        _cancel();
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(CurtainKeeper.NotForwarder.selector, forwarder));
        keeper.onReport("", _report(address(ev), CurtainKeeper.Action.PushRefunds));
    }

    function test_strangerCannotSwitchForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        keeper.setForwarder(address(this));
    }

    function test_rejectsZeroForwarderAndBatch() public {
        address impl = factory.implementation();
        vm.expectRevert(CurtainKeeper.InvalidForwarder.selector);
        new CurtainKeeper(address(0), impl, 2, keeperOwner);
        vm.expectRevert(CurtainKeeper.InvalidBatch.selector);
        new CurtainKeeper(forwarder, impl, 0, keeperOwner);
        vm.prank(keeperOwner);
        vm.expectRevert(CurtainKeeper.InvalidForwarder.selector);
        keeper.setForwarder(address(0));
    }
}
