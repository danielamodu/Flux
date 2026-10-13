// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title FluxVault
/// @notice A USDC vault that issues transferable FLUX-LP shares proportional to net asset value (NAV).
/// @dev NAV is the USDC actually held by this contract. Venue positions are not included.
///      Strategy profits count only after USDC is returned to the vault. This keeps share
///      pricing solvent and removes the owner-controlled arbitrary NAV setter.
contract FluxVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private constant DEAD_SHARES = 0x000000000000000000000000000000000000dEaD;

    /// @notice The USDC token accepted by the vault.
    IERC20 public immutable usdc;

    /// @dev FLUX-LP mirrors the underlying token's decimals so 1 USDC == 1 FLUX-LP at genesis.
    uint8 private immutable _shareDecimals;

    /// @notice Emitted when a user deposits USDC and receives FLUX-LP shares.
    event Deposited(address user, uint256 usdcAmount, uint256 sharesIssued);

    /// @notice Emitted when a user burns FLUX-LP shares and withdraws USDC.
    event Withdrawn(address user, uint256 sharesRedeemed, uint256 usdcAmount);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error InsufficientShares(uint256 requested, uint256 owned);
    error InsufficientVaultLiquidity(uint256 requested, uint256 available);
    error UnsupportedTransferFee(uint256 requested, uint256 received);
    error InsolventVault();

    /// @param _usdcToken Address of the USDC token this vault accepts (set at deploy time).
    constructor(address _usdcToken) ERC20("Flux LP", "FLUX-LP") {
        if (_usdcToken == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdcToken);
        _shareDecimals = IERC20Metadata(_usdcToken).decimals();
    }

    /// @notice USDC held by the vault and available to redeem.
    /// @dev External venue collateral and unrealized PnL are intentionally excluded.
    function totalAssets() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice FLUX-LP uses the same number of decimals as the underlying USDC token.
    function decimals() public view override returns (uint8) {
        return _shareDecimals;
    }

    /// @notice Deposit `amount` of USDC and receive newly minted FLUX-LP shares.
    /// @param amount Amount of USDC (in USDC's smallest unit) to deposit.
    /// @return shares The number of FLUX-LP shares minted to the caller.
    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256 assets = totalAssets();
        if (supply == 0) {
            // A pre-seeded vault donation belongs to burned shares, not the first depositor.
            if (assets != 0) _mint(DEAD_SHARES, assets);
            shares = amount;
        } else {
            if (assets == 0) revert InsolventVault();
            shares = Math.mulDiv(amount, supply, assets);
        }
        if (shares == 0) revert ZeroShares();

        // This vault accepts exact-transfer USDC only; fee-on-transfer tokens are rejected.
        uint256 beforeBalance = assets;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = totalAssets() - beforeBalance;
        if (received != amount) revert UnsupportedTransferFee(amount, received);
        _mint(msg.sender, shares);

        emit Deposited(msg.sender, amount, shares);
    }

    /// @notice Burn `shares` FLUX-LP and withdraw the proportional amount of USDC.
    /// @param shares The number of FLUX-LP shares to redeem.
    /// @return amount The amount of USDC returned to the caller.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();

        uint256 supply = totalSupply();
        if (supply == 0) revert InsufficientShares(shares, 0);
        uint256 owned = balanceOf(msg.sender);
        if (shares > owned) revert InsufficientShares(shares, owned);
        uint256 assets = totalAssets();
        // Full redemption also sweeps any division dust to the final shareholder.
        amount = shares == supply ? assets : Math.mulDiv(shares, assets, supply);
        if (amount > assets) revert InsufficientVaultLiquidity(amount, assets);

        // Effects before interaction (CEI); zero-value redemptions burn worthless shares.
        _burn(msg.sender, shares);
        if (amount != 0) usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, shares, amount);
    }
}
