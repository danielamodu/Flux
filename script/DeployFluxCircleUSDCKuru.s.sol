// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {FluxStrategyVault} from "../src/FluxStrategyVault.sol";
import {KuruMarginStrategy} from "../src/venues/KuruMarginStrategy.sol";

interface IKuruTestnetMarketFactory {
    function deployProxy(
        uint8 marketType,
        address baseToken,
        address quoteToken,
        uint96 sizePrecision,
        uint32 pricePrecision,
        uint32 tickSize,
        uint96 minSize,
        uint96 maxSize,
        uint256 takerFeeBps,
        uint256 makerFeeBps,
        uint96 kuruAmmSpread
    ) external returns (address market);
}

interface IKuruCreatedMarket {
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

/// @notice Deploys a Kuru testnet MON/Circle-USDC market and a matching Flux vault.
/// @dev User deposits and withdrawals use Circle testnet USDC. No user funds are allocated
///      during deployment. The new market starts empty and needs a funded strategy cycle.
contract DeployFluxCircleUSDCKuruScript is Script {
    uint256 private constant MONAD_TESTNET_CHAIN_ID = 10143;
    address private constant KURU_TESTNET_ROUTER = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address private constant KURU_TESTNET_MARGIN_ACCOUNT = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;
    address private constant STORK_TESTNET_RECEIVER = 0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62;
    address private constant CIRCLE_TESTNET_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    address private constant NATIVE_MON = address(0);
    bytes32 private constant MON_USD_FEED_ID = 0xa4f6b07ae0c89e3f3cc03c1badcc3e9adffdf7206bafcd56d142979800887385;
    bytes32 private constant USDC_USD_FEED_ID = 0x7416a56f222e196d0487dce8a1a8003936862e7a15092a91898d69fa8bce290c;

    // Kuru precision units. A 0.001 MON minimum keeps this testnet market usable with
    // faucet-sized USDC balances; the prior market's minimum was 200 MON per order.
    uint96 private constant SIZE_PRECISION = 10_000_000_000;
    uint32 private constant PRICE_PRECISION = 100_000_000;
    uint32 private constant TICK_SIZE = 100;
    uint96 private constant MIN_SIZE = 10_000_000;
    uint96 private constant MAX_SIZE = 2_000_000_000_000_000_000;
    uint256 private constant TAKER_FEE_BPS = 30;
    uint256 private constant MAKER_FEE_BPS = 10;
    uint96 private constant KURU_AMM_SPREAD = 100;

    function run()
        external
        returns (address market, FluxStrategyVault vault, KuruMarginStrategy strategy)
    {
        require(block.chainid == MONAD_TESTNET_CHAIN_ID, "Monad testnet only");
        uint256 deployerKey = vm.envUint("VAULT_OWNER_PRIVATE_KEY");
        address owner = vm.addr(deployerKey);
        address keeper = vm.envOr("KURU_KEEPER_ADDRESS", owner);
        uint128 assetCap = uint128(vm.envOr("FLUX_STRATEGY_ASSET_CAP", uint256(10_000_000_000)));
        uint64 maxValuationAge = uint64(vm.envOr("FLUX_MAX_VALUATION_AGE", uint256(3_600)));
        uint64 maxOracleAge = uint64(vm.envOr("KURU_MAX_ORACLE_AGE", uint256(3_600)));
        uint16 maxOrderDeviationBps = uint16(vm.envOr("KURU_MAX_ORDER_DEVIATION_BPS", uint256(500)));
        uint16 emergencySlippageBps = uint16(vm.envOr("KURU_EMERGENCY_SLIPPAGE_BPS", uint256(300)));

        _requireCode(KURU_TESTNET_ROUTER, "Kuru testnet market factory");
        _requireCode(KURU_TESTNET_MARGIN_ACCOUNT, "Kuru testnet MarginAccount");
        _requireCode(STORK_TESTNET_RECEIVER, "Stork testnet receiver");
        _requireCode(CIRCLE_TESTNET_USDC, "Circle testnet USDC");
        require(assetCap > 0 && maxValuationAge > 0 && maxOracleAge > 0, "Invalid risk config");
        require(keeper != address(0), "Keeper cannot be zero");

        vm.startBroadcast(deployerKey);
        market = IKuruTestnetMarketFactory(KURU_TESTNET_ROUTER).deployProxy(
            1,
            NATIVE_MON,
            CIRCLE_TESTNET_USDC,
            SIZE_PRECISION,
            PRICE_PRECISION,
            TICK_SIZE,
            MIN_SIZE,
            MAX_SIZE,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS,
            KURU_AMM_SPREAD
        );
        _assertMarket(market);

        vault = new FluxStrategyVault(CIRCLE_TESTNET_USDC, owner, maxValuationAge);
        KuruMarginStrategy.Config memory config = KuruMarginStrategy.Config({
            vault: address(vault),
            baseToken: NATIVE_MON,
            marginAccount: KURU_TESTNET_MARGIN_ACCOUNT,
            orderBook: market,
            stork: STORK_TESTNET_RECEIVER,
            baseUsdFeedId: MON_USD_FEED_ID,
            quoteUsdFeedId: USDC_USD_FEED_ID,
            maxOracleAge: maxOracleAge,
            maxOrderDeviationBps: maxOrderDeviationBps,
            emergencySlippageBps: emergencySlippageBps
        });
        strategy = new KuruMarginStrategy(config);
        vault.registerStrategy(address(strategy), assetCap);
        if (keeper != owner) vault.setKeeper(keeper);
        vm.stopBroadcast();

        console.log("Kuru MON/Circle-USDC market:", market);
        console.log("FluxStrategyVault:", address(vault));
        console.log("KuruMarginStrategy:", address(strategy));
        console.log("User deposit asset (Circle testnet USDC):", CIRCLE_TESTNET_USDC);
        console.log("Owner:", owner);
        console.log("Keeper:", keeper);
        console.log("Market minimum order raw size:", uint256(MIN_SIZE));
        console.log("Market base size precision:", uint256(SIZE_PRECISION));
        console.log("Market starts empty; no funds were allocated.");
    }

    function _assertMarket(address market) private view {
        _requireCode(market, "New Kuru market");
        (,, address baseToken, uint256 baseDecimals, address quoteToken, uint256 quoteDecimals,,,,,) =
            IKuruCreatedMarket(market).getMarketParams();
        require(baseToken == NATIVE_MON && baseDecimals == 18, "Market base mismatch");
        require(quoteToken == CIRCLE_TESTNET_USDC && quoteDecimals == 6, "Market quote is not Circle USDC");
    }

    function _requireCode(address target, string memory label) private view {
        require(target.code.length > 0, string.concat(label, " has no code on this network"));
    }
}
