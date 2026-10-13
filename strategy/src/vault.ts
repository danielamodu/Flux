// vault.ts — FluxVault contract client (ethers v6, testnet only).
//
// Read-only client for the vault. It deliberately has no NAV-write interface:
// FluxVault NAV is the actual USDC balance held by the contract.
import { ethers } from 'ethers';

const VAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function usdc() view returns (address)',
] as const;

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

export interface VaultClientConfig {
  rpcUrl: string;
  vaultAddress: string;
}

export class VaultClient {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly vault: ethers.Contract;
  private readonly vaultAddress: string;
  private usdcContract: ethers.Contract | undefined;

  constructor(config: VaultClientConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.vaultAddress = config.vaultAddress;
    this.vault = new ethers.Contract(config.vaultAddress, VAULT_ABI, this.provider);
  }

  /** Current redeemable USDC held by the vault (base units). */
  async getTotalAssets(): Promise<bigint> {
    return (await this.vault.totalAssets()) as bigint;
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
