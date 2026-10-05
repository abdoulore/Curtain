// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {CurtainEvent} from "./CurtainEvent.sol";

/// @notice What a Chainlink KeystoneForwarder calls with a workflow's report.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title CurtainKeeper
/// @notice Receives reports from a Chainlink CRE workflow and settles finished events and pushes refund batches.
/// `settle` and `pushRefunds` are open to anyone, so the keeper holds no money and no special role: it only saves
/// people from having to call them. It acts only on genuine CurtainEvent clones, recognised by their code hash.
contract CurtainKeeper is IReceiver, Ownable {
    enum Action {
        None,
        Settle,
        PushRefunds
    }

    struct Job {
        address eventAddress;
        Action action;
    }

    /// @notice Only reports delivered by this forwarder are accepted.
    address public forwarder;
    /// @notice Runtime code hash of an EIP-1167 clone of the factory's CurtainEvent implementation.
    bytes32 public immutable eventCodeHash;
    /// @notice Tickets paid per pushRefunds call, so one report stays within its gas limit.
    uint256 public immutable refundBatch;

    event ForwarderUpdated(address indexed previous, address indexed current);
    event Kept(address indexed eventAddress, Action action, uint256 refundsProcessed);
    event Skipped(address indexed eventAddress, Action action, bytes reason);

    error InvalidForwarder();
    error InvalidBatch();
    error NotForwarder(address sender);

    constructor(address forwarder_, address implementation, uint256 refundBatch_, address owner_) Ownable(owner_) {
        if (forwarder_ == address(0)) revert InvalidForwarder();
        if (refundBatch_ == 0) revert InvalidBatch();
        forwarder = forwarder_;
        refundBatch = refundBatch_;
        eventCodeHash =
            keccak256(abi.encodePacked(hex"363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"));
    }

    /// @notice Switches between the simulation MockKeystoneForwarder and the production KeystoneForwarder.
    function setForwarder(address forwarder_) external onlyOwner {
        if (forwarder_ == address(0)) revert InvalidForwarder();
        emit ForwarderUpdated(forwarder, forwarder_);
        forwarder = forwarder_;
    }

    function isCurtainEvent(address eventAddress) public view returns (bool) {
        return eventAddress.codehash == eventCodeHash;
    }

    /// @notice What each listed escrow needs right now, only the ones with work. The workflow reads this and reports
    /// the result back.
    function pending(address[] calldata events) external view returns (Job[] memory jobs) {
        jobs = new Job[](events.length);
        uint256 n;
        for (uint256 i = 0; i < events.length; ++i) {
            Action action = _needed(events[i]);
            if (action != Action.None) jobs[n++] = Job(events[i], action);
        }
        assembly ("memory-safe") {
            mstore(jobs, n)
        }
    }

    /// @inheritdoc IReceiver
    /// @dev Never reverts on a stale or failing job: it is skipped with its reason, so one event can't hold up the
    /// rest, and a replayed report does nothing.
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        Job[] memory jobs = abi.decode(report, (Job[]));
        for (uint256 i = 0; i < jobs.length; ++i) {
            _run(jobs[i]);
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _run(Job memory job) internal {
        if (!isCurtainEvent(job.eventAddress)) {
            emit Skipped(job.eventAddress, job.action, "not a Curtain event");
            return;
        }
        CurtainEvent ev = CurtainEvent(job.eventAddress);
        if (job.action == Action.Settle) {
            try ev.settle() {}
            catch (bytes memory reason) {
                emit Skipped(job.eventAddress, job.action, reason);
                return;
            }
            // A show that wasn't held refunds in the same report.
            if (ev.status() != CurtainEvent.EventStatus.NotHeld) {
                emit Kept(job.eventAddress, job.action, 0);
                return;
            }
        } else if (job.action != Action.PushRefunds) {
            emit Skipped(job.eventAddress, job.action, "no action");
            return;
        }
        try ev.pushRefunds(refundBatch) returns (uint256 processed) {
            emit Kept(job.eventAddress, job.action, processed);
        } catch (bytes memory reason) {
            emit Skipped(job.eventAddress, job.action, reason);
        }
    }

    function _needed(address eventAddress) internal view returns (Action) {
        if (!isCurtainEvent(eventAddress)) return Action.None;
        CurtainEvent ev = CurtainEvent(eventAddress);
        CurtainEvent.EventStatus status = ev.status();
        if (status == CurtainEvent.EventStatus.Open) {
            return block.timestamp >= uint256(ev.endTime()) + ev.settleDelay() ? Action.Settle : Action.None;
        }
        if (status == CurtainEvent.EventStatus.Cancelled || status == CurtainEvent.EventStatus.NotHeld) {
            return ev.refundCursor() < ev.sold() ? Action.PushRefunds : Action.None;
        }
        return Action.None;
    }
}
