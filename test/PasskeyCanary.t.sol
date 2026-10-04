// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {PasskeyCanary} from "../src/PasskeyCanary.sol";

/// @dev Measures the P-256 verify step on its own, through the default path and the forced Solidity path.
contract P256GasHarness {
    function verifyDefault(bytes32 h, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy)
        external
        view
        returns (bool ok, uint256 gasUsed)
    {
        uint256 g = gasleft();
        ok = P256.verify(h, r, s, qx, qy);
        gasUsed = g - gasleft();
    }

    function verifySolidity(bytes32 h, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy)
        external
        view
        returns (bool ok, uint256 gasUsed)
    {
        uint256 g = gasleft();
        ok = P256.verifySolidity(h, r, s, qx, qy);
        gasUsed = g - gasleft();
    }
}

contract PasskeyCanaryTest is Test {
    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant MAX_AGE = 150;

    // iCloud Keychain passkeys report UP | UV | BE | BS.
    bytes1 internal constant FLAGS_UP_UV_BE_BS = 0x1d;
    bytes1 internal constant FLAGS_UP_ONLY = 0x01;

    // `{"type":"webauthn.get",` puts the type at index 1 and the challenge at index 23.
    uint256 internal constant TYPE_INDEX = 1;
    uint256 internal constant CHALLENGE_INDEX = 23;

    string internal constant RP_ID = "canary.curtain.test";
    string internal constant ORIGIN = "https://canary.curtain.test";

    uint256 internal constant HOLDER_PK = 0xA11CE;
    uint256 internal constant OTHER_PK = 0xB0B;

    PasskeyCanary internal canary;
    uint256 internal ticketId;
    bytes32 internal constant GATE_NONCE = keccak256("gate-1");

    function setUp() public {
        vm.roll(1_000);
        canary = new PasskeyCanary(MAX_AGE);
        (uint256 qx, uint256 qy) = vm.publicKeyP256(HOLDER_PK);
        ticketId = canary.register(bytes32(qx), bytes32(qy));
    }

    // ---------------------------------------------------------------------
    // Helpers that build a real WebAuthn assertion with vm.signP256
    // ---------------------------------------------------------------------

    function _clientDataJSON(bytes32 challenge) internal pure returns (string memory) {
        return string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"',
            ORIGIN,
            '","crossOrigin":false}'
        );
    }

    function _authenticatorData(bytes1 flags) internal pure returns (bytes memory) {
        // rpIdHash (32) | flags (1) | signCount (4)
        return abi.encodePacked(sha256(bytes(RP_ID)), flags, uint32(0));
    }

    function _signRaw(uint256 pk, bytes memory authData, string memory clientDataJSON)
        internal
        pure
        returns (bytes32 r, bytes32 s)
    {
        bytes32 digest = sha256(abi.encodePacked(authData, sha256(bytes(clientDataJSON))));
        (r, s) = vm.signP256(pk, digest);
    }

    function _lowS(bytes32 s) internal pure returns (bytes32) {
        return uint256(s) > N / 2 ? bytes32(N - uint256(s)) : s;
    }

    function _assertion(uint256 pk, bytes32 challenge, bytes1 flags)
        internal
        pure
        returns (WebAuthn.WebAuthnAuth memory auth)
    {
        bytes memory authData = _authenticatorData(flags);
        string memory cdj = _clientDataJSON(challenge);
        (bytes32 r, bytes32 s) = _signRaw(pk, authData, cdj);
        auth = WebAuthn.WebAuthnAuth({
            r: r,
            s: _lowS(s),
            challengeIndex: CHALLENGE_INDEX,
            typeIndex: TYPE_INDEX,
            authenticatorData: authData,
            clientDataJSON: cdj
        });
    }

    function _freshAssertion(uint256 pk) internal view returns (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory) {
        challengeBlock = block.number;
        bytes32 challenge = canary.challengeFor(ticketId, GATE_NONCE, challengeBlock);
        return (challengeBlock, _assertion(pk, challenge, FLAGS_UP_UV_BE_BS));
    }

    // ---------------------------------------------------------------------
    // Required cases
    // ---------------------------------------------------------------------

    function test_validCheckIn() public {
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        bytes32 expected = canary.challengeFor(ticketId, GATE_NONCE, challengeBlock);
        vm.roll(block.number + 3);

        vm.expectEmit(true, true, false, true, address(canary));
        emit PasskeyCanary.CheckedIn(ticketId, expected);
        bytes32 challenge = canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);

        assertEq(challenge, expected);
        assertTrue(canary.challengeUsed(challenge));
    }

    function test_replayedChallengeReverts() public {
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        bytes32 challenge = canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);

        vm.expectRevert(abi.encodeWithSelector(PasskeyCanary.ChallengeAlreadyUsed.selector, challenge));
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
    }

    function test_staleChallengeReverts() public {
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        vm.roll(challengeBlock + MAX_AGE + 1);

        vm.expectRevert(
            abi.encodeWithSelector(PasskeyCanary.ChallengeExpired.selector, challengeBlock, challengeBlock + MAX_AGE + 1)
        );
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
    }

    function test_challengeAtMaxAgeStillPasses() public {
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        vm.roll(challengeBlock + MAX_AGE);
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
    }

    function test_wrongKeyReverts() public {
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(OTHER_PK);

        vm.expectRevert(PasskeyCanary.InvalidAssertion.selector);
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
    }

    function test_tamperedClientDataJSONReverts() public {
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        bytes32 challenge = canary.challengeFor(ticketId, GATE_NONCE, challengeBlock);

        // Same type and challenge at the same offsets, different origin than what was signed.
        auth.clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(challenge)),
            '","origin":"https://evil.example","crossOrigin":false}'
        );

        vm.expectRevert(PasskeyCanary.InvalidAssertion.selector);
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
    }

    // ---------------------------------------------------------------------
    // Extra edge cases
    // ---------------------------------------------------------------------

    function test_futureChallengeReverts() public {
        uint256 challengeBlock = block.number + 1;
        bytes32 challenge = canary.challengeFor(ticketId, GATE_NONCE, challengeBlock);
        WebAuthn.WebAuthnAuth memory auth = _assertion(HOLDER_PK, challenge, FLAGS_UP_UV_BE_BS);

        vm.expectRevert(
            abi.encodeWithSelector(PasskeyCanary.ChallengeFromFuture.selector, challengeBlock, block.number)
        );
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
    }

    function test_assertionForAnotherTicketReverts() public {
        (uint256 qx, uint256 qy) = vm.publicKeyP256(OTHER_PK);
        uint256 otherTicket = canary.register(bytes32(qx), bytes32(qy));

        // Holder signs for their own ticket, relayer tries to use it for a different ticket and nonce.
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        vm.expectRevert(PasskeyCanary.InvalidAssertion.selector);
        canary.checkIn(otherTicket, GATE_NONCE, challengeBlock, auth);
    }

    function test_missingUserVerificationReverts() public {
        uint256 challengeBlock = block.number;
        bytes32 challenge = canary.challengeFor(ticketId, GATE_NONCE, challengeBlock);
        WebAuthn.WebAuthnAuth memory auth = _assertion(HOLDER_PK, challenge, FLAGS_UP_ONLY);

        vm.expectRevert(PasskeyCanary.InvalidAssertion.selector);
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
    }

    function test_highSReverts() public {
        // Authenticators often return high-s signatures. OZ rejects them, so clients must normalize s to N - s.
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        auth.s = bytes32(N - uint256(auth.s));

        vm.expectRevert(PasskeyCanary.InvalidAssertion.selector);
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
    }

    function test_unknownTicketReverts() public {
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        vm.expectRevert(abi.encodeWithSelector(PasskeyCanary.UnknownTicket.selector, 99));
        canary.checkIn(99, GATE_NONCE, challengeBlock, auth);
    }

    function test_registerRejectsOffCurveKey() public {
        vm.expectRevert(PasskeyCanary.InvalidPublicKey.selector);
        canary.register(bytes32(uint256(1)), bytes32(uint256(2)));
    }

    // ---------------------------------------------------------------------
    // Gas: which P-256 path ran
    // ---------------------------------------------------------------------

    /// @dev Wycheproof vector OZ uses to probe for the precompile.
    function _precompilePresent() internal view returns (bool) {
        (bool ok, bytes memory ret) = address(0x100).staticcall(
            abi.encode(
                0xbb5a52f42f9c9261ed4361f59422a1e30036e7c32b270c8807a419feca605023,
                uint256(5),
                uint256(1),
                0xa71af64de5126a4a4e02b7922d66ce9415ce88a4c9d25514d91082c8725ac957,
                0x5d47723c8fbe580bb369fec9c2665d8e30a435b9932645482e7c9f11e872296b
            )
        );
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == 1;
    }

    function test_gas_p256Verify() public {
        P256GasHarness harness = new P256GasHarness();
        bytes32 h = sha256("curtain canary");
        (bytes32 r, bytes32 s) = vm.signP256(HOLDER_PK, h);
        s = _lowS(s);
        (uint256 qx, uint256 qy) = vm.publicKeyP256(HOLDER_PK);

        (bool okDefault, uint256 gasDefault) = harness.verifyDefault(h, r, s, bytes32(qx), bytes32(qy));
        (bool okSolidity, uint256 gasSolidity) = harness.verifySolidity(h, r, s, bytes32(qx), bytes32(qy));
        assertTrue(okDefault && okSolidity);

        console.log("precompile at 0x100 present:", _precompilePresent());
        console.log("P256.verify (default path) gas:", gasDefault);
        console.log("P256.verifySolidity gas:", gasSolidity);

        if (_precompilePresent()) {
            // Precompile path: 6900 for the precompile plus call and memory overhead.
            assertLt(gasDefault, 15_000, "precompile path should cost low thousands");
        } else {
            assertGt(gasDefault, 100_000, "fallback path should cost hundreds of thousands");
        }
    }

    function test_gas_checkIn() public {
        (uint256 challengeBlock, WebAuthn.WebAuthnAuth memory auth) = _freshAssertion(HOLDER_PK);
        uint256 g = gasleft();
        canary.checkIn(ticketId, GATE_NONCE, challengeBlock, auth);
        uint256 gasCheckIn = g - gasleft();

        console.log("checkIn call gas (no 21k base or calldata):", gasCheckIn);
        if (_precompilePresent()) assertLt(gasCheckIn, 100_000, "checkIn should be cheap with the precompile");
        else assertGt(gasCheckIn, 150_000, "checkIn without the precompile pays for the Solidity verifier");
    }
}
