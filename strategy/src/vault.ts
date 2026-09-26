// vault.ts — FluxVault contract client (ethers v6, testnet only).
//
// Reads NAV from the vault and reports strategy PnL back via updateTotalAssets
// (owner-only on-chain). Uses the ethers v6 API exclusively.
import { ethers } from 'ethers';

const VAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function updateTotalAssets(uint256 newTotal)',
  'function usdc() view returns (address)',
  'function owner() view returns (address)',
] as const;

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

export interface VaultClientConfig {
  rpcUrl: string;
  vaultAddress: string;
  ownerPrivateKey: string;
}

export class VaultClient {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly wallet: ethers.Wallet;
  private readonly vault: ethers.Contract;
  private readonly vaultAddress: string;
  private usdcContract: ethers.Contract | undefined;

  constructor(config: VaultClientConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.ownerPrivateKey, this.provider);
    this.vaultAddress = config.vaultAddress;
    this.vault = new ethers.Contract(config.vaultAddress, VAULT_ABI, this.wallet);
  }

  /** Current NAV tracked by the vault (USDC units, 6 decimals). */
  async getTotalAssets(): Promise<bigint> {
    return (await this.vault.totalAssets()) as bigint;
  }

  /** Owner-only: report the strategy's new NAV to the vault. */
  async updateTotalAssets(newTotal: bigint): Promise<void> {
    const tx = await this.vault.updateTotalAssets(newTotal);
    await tx.wait();
  }

  /** USDC currently held by the vault, available to deploy (6 decimals). */
  async getAvailableLiquidity(): Promise<bigint> {
    const usdc = await this.usdc();
    return (await usdc.balanceOf(this.vaultAddress)) as bigint;
  }

  private async usdc(): Promise<ethers.Contract> {
    if (this.usdcContract) return this.usdcContract;
    const tokenAddress = (await this.vault.usdc()) as string;
    this.usdcContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    return this.usdcContract;
  }
}
