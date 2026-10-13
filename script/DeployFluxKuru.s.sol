// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {FluxStrategyVault} from "../src/FluxStrategyVault.sol";
import {KuruMarginStrategy} from "../src/venues/KuruMarginStrategy.sol";

interface IKuruMarketDeploymentParams {
    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseToken,
            uint256 baseDecimals,
            address quoteToken,
            uint256 quoteDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );
}

/// @notice Deploy a fresh Flux vault and Kuru strategy against one configured market.
/// @dev This does not migrate or modify any existing Flux vault and does not allocate funds.
///      Required env: VAULT_OWNER_PRIVATE_KEY, KURU_MARKET_ADDRESS, KURU_MARGIN_ACCOUNT,
///      STORK_ORACLE_ADDRESS, STORK_BASE_USD_FEED_ID, STORK_QUOTE_USD_FEED_ID. Optional env values are documented in
///      strategy/.env.example. Run only after verifying the market and oracle addresses.
contract DeployFluxKuruScript is Script {
    uint256 private constant MONAD_TESTNET_CHAIN_ID = 10143;

    struct DeploymentConfig {
        address market;
        address margin;
        address stork;
        bytes32 baseFeedId;
        bytes32 quoteFeedId;
        uint128 assetCap;
        uint64 maxValuationAge;
        uint64 maxOracleAge;
        uint16 maxOrderDeviationBps;
        uint16 emergencySlippageBps;
        address keeper;
    }

    function run() external returns (FluxStrategyVault vault, KuruMarginStrategy strategy) {
        require(block.chainid == MONAD_TESTNET_CHAIN_ID, "Monad testnet only");

        uint256 deployerKey = vm.envUint("VAULT_OWNER_PRIVATE_KEY");
        address owner = vm.addr(deployerKey);
        DeploymentConfig memory config = _readConfig(owner);

        vm.startBroadcast(deployerKey);
        (vault, strategy) = _deploy(config, owner);
        vm.stopBroadcast();

        console.log("FluxStrategyVault:", address(vault));
        console.log("KuruMarginStrategy:", address(strategy));
        console.log("Market:", config.market);
        console.log("Vault asset:", vault.asset());
        console.log("Owner:", owner);
        console.log("Keeper:", config.keeper);
        console.log("Asset cap (raw token units):", config.assetCap);
    }

    function _readConfig(address owner) private view returns (DeploymentConfig memory config) {
        config.market = vm.envAddress("KURU_MARKET_ADDRESS");
        config.margin = vm.envAddress("KURU_MARGIN_ACCOUNT");
        config.stork = vm.envAddress("STORK_ORACLE_ADDRESS");
        config.baseFeedId = vm.envBytes32("STORK_BASE_USD_FEED_ID");
        config.quoteFeedId = vm.envBytes32("STORK_QUOTE_USD_FEED_ID");
        config.assetCap = uint128(vm.envOr("FLUX_STRATEGY_ASSET_CAP", uint256(1_000_000_000)));
        config.maxValuationAge = uint64(vm.envOr("FLUX_MAX_VALUATION_AGE", uint256(3_600)));
        config.maxOracleAge = uint64(vm.envOr("KURU_MAX_ORACLE_AGE", uint256(3_600)));
        config.maxOrderDeviationBps = uint16(vm.envOr("KURU_MAX_ORDER_DEVIATION_BPS", uint256(500)));
        config.emergencySlippageBps = uint16(vm.envOr("KURU_EMERGENCY_SLIPPAGE_BPS", uint256(300)));
        config.keeper = vm.envOr("KURU_KEEPER_ADDRESS", owner);

        require(config.market.code.length > 0, "Market address has no code");
        require(config.margin.code.length > 0, "MarginAccount address has no code");
        require(config.stork.code.length > 0, "Stork address has no code");
        require(config.baseFeedId != bytes32(0), "Base Stork feed ID is zero");
        require(config.quoteFeedId != bytes32(0), "Quote Stork feed ID is zero");
        require(config.assetCap > 0, "Asset cap must be positive");
        require(config.keeper != address(0), "Keeper cannot be zero");
    }

    function _deploy(DeploymentConfig memory config, address owner)
        private
        returns (FluxStrategyVault vault, KuruMarginStrategy strategy)
    {
        (,, address baseToken,,,,,,,,) = IKuruMarketDeploymentParams(config.market).getMarketParams();
        (,,,, address quoteToken,,,,,,) = IKuruMarketDeploymentParams(config.market).getMarketParams();
        require(baseToken == address(0) || baseToken.code.length > 0, "Market base token has no code");
        require(quoteToken.code.length > 0, "Market quote token has no code");

        vault = new FluxStrategyVault(quoteToken, owner, config.maxValuationAge);
        KuruMarginStrategy.Config memory strategyConfig = KuruMarginStrategy.Config({
            vault: address(vault),
            baseToken: baseToken,
            marginAccount: config.margin,
            orderBook: config.market,
            stork: config.stork,
            baseUsdFeedId: config.baseFeedId,
            quoteUsdFeedId: config.quoteFeedId,
            maxOracleAge: config.maxOracleAge,
            maxOrderDeviationBps: config.maxOrderDeviationBps,
            emergencySlippageBps: config.emergencySlippageBps
        });
        strategy = new KuruMarginStrategy(strategyConfig);
        vault.registerStrategy(address(strategy), config.assetCap);
        if (config.keeper != owner) vault.setKeeper(config.keeper);
    }
}
