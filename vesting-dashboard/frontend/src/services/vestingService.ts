// src/services/vestingService.ts - ИСПРАВЛЕННАЯ версия с новым парсером Solana
import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import type { 
  VestingData, 
  VestingConfig, 
  UserRole, 
  Recipient,
  VestingSchedule,
  VestingProgress,
  ClaimStatus,
  ClaimRequest,
  ClaimResponse
} from '../types/vesting';
import { BNB_VESTING_ABI } from '../types/vesting';

// Add type definitions for contract responses
interface ContractRecipient {
  wallet: string;
  percentage: number;
}

interface ContractVestingSchedule {
  isInitialized: boolean;
  token: string;
  startTime: bigint;
  cliffDuration: bigint;
  vestingDuration: bigint;
  totalAmount: bigint;
  claimedAmount: bigint;
  recipientCount: number;
  isTestMode: boolean;
}

interface ContractVestingProgress {
  elapsedTime: bigint;
  unlockedPercentage: bigint;
  unlockedAmount: bigint;
  claimableAmount: bigint;
  remainingAmount: bigint;
}

interface ContractNextUnlock {
  nextUnlockTime: bigint;
  nextUnlockPercentage: bigint;
  timeRemaining: bigint;
}

export class VestingService {
  private config: VestingConfig;
  private backendUrl: string;

  constructor() {
    this.backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
    
    this.config = {
      bnb: {
        rpcUrl: 'https://bsc-testnet.drpc.org',
        contractAddress: import.meta.env.VITE_BNB_CONTRACT_ADDRESS || '0x779272a662e72Fd637A5E1598812D32cE9AC8788',
        tokenAddress: import.meta.env.VITE_BNB_TOKEN_ADDRESS || '0x1F90b42CaF179CA404025a7C0234d348d3DC6b12',
        name: 'BNB Smart Chain Testnet',
        explorerUrl: 'https://testnet.bscscan.com'
      },
      solana: {
        rpcUrl: 'https://api.devnet.solana.com',
        vestingPDA: import.meta.env.VITE_SOLANA_VESTING_PDA || 'BU38o4YFshs4UUidcV8AQZ6hrphmXbZy5Sqm5AcatCWz',
        programId: import.meta.env.VITE_SOLANA_PROGRAM_ID || '5Q45ww8uwWsnLpZa8ivFFp6ENfVFHE9yCARTs1CJ3xZB',
        name: 'Solana Devnet',
        explorerUrl: 'https://explorer.solana.com'
      }
    };
  }

  async fetchBNBVestingData(
    userAddress: string | null,
    provider?: ethers.BrowserProvider
  ): Promise<VestingData | null> {
    try {
      // Always use RPC provider for contract calls to avoid MetaMask network issues
      // MetaMask provider will be used only for signing transactions
      const rpcProvider = new ethers.JsonRpcProvider(this.config.bnb.rpcUrl);
      const contract = new ethers.Contract(
        this.config.bnb.contractAddress,
        BNB_VESTING_ABI,
        rpcProvider
      );

      const KNOWN_INITIALIZER = '0xea755aBa09CaAc2F73C4b6288256FF4Ae88beFbC';

      console.group('🔧 BNB Vesting - Contract Data Analysis');
      
      // 🔍 Debug network and contract info
      console.log('🌐 Network info:', {
        contractAddress: this.config.bnb.contractAddress,
        beneficiaryAddress: KNOWN_INITIALIZER,
        userAddress,
        hasProvider: !!provider,
        rpcUrl: this.config.bnb.rpcUrl
      });
      
      const network = await rpcProvider.getNetwork();
      console.log('🌐 RPC network:', {
        name: network.name,
        chainId: network.chainId.toString()
      });
      
      console.log('📞 Calling getVestingSchedule...');
      let scheduleResult: ContractVestingSchedule;
      try {
        scheduleResult = await contract.getVestingSchedule(KNOWN_INITIALIZER) as ContractVestingSchedule;
        console.log('✅ getVestingSchedule result:', scheduleResult);
      } catch (scheduleError: any) {
        console.error('❌ getVestingSchedule failed:', scheduleError);
        console.error('❌ Schedule error details:', {
          message: scheduleError.message,
          code: scheduleError.code,
          data: scheduleError.data
        });
        
        // Try with different approach
        try {
          console.log('🔄 Trying alternative contract call...');
          const code = await rpcProvider.getCode(this.config.bnb.contractAddress);
          console.log('📋 Contract code exists:', code !== '0x');
          
          if (code === '0x') {
            throw new Error('Contract does not exist at this address');
          }
        } catch (codeError) {
          console.error('❌ Contract code check failed:', codeError);
        }
        
        throw scheduleError;
      }
      
      if (!scheduleResult.isInitialized) {
        console.log('❌ Contract not initialized');
        console.groupEnd();
        return null;
      }

      const totalAmount = BigInt(scheduleResult.totalAmount);
      let claimedAmount = BigInt(scheduleResult.claimedAmount);
      
      try {
        const currentSchedule = await contract.getVestingSchedule(KNOWN_INITIALIZER);
        const actualClaimedAmount = BigInt(currentSchedule.claimedAmount);
        
        if (actualClaimedAmount !== claimedAmount) {
          console.log('⚠️ Claimed amount mismatch detected:', {
            fromSchedule: claimedAmount.toString(),
            actualClaimed: actualClaimedAmount.toString()
          });
          claimedAmount = actualClaimedAmount; 
        }
      } catch (error) {
        console.warn('Could not verify claimed amount:', error);
      }
      
      console.log('📊 Contract Schedule Data:', {
        totalAmount: totalAmount.toString(),
        claimedAmount: claimedAmount.toString(),
        startTime: scheduleResult.startTime > 0n ? new Date(Number(scheduleResult.startTime) * 1000).toISOString() : 'Not started'
      });

      try {
        const claimableFromContract = await contract.getClaimableAmount(KNOWN_INITIALIZER);
        const canDistribute = await contract.canDistribute(KNOWN_INITIALIZER);
        
        console.log('🔍 Additional contract checks:', {
          claimableFromContract: claimableFromContract.toString(),
          canDistribute,
          contractClaimedAmount: claimedAmount.toString()
        });
        
        // ✅ REMOVED: Incorrect logic that assumed full distribution
        // if (claimableFromContract === 0n && claimedAmount < totalAmount && canDistribute === false) {
        //   console.log('🚨 Potential data inconsistency detected - assuming full distribution');
        //   claimedAmount = totalAmount; 
        // }
        
        // ✅ CORRECT: Trust the contract data as-is
        console.log('📊 Contract data is trusted as-is:', {
          claimedAmount: claimedAmount.toString(),
          claimableFromContract: claimableFromContract.toString(),
          canDistribute
        });
      } catch (error) {
        console.warn('Could not perform additional contract checks:', error);
      }

      let isFullyVested = claimedAmount >= totalAmount;
      
      // ✅ REMOVED: Incorrect time-based logic that assumed full distribution
      // The contract should be the source of truth, not time calculations
      
      // if (!isFullyVested) {
      //   const currentTime = Math.floor(Date.now() / 1000);
      //   const startTime = Number(scheduleResult.startTime);
      //   const elapsedTime = currentTime - startTime;
      //   const vestingEndTime = startTime + Number(scheduleResult.vestingDuration);
      //   
      //   if (currentTime >= vestingEndTime && elapsedTime > 1200) {
      //     console.log('🕒 Vesting period completed by time, assuming full distribution');
      //     isFullyVested = true;
      //     claimedAmount = totalAmount; 
      //   }
      // }

      console.log('📊 Final status check:', {
        isFullyVested,
        claimedAmount: claimedAmount.toString(),
        totalAmount: totalAmount.toString()
      });

      let unlockedPercentage: number;
      let unlockedAmount: bigint;
      let claimableAmount: bigint;
      let remainingAmount: bigint;
      let currentPeriod: number;

      // ✅ FIXED: Use contract's getVestingProgress for real-time linear vesting calculation
      try {
        console.log('🔄 Getting real-time vesting progress from contract...');
        const progressResult = await contract.getVestingProgress(KNOWN_INITIALIZER);
        
        unlockedPercentage = Number(progressResult.unlockedPercentage);
        unlockedAmount = BigInt(progressResult.unlockedAmount);
        claimableAmount = BigInt(progressResult.claimableAmount);
        remainingAmount = BigInt(progressResult.remainingAmount);
        
        console.log('✅ Real-time progress from contract:', {
          unlockedPercentage,
          unlockedAmount: unlockedAmount.toString(),
          claimableAmount: claimableAmount.toString(),
          remainingAmount: remainingAmount.toString()
        });

      } catch (progressError) {
        console.warn('⚠️ Contract progress call failed, using fallback calculation:', progressError);
        
        // Fallback to manual calculation
        const currentTime = Math.floor(Date.now() / 1000);
        const startTime = Number(scheduleResult.startTime);
        const actualElapsed = Math.max(0, currentTime - startTime);
        
        unlockedPercentage = this.calculateLinearUnlockPercentage(actualElapsed, scheduleResult);
        currentPeriod = this.calculateBNBCurrentPeriod(actualElapsed);
        
        const unlockedBasisPoints = Math.floor(unlockedPercentage * 100);
        unlockedAmount = (totalAmount * BigInt(unlockedBasisPoints)) / 10000n;
        claimableAmount = unlockedAmount - claimedAmount;
        remainingAmount = totalAmount - unlockedAmount;
      }

      currentPeriod = this.calculateBNBCurrentPeriod(
        Math.max(0, Math.floor(Date.now() / 1000) - Number(scheduleResult.startTime))
      );
      
      // Fix negative claimable amount
      if (claimableAmount < 0n) {
        claimableAmount = 0n;
      }
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = Number(scheduleResult.startTime);
      const actualElapsed = Math.max(0, currentTime - startTime);
      
      console.log('📊 Time-based vesting calculation:', {
        currentTime,
        startTime,
        elapsedTime: actualElapsed,
        elapsedMinutes: Math.floor(actualElapsed / 60),
        unlockedPercentage,
        currentPeriod,
        totalAmount: totalAmount.toString(),
        claimedAmount: claimedAmount.toString(),
        unlockedAmount: unlockedAmount.toString(),
        claimableAmount: claimableAmount.toString(),
        remainingAmount: remainingAmount.toString()
      });

      const schedule: VestingSchedule = {
        chain: 'bnb',  // ✅ ADD: Specify this is BNB chain
        isInitialized: scheduleResult.isInitialized,
        token: scheduleResult.token,
        startTime: Number(scheduleResult.startTime),
        cliffDuration: Number(scheduleResult.cliffDuration),
        vestingDuration: Number(scheduleResult.vestingDuration),
        totalAmount: scheduleResult.totalAmount.toString(),
        claimedAmount: claimedAmount.toString(),  
        recipientCount: Number(scheduleResult.recipientCount),
        isTestMode: scheduleResult.isTestMode || false
      };

      const progress: VestingProgress = {
        elapsedTime: actualElapsed,
        unlockedPercentage,
        unlockedAmount: unlockedAmount.toString(),
        claimableAmount: claimableAmount.toString(),
        remainingAmount: remainingAmount.toString(),
        currentPeriod,
        canClaimNow: claimableAmount > 0n
      };

      console.log('✅ Final corrected data:', {
        schedule: {
          totalAmount: schedule.totalAmount,
          claimedAmount: schedule.claimedAmount
        },
        progress: {
          unlockedPercentage: progress.unlockedPercentage,
          unlockedAmount: progress.unlockedAmount,
          claimableAmount: progress.claimableAmount,
          remainingAmount: progress.remainingAmount,
          canClaimNow: progress.canClaimNow
        }
      });
      console.groupEnd();

      const recipientsResult = await contract.getRecipients(KNOWN_INITIALIZER) as ContractRecipient[];
      const uniqueRecipients = new Map<string, Recipient>();
      
      console.log('🎯 Raw recipients data from contract:', recipientsResult);
      
      recipientsResult.forEach((r: any, index: number) => {
        console.log(`📋 Processing recipient ${index}:`, {
          wallet: r.wallet,
          basisPoints: r.basisPoints?.toString(),
          claimedAmount: r.claimedAmount?.toString(),
          lastClaimTime: r.lastClaimTime?.toString()
        });
        
        const wallet = r.wallet?.toLowerCase();
        if (wallet && wallet !== '0x0000000000000000000000000000000000000000' && Number(r.basisPoints) > 0) {
          const percentage = Number(r.basisPoints) / 100; // Convert basis points to percentage
          uniqueRecipients.set(wallet, {
            wallet: r.wallet,
            basisPoints: Number(r.basisPoints),
            percentage: Number(r.basisPoints) / 100,
            claimedAmount: r.claimedAmount ? r.claimedAmount.toString() : '0',
            lastClaimTime: r.lastClaimTime ? Number(r.lastClaimTime) : 0
          });
        }
      });
      
      const recipients: Recipient[] = Array.from(uniqueRecipients.values());
      
      console.log('🎯 Final processed recipients:', recipients);
      console.log('👤 User role determination:', {
        userAddress,
        recipientsCount: recipients.length,
        recipientWallets: recipients.map(r => r.wallet.toLowerCase())
      });
      
      const userRole = this.determineUserRole(userAddress, KNOWN_INITIALIZER, recipients);
      
      // ✅ NEW: Calculate recipient-specific progress if user is a recipient
      if (userRole.isRecipient && userRole.recipientData) {
        const personalTotalAmount = (BigInt(schedule.totalAmount) * BigInt(userRole.recipientData.basisPoints)) / 10000n;
        const personalClaimedAmount = BigInt(userRole.recipientData.claimedAmount || 0);
        const personalUnlockedAmount = (unlockedAmount * BigInt(userRole.recipientData.basisPoints)) / 10000n;
        const personalClaimableAmount = personalUnlockedAmount - personalClaimedAmount;
        
        console.log('👤 Personal recipient calculation:', {
          basisPoints: userRole.recipientData.basisPoints,
          personalTotalAmount: personalTotalAmount.toString(),
          personalClaimedAmount: personalClaimedAmount.toString(),
          personalUnlockedAmount: personalUnlockedAmount.toString(),
          personalClaimableAmount: personalClaimableAmount.toString()
        });
        
        // Override progress for recipient
        progress.claimableAmount = personalClaimableAmount.toString();
        progress.canClaimNow = personalClaimableAmount > 0n;
      }
      
      const claimStatus = await this.calculateClaimStatus(contract, KNOWN_INITIALIZER, schedule, progress, userRole);

      return {
        schedule,
        progress,
        recipients,
        userRole,
        claimStatus
      };

    } catch (error) {
      console.error('Error fetching BNB vesting data:', error);
      console.groupEnd();
      return null;
    }
  }
  async fetchSolanaVestingData(
    userAddress: string | null,
    connection: Connection
  ): Promise<VestingData | null> {
    try {
      const vestingPDA = new PublicKey(this.config.solana.vestingPDA);
      const accountInfo = await connection.getAccountInfo(vestingPDA);
      
      if (!accountInfo) {
        console.warn('Solana vesting account not found');
        return null;
      }

      console.group('🔍 Solana Vesting - Parsing Account Data');
      console.log('Account data length:', accountInfo.data.length);

      const parsedData = this.parseNewSolanaVestingAccount(accountInfo.data);
      if (!parsedData) {
        console.error('Failed to parse Solana vesting account');
        console.groupEnd();
        return null;
      }

      console.log('✅ Parsed vesting data:', {
        isInitialized: parsedData.isInitialized,
        startTime: parsedData.startTime,
        totalAmount: parsedData.totalAmount,
        recipientCount: parsedData.recipientCount,
        recipients: parsedData.recipients.map((r: Recipient) => ({
          wallet: r.wallet.substring(0, 8) + '...',
          percentage: r.percentage,
          claimedAmount: r.claimedAmount
        }))
      });

      const currentTime = Math.floor(Date.now() / 1000);
      const progress = this.calculateSolanaProgress(parsedData, currentTime);

      console.log('✅ Calculated progress:', progress);

      const userRole = this.determineUserRole(
        userAddress, 
        parsedData.initializer, 
        parsedData.recipients
      );

      const claimStatus = this.calculateSolanaClaimStatus(parsedData, progress, userRole);

      console.groupEnd();

      return {
        schedule: {
          chain: 'solana',  // ✅ ADD: Specify this is Solana chain
          isInitialized: parsedData.isInitialized,
          token: parsedData.mint,
          startTime: parsedData.startTime,
          cliffDuration: parsedData.cliffPeriod,
          vestingDuration: parsedData.vestingPeriod,
          totalAmount: parsedData.totalAmount,
          claimedAmount: this.calculateTotalClaimed(parsedData.recipients),
          recipientCount: parsedData.recipientCount,
          tgeBasisPoints: parsedData.tgeBasisPoints,  // ✅ UPDATED: Add basis points
          tgePercentage: parsedData.tgePercentage,    // ✅ LEGACY: Keep for compatibility
          isFinalized: parsedData.isFinalized,        // ✅ UPDATED: New field
          lastDistributionTime: parsedData.lastDistributionTime  // ✅ UPDATED: New field
        },
        progress,
        recipients: parsedData.recipients,
        userRole,
        claimStatus
      };

    } catch (error) {
      console.error('Error fetching Solana vesting data:', error);
      console.groupEnd();
      return null;
    }
  }

  private parseNewSolanaVestingAccount(data: Buffer): any {
    try {
      console.log('📊 Parsing Solana account with length:', data.length);
      
      // ✅ UPDATED: Expected size with basis points and new fields
      if (!data || data.length < 640) {
        console.error(`Invalid vesting account data. Length: ${data?.length || 0}, expected at least 640`);
        return null;
      }
      
      let offset = 0;

      const isInitialized = data[offset] === 1;
      offset += 1;

      const initializer = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const mint = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const vault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;

      const startTime = Number(data.readBigInt64LE(offset));
      offset += 8;

      const totalAmount = data.readBigUInt64LE(offset);
      offset += 8;

      const cliffPeriod = Number(data.readBigInt64LE(offset));
      offset += 8;

      const vestingPeriod = Number(data.readBigInt64LE(offset));
      offset += 8;

      // ✅ UPDATED: TGE basis points (u16 instead of u8)
      const tgeBasisPoints = data.readUInt16LE(offset);
      offset += 2;

      const recipientCount = data[offset];
      offset += 1;

      // ✅ UPDATED: New fields from contract
      const isFinalized = data[offset] === 1;
      offset += 1;

      const lastDistributionTime = Number(data.readBigInt64LE(offset));
      offset += 8;

      console.log('📋 Basic fields parsed:', {
        isInitialized,
        initializer: initializer.toBase58(),
        startTime: startTime > 0 ? new Date(startTime * 1000).toISOString() : 'Not started',
        totalAmount: totalAmount.toString(),
        recipientCount,
        tgeBasisPoints,
        tgePercentage: tgeBasisPoints / 100,  // Show as percentage for logging
        isFinalized,
        lastDistributionTime
      });

      const recipients: Recipient[] = [];
      
      console.log('👥 Parsing recipients starting at offset:', offset);
      
      for (let i = 0; i < Math.min(recipientCount, 10); i++) {
        // ✅ UPDATED: Each recipient now 50 bytes (32 + 2 + 8 + 8)
        if (offset + 50 > data.length) {
          console.warn(`Not enough data for recipient ${i}, stopping parsing`);
          break;
        }

        const wallet = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;

        // ✅ UPDATED: Basis points (u16) instead of percentage (u8)
        const basisPoints = data.readUInt16LE(offset);
        offset += 2;

        const claimedAmount = data.readBigUInt64LE(offset);
        offset += 8;

        const lastClaimTime = Number(data.readBigInt64LE(offset));
        offset += 8;

        if (basisPoints > 0) {
          const recipient: Recipient = {
            wallet: wallet.toBase58(),
            basisPoints: basisPoints,  // ✅ UPDATED: Store basis points
            percentage: basisPoints / 100,  // ✅ UPDATED: Calculate percentage for display
            claimedAmount: claimedAmount.toString(),
            lastClaimTime: lastClaimTime
          };
          
          recipients.push(recipient);
          
          console.log(`👤 Recipient ${i}:`, {
            wallet: recipient.wallet.substring(0, 8) + '...',
            basisPoints: recipient.basisPoints,
            percentage: recipient.percentage,
            claimedAmount: recipient.claimedAmount,
            lastClaimTime: lastClaimTime > 0 ? new Date(lastClaimTime * 1000).toISOString() : 'Never'
          });
        }
      }

      console.log('✅ Successfully parsed', recipients.length, 'recipients');

      return {
        isInitialized,
        initializer: initializer.toBase58(),
        mint: mint.toBase58(),
        vault: vault.toBase58(),
        startTime,
        totalAmount: totalAmount.toString(),
        cliffPeriod,
        vestingPeriod,
        tgeBasisPoints,  // ✅ UPDATED: Use basis points
        tgePercentage: tgeBasisPoints / 100,  // ✅ LEGACY: For backwards compatibility
        recipients,
        recipientCount,
        isFinalized,
        lastDistributionTime
      };

    } catch (error) {
      console.error('Error parsing new Solana vesting account:', error);
      return null;
    }
  }

  private calculateUnlockedPercentageManually(elapsedTime: number): number {
    const totalMinutes = Math.floor(elapsedTime / 60);
    
    if (totalMinutes < 5) {
      return 0;
    } else if (totalMinutes < 10) {
      return 10;
    } else if (totalMinutes < 15) {
      return 20;
    } else if (totalMinutes < 20) {
      return 50;
    } else {
      return 100;
    }
  }

  private calculateLinearUnlockPercentage(elapsedTime: number, schedule: any): number {
    if (elapsedTime < Number(schedule.cliffDuration)) {
      return 0;
    }
    
    if (elapsedTime >= Number(schedule.vestingDuration)) {
      return 100;
    }
    
    const vestingElapsed = elapsedTime - Number(schedule.cliffDuration);
    const remainingVesting = Number(schedule.vestingDuration) - Number(schedule.cliffDuration);
    
    return Math.min(100, (vestingElapsed / remainingVesting) * 100);
  }

  private calculateBNBCurrentPeriod(elapsedTime: number): number {
    if (elapsedTime < 0) return 0;
    
    const totalMinutes = Math.floor(elapsedTime / 60);
    
    if (totalMinutes < 5) {
      return 0;
    } else if (totalMinutes < 10) {
      return 1;
    } else if (totalMinutes < 15) {
      return 2;
    } else if (totalMinutes < 20) {
      return 3;
    } else {
      return 4;
    }
  }

  private calculateSolanaProgress(vestingData: any, currentTime: number): VestingProgress {
    const elapsedTime = Math.max(0, currentTime - vestingData.startTime);
    let unlockedPercentage = 0;
    let currentPeriod = 0;

    if (vestingData.startTime > 0) {
      // ✅ FIXED: Real-time linear vesting calculation for Solana (TGE + continuous linear unlock)
      const cliffPeriod = vestingData.cliffPeriod || 7776000;  // 3 months default (90 days * 24h * 60m * 60s)
      const vestingPeriod = vestingData.vestingPeriod || 23328000;  // 9 months default (270 days * 24h * 60m * 60s)
      const tgeBasisPoints = vestingData.tgeBasisPoints || 1500;  // 15% default
      const tgePercentage = tgeBasisPoints / 100;
      
      console.log('🔄 Solana real-time vesting calculation:', {
        currentTime,
        startTime: vestingData.startTime,
        elapsedTime,
        elapsedMinutes: Math.floor(elapsedTime / 60),
        cliffPeriod,
        vestingPeriod,
        tgePercentage
      });
      
      if (elapsedTime < cliffPeriod) {
        // Before cliff: only TGE is available immediately at start
        unlockedPercentage = elapsedTime > 0 ? tgePercentage : 0;
        currentPeriod = elapsedTime > 0 ? 1 : 0;
      } else if (elapsedTime >= vestingPeriod) {
        // After full vesting: 100% is available
        unlockedPercentage = 100;
        currentPeriod = 4;
      } else {
        // ✅ FIXED: Real-time linear vesting between cliff and end
        const vestingElapsed = elapsedTime - cliffPeriod;
        const vestingDuration = vestingPeriod - cliffPeriod;
        const linearProgress = vestingElapsed / vestingDuration;  // 0 to 1
        const linearVestingPercent = (100 - tgePercentage) * linearProgress;
        
        unlockedPercentage = tgePercentage + linearVestingPercent;
        
        // More granular period tracking
        const progressRatio = vestingElapsed / vestingDuration;
        if (progressRatio < 0.33) {
          currentPeriod = 2;  // Early linear vesting
        } else if (progressRatio < 0.66) {
          currentPeriod = 3;  // Mid linear vesting
        } else {
          currentPeriod = 4;  // Late linear vesting
        }
      }

      console.log('✅ Solana calculated progress:', {
        unlockedPercentage,
        currentPeriod,
        tgePercentage,
        isInLinearVesting: elapsedTime >= cliffPeriod && elapsedTime < vestingPeriod
      });
    }

    const totalAmount = BigInt(vestingData.totalAmount);
    // ✅ FIX: Convert percentage to basis points to avoid decimal BigInt conversion
    const unlockedBasisPoints = Math.floor(unlockedPercentage * 100);
    const unlockedAmount = (totalAmount * BigInt(unlockedBasisPoints)) / 10000n;
    
    const totalClaimed = vestingData.recipients.reduce((sum: bigint, recipient: Recipient) => {
      return sum + BigInt(recipient.claimedAmount || '0');
    }, 0n);
    
    const claimableAmount = unlockedAmount - totalClaimed;
    const remainingAmount = totalAmount - unlockedAmount;

    console.log('📊 Progress calculation:', {
      elapsedTime,
      elapsedMinutes: Math.floor(elapsedTime / 60),
      unlockedPercentage,
      totalAmount: totalAmount.toString(),
      unlockedAmount: unlockedAmount.toString(),
      totalClaimed: totalClaimed.toString(),
      claimableAmount: claimableAmount.toString(),
      remainingAmount: remainingAmount.toString()
    });

    return {
      elapsedTime,
      unlockedPercentage,
      unlockedAmount: unlockedAmount.toString(),
      claimableAmount: claimableAmount > 0n ? claimableAmount.toString() : '0',
      remainingAmount: remainingAmount.toString(),
      currentPeriod,
      canClaimNow: claimableAmount > 0n
    };
  }

  async requestClaim(request: ClaimRequest): Promise<ClaimResponse> {
    try {
      console.log('Sending claim request to backend:', request);
      
      const response = await fetch(`${this.backendUrl}/api/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Backend claim request failed:', data);
        return {
          success: false,
          error: data.error || `HTTP error! status: ${response.status}`
        };
      }

      console.log('Backend claim response:', data);
      return data;

    } catch (error) {
      console.error('Claim request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error - could not connect to backend'
      };
    }
  }

  async checkBackendHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.backendUrl}/api/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          healthy: false,
          error: `Backend returned ${response.status}`
        };
      }

      const data = await response.json();
      return {
        healthy: data.status === 'healthy',
        error: data.status !== 'healthy' ? 'Backend reports unhealthy status' : undefined
      };

    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Could not connect to backend'
      };
    }
  }

  async checkClaimStatus(
    chain: 'bnb' | 'solana',
    beneficiaryAddress: string,
    userAddress: string
  ): Promise<{
    canClaim: boolean;
    claimableAmount: string;
    userRole: string;
    authorized: boolean;
  }> {
    try {
      const response = await fetch(
        `${this.backendUrl}/api/claim/status/${chain}/${beneficiaryAddress}?user=${encodeURIComponent(userAddress)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error('Failed to check claim status:', error);
      return {
        canClaim: false,
        claimableAmount: '0',
        userRole: 'none',
        authorized: false
      };
    }
  }

  private determineUserRole(
    userAddress: string | null,
    initializerAddress: string,
    recipients: Recipient[]
  ): UserRole {
    if (!userAddress) {
      return { isInitializer: false, isRecipient: false };
    }

    const isInitializer = userAddress.toLowerCase() === initializerAddress.toLowerCase();
    
    const recipientIndex = recipients.findIndex((r: Recipient) => 
      r.wallet.toLowerCase() === userAddress.toLowerCase()
    );
    
    const isRecipient = recipientIndex !== -1;
    
    return {
      isInitializer,
      isRecipient,
      recipientIndex: isRecipient ? recipientIndex : undefined,
      recipientData: isRecipient ? recipients[recipientIndex] : undefined
    };
  }

  private async calculateClaimStatus(
    contract: ethers.Contract,
    beneficiary: string,
    schedule: VestingSchedule,
    progress: VestingProgress,
    userRole: UserRole
  ): Promise<ClaimStatus> {
    try {
      const canClaim = progress.canClaimNow && (userRole.isInitializer || userRole.isRecipient);
      
      if (canClaim) {
        return {
          canClaim: true,
          reason: 'Tokens available for claim'
        };
      }

      try {
        const nextUnlock = await contract.getNextUnlock(beneficiary) as ContractNextUnlock;
        return {
          canClaim: false,
          nextUnlockTime: Number(nextUnlock.nextUnlockTime),
          nextUnlockPercentage: Number(nextUnlock.nextUnlockPercentage),
          timeRemaining: Number(nextUnlock.timeRemaining),
          reason: `Next unlock in ${Math.ceil(Number(nextUnlock.timeRemaining) / 60)} minutes`
        };
      } catch {
        const currentTime = Math.floor(Date.now() / 1000);
        const timeSinceStart = currentTime - schedule.startTime;
        
        if (schedule.startTime === 0) {
          return {
            canClaim: false,
            reason: 'Vesting not funded yet'
          };
        }
        
        if (timeSinceStart < schedule.cliffDuration) {
          const timeRemaining = schedule.cliffDuration - timeSinceStart;
          return {
            canClaim: false,
            timeRemaining,
            reason: `Still in cliff period (${Math.ceil(timeRemaining / 60)} minutes remaining)`
          };
        }

        return {
          canClaim: false,
          reason: 'No tokens available to claim'
        };
      }
    } catch (error) {
      return {
        canClaim: false,
        reason: 'Error calculating claim status'
      };
    }
  }

  private calculateSolanaClaimStatus(vestingData: any, progress: VestingProgress, userRole: UserRole): ClaimStatus {
    // ✅ REMOVED: isRevoked check since field was deleted from contract for immutability
    // Vesting can never be revoked now
    
    // if (vestingData.isRevoked) {
    //   return {
    //     canClaim: false,
    //     reason: 'Vesting has been revoked'
    //   };
    // }

    if (vestingData.startTime === 0) {
      return {
        canClaim: false,
        reason: 'Vesting not funded yet'
      };
    }

    const canClaim = progress.canClaimNow && (userRole.isInitializer || userRole.isRecipient);
    
    if (canClaim) {
      return {
        canClaim: true,
        reason: 'Tokens available for claim'
      };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const elapsedTime = currentTime - vestingData.startTime;
    
    const unlockTimes = [
      { time: 300, percentage: 20 },
      { time: 600, percentage: 50 },
      { time: 900, percentage: 100 }
    ];

    for (const unlock of unlockTimes) {
      if (elapsedTime < unlock.time) {
        const timeRemaining = unlock.time - elapsedTime;
        return {
          canClaim: false,
          nextUnlockTime: vestingData.startTime + unlock.time,
          nextUnlockPercentage: unlock.percentage,
          timeRemaining,
          reason: `Next unlock (${unlock.percentage}%) in ${Math.ceil(timeRemaining / 60)} minutes`
        };
      }
    }

    return {
      canClaim: false,
      reason: 'All tokens have been unlocked'
    };
  }

  private calculateTotalClaimed(recipients: Recipient[]): string {
    return recipients.reduce((total, recipient: Recipient) => {
      return total + BigInt(recipient.claimedAmount || '0');
    }, 0n).toString();
  }

  formatTokenAmount(amount: string, decimals: number = 9): string {
    try {
      const value = BigInt(amount);
      const divisor = BigInt(10 ** decimals);
      const quotient = value / divisor;
      const remainder = value % divisor;
      
      if (remainder === BigInt(0)) {
        return quotient.toString();
      } else {
        const remainderStr = remainder.toString().padStart(decimals, '0');
        const trimmed = remainderStr.replace(/0+$/, '');
        // Limit to 3 decimal places
        const limitedDecimals = trimmed.length > 3 ? trimmed.substring(0, 3) : trimmed;
        return `${quotient}.${limitedDecimals}`;
      }
    } catch (error) {
      return '0';
    }
  }

  formatDuration(seconds: number): string {
    if (seconds <= 0) return 'No cliff';
    
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }

  async directClaimTokens(
    beneficiaryAddress: string,
    provider: ethers.BrowserProvider
  ): Promise<ClaimResponse> {
    try {
      console.log('🚀 Starting direct claim process', { beneficiaryAddress });
      
      // Try to get signer with retry for pending permission requests
      const signer = await this.getSignerWithRetry(provider);
      const contract = new ethers.Contract(
        this.config.bnb.contractAddress,
        BNB_VESTING_ABI,
        signer
      );

      console.log('📋 Calling claimTokens on contract...');
      const tx = await contract.claimTokens(beneficiaryAddress);
      console.log('✅ Transaction sent:', tx.hash);

      console.log('⏳ Waiting for transaction confirmation...');
      const receipt = await tx.wait();
      console.log('✅ Transaction confirmed:', receipt);

      const claimedAmount = this.extractClaimedAmountFromReceipt(receipt);
      
      return {
        success: true,
        transactionHash: tx.hash,
        amount: claimedAmount
      };

    } catch (error: any) {
      console.error('❌ Direct claim failed:', error);
      
      let errorMessage = 'Failed to claim tokens';
      
      if (error.code === 'ACTION_REJECTED') {
        errorMessage = 'Transaction rejected by user';
      } else if (error.code === 'INSUFFICIENT_FUNDS') {
        errorMessage = 'Insufficient BNB for transaction fees';
      } else if (error.code === -32002) {
        errorMessage = 'Wallet has pending requests. Please check your wallet and try again.';
      } else if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  private async getSignerWithRetry(provider: ethers.BrowserProvider, maxRetries: number = 3): Promise<ethers.Signer> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempting to get signer (attempt ${attempt}/${maxRetries})`);
        
        // Wait a bit between retries
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // Try different methods to get signer
        let signer: ethers.Signer;
        
        if (attempt === 1) {
          // First attempt: standard getSigner()
          signer = await provider.getSigner();
        } else if (attempt === 2) {
          // Second attempt: try to get signer by index
          console.log('🔄 Trying getSigner(0)...');
          signer = await provider.getSigner(0);
        } else {
          // Third attempt: try to get accounts first, then signer
          console.log('🔄 Trying listAccounts first...');
          const accounts = await provider.listAccounts();
          if (accounts.length === 0) {
            throw new Error('No accounts available');
          }
          console.log('✅ Found accounts, getting signer...');
          signer = await provider.getSigner(accounts[0].address);
        }
        
        console.log('✅ Successfully got signer');
        return signer;
        
      } catch (error: any) {
        console.warn(`⚠️ Attempt ${attempt} failed:`, error.code || error.message);
        
        if (error.code === -32002 && attempt < maxRetries) {
          console.log('⏳ Pending request detected, waiting longer before retry...');
          continue;
        }
        
        if (attempt === maxRetries) {
          // Last attempt failed - provide helpful error message
          if (error.code === -32002) {
            throw new Error('MetaMask has pending requests. Please check your wallet, approve or reject any pending requests, and try again.');
          }
          throw error;
        }
      }
    }
    
    throw new Error('Failed to get signer after retries');
  }

  private extractClaimedAmountFromReceipt(receipt: any): string {
    try {
      console.log('📋 Extracting claimed amount from receipt...', {
        logsCount: receipt.logs?.length || 0
      });

      if (receipt.logs && receipt.logs.length > 0) {
        for (const log of receipt.logs) {
          try {
            const parsedLog = new ethers.Interface(BNB_VESTING_ABI).parseLog(log);
            console.log('📄 Parsed log:', { name: parsedLog?.name, args: parsedLog?.args });
            
            if (parsedLog && (parsedLog.name === 'TokensClaimed' || parsedLog.name === 'TokensDistributed')) {
              const amount = parsedLog.args.amount?.toString() || '0';
              console.log('✅ Found claim amount:', amount);
              return amount;
            }
          } catch (parseError) {
            console.log('⚠️ Could not parse log:', parseError);
            continue;
          }
        }
      }

      // Try to find ERC20 Transfer events as fallback
      for (const log of receipt.logs) {
        try {
          // Standard ERC20 Transfer event: Transfer(address from, address to, uint256 value)
          if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            const transferAmount = BigInt(log.data).toString();
            console.log('✅ Found Transfer event amount:', transferAmount);
            return transferAmount;
          }
        } catch (parseError) {
          continue;
        }
      }

      console.log('⚠️ No TokensClaimed, TokensDistributed, or Transfer event found, returning 0');
      return '0';
    } catch (error) {
      console.warn('❌ Could not extract claimed amount from receipt:', error);
      return '0';
    }
  }

  getExplorerUrl(chain: 'bnb' | 'solana', hash: string): string {
    if (chain === 'bnb') {
      return `${this.config.bnb.explorerUrl}/tx/${hash}`;
    } else {
      return `${this.config.solana.explorerUrl}/tx/${hash}?cluster=devnet`;
    }
  }
}