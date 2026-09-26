// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {FluxVault} from "../src/FluxVault.sol";

/// @notice Deployment script for {FluxVault} on Monad testnet (chainId: 10143).
/// @dev Reads the USDC token address and deployer key from the environment so no secrets
///      are committed. Example:
///
///        export USDC_ADDRESS=0x...            # USDC token on Monad testnet
///        export PRIVATE_KEY=0x...             # deployer private key
///        forge script script/FluxVault.s.sol:FluxVaultScript \
///            --rpc-url monad_testnet --broadcast
contract FluxVaultScript is Script {
    function run() external returns (FluxVault vault) {
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        vault = new FluxVault(usdc);
        vm.stopBroadcast();

        console.log("FluxVault deployed at:", address(vault));
        console.log("Underlying USDC:       ", usdc);
        console.log("Owner:                 ", vault.owner());
    }
}
