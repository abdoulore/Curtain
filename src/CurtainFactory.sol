// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {CurtainEvent} from "./CurtainEvent.sol";

/// @title CurtainFactory
/// @notice Deploys one CurtainEvent clone per event. Holds no money and has no function that can touch an event's
/// escrow; the caller becomes the event's organizer.
contract CurtainFactory {
    address public immutable implementation;

    event EventCreated(
        address indexed eventAddress,
        address indexed organizer,
        address indexed token,
        uint256 price,
        uint256 capacity,
        uint64 salesEnd,
        uint64 doorsOpen,
        uint64 endTime,
        bytes32 rpIdHash
    );

    constructor() {
        implementation = address(new CurtainEvent());
    }

    function createEvent(CurtainEvent.EventParams calldata p) external returns (address eventAddress) {
        eventAddress = Clones.clone(implementation);
        CurtainEvent(eventAddress).initialize(msg.sender, p);
        emit EventCreated(
            eventAddress,
            msg.sender,
            address(p.token),
            p.price,
            p.capacity,
            p.salesEnd,
            p.doorsOpen,
            p.endTime,
            p.rpIdHash
        );
    }
}
