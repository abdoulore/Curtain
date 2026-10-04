// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {PasskeyCanary} from "../src/PasskeyCanary.sol";

/// Pipeline check before the phone run: registers a script-generated P-256 key and checks in with a WebAuthn
/// assertion built by vm.signP256. This is not Face ID; it only exercises the deployed contract on testnet.
/// CANARY=0x... forge script script/SyntheticCheckIn.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
contract SyntheticCheckIn is Script {
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;

    function run() external {
        PasskeyCanary canary = PasskeyCanary(vm.envAddress("CANARY"));
        uint256 p256Key = uint256(keccak256(abi.encode("curtain synthetic", block.number)));
        (uint256 qx, uint256 qy) = vm.publicKeyP256(p256Key);

        vm.startBroadcast();
        uint256 ticketId = canary.register(bytes32(qx), bytes32(qy));

        uint256 challengeBlock = block.number;
        bytes32 gateNonce = keccak256(abi.encode("synthetic gate", challengeBlock));
        bytes32 challenge = canary.challengeFor(ticketId, gateNonce, challengeBlock);

        bytes memory authData = abi.encodePacked(sha256("synthetic.curtain.test"), bytes1(0x05), uint32(0));
        string memory cdj = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"https://synthetic.curtain.test","crossOrigin":false}'
        );
        (bytes32 r, bytes32 s) = vm.signP256(p256Key, sha256(abi.encodePacked(authData, sha256(bytes(cdj)))));
        if (uint256(s) > N / 2) s = bytes32(N - uint256(s));

        canary.checkIn(
            ticketId,
            gateNonce,
            challengeBlock,
            WebAuthn.WebAuthnAuth({
                r: r, s: s, challengeIndex: 23, typeIndex: 1, authenticatorData: authData, clientDataJSON: cdj
            })
        );
        vm.stopBroadcast();
        console.log("synthetic ticketId:", ticketId);
    }
}
