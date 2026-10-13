// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFluxStrategy} from "../interfaces/IFluxStrategy.sol";

interface IKuruMarginAccount {
    function deposit(address user, address token, uint256 amount) external payable;
    function withdraw(uint256 amount, address token) external;
    function getBalance(address user, address token) external view returns (uint256);
    function batchWithdrawMaxTokens(address[] calldata tokens) external;
}

interface IKuruOrderBook {
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

    function batchUpdate(
        uint32[] calldata buyPrices,
        uint96[] calldata buySizes,
        uint32[] calldata sellPrices,
        uint96[] calldata sellSizes,
        uint40[] calldata orderIdsToCancel,
        bool postOnly
    ) external;

    function batchCancelOrders(uint40[] calldata orderIds) external;
    function placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool isMargin, bool isFillOrKill)
        external
        returns (uint256);
}

interface IStorkPriceFeed {
    struct TemporalNumericValue {
        uint64 timestampNs;
        int192 quantizedValue;
    }

    function getTemporalNumericValueV1(bytes32 id) external view returns (TemporalNumericValue memory value);
}

/// @title KuruMarginStrategy
/// @notice Flux strategy adapter for a Kuru spot order book and MarginAccount.
/// @dev Kuru order placement is restricted to a small, oracle-bounded post-only batch.
///      Its NAV includes the margin account's base and quote balances, valued with fresh
///      external USD feeds. This contract is new and must be reviewed against the exact
///      Kuru deployment before any user funds are allocated.
contract KuruMarginStrategy is IFluxStrategy {
    using SafeERC20 for IERC20;

    uint256 private constant PRICE_SCALE = 1e8;
    uint256 private constant BPS = 10_000;
    uint256 public constant MAX_ORDERS_PER_SIDE = 4;

    address public immutable vault;
    IERC20 public immutable quoteToken;
    IERC20 public immutable baseToken;
    IKuruMarginAccount public immutable marginAccount;
    IKuruOrderBook public immutable orderBook;
    IStorkPriceFeed public immutable stork;
    bytes32 public immutable baseUsdFeedId;
    bytes32 public immutable quoteUsdFeedId;
    uint8 public immutable baseDecimals;
    uint8 public immutable quoteDecimals;
    uint64 public immutable maxOracleAge;
    uint16 public immutable maxOrderDeviationBps;
    uint16 public immutable emergencySlippageBps;
    uint32 public immutable pricePrecision;
    uint96 public immutable sizePrecision;
    uint96 public immutable minOrderSize;
    uint96 public immutable maxOrderSize;

    error OnlyVault();
    error InvalidConfiguration();
    error WrongMarketTokens();
    error InvalidOracleAnswer(address feed);
    error StaleOracle(address feed, uint256 updatedAt);
    error InvalidOrderBatch();
    error OrderOutsideOracleBand(uint256 orderPriceUsd, uint256 oraclePriceUsd);
    error InsufficientBaseBalance(uint256 required, uint256 available);
    error InsufficientQuoteBalance(uint256 required, uint256 available);
    error AmountTooLarge();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    struct RebalanceParams {
        uint32[] buyPrices;
        uint96[] buySizes;
        uint32[] sellPrices;
        uint96[] sellSizes;
        uint40[] cancelOrderIds;
    }

    struct Config {
        address vault;
        address baseToken;
        address marginAccount;
        address orderBook;
        address stork;
        bytes32 baseUsdFeedId;
        bytes32 quoteUsdFeedId;
        uint64 maxOracleAge;
        uint16 maxOrderDeviationBps;
        uint16 emergencySlippageBps;
    }

    event KuruFunded(uint256 amount);
    event OrdersReplaced(uint256 buyCount, uint256 sellCount, uint256 canceledCount);
    event KuruFundsReturned(uint256 amount);
    event KuruEmergencyExit(uint256 quoteReturned, uint256 baseSold);
    event BaseInventoryDeposited(uint256 amount);

    constructor(Config memory config) {
        if (
            config.vault == address(0) || config.marginAccount == address(0) || config.orderBook == address(0)
                || config.stork == address(0) || config.baseUsdFeedId == bytes32(0)
                || config.quoteUsdFeedId == bytes32(0) || config.maxOracleAge == 0 || config.maxOrderDeviationBps == 0
                || config.maxOrderDeviationBps > 2_000 || config.emergencySlippageBps > 2_000
        ) revert InvalidConfiguration();
        if (config.stork.code.length == 0) revert InvalidConfiguration();

        address vaultAsset = IFluxStrategyVaultAsset(config.vault).asset();
        (uint32 pricePrec, uint96 sizePrec, uint96 minSize, uint96 maxSize, uint8 baseDec, uint8 quoteDec) =
            _validateMarket(config.orderBook, config.baseToken, vaultAsset);

        vault = config.vault;
        quoteToken = IERC20(vaultAsset);
        baseToken = IERC20(config.baseToken);
        marginAccount = IKuruMarginAccount(config.marginAccount);
        orderBook = IKuruOrderBook(config.orderBook);
        stork = IStorkPriceFeed(config.stork);
        baseUsdFeedId = config.baseUsdFeedId;
        quoteUsdFeedId = config.quoteUsdFeedId;
        baseDecimals = baseDec;
        quoteDecimals = quoteDec;
        maxOracleAge = config.maxOracleAge;
        maxOrderDeviationBps = config.maxOrderDeviationBps;
        emergencySlippageBps = config.emergencySlippageBps;
        pricePrecision = pricePrec;
        sizePrecision = sizePrec;
        minOrderSize = minSize;
        maxOrderSize = maxSize;
    }

    function _validateMarket(address orderBook_, address baseToken_, address vaultAsset_)
        private
        view
        returns (uint32 pricePrec, uint96 sizePrec, uint96 minSize, uint96 maxSize, uint8 baseDec, uint8 quoteDec)
    {
        address marketBase;
        uint256 marketBaseDecimals;
        address marketQuote;
        uint256 marketQuoteDecimals;
        (pricePrec, sizePrec, marketBase, marketBaseDecimals, marketQuote, marketQuoteDecimals,,,,,) =
            IKuruOrderBook(orderBook_).getMarketParams();
        if (marketBase != baseToken_ || marketQuote != vaultAsset_) revert WrongMarketTokens();
        if (marketBaseDecimals > 18 || marketQuoteDecimals > 18 || pricePrec == 0 || sizePrec == 0) {
            revert InvalidConfiguration();
        }
        if (marketBase == address(0)) {
            // Kuru uses address(0) to represent native MON in its native-paired books.
            if (marketBaseDecimals != 18) revert InvalidConfiguration();
        } else if (IERC20Metadata(baseToken_).decimals() != marketBaseDecimals) {
            revert InvalidConfiguration();
        }
        if (IERC20Metadata(vaultAsset_).decimals() != marketQuoteDecimals) revert InvalidConfiguration();
        (,,,,,,, minSize, maxSize,,) = IKuruOrderBook(orderBook_).getMarketParams();
        baseDec = uint8(marketBaseDecimals);
        quoteDec = uint8(marketQuoteDecimals);
    }

    function asset() external view returns (address) {
        return address(quoteToken);
    }

    /// @notice Net Kuru base and quote balances converted into the vault's quote token.
    function totalAssets() public view returns (uint256) {
        (uint256 basePrice, uint256 quotePrice,) = _prices();
        uint256 quoteBalance =
            quoteToken.balanceOf(address(this)) + marginAccount.getBalance(address(this), address(quoteToken));
        uint256 baseBalance = _idleBaseBalance() + marginAccount.getBalance(address(this), address(baseToken));
        uint256 baseValue = Math.mulDiv(
            baseBalance, basePrice * (10 ** uint256(quoteDecimals)), quotePrice * (10 ** uint256(baseDecimals))
        );
        return quoteBalance + baseValue;
    }

    /// @notice Freshness timestamp used by FluxStrategyVault.
    function valuationTimestamp() external view returns (uint64) {
        (,, uint64 timestamp) = _prices();
        return timestamp;
    }

    /// @notice Immediately withdrawable quote collateral only; base inventory needs a sell.
    function liquidAssets() external view returns (uint256) {
        return quoteInventory();
    }

    function baseInventory() external view returns (uint256) {
        return _idleBaseBalance() + marginAccount.getBalance(address(this), address(baseToken));
    }

    function quoteInventory() public view returns (uint256) {
        return quoteToken.balanceOf(address(this)) + marginAccount.getBalance(address(this), address(quoteToken));
    }

    function deploy(uint256 amount, bytes calldata) external onlyVault {
        if (amount == 0) revert InvalidConfiguration();
        quoteToken.forceApprove(address(marginAccount), amount);
        marginAccount.deposit(address(this), address(quoteToken), amount);
        quoteToken.forceApprove(address(marginAccount), 0);
        emit KuruFunded(amount);
    }

    /// @dev Withdraws only liquid quote collateral. Kuru base inventory remains invested.
    function withdraw(uint256 amount, bytes calldata) external onlyVault {
        uint256 idle = quoteToken.balanceOf(address(this));
        uint256 accountQuote = marginAccount.getBalance(address(this), address(quoteToken));
        uint256 totalLiquid = idle + accountQuote;
        uint256 target = Math.min(amount, totalLiquid);
        uint256 fromAccount = target > idle ? target - idle : 0;
        if (fromAccount != 0) marginAccount.withdraw(fromAccount, address(quoteToken));
        uint256 current = quoteToken.balanceOf(address(this));
        uint256 sendAmount = Math.min(target, current);
        if (sendAmount != 0) quoteToken.safeTransfer(vault, sendAmount);
        emit KuruFundsReturned(sendAmount);
    }

    /// @notice Replace a bounded set of post-only Kuru quotes after oracle-band checks.
    /// @param data ABI encoding of RebalanceParams with raw Kuru price and size values.
    function rebalance(bytes calldata data) external onlyVault {
        _depositIdleBase();
        RebalanceParams memory p = abi.decode(data, (RebalanceParams));
        if (
            p.buyPrices.length != p.buySizes.length || p.sellPrices.length != p.sellSizes.length
                || p.buyPrices.length > MAX_ORDERS_PER_SIDE || p.sellPrices.length > MAX_ORDERS_PER_SIDE
        ) revert InvalidOrderBatch();

        (uint256 basePrice, uint256 quotePrice,) = _prices();
        uint256 quoteBalance = marginAccount.getBalance(address(this), address(quoteToken));
        uint256 baseBalance = marginAccount.getBalance(address(this), address(baseToken));
        uint256 quoteNeeded;
        for (uint256 i; i < p.buyPrices.length; ++i) {
            uint32 price = p.buyPrices[i];
            uint96 size = p.buySizes[i];
            _validateOrder(price, size, basePrice, quotePrice);
            quoteNeeded += Math.mulDiv(
                size, uint256(price) * (10 ** uint256(quoteDecimals)), uint256(sizePrecision) * uint256(pricePrecision)
            );
        }
        uint256 baseNeeded;
        for (uint256 i; i < p.sellPrices.length; ++i) {
            _validateOrder(p.sellPrices[i], p.sellSizes[i], basePrice, quotePrice);
            baseNeeded += Math.mulDiv(p.sellSizes[i], 10 ** uint256(baseDecimals), sizePrecision);
        }
        if (quoteNeeded > quoteBalance) revert InsufficientQuoteBalance(quoteNeeded, quoteBalance);
        if (baseNeeded > baseBalance) revert InsufficientBaseBalance(baseNeeded, baseBalance);

        orderBook.batchUpdate(p.buyPrices, p.buySizes, p.sellPrices, p.sellSizes, p.cancelOrderIds, true);
        emit OrdersReplaced(p.buyPrices.length, p.sellPrices.length, p.cancelOrderIds.length);
    }

    /// @notice Cancel supplied orders, sell all Kuru base inventory with a bounded minimum,
    ///         and return recovered quote collateral to the vault.
    /// @dev The market sell is fill-or-kill. If the book cannot meet the oracle-derived minimum,
    ///      the whole exit reverts; the caller can first cancel orders through rebalance().
    function emergencyExit(bytes calldata data) external onlyVault {
        _depositIdleBase();
        uint40[] memory cancelIds = abi.decode(data, (uint40[]));
        if (cancelIds.length != 0) orderBook.batchCancelOrders(cancelIds);

        uint256 baseBalance = marginAccount.getBalance(address(this), address(baseToken));
        uint256 baseSize = Math.mulDiv(baseBalance, sizePrecision, 10 ** uint256(baseDecimals));
        uint256 baseSold;
        if (baseSize != 0) {
            if (baseSize > type(uint96).max) revert AmountTooLarge();
            uint256 sellableBase = Math.mulDiv(baseSize, 10 ** uint256(baseDecimals), sizePrecision);
            (uint256 basePrice, uint256 quotePrice,) = _prices();
            uint256 grossQuote = Math.mulDiv(
                sellableBase, basePrice * (10 ** uint256(quoteDecimals)), quotePrice * (10 ** uint256(baseDecimals))
            );
            uint256 minOut = Math.mulDiv(grossQuote, BPS - emergencySlippageBps, BPS);
            orderBook.placeAndExecuteMarketSell(uint96(baseSize), minOut, true, true);
            baseSold = sellableBase;
        }

        uint256 accountQuote = marginAccount.getBalance(address(this), address(quoteToken));
        if (accountQuote != 0) marginAccount.withdraw(accountQuote, address(quoteToken));
        uint256 returned = quoteToken.balanceOf(address(this));
        if (returned != 0) quoteToken.safeTransfer(vault, returned);
        emit KuruEmergencyExit(returned, baseSold);
    }

    function _validateOrder(uint32 rawPrice, uint96 rawSize, uint256 basePrice, uint256 quotePrice) private view {
        if (rawPrice == 0 || rawSize < minOrderSize || rawSize > maxOrderSize) revert InvalidOrderBatch();
        uint256 orderUsdPrice = Math.mulDiv(rawPrice, quotePrice, pricePrecision);
        uint256 difference = orderUsdPrice > basePrice ? orderUsdPrice - basePrice : basePrice - orderUsdPrice;
        if (Math.mulDiv(difference, BPS, basePrice) > maxOrderDeviationBps) {
            revert OrderOutsideOracleBand(orderUsdPrice, basePrice);
        }
    }

    function _prices() private view returns (uint256 basePrice, uint256 quotePrice, uint64 timestamp) {
        IStorkPriceFeed.TemporalNumericValue memory base = stork.getTemporalNumericValueV1(baseUsdFeedId);
        IStorkPriceFeed.TemporalNumericValue memory quote = stork.getTemporalNumericValueV1(quoteUsdFeedId);
        basePrice = _normalizeStorkPrice(base);
        quotePrice = _normalizeStorkPrice(quote);
        uint64 baseTimestamp = base.timestampNs / 1e9;
        uint64 quoteTimestamp = quote.timestampNs / 1e9;
        timestamp = uint64(Math.min(baseTimestamp, quoteTimestamp));
        if (timestamp > block.timestamp) revert InvalidOracleAnswer(address(stork));
        if (block.timestamp - timestamp > maxOracleAge) revert StaleOracle(address(stork), timestamp);
    }

    function _normalizeStorkPrice(IStorkPriceFeed.TemporalNumericValue memory data)
        private
        view
        returns (uint256 normalized)
    {
        if (data.timestampNs == 0 || data.quantizedValue <= 0) revert InvalidOracleAnswer(address(stork));
        normalized = uint256(uint192(data.quantizedValue)) / 1e10;
        if (normalized == 0) revert InvalidOracleAnswer(address(stork));
    }

    function _idleBaseBalance() private view returns (uint256) {
        if (address(baseToken) == address(0)) return address(this).balance;
        return baseToken.balanceOf(address(this));
    }

    /// @dev Kuru's MarginAccount requires assets to be deposited before they can back orders.
    function _depositIdleBase() private {
        uint256 amount = _idleBaseBalance();
        if (amount == 0) return;

        if (address(baseToken) == address(0)) {
            marginAccount.deposit{value: amount}(address(this), address(0), amount);
        } else {
            baseToken.forceApprove(address(marginAccount), amount);
            marginAccount.deposit(address(this), address(baseToken), amount);
            baseToken.forceApprove(address(marginAccount), 0);
        }
        emit BaseInventoryDeposited(amount);
    }

    receive() external payable {}
}

interface IFluxStrategyVaultAsset {
    function asset() external view returns (address);
}
