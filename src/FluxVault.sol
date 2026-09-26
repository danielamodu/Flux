// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FluxVault
/// @notice A USDC vault that issues transferable FLUX-LP shares proportional to net asset value (NAV).
/// @dev Share accounting follows an ERC-4626-style model:
///      - the first depositor mints shares 1:1 with the USDC deposited (1 USDC = 1 FLUX-LP);
///      - later depositors mint `shares = amount * totalSupply / totalAssets`.
///      `totalAssets` is authoritative and is moved only by deposits, withdrawals, and the
///      owner-controlled strategy layer via {updateTotalAssets}. Because NAV is not derived from
///      the vault's raw token balance, plain token donations cannot distort share pricing.
contract FluxVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The USDC token accepted by the vault.
    IERC20 public immutable usdc;

    /// @notice Total USDC assets under management, including yield reported by the strategy layer.
    uint256 public totalAssets;

    /// @dev FLUX-LP mirrors the underlying token's decimals so 1 USDC == 1 FLUX-LP at genesis.
    uint8 private immutable _shareDecimals;

    /// @notice Emitted when a user deposits USDC and receives FLUX-LP shares.
    event Deposited(address user, uint256 usdcAmount, uint256 sharesIssued);

    /// @notice Emitted when a user burns FLUX-LP shares and withdraws USDC.
    event Withdrawn(address user, uint256 sharesRedeemed, uint256 usdcAmount);

    /// @param _usdcToken Address of the USDC token this vault accepts (set at deploy time).
    constructor(address _usdcToken) ERC20("Flux LP", "FLUX-LP") Ownable(msg.sender) {
        require(_usdcToken != address(0), "FluxVault: usdc is zero address");
        usdc = IERC20(_usdcToken);
        _shareDecimals = IERC20Metadata(_usdcToken).decimals();
    }

    /// @notice FLUX-LP uses the same number of decimals as the underlying USDC token.
    function decimals() public view override returns (uint8) {
        return _shareDecimals;
    }

    /// @notice Deposit `amount` of USDC and receive newly minted FLUX-LP shares.
    /// @param amount Amount of USDC (in USDC's smallest unit) to deposit.
    /// @return shares The number of FLUX-LP shares minted to the caller.
    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        require(amount > 0, "FluxVault: amount is zero");

        uint256 supply = totalSupply();
        if (supply == 0) {
            // First depositor sets the initial price: 1 USDC = 1 FLUX-LP.
            shares = amount;
        } else {
            // Subsequent depositors receive shares based on current NAV.
            shares = (amount * supply) / totalAssets;
        }
        require(shares > 0, "FluxVault: zero shares minted");

        // Pull funds, then book the assets and mint. nonReentrant protects the flow.
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        totalAssets += amount;
        _mint(msg.sender, shares);

        emit Deposited(msg.sender, amount, shares);
    }

    /// @notice Burn `shares` FLUX-LP and withdraw the proportional amount of USDC.
    /// @param shares The number of FLUX-LP shares to redeem.
    /// @return amount The amount of USDC returned to the caller.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        require(shares > 0, "FluxVault: shares is zero");

        uint256 supply = totalSupply();
        // A non-zero caller balance guarantees supply >= shares > 0, so no division by zero.
        amount = (shares * totalAssets) / supply;
        require(amount > 0, "FluxVault: zero assets withdrawn");

        // Effects before interaction (CEI); _burn reverts if the caller lacks the shares.
        _burn(msg.sender, shares);
        totalAssets -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, shares, amount);
    }

    /// @notice Owner-only hook for the strategy layer to report the vault's latest total assets.
    /// @dev Used to book yield (or losses) so that share redemption reflects real NAV.
    /// @param newTotal The new total USDC assets under management.
    function updateTotalAssets(uint256 newTotal) external onlyOwner {
        totalAssets = newTotal;
    }
}
