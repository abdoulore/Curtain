// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";

/// @title PasskeyCanary
/// @notice Canary for Curtain: proves a real passkey (WebAuthn, P-256) assertion can be verified onchain on Monad.
/// A ticket is bound to a P-256 public key. Checking in requires a fresh, single-use challenge signed by that key
/// with user verification (Face ID, Touch ID or device PIN).
/// @dev OZ `P256.verify` calls the P-256 precompile at 0x100 (EIP-7951) and only falls back to the Solidity
/// implementation when the precompile is absent. Gas used by `checkIn` tells the two paths apart.
contract PasskeyCanary {
    struct PublicKey {
        bytes32 qx;
        bytes32 qy;
    }

    /// @notice Max age of a challenge in blocks, counted from the block number it commits to.
    uint256 public immutable maxChallengeAge;

    /// @notice Next ticket id handed out by `register`. Ids start at 1 so 0 never refers to a ticket.
    uint256 public nextTicketId = 1;

    mapping(uint256 ticketId => PublicKey) public ticketKey;
    mapping(bytes32 challenge => bool) public challengeUsed;

    event Registered(uint256 indexed ticketId, address indexed registrant, bytes32 qx, bytes32 qy);
    event CheckedIn(uint256 indexed ticketId, bytes32 indexed challenge);

    error InvalidPublicKey();
    error UnknownTicket(uint256 ticketId);
    error ChallengeFromFuture(uint256 challengeBlock, uint256 currentBlock);
    error ChallengeExpired(uint256 challengeBlock, uint256 currentBlock);
    error ChallengeAlreadyUsed(bytes32 challenge);
    error InvalidAssertion();

    constructor(uint256 maxChallengeAge_) {
        maxChallengeAge = maxChallengeAge_;
    }

    /// @notice Binds a P-256 public key to a new ticket.
    function register(bytes32 qx, bytes32 qy) external returns (uint256 ticketId) {
        if (!P256.isValidPublicKey(qx, qy)) revert InvalidPublicKey();
        ticketId = nextTicketId++;
        ticketKey[ticketId] = PublicKey(qx, qy);
        emit Registered(ticketId, msg.sender, qx, qy);
    }

    /// @notice The challenge a passkey must sign to check in. `gateNonce` is chosen by the gate, `challengeBlock`
    /// is a recent block number that bounds how long the challenge stays valid.
    function challengeFor(uint256 ticketId, bytes32 gateNonce, uint256 challengeBlock) public pure returns (bytes32) {
        return keccak256(abi.encode(ticketId, gateNonce, challengeBlock));
    }

    /// @notice Checks a ticket in with a WebAuthn assertion over `challengeFor(ticketId, gateNonce, challengeBlock)`.
    /// @dev The challenge is derived onchain rather than passed in, so its freshness can be enforced.
    function checkIn(
        uint256 ticketId,
        bytes32 gateNonce,
        uint256 challengeBlock,
        WebAuthn.WebAuthnAuth calldata auth
    ) external returns (bytes32 challenge) {
        PublicKey memory key = ticketKey[ticketId];
        if (key.qx == 0 && key.qy == 0) revert UnknownTicket(ticketId);
        if (challengeBlock > block.number) revert ChallengeFromFuture(challengeBlock, block.number);
        if (block.number - challengeBlock > maxChallengeAge) revert ChallengeExpired(challengeBlock, block.number);

        challenge = challengeFor(ticketId, gateNonce, challengeBlock);
        if (challengeUsed[challenge]) revert ChallengeAlreadyUsed(challenge);

        // Requires the UP and UV flags, the "webauthn.get" type and an exact challenge match in clientDataJSON.
        if (!WebAuthn.verify(abi.encodePacked(challenge), auth, key.qx, key.qy)) revert InvalidAssertion();

        challengeUsed[challenge] = true;
        emit CheckedIn(ticketId, challenge);
    }
}
