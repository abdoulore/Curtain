// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {CurtainEvent} from "./CurtainEvent.sol";

/// @title CurtainFactory
/// @notice Deploys one CurtainEvent clone per event. Holds no money and has no function that can touch an event's
/// escrow. The organizer is the caller of `createEvent`, or the signer of a relayed `createEventFor`.
contract CurtainFactory is EIP712, Nonces {
    struct Details {
        string name;
        string venue;
    }

    bytes32 public constant SHOW_TYPEHASH = keccak256(
        "Show(address payout,address token,uint96 price,uint32 capacity,uint64 salesEnd,uint64 doorsOpen,uint64 endTime,uint64 settleDelay,uint16 heldThresholdBps,uint32 maxChallengeAge,uint16 maxPerBuyer,bytes32 rpIdHash,address[] gates)"
    );
    bytes32 public constant CREATE_SHOW_TYPEHASH = keccak256(
        "CreateShow(address organizer,string name,string venue,Show show,uint256 nonce,uint256 deadline)Show(address payout,address token,uint96 price,uint32 capacity,uint64 salesEnd,uint64 doorsOpen,uint64 endTime,uint64 settleDelay,uint16 heldThresholdBps,uint32 maxChallengeAge,uint16 maxPerBuyer,bytes32 rpIdHash,address[] gates)"
    );

    address public immutable implementation;
    mapping(address eventAddress => Details) internal _details;

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
    event ShowDetails(address indexed eventAddress, string name, string venue);

    error SignatureExpired();
    error BadSignature();

    constructor() EIP712("CurtainFactory", "1") {
        implementation = address(new CurtainEvent());
    }

    /// @notice Creates an event organized by the caller.
    function createEvent(CurtainEvent.EventParams calldata p) external returns (address eventAddress) {
        eventAddress = _create(msg.sender, p, "", "");
    }

    /// @notice Creates an event for an organizer who signed `CreateShow`, so a relayer can pay the gas.
    function createEventFor(
        address organizer,
        CurtainEvent.EventParams calldata p,
        string calldata name,
        string calldata venue,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external returns (address eventAddress) {
        if (block.timestamp > deadline) revert SignatureExpired();
        _useCheckedNonce(organizer, nonce);
        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_SHOW_TYPEHASH,
                organizer,
                keccak256(bytes(name)),
                keccak256(bytes(venue)),
                hashShow(p),
                nonce,
                deadline
            )
        );
        if (!SignatureChecker.isValidSignatureNowCalldata(organizer, _hashTypedDataV4(structHash), sig)) {
            revert BadSignature();
        }
        eventAddress = _create(organizer, p, name, venue);
    }

    /// @notice The name and venue an organizer gave a show (empty for shows made with `createEvent`).
    function details(address eventAddress) external view returns (string memory name, string memory venue) {
        Details storage d = _details[eventAddress];
        return (d.name, d.venue);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice EIP-712 struct hash of the event parameters.
    function hashShow(CurtainEvent.EventParams calldata p) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SHOW_TYPEHASH,
                p.payout,
                p.token,
                p.price,
                p.capacity,
                p.salesEnd,
                p.doorsOpen,
                p.endTime,
                p.settleDelay,
                p.heldThresholdBps,
                p.maxChallengeAge,
                p.maxPerBuyer,
                p.rpIdHash,
                keccak256(abi.encodePacked(p.gates))
            )
        );
    }

    function _create(address organizer, CurtainEvent.EventParams calldata p, string memory name, string memory venue)
        internal
        returns (address eventAddress)
    {
        eventAddress = Clones.clone(implementation);
        CurtainEvent(eventAddress).initialize(organizer, p);
        emit EventCreated(
            eventAddress,
            organizer,
            address(p.token),
            p.price,
            p.capacity,
            p.salesEnd,
            p.doorsOpen,
            p.endTime,
            p.rpIdHash
        );
        if (bytes(name).length != 0 || bytes(venue).length != 0) {
            _details[eventAddress] = Details(name, venue);
            emit ShowDetails(eventAddress, name, venue);
        }
    }
}
