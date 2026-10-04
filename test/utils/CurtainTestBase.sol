// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {CurtainFactory} from "../../src/CurtainFactory.sol";
import {CurtainEvent} from "../../src/CurtainEvent.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @dev Shared setup and signing helpers. Buyers sign EIP-712 intents and EIP-2612 permits with vm.sign; passkeys
/// sign real WebAuthn payloads with vm.signP256.
abstract contract CurtainTestBase is Test {
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    string internal constant RP_ID = "curtaintickets.vercel.app";
    string internal constant ORIGIN = "https://curtaintickets.vercel.app";
    bytes1 internal constant FLAGS_UP_UV_BE_BS = 0x1d;

    uint96 internal constant PRICE = 5e6;
    uint32 internal constant CAPACITY = 10;
    uint64 internal constant SETTLE_DELAY = 1 hours;
    uint32 internal constant MAX_AGE = 300;

    struct Buyer {
        address addr;
        uint256 key;
        uint256 passkey;
    }

    MockUSDC internal usdc;
    CurtainFactory internal factory;
    CurtainEvent internal ev;

    address internal organizer = makeAddr("organizer");
    address internal payout = makeAddr("payout");
    address internal gate = makeAddr("gate");
    address internal relayer = makeAddr("relayer");

    uint64 internal salesEnd;
    uint64 internal doorsOpen;
    uint64 internal endTime;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        vm.roll(1_000);
        usdc = new MockUSDC();
        factory = new CurtainFactory();
        doorsOpen = uint64(block.timestamp + 1 days);
        endTime = uint64(block.timestamp + 2 days);
        salesEnd = endTime;
        // Build params first: the sha256 inside _params() is a call and would consume a prank.
        CurtainEvent.EventParams memory p = _params();
        vm.prank(organizer);
        ev = CurtainEvent(factory.createEvent(p));
    }

    function _params() internal view returns (CurtainEvent.EventParams memory p) {
        address[] memory gates = new address[](1);
        gates[0] = gate;
        p = CurtainEvent.EventParams({
            payout: payout,
            token: usdc,
            price: PRICE,
            capacity: CAPACITY,
            salesEnd: salesEnd,
            doorsOpen: doorsOpen,
            endTime: endTime,
            settleDelay: SETTLE_DELAY,
            heldThresholdBps: 5000,
            maxChallengeAge: MAX_AGE,
            rpIdHash: sha256(bytes(RP_ID)),
            gates: gates
        });
    }

    // ---------------------------------------------------------------------
    // Actors
    // ---------------------------------------------------------------------

    function _buyer(string memory name) internal returns (Buyer memory b) {
        (b.addr, b.key) = makeAddrAndKey(name);
        b.passkey = _p256Key(name);
        usdc.mint(b.addr, 100e6);
    }

    function _p256Key(string memory seed) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, "passkey"))) % (P256_N - 1) + 1;
    }

    function _passkeyXY(uint256 passkey) internal pure returns (bytes32 qx, bytes32 qy) {
        (uint256 x, uint256 y) = vm.publicKeyP256(passkey);
        return (bytes32(x), bytes32(y));
    }

    // ---------------------------------------------------------------------
    // EIP-712 and permit signing
    // ---------------------------------------------------------------------

    function _sign(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toTypedDataHash(ev.domainSeparator(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _intent(Buyer memory b, uint256 price) internal view returns (CurtainEvent.BuyIntent memory i) {
        (bytes32 qx, bytes32 qy) = _passkeyXY(b.passkey);
        i = CurtainEvent.BuyIntent({
            buyer: b.addr, qx: qx, qy: qy, price: price, nonce: ev.nonces(b.addr), deadline: block.timestamp + 1 hours
        });
    }

    function _signIntent(uint256 key, CurtainEvent.BuyIntent memory i) internal view returns (bytes memory) {
        return
            _sign(
                key, keccak256(abi.encode(ev.BUY_INTENT_TYPEHASH(), i.buyer, i.qx, i.qy, i.price, i.nonce, i.deadline))
            );
    }

    function _permit(Buyer memory b, uint256 value) internal view returns (CurtainEvent.Permit memory p) {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, b.addr, address(ev), value, usdc.nonces(b.addr), deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(b.key, MessageHashUtils.toTypedDataHash(usdc.DOMAIN_SEPARATOR(), structHash));
        p = CurtainEvent.Permit({value: value, deadline: deadline, v: v, r: r, s: s});
    }

    function _listSig(Buyer memory holder, uint256 ticketId, uint256 price, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sign(
            holder.key, keccak256(abi.encode(ev.LIST_TYPEHASH(), ticketId, price, ev.nonces(holder.addr), deadline))
        );
    }

    function _setClaimSig(Buyer memory holder, uint256 ticketId, address claimKey, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sign(
            holder.key,
            keccak256(abi.encode(ev.SET_CLAIM_TYPEHASH(), ticketId, claimKey, ev.nonces(holder.addr), deadline))
        );
    }

    function _claimSig(uint256 claimKeyPk, uint256 ticketId, address newHolder, bytes32 qx, bytes32 qy)
        internal
        view
        returns (bytes memory)
    {
        uint256 claimNonce = ev.getTicket(ticketId).claimNonce;
        return _sign(claimKeyPk, keccak256(abi.encode(ev.CLAIM_TYPEHASH(), ticketId, newHolder, qx, qy, claimNonce)));
    }

    // ---------------------------------------------------------------------
    // Flows
    // ---------------------------------------------------------------------

    function _buy(Buyer memory b) internal returns (uint256 ticketId) {
        CurtainEvent.BuyIntent memory i = _intent(b, PRICE);
        bytes memory sig = _signIntent(b.key, i);
        CurtainEvent.Permit memory p = _permit(b, PRICE);
        vm.prank(relayer);
        ticketId = ev.buy(i, sig, p);
    }

    function _list(Buyer memory holder, uint256 ticketId, uint256 price) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _listSig(holder, ticketId, price, deadline);
        uint256 nonce = ev.nonces(holder.addr);
        vm.prank(relayer);
        ev.listForResale(ticketId, price, nonce, deadline, sig);
    }

    function _buyResale(Buyer memory b, uint256 ticketId, uint256 price) internal {
        CurtainEvent.BuyIntent memory i = _intent(b, price);
        bytes memory sig = _signIntent(b.key, i);
        CurtainEvent.Permit memory p = _permit(b, price);
        vm.prank(relayer);
        ev.buyResale(ticketId, i, sig, p);
    }

    function _openDoors() internal {
        vm.warp(doorsOpen);
    }

    // ---------------------------------------------------------------------
    // WebAuthn
    // ---------------------------------------------------------------------

    function _assertion(uint256 passkey, bytes32 challenge, string memory rpId)
        internal
        pure
        returns (WebAuthn.WebAuthnAuth memory auth)
    {
        bytes memory authData = abi.encodePacked(sha256(bytes(rpId)), FLAGS_UP_UV_BE_BS, uint32(0));
        string memory cdj = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"',
            ORIGIN,
            '","crossOrigin":false}'
        );
        (bytes32 r, bytes32 s) = vm.signP256(passkey, sha256(abi.encodePacked(authData, sha256(bytes(cdj)))));
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s));
        auth = WebAuthn.WebAuthnAuth({
            r: r, s: s, challengeIndex: 23, typeIndex: 1, authenticatorData: authData, clientDataJSON: cdj
        });
    }

    function _gateNonce(uint256 ticketId) internal view returns (bytes32) {
        return keccak256(abi.encode("gate nonce", ticketId, block.number, block.timestamp));
    }

    /// @dev Builds a fresh challenge at the current block and checks in from the registered gate.
    function _checkIn(uint256 ticketId, uint256 passkey) internal returns (bytes32) {
        bytes32 nonce = _gateNonce(ticketId);
        WebAuthn.WebAuthnAuth memory auth = _assertion(passkey, ev.challengeFor(ticketId, nonce, block.number), RP_ID);
        vm.prank(gate);
        return ev.checkIn(ticketId, nonce, block.number, auth);
    }
}
