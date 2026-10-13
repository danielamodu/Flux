// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FluxVault} from "../src/FluxVault.sol";

/// @dev Minimal 6-decimal USDC mock for testing.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract FluxVaultTest is Test {
    MockUSDC internal usdc;
    FluxVault internal vault;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant ONE_USDC = 1e6;

    // Re-declared so we can assert on them with vm.expectEmit.
    event Deposited(address user, uint256 usdcAmount, uint256 sharesIssued);
    event Withdrawn(address user, uint256 sharesRedeemed, uint256 usdcAmount);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new FluxVault(address(usdc));

        usdc.mint(alice, 1_000_000 * ONE_USDC);
        usdc.mint(bob, 1_000_000 * ONE_USDC);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _deposit(address user, uint256 amount) internal returns (uint256 shares) {
        vm.prank(user);
        shares = vault.deposit(amount);
    }

    /// deposit mints correct shares (first depositor: 1 USDC = 1 FLUX-LP)
    function test_DepositMintsCorrectShares() public {
        uint256 amount = 1_000 * ONE_USDC;

        vm.expectEmit(true, true, true, true, address(vault));
        emit Deposited(alice, amount, amount); // 1:1 for the first depositor

        uint256 shares = _deposit(alice, amount);

        assertEq(shares, amount, "shares == deposit for first depositor");
        assertEq(vault.balanceOf(alice), amount, "alice FLUX-LP balance");
        assertEq(vault.totalSupply(), amount, "total supply");
        assertEq(vault.totalAssets(), amount, "totalAssets");
        assertEq(usdc.balanceOf(address(vault)), amount, "vault USDC balance");
        assertEq(vault.decimals(), 6, "FLUX-LP decimals match USDC");
    }

    /// withdraw burns correct shares and returns correct USDC
    function test_WithdrawBurnsSharesAndReturnsUSDC() public {
        uint256 amount = 1_000 * ONE_USDC;
        _deposit(alice, amount);

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 shares = vault.balanceOf(alice);

        vm.expectEmit(true, true, true, true, address(vault));
        emit Withdrawn(alice, shares, amount);

        vm.prank(alice);
        uint256 returned = vault.withdraw(shares);

        assertEq(returned, amount, "returns full USDC (no yield)");
        assertEq(vault.balanceOf(alice), 0, "alice shares burned");
        assertEq(vault.totalSupply(), 0, "supply back to zero");
        assertEq(vault.totalAssets(), 0, "totalAssets back to zero");
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore + amount, "alice got USDC back");
        assertEq(usdc.balanceOf(address(vault)), 0, "vault emptied");
    }

    /// Share price follows only USDC held by the vault; donations are real assets.
    function test_SecondDepositorGetsCorrectShareRatio() public {
        uint256 aliceAmount = 1_000 * ONE_USDC;
        _deposit(alice, aliceAmount); // 1,000 shares (1:1)
        assertEq(vault.balanceOf(alice), aliceAmount);

        // Settled proceeds returned to the vault increase redeemable NAV.
        usdc.mint(address(vault), 1_000 * ONE_USDC);

        // NAV/share = 2,000 / 1,000 = 2 USDC. Bob deposits 1,000 -> 500 shares.
        uint256 bobAmount = 1_000 * ONE_USDC;
        uint256 expected = (bobAmount * vault.totalSupply()) / vault.totalAssets();
        uint256 bobShares = _deposit(bob, bobAmount);

        assertEq(bobShares, expected, "bob shares from NAV formula");
        assertEq(bobShares, 500 * ONE_USDC, "bob gets half the shares per USDC");
        assertEq(vault.totalSupply(), aliceAmount + bobShares, "supply updated");
        assertEq(vault.totalAssets(), 3_000 * ONE_USDC, "totalAssets includes bob deposit");
    }

    /// Settled proceeds held in the vault are redeemable by shareholders.
    function test_SettledProceedsAffectWithdrawal() public {
        uint256 amount = 1_000 * ONE_USDC;
        _deposit(alice, amount); // 1,000 shares, totalAssets = 1,000 USDC

        // Baseline: redeeming 1 share now would return 1 USDC.
        // Strategy books +1,000 USDC of yield and returns the cash to the vault.
        usdc.mint(address(vault), 1_000 * ONE_USDC);

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 shares = vault.balanceOf(alice);

        vm.prank(alice);
        uint256 returned = vault.withdraw(shares);

        // Only actual USDC held by the vault can be withdrawn.
        assertEq(returned, 2_000 * ONE_USDC, "withdrawal reflects reported yield");
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore + 2_000 * ONE_USDC, "alice received yield");
        assertEq(vault.totalAssets(), 0, "totalAssets drained");
    }

    function test_PreseededDonationCannotBeCapturedByFirstDepositor() public {
        uint256 donation = 100 * ONE_USDC;
        uint256 deposit = 100 * ONE_USDC;
        usdc.mint(address(vault), donation);
        uint256 shares = _deposit(alice, deposit);
        assertEq(shares, deposit);
        assertEq(vault.balanceOf(alice), deposit);
        assertEq(vault.balanceOf(address(0x000000000000000000000000000000000000dEaD)), donation);
        assertEq(vault.totalAssets(), donation + deposit);
    }

    function test_DepositRevertsWhenVaultInsolventButSharesRemain() public {
        _deposit(alice, 10 * ONE_USDC);
        usdc.burn(address(vault), 10 * ONE_USDC);
        vm.prank(bob);
        vm.expectRevert(FluxVault.InsolventVault.selector);
        vault.deposit(ONE_USDC);
    }

    function test_WorthlessSharesCanBeBurned() public {
        uint256 shares = _deposit(alice, 10 * ONE_USDC);
        usdc.burn(address(vault), 10 * ONE_USDC);
        vm.prank(alice);
        assertEq(vault.withdraw(shares), 0);
        assertEq(vault.totalSupply(), 0);
    }

    function test_DirectDonationImmediatelyChangesAssets() public {
        _deposit(alice, ONE_USDC);
        usdc.mint(address(vault), ONE_USDC);
        assertEq(vault.totalAssets(), 2 * ONE_USDC);
    }
}
