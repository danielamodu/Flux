// vault.ts — Flux strategy vault read client (ethers v6, testnet only).
import { ethers } from 'ethers';

const VAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function asset() view returns (address)',
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

  /** Current portfolio NAV returned by the vault (base units). */
  async getTotalAssets(): Promise<bigint> {
    return (await this.vault.totalAssets()) as bigint;
  }

  /** Quote token currently held idle by the vault (base units). */
  async getAvailableLiquidity(): Promise<bigint> {
    const usdc = await this.usdc();
    return (await usdc.balanceOf(this.vaultAddress)) as bigint;
  }

  private async usdc(): Promise<ethers.Contract> {
    if (this.usdcContract) return this.usdcContract;
    let tokenAddress: string;
    try {
      tokenAddress = (await this.vault.asset()) as string;
    } catch {
      // Older cash-only FluxVault deployments expose `usdc()` instead.
      tokenAddress = (await this.vault.usdc()) as string;
    }
    this.usdcContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    return this.usdcContract;
  }
}
