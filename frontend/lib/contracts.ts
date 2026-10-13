// On-chain constants for the Flux vault on Monad testnet.
// The vault ABI below is the authoritative fragment supplied by the protocol —
// do not extend it by guessing. USDC is a standard ERC-20 (the testnet mock
// "Test USD"), so its interface lives in ERC20_ABI.

const LEGACY_VAULT_ADDRESS = '0x87D7e8ADc960B554483d4CEed5305B15b1D3B600' as const;
const DEPLOYED_VAULT_ADDRESS = '0x7e974626f6767c3A9ddA8A5b664301CAD5a6B879' as const;
const configuredVault = process.env.NEXT_PUBLIC_VAULT_ADDRESS?.trim();
const isConfiguredVault = /^0x[0-9a-fA-F]{40}$/.test(configuredVault ?? '');
export const VAULT_ADDRESS = (isConfiguredVault ? configuredVault : DEPLOYED_VAULT_ADDRESS) as `0x${string}`;
export const USDC_ADDRESS = '0xdf5b718d8fcc173335185a2a1513ee8151e3c027' as const;

// USDC and FLUX-LP shares are both 6-decimal on this deployment: deposits mint
// shares 1:1 at genesis, so totalSupply and totalAssets share the same scale.
export const USDC_DECIMALS = 6;
export const SHARE_DECIMALS = 6;

// The legacy contract has unsafe owner-set NAV and must remain read-only.
export const DEPOSITS_ENABLED = VAULT_ADDRESS.toLowerCase() !== LEGACY_VAULT_ADDRESS.toLowerCase();

export const VAULT_ABI = [
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
  {
    name: 'Deposited',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'usdcAmount', type: 'uint256', indexed: false },
      { name: 'sharesIssued', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdrawn',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'sharesRedeemed', type: 'uint256', indexed: false },
      { name: 'usdcAmount', type: 'uint256', indexed: false },
    ],
  },
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
