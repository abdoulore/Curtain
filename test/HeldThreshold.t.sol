// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurtainEvent} from "../src/CurtainEvent.sol";
import {CurtainTestBase} from "./utils/CurtainTestBase.sol";

/// @dev Every show uses the same rule: held when at least half of the tickets sold were checked in.
contract HeldThresholdTest is CurtainTestBase {
    function _sellAndScan(uint256 sold, uint256 scanned) internal {
        Buyer[] memory buyers = new Buyer[](sold);
        for (uint256 i = 0; i < sold; ++i) {
            buyers[i] = _buyer(string(abi.encodePacked("buyer", vm.toString(i))));
            _buy(buyers[i]);
        }
        _openDoors();
        for (uint256 i = 0; i < scanned; ++i) {
            _checkIn(i + 1, buyers[i].passkey);
        }
        vm.warp(endTime + SETTLE_DELAY);
        ev.settle();
    }

    function test_exactlyHalfIsHeld() public {
        _sellAndScan(4, 2);
        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.Held));
        assertEq(ev.released(), 4 * uint256(PRICE));
    }

    function test_underHalfIsNotHeld() public {
        _sellAndScan(3, 1);
        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.NotHeld));
        assertEq(ev.escrowed(), 2 * uint256(PRICE));
    }

    function test_noCheckInsIsNotHeld() public {
        _sellAndScan(1, 0);
        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.NotHeld));
    }

    function test_noSalesSettlesAsHeldWithNothingToRelease() public {
        _sellAndScan(0, 0);
        assertEq(uint8(ev.status()), uint8(CurtainEvent.EventStatus.Held));
        assertEq(ev.released(), 0);
    }

    function test_thresholdIsTheSameForEveryShow() public view {
        assertEq(ev.HELD_THRESHOLD_BPS(), 5000);
    }
}
