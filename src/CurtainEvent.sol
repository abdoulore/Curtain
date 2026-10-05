// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";

/// @title CurtainEvent
/// @notice Pay-on-entry escrow for one event. Ticket money waits here and reaches the organizer one ticket at a
/// time, when the holder checks in at a registered gate with their passkey. If the event is cancelled or not held,
/// every unscanned ticket is refundable to its current holder.
/// @dev Deployed as a minimal clone by CurtainFactory. No function lets anyone move escrowed money except check-in,
/// settlement and refunds. Money only leaves through `withdraw` (released money, to payout) and refunds (to holders).
contract CurtainEvent is Initializable, EIP712, Nonces, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum EventStatus {
        Open,
        Cancelled,
        Held,
        NotHeld
    }

    enum TicketState {
        None,
        Active,
        CheckedIn,
        RefundOwed,
        Refunded
    }

    struct EventParams {
        address payout;
        IERC20 token;
        uint96 price;
        uint32 capacity;
        uint64 salesEnd;
        uint64 doorsOpen;
        uint64 endTime;
        uint64 settleDelay;
        uint16 heldThresholdBps; // 0 selects DEFAULT_HELD_THRESHOLD_BPS
        uint32 maxChallengeAge; // in blocks, 0 selects DEFAULT_MAX_CHALLENGE_AGE
        bytes32 rpIdHash; // sha256 of the WebAuthn rpId, compared with authenticatorData[0:32]
        address[] gates;
    }

    struct Ticket {
        address holder; // receives refunds, signs holder actions
        TicketState state;
        uint64 claimNonce; // bumped whenever the holder or claim key changes, so old gift links die
        bytes32 qx; // passkey that must sign at the door
        bytes32 qy;
        address claimKey; // gift link key, zero when no link is live
        uint96 resalePrice; // zero when not listed
    }

    /// @notice Signed by the buyer's account. Binds the payer and refund address to the passkey used at the door,
    /// and to one sale: ticketId is 0 for a primary buy and the listed ticket's id for a resale.
    struct BuyIntent {
        address buyer;
        uint256 ticketId;
        bytes32 qx;
        bytes32 qy;
        uint256 price;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice EIP-2612 permit for the token. A zero deadline skips the permit and relies on an existing allowance.
    struct Permit {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    uint16 public constant DEFAULT_HELD_THRESHOLD_BPS = 5000;
    uint32 public constant DEFAULT_MAX_CHALLENGE_AGE = 300;

    bytes32 public constant BUY_INTENT_TYPEHASH = keccak256(
        "BuyIntent(address buyer,uint256 ticketId,bytes32 qx,bytes32 qy,uint256 price,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant WITHDRAW_TYPEHASH = keccak256("Withdraw(uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(uint256 nonce,uint256 deadline)");
    bytes32 public constant SET_GATE_TYPEHASH =
        keccak256("SetGate(address gate,bool allowed,uint256 nonce,uint256 deadline)");
    /// @notice A gate device signs each nonce it shows, so anyone can relay the check-in without holding a gate key.
    bytes32 public constant GATE_PASS_TYPEHASH = keccak256("GatePass(bytes32 gateNonce,uint256 challengeBlock)");
    bytes32 public constant LIST_TYPEHASH =
        keccak256("List(uint256 ticketId,uint256 price,uint256 nonce,uint256 deadline)");
    bytes32 public constant SET_CLAIM_TYPEHASH =
        keccak256("SetClaim(uint256 ticketId,address claimKey,uint256 nonce,uint256 deadline)");
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(uint256 ticketId,address newHolder,bytes32 qx,bytes32 qy,uint256 claimNonce)");

    // Settings, written once in `initialize`.
    address public organizer;
    uint96 public price;
    address public payout;
    uint32 public capacity;
    uint32 public maxChallengeAge;
    uint16 public heldThresholdBps;
    EventStatus public status;
    IERC20 public token;
    uint64 public salesEnd;
    uint32 public refundCursor;
    uint64 public doorsOpen;
    uint64 public endTime;
    uint64 public settleDelay;
    uint32 public sold;
    uint32 public checkedIn;
    bytes32 public rpIdHash;

    // Money accounting. Invariant: totalPaidIn == escrowed + released + refunded.
    uint256 public totalPaidIn;
    uint256 public escrowed;
    uint256 public released;
    uint256 public withdrawn;
    uint256 public refunded;

    mapping(uint256 ticketId => Ticket) internal _tickets;
    mapping(bytes32 challenge => bool) public challengeUsed;
    mapping(address gate => bool) public isGate;

    event GateSet(address indexed gate, bool allowed);
    event Purchased(uint256 indexed ticketId, address indexed buyer, bytes32 qx, bytes32 qy, uint256 price);
    event CheckedIn(uint256 indexed ticketId, address indexed gate, bytes32 challenge, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Cancelled();
    event Settled(bool held, uint256 releasedAmount);
    event Refunded(uint256 indexed ticketId, address indexed holder, uint256 amount);
    event RefundOwed(uint256 indexed ticketId, address indexed holder, uint256 amount);
    event Listed(uint256 indexed ticketId, uint256 price);
    event Resold(uint256 indexed ticketId, address indexed seller, address indexed buyer, uint256 price);
    event ClaimSet(uint256 indexed ticketId, address indexed claimKey, uint256 claimNonce);
    event Claimed(uint256 indexed ticketId, address indexed from, address indexed to);

    error InvalidParams();
    error NotOrganizer();
    error NotHolder();
    error WrongSale(uint256 intentTicketId, uint256 ticketId);
    error NotGate();
    error EventNotOpen();
    error SalesClosed();
    error SoldOut();
    error NotDoorTime();
    error PriceMismatch();
    error InvalidPublicKey();
    error InsufficientAllowance();
    error SignatureExpired();
    error BadSignature();
    error TicketNotActive(uint256 ticketId);
    error ChallengeFromFuture(uint256 challengeBlock, uint256 currentBlock);
    error ChallengeExpired(uint256 challengeBlock, uint256 currentBlock);
    error ChallengeAlreadyUsed(bytes32 challenge);
    error WrongRpId();
    error InvalidAssertion();
    error ExceedsReleased(uint256 amount, uint256 available);
    error NotSettleable();
    error NotRefundable();
    error NothingToRefund(uint256 ticketId);
    error PriceAboveCap(uint256 price, uint256 cap);
    error NotListed(uint256 ticketId);
    error NoClaimKey(uint256 ticketId);
    error ZeroAddress();

    constructor() EIP712("Curtain", "1") {
        _disableInitializers();
    }

    /// @notice Called once by the factory right after cloning.
    function initialize(address organizer_, EventParams calldata p) external initializer {
        if (
            organizer_ == address(0) || p.payout == address(0) || address(p.token) == address(0) || p.price == 0
                || p.capacity == 0 || p.salesEnd > p.endTime || p.doorsOpen > p.endTime || p.heldThresholdBps > 10_000
                || p.rpIdHash == bytes32(0)
        ) revert InvalidParams();

        organizer = organizer_;
        payout = p.payout;
        token = p.token;
        price = p.price;
        capacity = p.capacity;
        salesEnd = p.salesEnd;
        doorsOpen = p.doorsOpen;
        endTime = p.endTime;
        settleDelay = p.settleDelay;
        heldThresholdBps = p.heldThresholdBps == 0 ? DEFAULT_HELD_THRESHOLD_BPS : p.heldThresholdBps;
        maxChallengeAge = p.maxChallengeAge == 0 ? DEFAULT_MAX_CHALLENGE_AGE : p.maxChallengeAge;
        rpIdHash = p.rpIdHash;

        for (uint256 i = 0; i < p.gates.length; ++i) {
            _setGate(p.gates[i], true);
        }
    }

    // ---------------------------------------------------------------------
    // Buying
    // ---------------------------------------------------------------------

    /// @notice Buys a ticket at face value. Anyone may submit; the buyer authorizes with `buyerSig` and the permit.
    function buy(BuyIntent calldata intent, bytes calldata buyerSig, Permit calldata permit)
        external
        nonReentrant
        returns (uint256 ticketId)
    {
        if (status != EventStatus.Open) revert EventNotOpen();
        if (block.timestamp >= salesEnd) revert SalesClosed();
        if (sold >= capacity) revert SoldOut();
        uint256 p = price;
        if (intent.price != p) revert PriceMismatch();
        if (intent.ticketId != 0) revert WrongSale(intent.ticketId, 0);
        _verifyBuyIntent(intent, buyerSig);

        ticketId = ++sold;
        Ticket storage t = _tickets[ticketId];
        t.holder = intent.buyer;
        t.state = TicketState.Active;
        t.qx = intent.qx;
        t.qy = intent.qy;
        totalPaidIn += p;
        escrowed += p;

        _pull(intent.buyer, address(this), p, permit);
        emit Purchased(ticketId, intent.buyer, intent.qx, intent.qy, p);
    }

    // ---------------------------------------------------------------------
    // The door
    // ---------------------------------------------------------------------

    /// @notice The challenge a ticket's passkey must sign at a gate.
    function challengeFor(uint256 ticketId, bytes32 gateNonce, uint256 challengeBlock) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), ticketId, gateNonce, challengeBlock));
    }

    /// @notice Checks a ticket in and releases its price to the organizer. The gate nonce must come from a
    /// registered gate: either the gate calls directly with an empty `gatePass`, or anyone submits the gate's
    /// EIP-712 `GatePass` signature over the nonce and challenge block it showed.
    function checkIn(
        uint256 ticketId,
        bytes32 gateNonce,
        uint256 challengeBlock,
        bytes calldata gatePass,
        WebAuthn.WebAuthnAuth calldata auth
    ) external returns (bytes32 challenge) {
        address gate = _gateFor(gateNonce, challengeBlock, gatePass);
        if (status != EventStatus.Open) revert EventNotOpen();
        if (block.timestamp < doorsOpen || block.timestamp > endTime) revert NotDoorTime();
        if (challengeBlock > block.number) revert ChallengeFromFuture(challengeBlock, block.number);
        if (block.number - challengeBlock > maxChallengeAge) revert ChallengeExpired(challengeBlock, block.number);

        challenge = challengeFor(ticketId, gateNonce, challengeBlock);
        if (challengeUsed[challenge]) revert ChallengeAlreadyUsed(challenge);

        Ticket storage t = _tickets[ticketId];
        if (t.state != TicketState.Active) revert TicketNotActive(ticketId);

        // OZ WebAuthn.verify does not check the rpId, so only passkeys made for this event's domain count.
        if (auth.authenticatorData.length < 37 || bytes32(auth.authenticatorData[:32]) != rpIdHash) {
            revert WrongRpId();
        }
        if (!WebAuthn.verify(abi.encodePacked(challenge), auth, t.qx, t.qy)) revert InvalidAssertion();

        challengeUsed[challenge] = true;
        t.state = TicketState.CheckedIn;
        ++checkedIn;
        uint256 p = price;
        escrowed -= p;
        released += p;
        emit CheckedIn(ticketId, gate, challenge, p);
    }

    // ---------------------------------------------------------------------
    // Organizer
    // ---------------------------------------------------------------------

    // Each organizer action works when the organizer calls it, or when anyone submits the organizer's EIP-712
    // signature, so the organizer key never has to sit on a server and never needs gas.

    /// @notice Adds or removes a gate.
    function setGate(address gate, bool allowed, uint256 nonce, uint256 deadline, bytes calldata organizerSig)
        external
    {
        _authorizeOrganizer(
            keccak256(abi.encode(SET_GATE_TYPEHASH, gate, allowed, nonce, deadline)), nonce, deadline, organizerSig
        );
        if (status != EventStatus.Open) revert EventNotOpen();
        _setGate(gate, allowed);
    }

    /// @notice Pays released money to the payout address fixed at creation; a relayer cannot redirect it.
    function withdraw(uint256 amount, uint256 nonce, uint256 deadline, bytes calldata organizerSig)
        external
        nonReentrant
    {
        _authorizeOrganizer(
            keccak256(abi.encode(WITHDRAW_TYPEHASH, amount, nonce, deadline)), nonce, deadline, organizerSig
        );
        uint256 available = released - withdrawn;
        if (amount > available) revert ExceedsReleased(amount, available);
        withdrawn += amount;
        address to = payout;
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Cancels the event. Unscanned tickets become refundable; scanned tickets stay paid.
    function cancel(uint256 nonce, uint256 deadline, bytes calldata organizerSig) external {
        _authorizeOrganizer(keccak256(abi.encode(CANCEL_TYPEHASH, nonce, deadline)), nonce, deadline, organizerSig);
        if (status != EventStatus.Open) revert EventNotOpen();
        status = EventStatus.Cancelled;
        emit Cancelled();
    }

    // ---------------------------------------------------------------------
    // Settlement and refunds
    // ---------------------------------------------------------------------

    /// @notice After endTime plus settleDelay, decides whether the event was held. Anyone may call.
    function settle() external {
        if (status != EventStatus.Open || block.timestamp < uint256(endTime) + settleDelay) revert NotSettleable();
        if (uint256(checkedIn) * 10_000 >= uint256(heldThresholdBps) * sold) {
            status = EventStatus.Held;
            uint256 amount = escrowed;
            escrowed = 0;
            released += amount;
            emit Settled(true, amount);
        } else {
            status = EventStatus.NotHeld;
            emit Settled(false, 0);
        }
    }

    /// @notice Pays refunds to holders of unscanned tickets, walking a cursor. A failed transfer marks the ticket
    /// RefundOwed instead of blocking everyone else. Anyone may call.
    function pushRefunds(uint256 maxCount) external nonReentrant returns (uint256 processed) {
        if (!_refundable()) revert NotRefundable();
        uint256 cursor = refundCursor;
        uint256 end = sold;
        uint256 p = price;
        while (cursor < end && processed < maxCount) {
            unchecked {
                ++cursor;
                ++processed;
            }
            Ticket storage t = _tickets[cursor];
            if (t.state != TicketState.Active) continue;
            address to = t.holder;
            if (token.trySafeTransfer(to, p)) {
                t.state = TicketState.Refunded;
                escrowed -= p;
                refunded += p;
                emit Refunded(cursor, to, p);
            } else {
                t.state = TicketState.RefundOwed;
                emit RefundOwed(cursor, to, p);
            }
        }
        // casting to uint32 is safe because cursor never exceeds sold, which is a uint32
        // forge-lint: disable-next-line(unsafe-typecast)
        refundCursor = uint32(cursor);
    }

    /// @notice Pays one refundable ticket to its holder. Anyone may call, so a relayer can do it for a buyer with
    /// no gas; the money only ever goes to the holder.
    function claimRefund(uint256 ticketId) external nonReentrant {
        if (!_refundable()) revert NotRefundable();
        Ticket storage t = _tickets[ticketId];
        if (t.state != TicketState.Active && t.state != TicketState.RefundOwed) revert NothingToRefund(ticketId);
        uint256 p = price;
        t.state = TicketState.Refunded;
        escrowed -= p;
        refunded += p;
        address to = t.holder;
        token.safeTransfer(to, p);
        emit Refunded(ticketId, to, p);
    }

    // ---------------------------------------------------------------------
    // Resale and gift links
    // ---------------------------------------------------------------------

    /// @notice Lists a ticket at or below face value; a zero price delists. Called by the holder, or by anyone with
    /// the holder's EIP-712 `List` signature (gasless).
    function listForResale(
        uint256 ticketId,
        uint256 newPrice,
        uint256 nonce,
        uint256 deadline,
        bytes calldata holderSig
    ) external {
        Ticket storage t = _openActiveTicket(ticketId);
        if (newPrice > price) revert PriceAboveCap(newPrice, price);
        _authorizeHolder(
            t.holder,
            keccak256(abi.encode(LIST_TYPEHASH, ticketId, newPrice, nonce, deadline)),
            nonce,
            deadline,
            holderSig
        );
        // casting to uint96 is safe because newPrice is at most price, which is a uint96
        // forge-lint: disable-next-line(unsafe-typecast)
        t.resalePrice = uint96(newPrice);
        emit Listed(ticketId, newPrice);
    }

    /// @notice Buys a listed ticket. The buyer pays the seller directly; the escrowed face value stays, so the new
    /// holder is fully refundable. The ticket's holder and passkey rebind to the buyer.
    function buyResale(uint256 ticketId, BuyIntent calldata intent, bytes calldata buyerSig, Permit calldata permit)
        external
        nonReentrant
    {
        Ticket storage t = _openActiveTicket(ticketId);
        uint256 listPrice = t.resalePrice;
        if (listPrice == 0) revert NotListed(ticketId);
        if (intent.price != listPrice) revert PriceMismatch();
        if (intent.ticketId != ticketId) revert WrongSale(intent.ticketId, ticketId);
        _verifyBuyIntent(intent, buyerSig);

        address seller = t.holder;
        t.holder = intent.buyer;
        t.qx = intent.qx;
        t.qy = intent.qy;
        t.resalePrice = 0;
        t.claimKey = address(0);
        unchecked {
            ++t.claimNonce;
        }

        _pull(intent.buyer, seller, listPrice, permit);
        emit Resold(ticketId, seller, intent.buyer, listPrice);
    }

    /// @notice Sets the gift link key for a ticket; the zero address revokes. Called by the holder, or by anyone
    /// with the holder's EIP-712 `SetClaim` signature (gasless).
    function setClaim(uint256 ticketId, address claimKey, uint256 nonce, uint256 deadline, bytes calldata holderSig)
        external
    {
        Ticket storage t = _openActiveTicket(ticketId);
        _authorizeHolder(
            t.holder,
            keccak256(abi.encode(SET_CLAIM_TYPEHASH, ticketId, claimKey, nonce, deadline)),
            nonce,
            deadline,
            holderSig
        );
        t.claimKey = claimKey;
        uint64 claimNonce;
        unchecked {
            claimNonce = ++t.claimNonce;
        }
        emit ClaimSet(ticketId, claimKey, claimNonce);
    }

    /// @notice Claims a gifted ticket with a signature from its claim key. The holder and passkey rebind to the
    /// friend and the claim key is cleared.
    function claim(uint256 ticketId, address newHolder, bytes32 qx, bytes32 qy, bytes calldata claimSig) external {
        Ticket storage t = _openActiveTicket(ticketId);
        address key = t.claimKey;
        if (key == address(0)) revert NoClaimKey(ticketId);
        if (newHolder == address(0)) revert ZeroAddress();
        if (!P256.isValidPublicKey(qx, qy)) revert InvalidPublicKey();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, ticketId, newHolder, qx, qy, t.claimNonce)));
        if (!SignatureChecker.isValidSignatureNowCalldata(key, digest, claimSig)) revert BadSignature();

        address from = t.holder;
        t.holder = newHolder;
        t.qx = qx;
        t.qy = qy;
        t.claimKey = address(0);
        t.resalePrice = 0;
        unchecked {
            ++t.claimNonce;
        }
        emit Claimed(ticketId, from, newHolder);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getTicket(uint256 ticketId) external view returns (Ticket memory) {
        return _tickets[ticketId];
    }

    function availableToWithdraw() external view returns (uint256) {
        return released - withdrawn;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _setGate(address gate, bool allowed) internal {
        if (gate == address(0)) revert ZeroAddress();
        isGate[gate] = allowed;
        emit GateSet(gate, allowed);
    }

    /// @dev The registered gate behind a check-in, or NotGate.
    function _gateFor(bytes32 gateNonce, uint256 challengeBlock, bytes calldata gatePass)
        internal
        view
        returns (address gate)
    {
        if (gatePass.length == 0) {
            gate = msg.sender;
        } else {
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(GATE_PASS_TYPEHASH, gateNonce, challengeBlock)));
            (gate,,) = ECDSA.tryRecoverCalldata(digest, gatePass);
        }
        if (gate == address(0) || !isGate[gate]) revert NotGate();
    }

    function _refundable() internal view returns (bool) {
        return status == EventStatus.Cancelled || status == EventStatus.NotHeld;
    }

    function _openActiveTicket(uint256 ticketId) internal view returns (Ticket storage t) {
        if (status != EventStatus.Open || block.timestamp >= endTime) revert EventNotOpen();
        t = _tickets[ticketId];
        if (t.state != TicketState.Active) revert TicketNotActive(ticketId);
    }

    function _verifyBuyIntent(BuyIntent calldata intent, bytes calldata sig) internal {
        if (block.timestamp > intent.deadline) revert SignatureExpired();
        if (!P256.isValidPublicKey(intent.qx, intent.qy)) revert InvalidPublicKey();
        _useCheckedNonce(intent.buyer, intent.nonce);
        // BuyIntent is all static fields, so encoding the struct equals encoding its fields in order.
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(BUY_INTENT_TYPEHASH, intent)));
        if (!SignatureChecker.isValidSignatureNowCalldata(intent.buyer, digest, sig)) revert BadSignature();
    }

    function _authorizeHolder(address holder, bytes32 structHash, uint256 nonce, uint256 deadline, bytes calldata sig)
        internal
    {
        if (msg.sender == holder) return;
        if (sig.length == 0) revert NotHolder();
        _checkSignature(holder, structHash, nonce, deadline, sig);
    }

    function _authorizeOrganizer(bytes32 structHash, uint256 nonce, uint256 deadline, bytes calldata sig) internal {
        address org = organizer;
        if (msg.sender == org) return;
        if (sig.length == 0) revert NotOrganizer();
        _checkSignature(org, structHash, nonce, deadline, sig);
    }

    /// @dev Holder and organizer signatures share the account's nonce with its buy intents.
    function _checkSignature(address signer, bytes32 structHash, uint256 nonce, uint256 deadline, bytes calldata sig)
        internal
    {
        if (block.timestamp > deadline) revert SignatureExpired();
        _useCheckedNonce(signer, nonce);
        if (!SignatureChecker.isValidSignatureNowCalldata(signer, _hashTypedDataV4(structHash), sig)) {
            revert BadSignature();
        }
    }

    /// @dev The permit may already have been used (for example front-run), so a failure is ignored and the
    /// allowance is checked instead.
    function _pull(address from, address to, uint256 amount, Permit calldata permit) internal {
        if (permit.deadline != 0) {
            try IERC20Permit(address(token))
                .permit(from, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s) {}
                catch {}
        }
        if (token.allowance(from, address(this)) < amount) revert InsufficientAllowance();
        token.safeTransferFrom(from, to, amount);
    }
}
