// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Narrow interface for a strategy that holds assets on behalf of Flux.
/// @dev Implementations must report net USDC-denominated NAV and only allow the vault
///      to allocate, withdraw, rebalance, or trigger an emergency exit.
interface IFluxStrategy {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function liquidAssets() external view returns (uint256);
    function valuationTimestamp() external view returns (uint64);

    /// @dev Called after the vault transfers `amount` of the underlying asset to the strategy.
    function deploy(uint256 amount, bytes calldata data) external;

    /// @dev Must send up to `amount` of the underlying asset back to the vault.
    function withdraw(uint256 amount, bytes calldata data) external;

    function rebalance(bytes calldata data) external;

    /// @dev Best-effort unwind. Must send recovered underlying assets to the vault.
    function emergencyExit(bytes calldata data) external;
}
