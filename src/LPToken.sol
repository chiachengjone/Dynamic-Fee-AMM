// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * LP (Liquidity Provider) token for the Dynamic-Fee-AMM.
 *
 * When you add liquidity to a pool you get these tokens back — they represent
 * your share of the reserves. Burn them to get your tokens back.
 *
 * Only the pool contract that deployed this token can mint or burn it.
 * That restriction is enforced by the `owner` address set in the constructor.
 */
contract LPToken is ERC20 {
    address public owner;

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // The deployer (always the pool contract) becomes the sole minter/burner.
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        owner = msg.sender;
    }

    // Mint new LP shares. Called by the pool when liquidity is added.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // Burn LP shares. Called by the pool when liquidity is removed.
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
