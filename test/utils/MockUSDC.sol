// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev 6-decimal token with EIP-2612 permit. `setBlocked` makes transfers to an address revert, standing in for
/// a USDC blocklist so refund failures can be tested.
contract MockUSDC is ERC20, ERC20Permit {
    mapping(address => bool) public blocked;

    error Blocked(address account);

    constructor() ERC20("USDC", "USDC") ERC20Permit("USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[to]) revert Blocked(to);
        super._update(from, to, value);
    }
}
