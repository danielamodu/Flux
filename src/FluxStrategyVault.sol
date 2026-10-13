// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFluxStrategy} from "./interfaces/IFluxStrategy.sol";

/// @title FluxStrategyVault
/// @notice USDC share vault that accounts for approved, USDC-denominated strategy adapters.
/// @dev New deployment only. The existing cash-only FluxVault remains unchanged. Strategy
///      adapters are trusted components and must report conservative net NAV. This prototype
///      does not make external venue custody or oracle risk trustless.
contract FluxStrategyVault is ERC20, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    address private constant DEAD_SHARES = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_STRATEGIES = 8;

    IERC20 public immutable usdc;
    uint8 private immutable _shareDecimals;
    uint64 public maxValuationAge;
    address public keeper;
    bool public paused;

    struct StrategyConfig {
        uint128 assetCap;
        bool enabled;
        bool registered;
    }

    mapping(address strategy => StrategyConfig config) public strategies;
    address[] private _strategyList;

    event StrategyRegistered(address indexed strategy, uint256 assetCap);
    event StrategyStatusChanged(address indexed strategy, bool enabled);
    event StrategyCapChanged(address indexed strategy, uint256 assetCap);
    event KeeperChanged(address indexed oldKeeper, address indexed newKeeper);
    event PauseChanged(bool paused);
    event ValuationAgeChanged(uint64 oldAge, uint64 newAge);
    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 shares, uint256 assets);
    event Allocated(address indexed strategy, uint256 amount);
    event StrategyWithdrawal(address indexed strategy, uint256 requested, uint256 recovered);
    event StrategyEmergencyExit(address indexed strategy, uint256 recovered);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error InvalidStrategy();
    error StrategyAlreadyRegistered();
    error StrategyNotRegistered();
    error StrategyAssetMismatch();
    error InvalidCap();
    error CapExceeded(uint256 requestedNav, uint256 cap);
    error NotKeeper();
    error VaultPaused();
    error StaleValuation(address strategy, uint64 timestamp);
    error InvalidValuationTimestamp(address strategy, uint64 timestamp);
    error UnsupportedTransferFee(uint256 requested, uint256 received);
    error InsolventVault();
    error InsufficientShares(uint256 requested, uint256 owned);
    error InsufficientLiquidity(uint256 requested, uint256 available);

    modifier onlyKeeperOrOwner() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(address usdcToken, address initialOwner, uint64 initialMaxValuationAge)
        ERC20("Flux LP", "FLUX-LP")
        Ownable(initialOwner)
    {
        if (usdcToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        if (initialMaxValuationAge == 0) revert InvalidCap();
        usdc = IERC20(usdcToken);
        _shareDecimals = IERC20Metadata(usdcToken).decimals();
        maxValuationAge = initialMaxValuationAge;
        keeper = initialOwner;
    }

    function decimals() public view override returns (uint8) {
        return _shareDecimals;
    }

    /// @notice Underlying asset accepted by the vault and its strategy adapters.
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Idle USDC plus fresh NAV reported by every registered strategy.
    function totalAssets() public view returns (uint256 assets) {
        assets = usdc.balanceOf(address(this));
        uint256 length = _strategyList.length;
        for (uint256 i; i < length; ++i) {
            address strategy = _strategyList[i];
            uint256 nav = IFluxStrategy(strategy).totalAssets();
            if (nav == 0) continue;
            _assertFresh(strategy);
            assets += nav;
        }
    }

    function previewDeposit(uint256 amount) external view returns (uint256 shares) {
        uint256 supply = totalSupply();
        uint256 assets = totalAssets();
        if (supply == 0) return amount;
        if (assets == 0) revert InsolventVault();
        shares = Math.mulDiv(amount, supply, assets);
    }

    function previewWithdraw(uint256 shares) external view returns (uint256 assets) {
        uint256 supply = totalSupply();
        if (supply == 0) revert InsufficientShares(shares, 0);
        uint256 total = totalAssets();
        assets = shares == supply ? total : Math.mulDiv(shares, total, supply);
    }

    function strategyCount() external view returns (uint256) {
        return _strategyList.length;
    }

    function strategyAt(uint256 index) external view returns (address) {
        return _strategyList[index];
    }

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroAddress();
        emit KeeperChanged(keeper, newKeeper);
        keeper = newKeeper;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PauseChanged(value);
    }

    function setMaxValuationAge(uint64 newAge) external onlyOwner {
        if (newAge == 0) revert InvalidCap();
        emit ValuationAgeChanged(maxValuationAge, newAge);
        maxValuationAge = newAge;
    }

    function registerStrategy(address strategy, uint128 assetCap) external onlyOwner {
        if (strategy == address(0) || strategy.code.length == 0) revert InvalidStrategy();
        if (strategies[strategy].registered) revert StrategyAlreadyRegistered();
        if (_strategyList.length >= MAX_STRATEGIES) revert InvalidStrategy();
        if (assetCap == 0) revert InvalidCap();
        if (IFluxStrategy(strategy).asset() != address(usdc)) revert StrategyAssetMismatch();
        strategies[strategy] = StrategyConfig({assetCap: assetCap, enabled: true, registered: true});
        _strategyList.push(strategy);
        emit StrategyRegistered(strategy, assetCap);
    }

    function setStrategyEnabled(address strategy, bool enabled) external onlyOwner {
        StrategyConfig storage config = strategies[strategy];
        if (!config.registered) revert StrategyNotRegistered();
        config.enabled = enabled;
        emit StrategyStatusChanged(strategy, enabled);
    }

    function setStrategyCap(address strategy, uint128 assetCap) external onlyOwner {
        StrategyConfig storage config = strategies[strategy];
        if (!config.registered) revert StrategyNotRegistered();
        if (assetCap == 0) revert InvalidCap();
        uint256 currentNav = IFluxStrategy(strategy).totalAssets();
        if (currentNav != 0) _assertFresh(strategy);
        if (currentNav > assetCap) revert CapExceeded(currentNav, assetCap);
        config.assetCap = assetCap;
        emit StrategyCapChanged(strategy, assetCap);
    }

    /// @notice Mint shares against the vault's complete marked-to-market portfolio.
    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (paused) revert VaultPaused();
        if (amount == 0) revert ZeroAmount();

        uint256 supply = totalSupply();
        uint256 assets = totalAssets();
        if (supply == 0) {
            if (assets != 0) _mint(DEAD_SHARES, assets);
            shares = amount;
        } else {
            if (assets == 0) revert InsolventVault();
            shares = Math.mulDiv(amount, supply, assets);
        }
        if (shares == 0) revert ZeroShares();

        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert UnsupportedTransferFee(amount, received);
        _mint(msg.sender, shares);
        emit Deposited(msg.sender, amount, shares);
    }

    /// @notice Redeem shares, unwinding strategy liquidity as needed.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256 owned = balanceOf(msg.sender);
        if (shares > owned) revert InsufficientShares(shares, owned);
        uint256 assets = totalAssets();
        amount = shares == supply ? assets : Math.mulDiv(shares, assets, supply);

        uint256 idle = usdc.balanceOf(address(this));
        if (idle < amount) _withdrawFromStrategies(amount - idle);
        idle = usdc.balanceOf(address(this));
        if (idle < amount) revert InsufficientLiquidity(amount, idle);

        _burn(msg.sender, shares);
        if (amount != 0) usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, shares, amount);
    }

    /// @notice Send idle USDC to an enabled adapter, subject to its NAV cap.
    function allocate(address strategy, uint256 amount, bytes calldata data)
        external
        onlyKeeperOrOwner
        nonReentrant
    {
        if (paused) revert VaultPaused();
        if (amount == 0) revert ZeroAmount();
        StrategyConfig memory config = strategies[strategy];
        if (!config.registered || !config.enabled) revert StrategyNotRegistered();
        uint256 currentNav = IFluxStrategy(strategy).totalAssets();
        if (currentNav != 0) _assertFresh(strategy);
        if (currentNav + amount > config.assetCap) {
            revert CapExceeded(currentNav + amount, config.assetCap);
        }
        usdc.safeTransfer(strategy, amount);
        IFluxStrategy(strategy).deploy(amount, data);
        uint256 reportedNav = IFluxStrategy(strategy).totalAssets();
        if (reportedNav != 0) _assertFresh(strategy);
        if (reportedNav > config.assetCap) revert CapExceeded(reportedNav, config.assetCap);
        emit Allocated(strategy, amount);
    }

    function rebalance(address strategy, bytes calldata data) external onlyKeeperOrOwner nonReentrant {
        if (paused) revert VaultPaused();
        StrategyConfig memory config = strategies[strategy];
        if (!config.registered || !config.enabled) revert StrategyNotRegistered();
        IFluxStrategy(strategy).rebalance(data);
    }

    /// @notice Owner-triggered best-effort exit remains callable while the vault is paused.
    function emergencyExit(address strategy, bytes calldata data) external onlyOwner nonReentrant {
        if (!strategies[strategy].registered) revert StrategyNotRegistered();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        IFluxStrategy(strategy).emergencyExit(data);
        emit StrategyEmergencyExit(strategy, usdc.balanceOf(address(this)) - beforeBalance);
    }

    function _withdrawFromStrategies(uint256 shortfall) private {
        uint256 length = _strategyList.length;
        for (uint256 i; i < length && shortfall != 0; ++i) {
            address strategy = _strategyList[i];
            uint256 nav = IFluxStrategy(strategy).totalAssets();
            if (nav == 0) continue;
            uint256 liquid = IFluxStrategy(strategy).liquidAssets();
            uint256 request = Math.min(shortfall, Math.min(nav, liquid));
            if (request == 0) continue;

            uint256 beforeBalance = usdc.balanceOf(address(this));
            IFluxStrategy(strategy).withdraw(request, "");
            uint256 recovered = usdc.balanceOf(address(this)) - beforeBalance;
            emit StrategyWithdrawal(strategy, request, recovered);
            shortfall = recovered >= shortfall ? 0 : shortfall - recovered;
        }
    }

    function _assertFresh(address strategy) private view {
        uint64 timestamp = IFluxStrategy(strategy).valuationTimestamp();
        if (timestamp > block.timestamp) revert InvalidValuationTimestamp(strategy, timestamp);
        if (block.timestamp - timestamp > maxValuationAge) revert StaleValuation(strategy, timestamp);
    }
}
