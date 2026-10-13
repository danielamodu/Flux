// On-chain configuration for Flux deployments on Monad testnet.

const LEGACY_VAULT_ADDRESS = '0x87D7e8ADc960B554483d4CEed5305B15b1D3B600' as const;
const CASH_VAULT_ADDRESS = '0x7e974626f6767c3A9ddA8A5b664301CAD5a6B879' as const;
const STRATEGY_VAULT_ADDRESS = '0x67f5787E44A42BBb12fdA9A3a9142Bd6cEEffb42' as const;
const configuredVault = process.env.NEXT_PUBLIC_VAULT_ADDRESS?.trim();
const isConfiguredVault = /^0x[0-9a-fA-F]{40}$/.test(configuredVault ?? '');
export const VAULT_ADDRESS = (isConfiguredVault ? configuredVault : STRATEGY_VAULT_ADDRESS) as `0x${string}`;
export const STRATEGY_ADDRESS = '0x1AC5d862e48001b139070F9A64F9dd164B6A6d1B' as const;
const STRATEGY_QUOTE_TOKEN = '0x534b2f3A21130d7a60830c2Df862319e593943A3' as const;
const CASH_VAULT_TOKEN = '0xdf5b718d8fcc173335185a2a1513ee8151e3c027' as const;
const configuredAsset = process.env.NEXT_PUBLIC_VAULT_ASSET_ADDRESS?.trim();
const isConfiguredAsset = /^0x[0-9a-fA-F]{40}$/.test(configuredAsset ?? '');
const isStrategyVault = VAULT_ADDRESS.toLowerCase() === STRATEGY_VAULT_ADDRESS.toLowerCase();
export const USDC_ADDRESS = (isConfiguredAsset
  ? configuredAsset
  : isStrategyVault
    ? STRATEGY_QUOTE_TOKEN
    : CASH_VAULT_TOKEN) as `0x${string}`;

// USDC and FLUX-LP shares are both 6-decimal on this deployment: deposits mint
// shares 1:1 at genesis, so totalSupply and totalAssets share the same scale.
export const USDC_DECIMALS = 6;
export const SHARE_DECIMALS = 6;

// Keep strategy-vault deposits closed in the app until its Kuru allocation,
// trading, unwind, and withdrawal cycle has been exercised with test funds.
// The previous cash-only vault remains available for its existing flow.
export const DEPOSITS_ENABLED = VAULT_ADDRESS.toLowerCase() === CASH_VAULT_ADDRESS.toLowerCase();
export const DEPOSITS_PAUSE_REASON = isStrategyVault
  ? 'Deposits are paused until the Kuru testnet trade and unwind cycle is verified.'
  : VAULT_ADDRESS.toLowerCase() === LEGACY_VAULT_ADDRESS.toLowerCase()
    ? 'Deposits are disabled for the legacy vault.'
    : 'Deposits are disabled for this vault configuration.';

const VAULT_FUNCTIONS = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'withdraw',
    type: 'function',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'totalAssets',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'totalSupply',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const STRATEGY_VAULT_EVENTS = [
  {
    name: 'Deposited',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdrawn',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'assets', type: 'uint256', indexed: false },
    ],
  },
] as const;

const CASH_VAULT_EVENTS = [
  {
    name: 'Deposited',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: false },
      { name: 'usdcAmount', type: 'uint256', indexed: false },
      { name: 'sharesIssued', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdrawn',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: false },
      { name: 'sharesRedeemed', type: 'uint256', indexed: false },
      { name: 'usdcAmount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const VAULT_ABI = [
  ...VAULT_FUNCTIONS,
  ...(isStrategyVault ? STRATEGY_VAULT_EVENTS : CASH_VAULT_EVENTS),
] as const;

// Minimal ERC-20 surface for the USDC token: approve/allowance drive the deposit
// flow, balanceOf shows the wallet's spendable USDC.
export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export const EXPLORER_URL = 'https://testnet.monadexplorer.com';
