// backend/src/services/AutoDistributionService.ts
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

import { EventEmitter } from 'events';
import { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction, SYSVAR_CLOCK_PUBKEY, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

interface VestingContract {
  id: string;
  chain: 'solana' | 'bnb';
  address: string;
  beneficiaryAddress: string;
  startTime: number;
  recipients: Array<{ wallet: string; percentage: number }>;
  lastDistributionTime: number;
  isActive: boolean;
  // Новые поля для отслеживания распределений
  distributedPeriods: Set<number>; // Какие периоды уже были распределены
  totalDistributed: string; // Сколько всего распределено
  lastCheckedAmount: string; // Последняя проверенная сумма в контракте
}

interface DistributionEvent {
  vestingId: string;
  chain: 'solana' | 'bnb';
  transactionHash: string;
  amount: string;
  timestamp: number;
  recipients: Array<{ wallet: string; amount: string }>;
  period: number; // Какой период был распределен
}

interface DistributionResult {
  transactionHash: string;
  totalAmount: string;
  recipients: Array<{ wallet: string; amount: string }>;
  period: number;
}

interface ContractBalance {
  total: string;
  distributed: string;
  available: string;
  claimableNow: string;
}

class AutoDistributionService extends EventEmitter {
  private isRunning = false;
  private checkInterval = 30000; // 30 секунд
  private intervalId: NodeJS.Timeout | null = null;
  private vestingContracts: Map<string, VestingContract> = new Map();

  // Конфигурация из переменных окружения
  private config = {
    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      programId: process.env.SOLANA_PROGRAM_ID || '5Q45ww8uwWsnLpZa8ivFFp6ENfVFHE9yCARTs1CJ3xZB',
      mintAddress: process.env.SOLANA_MINT_ADDRESS || 'CaYYqEzktvpPXkqpFeUGrs5kt6QDk7vmnb5GVzydDJJb',
      privateKey: process.env.SOLANA_PRIVATE_KEY || '',
      vestingPDA: process.env.SOLANA_VESTING_PDA || '',
    },
    bnb: {
      rpcUrl: process.env.BNB_RPC_URL || 'https://bsc-testnet.drpc.org',
      privateKey: process.env.BNB_PRIVATE_KEY || '',
      contractAddress: process.env.BNB_CONTRACT_ADDRESS || '',
      // Используем тот же адрес что и в старом коде для совместимости
      knownInitializer: process.env.KNOWN_INITIALIZER || process.env.BNB_BENEFICIARY_ADDRESS || '',
    }
  };

  constructor() {
    super();
    this.validateConfig();
    this.loadVestingContracts();
  }

  // Utility method for safe error message extraction
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as any).message);
    }
    return 'Unknown error occurred';
  }

  private validateConfig() {
    if (!this.config.solana.privateKey) {
      console.warn('⚠️  SOLANA_PRIVATE_KEY not configured');
    }
    if (!this.config.bnb.privateKey) {
      console.warn('⚠️  BNB_PRIVATE_KEY not configured');
    }
  }

  // Запуск автоматической раздачи
  async start() {
    if (this.isRunning) {
      console.log('Auto distribution already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting auto distribution service...');

    // Первоначальная проверка
    await this.checkDistributions();

    // Запускаем периодическую проверку
    this.intervalId = setInterval(async () => {
      try {
        await this.checkDistributions();
      } catch (error) {
        const errorMessage = this.getErrorMessage(error);
        console.error('Error in auto distribution:', errorMessage);
        this.emit('distributionError', { error: errorMessage });
      }
    }, this.checkInterval);

    this.emit('serviceStarted');
  }

  // Остановка автоматической раздачи
  async stop() {
    if (!this.isRunning) {
      console.log('Auto distribution not running');
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('🛑 Auto distribution service stopped');
    this.emit('serviceStopped');
  }

  // Основная проверка на необходимость раздачи
  private async checkDistributions() {
    const currentTime = Math.floor(Date.now() / 1000);
    console.log(`\n🔍 Checking distributions at ${new Date().toLocaleString()}`);

    for (const [id, contract] of this.vestingContracts.entries()) {
      if (!contract.isActive) {
        console.log(`   ⏸️  Contract ${id} is inactive, skipping`);
        continue;
      }

      try {
        // Обновляем баланс контракта
        await this.updateContractBalance(contract);
        
        const shouldDistribute = await this.shouldDistribute(contract, currentTime);
        
        if (shouldDistribute.should && shouldDistribute.period !== undefined) {
          console.log(`🎯 Distributing tokens for contract ${id} (Period ${shouldDistribute.period}%)`);
          await this.distribute(contract, shouldDistribute.period);
        }
      } catch (error) {
        const errorMessage = this.getErrorMessage(error);
        console.error(`❌ Error processing contract ${id}:`, errorMessage);
        this.emit('distributionError', { contractId: id, error: errorMessage });
      }
    }
    
    console.log(`✅ Distribution check completed\n`);
  }

  // Обновление баланса контракта
  private async updateContractBalance(contract: VestingContract): Promise<ContractBalance> {
    if (contract.chain === 'solana') {
      return await this.getSolanaContractBalance(contract);
    } else {
      return await this.getBNBContractBalance(contract);
    }
  }

  // Получение баланса Solana контракта (ОБНОВЛЕНО под новый контракт)
  private async getSolanaContractBalance(contract: VestingContract): Promise<ContractBalance> {
    try {
      const connection = new Connection(this.config.solana.rpcUrl, 'confirmed');
      const vestingPDA = new PublicKey(contract.address);
      
      const vestingAccountInfo = await connection.getAccountInfo(vestingPDA);
      if (!vestingAccountInfo) {
        return { total: '0', distributed: '0', available: '0', claimableNow: '0' };
      }
      
      const vestingAccount = this.parseVestingAccount(vestingAccountInfo.data);
      if (!vestingAccount.isInitialized) {
        return { total: '0', distributed: '0', available: '0', claimableNow: '0' };
      }

      // Считаем общую сумму уже заклейменных токенов
      const totalClaimed = vestingAccount.recipients.reduce((sum, recipient) => {
        return sum + BigInt(recipient.claimedAmount || 0);
      }, 0n);

      const currentTime = Math.floor(Date.now() / 1000);
      const elapsed = currentTime - vestingAccount.startTime;
      const vestedAmount = this.calculateVestedAmount(BigInt(vestingAccount.totalAmount), elapsed);
      const claimableNow = vestedAmount - totalClaimed;

      const balance: ContractBalance = {
        total: BigInt(vestingAccount.totalAmount).toString(),
        distributed: totalClaimed.toString(),
        available: (BigInt(vestingAccount.totalAmount) - totalClaimed).toString(),
        claimableNow: claimableNow > 0n ? claimableNow.toString() : '0'
      };

      contract.lastCheckedAmount = balance.available;
      return balance;

    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.warn(`⚠️  Could not get Solana balance: ${errorMessage}`);
      return { total: '0', distributed: '0', available: '0', claimableNow: '0' };
    }
  }

  // Получение баланса BNB контракта (ОБНОВЛЕНО под новый контракт SecureTokenVesting)
  private async getBNBContractBalance(contract: VestingContract): Promise<ContractBalance> {
    try {
      const provider = new ethers.JsonRpcProvider(this.config.bnb.rpcUrl);
      const vestingABI = [
        'function getVestingSchedule(address beneficiary) external view returns (bool isInitialized, address token, uint256 startTime, uint256 cliffDuration, uint256 vestingDuration, uint256 totalAmount, uint256 claimedAmount, uint8 recipientCount)',
        'function getClaimableAmount(address beneficiary) external view returns (uint256)',
        'function canDistribute(address beneficiary) external view returns (bool)'
      ];
      
      const vestingContract = new ethers.Contract(
        contract.address,
        vestingABI,
        provider
      );
      
      const schedule = await vestingContract.getVestingSchedule(contract.beneficiaryAddress);
      if (!schedule.isInitialized) {
        return { total: '0', distributed: '0', available: '0', claimableNow: '0' };
      }

      const claimableAmount = await vestingContract.getClaimableAmount(contract.beneficiaryAddress);
      
      const balance: ContractBalance = {
        total: schedule.totalAmount.toString(),
        distributed: schedule.claimedAmount.toString(),
        available: (schedule.totalAmount - schedule.claimedAmount).toString(),
        claimableNow: claimableAmount.toString()
      };

      contract.lastCheckedAmount = balance.available;
      return balance;

    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.warn(`⚠️  Could not get BNB balance: ${errorMessage}`);
      return { total: '0', distributed: '0', available: '0', claimableNow: '0' };
    }
  }

  // Проверка нужно ли распределять токены
  private async shouldDistribute(contract: VestingContract, currentTime: number): Promise<{should: boolean, period?: number}> {
    if (!contract.recipients.length || !contract.startTime) {
      console.log(`   - Contract not ready: recipients=${contract.recipients.length}, startTime=${contract.startTime}`);
      return { should: false };
    }

    const elapsed = currentTime - contract.startTime;
    
    console.log(`🔍 Checking contract ${contract.id}:`);
    console.log(`   - Chain: ${contract.chain}`);
    console.log(`   - Start time: ${new Date(contract.startTime * 1000).toLocaleString()}`);
    console.log(`   - Elapsed: ${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`);
    console.log(`   - Last distribution: ${contract.lastDistributionTime > 0 ? new Date(contract.lastDistributionTime * 1000).toLocaleString() : 'Never'}`);
    console.log(`   - Recipients: ${contract.recipients.length}`);
    console.log(`   - Distributed periods: [${Array.from(contract.distributedPeriods).join(', ')}]`);
    
    // Получаем текущий баланс контракта
    const balance = await this.updateContractBalance(contract);
    console.log(`   - Total in contract: ${balance.total}`);
    console.log(`   - Already distributed: ${balance.distributed}`);
    console.log(`   - Available: ${balance.available}`);
    console.log(`   - Claimable now: ${balance.claimableNow}`);

    // Периоды разблокировки (в секундах)
    const unlockPeriods = [
      { time: 300, percentage: 10 },   // 5 минут
      { time: 600, percentage: 20 },   // 10 минут
      { time: 900, percentage: 50 },   // 15 минут
      { time: 1200, percentage: 100 }  // 20 минут
    ];

    // Проверяем каждый период
    for (const period of unlockPeriods) {
      const unlockTime = contract.startTime + period.time;
      
      console.log(`   - Period ${period.percentage}%: ${elapsed >= period.time ? 
                  '✅ UNLOCKED' : '⏳ PENDING'} (${Math.floor(period.time / 60)}min) ${
                  contract.distributedPeriods.has(period.percentage) ? '[DISTRIBUTED]' : '[WAITING]'}`);
      
      // Если время разблокировки наступило и мы еще не распределяли этот период
      if (currentTime >= unlockTime && !contract.distributedPeriods.has(period.percentage)) {
        // Проверяем есть ли токены для распределения
        if (BigInt(balance.claimableNow) > 0n) {
          console.log(`⏰ Time to distribute ${period.percentage}% for contract ${contract.id}`);
          console.log(`   - Unlock time: ${new Date(unlockTime * 1000).toLocaleString()}`);
          console.log(`   - Current time: ${new Date(currentTime * 1000).toLocaleString()}`);
          return { should: true, period: period.percentage };
        } else {
          console.log(`   - Period ${period.percentage}% ready but no claimable tokens available`);
          // Отмечаем период как распределенный, чтобы не проверять его снова
          contract.distributedPeriods.add(period.percentage);
        }
      }
    }

    // Проверяем, завершен ли весь vesting
    const allPeriodsDistributed = unlockPeriods.every(p => contract.distributedPeriods.has(p.percentage));
    if (allPeriodsDistributed) {
      console.log(`   - All vesting periods completed for contract ${contract.id}`);
    } else {
      console.log(`   - No new distribution needed at this time`);
    }
    
    return { should: false };
  }

  // Вычисление vested токенов
  private calculateVestedAmount(totalAmount: bigint, elapsedSeconds: number): bigint {
    let percentage: number;
    if (elapsedSeconds < 0) {
      percentage = 0;
    } else if (elapsedSeconds < 300) {  // 0-5 minutes
      percentage = 10;
    } else if (elapsedSeconds < 600) {  // 5-10 minutes
      percentage = 20;
    } else if (elapsedSeconds < 900) {  // 10-15 minutes
      percentage = 50;
    } else {  // 15+ minutes
      percentage = 100;
    }
    
    return (totalAmount * BigInt(percentage)) / 100n;
  }

  // Выполнение раздачи
  private async distribute(contract: VestingContract, period: number): Promise<DistributionResult> {
    try {
      let result: DistributionResult;
      
      if (contract.chain === 'solana') {
        result = await this.distributeSolana(contract, period);
      } else {
        result = await this.distributeBNB(contract, period);
      }

      // Обновляем время последней раздачи и отмечаем период как распределенный
      contract.lastDistributionTime = Math.floor(Date.now() / 1000);
      contract.distributedPeriods.add(period);
      
      // Эмитим событие успешной раздачи
      const event: DistributionEvent = {
        vestingId: contract.id,
        chain: contract.chain,
        transactionHash: result.transactionHash,
        amount: result.totalAmount,
        timestamp: contract.lastDistributionTime,
        recipients: result.recipients,
        period: period
      };

      this.emit('distribution', event);
      console.log(`✅ Distribution completed for ${contract.id} (Period ${period}%): ${result.transactionHash}`);

      return result;

    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.error(`❌ Distribution failed for ${contract.id}:`, errorMessage);
      this.emit('distributionError', { contractId: contract.id, error: errorMessage, period });
      throw error;
    }
  }

  // Раздача Solana токенов - ОБНОВЛЕНО под новый скрипт
  private async distributeSolana(contract: VestingContract, period: number): Promise<DistributionResult> {
    console.log(`🌞 Starting Solana distribution for period ${period}%...`);
    
    const connection = new Connection(this.config.solana.rpcUrl, 'confirmed');
    const programId = new PublicKey(this.config.solana.programId);
    const vestingPDA = new PublicKey(contract.address);
    const mintAddress = new PublicKey(this.config.solana.mintAddress);
    
    // Создаем keypair из private key
    const privateKeyArray = JSON.parse(this.config.solana.privateKey);
    const initializer = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    
    console.log('Initializer address:', initializer.publicKey.toBase58());
    
    try {
      // Проверяем баланс
      const balance = await connection.getBalance(initializer.publicKey);
      console.log(`SOL balance: ${balance / 1e9} SOL`);
      
      if (balance < 0.01 * 1e9) {
        throw new Error('Insufficient SOL balance for distribution (need at least 0.01 SOL)');
      }
      
      // Получаем текущий баланс контракта
      const contractBalance = await this.getSolanaContractBalance(contract);
      
      if (BigInt(contractBalance.claimableNow) <= 0n) {
        throw new Error('No tokens available to distribute');
      }
      
      // Получаем vault PDA
      const [vaultPDA] = await PublicKey.findProgramAddress(
        [Buffer.from('vault'), vestingPDA.toBuffer()],
        programId
      );
      console.log('Vault PDA:', vaultPDA.toBase58());
      
      // Проверяем существует ли vesting аккаунт
      const vestingAccountInfo = await connection.getAccountInfo(vestingPDA);
      if (!vestingAccountInfo) {
        throw new Error('Vesting PDA account not found');
      }
      
      // Парсим данные vesting аккаунта
      const vestingAccount = this.parseVestingAccount(vestingAccountInfo.data);
      
      if (!vestingAccount.isInitialized) {
        throw new Error('Vesting account not initialized');
      }
      
      if (vestingAccount.startTime === 0) {
        throw new Error('Vesting not funded yet');
      }
      
      // Создаем транзакцию
      const transaction = new Transaction();
      
      // Добавляем compute budget для сложных операций
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })
      );
      
      // Создаем/проверяем ATA для всех получателей
      const recipientATAs: PublicKey[] = [];
      for (const recipient of contract.recipients) {
        const recipientPubkey = new PublicKey(recipient.wallet);
        const ata = await getAssociatedTokenAddress(mintAddress, recipientPubkey);
        recipientATAs.push(ata);

        try {
          await getAccount(connection, ata);
          console.log(`  ✅ ATA exists for ${recipient.wallet.substring(0, 8)}...`);
        } catch {
          console.log(`  ⚙️  Creating ATA for ${recipient.wallet.substring(0, 8)}...`);
          transaction.add(
            createAssociatedTokenAccountInstruction(
              initializer.publicKey,  // payer
              ata,                   // ata
              recipientPubkey,       // owner
              mintAddress           // mint
            )
          );
        }
      }
      
      // Получаем vault authority PDA
      const [vaultAuthority] = await PublicKey.findProgramAddress(
        [Buffer.from('authority'), vestingPDA.toBuffer()],
        programId
      );
      
      // Создаем инструкцию для распределения токенов
      const distributionInstruction = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: initializer.publicKey, isSigner: true, isWritable: true },
          { pubkey: vestingPDA, isSigner: false, isWritable: true },
          { pubkey: vaultPDA, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: vaultAuthority, isSigner: false, isWritable: false },
          // Добавляем все ATA получателей
          ...recipientATAs.map(ata => ({ 
            pubkey: ata, 
            isSigner: false, 
            isWritable: true 
          }))
        ],
        data: Buffer.from([2]) // Distribute instruction
      });
      
      transaction.add(distributionInstruction);
      
      // Получаем recent blockhash
      const { blockhash } = await connection.getRecentBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = initializer.publicKey;
      
      // Отправляем и подтверждаем транзакцию
      console.log('📤 Sending Solana distribution transaction...');
      
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [initializer],
        {
          commitment: 'confirmed',
          preflightCommitment: 'confirmed',
        }
      );
      
      console.log(`✅ Solana distribution successful: ${signature}`);
      
      // Вычисляем суммы для ответа
      const distributedAmount = BigInt(contractBalance.claimableNow);
      
      const recipients = contract.recipients.map(r => ({
        wallet: r.wallet,
        amount: ((distributedAmount * BigInt(r.percentage)) / 100n).toString()
      }));
      
      return {
        transactionHash: signature,
        totalAmount: distributedAmount.toString(),
        recipients,
        period
      };
      
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.error('❌ Error in Solana distribution:', errorMessage);
      throw error;
    }
  }

  // Раздача BNB токенов - ОБНОВЛЕНО под новый контракт SecureTokenVesting
  private async distributeBNB(contract: VestingContract, period: number): Promise<DistributionResult> {
    console.log(`🟡 Starting BNB distribution for period ${period}%...`);
    
    const provider = new ethers.JsonRpcProvider(this.config.bnb.rpcUrl);
    const wallet = new ethers.Wallet(this.config.bnb.privateKey, provider);
    
    console.log('Wallet address:', wallet.address);
    
    try {
      // Проверяем баланс
      const balance = await provider.getBalance(wallet.address);
      console.log(`BNB balance: ${ethers.formatEther(balance)} BNB`);
      
      if (balance < ethers.parseEther('0.001')) {
        throw new Error('Insufficient BNB balance for distribution (need at least 0.001 BNB)');
      }
      
      // ABI для SecureTokenVesting контракта (из первого файла)
      const vestingABI = [
        'function distributeTokens() external',
        'function getVestingSchedule(address beneficiary) external view returns (bool isInitialized, address token, uint256 startTime, uint256 cliffDuration, uint256 vestingDuration, uint256 totalAmount, uint256 claimedAmount, uint8 recipientCount)',
        'function getClaimableAmount(address beneficiary) external view returns (uint256)',
        'function getRecipients(address beneficiary) external view returns (tuple(address wallet, uint8 percentage)[])',
        'function canDistribute(address beneficiary) external view returns (bool)'
      ];
      
      const vestingContract = new ethers.Contract(
        contract.address,
        vestingABI,
        wallet
      );
      
      // Проверяем, есть ли расписание вестинга
      const schedule = await vestingContract.getVestingSchedule(contract.beneficiaryAddress);
      
      if (!schedule.isInitialized) {
        throw new Error('No vesting schedule found');
      }
      
      console.log('✅ Vesting schedule found');
      console.log(`  - Start time: ${schedule.startTime > 0 ? 
                  new Date(Number(schedule.startTime) * 1000).toLocaleString() : 'Not funded'}`);
      console.log(`  - Total amount: ${ethers.formatEther(schedule.totalAmount)} tokens`);
      console.log(`  - Claimed amount: ${ethers.formatEther(schedule.claimedAmount)} tokens`);
      
      // Проверяем, можно ли распределить токены
      const canDistribute = await vestingContract.canDistribute(contract.beneficiaryAddress);
      if (!canDistribute) {
        throw new Error('Cannot distribute tokens at this time');
      }
      
      const claimableAmount = await vestingContract.getClaimableAmount(contract.beneficiaryAddress);
      
      if (claimableAmount === 0n) {
        throw new Error('No tokens available to distribute');
      }
      
      console.log(`✅ Claimable amount: ${ethers.formatEther(claimableAmount)} tokens`);
      
      // ВЫПОЛНЯЕМ РЕАЛЬНОЕ РАСПРЕДЕЛЕНИЕ с помощью distributeTokens()
      console.log('🚀 Executing REAL distribution transaction...');
      const tx = await vestingContract.distributeTokens({
        gasLimit: 500000
      });
      
      console.log('Transaction hash:', tx.hash);
      console.log('Waiting for confirmation...');
      await tx.wait();
      console.log(`✅ Real BNB distribution successful: ${tx.hash}`);
      
      // Получаем получателей для расчета сумм
      const recipients = await vestingContract.getRecipients(contract.beneficiaryAddress);
      
      const distributionAmounts = recipients.map((recipient: any) => ({
        wallet: recipient.wallet,
        amount: ((claimableAmount * BigInt(recipient.percentage)) / 100n).toString()
      }));
      
      return {
        transactionHash: tx.hash,
        totalAmount: claimableAmount.toString(),
        recipients: distributionAmounts,
        period
      };
      
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.error('❌ Error in BNB distribution:', errorMessage);
      throw error;
    }
  }

  // Парсер для Solana vesting аккаунта (обновленная версия)
  private parseVestingAccount(data: Buffer) {
    if (!data || data.length < 141) {
      throw new Error(`Invalid vesting account data. Length: ${data?.length || 0}, expected at least 141`);
    }
    
    const recipients = [];
    let offset = 141; // Start of recipients data
    
    const recipientCount = data[130];
    for (let i = 0; i < Math.min(recipientCount, 10); i++) {
      const wallet = new PublicKey(data.slice(offset, offset + 32));
      const percentage = data[offset + 32];
      const claimedAmount = Number(data.readBigUInt64LE(offset + 33));
      const lastClaimTime = Number(data.readBigInt64LE(offset + 41));
      
      if (percentage > 0) {
        recipients.push({
          wallet: wallet.toBase58(),
          percentage,
          claimedAmount,
          lastClaimTime,
        });
      }
      offset += 49;
    }
    
    return {
      isInitialized: data[0] === 1,
      initializer: new PublicKey(data.slice(1, 33)),
      mint: new PublicKey(data.slice(33, 65)),
      vault: new PublicKey(data.slice(65, 97)),
      startTime: Number(data.readBigInt64LE(97)),
      totalAmount: Number(data.readBigUInt64LE(105)),
      cliffPeriod: Number(data.readBigInt64LE(113)),
      vestingPeriod: Number(data.readBigInt64LE(121)),
      tgePercentage: data[129],
      recipientCount: data[130],
      isRevoked: data[131] === 1,
      isFinalized: data[132] === 1,
      lastDistributionTime: Number(data.readBigInt64LE(133)),
      recipients,
    };
  }

  // Загрузка существующих контрактов
  private loadVestingContracts() {
    try {
      console.log('📋 Loading vesting contracts from environment...');
      
      const contracts: Array<Omit<VestingContract, 'id'>> = [];
      
      // Добавляем Solana контракт если есть конфигурация
      if (this.config.solana.vestingPDA && this.config.solana.privateKey) {
        contracts.push({
          chain: 'solana',
          address: this.config.solana.vestingPDA,
          beneficiaryAddress: 'system', // Для Solana не используется
          startTime: 0, // Will be loaded from contract
          recipients: [], // Will be loaded from contract
          lastDistributionTime: 0,
          isActive: true,
          distributedPeriods: new Set<number>(),
          totalDistributed: '0',
          lastCheckedAmount: '0'
        });
        console.log(`✅ Configured Solana contract: ${this.config.solana.vestingPDA}`);
      } else {
        console.log(`⚠️  Solana contract not configured - missing private key or PDA address`);
      }
      
      // Добавляем BNB контракт если есть конфигурация
      if (this.config.bnb.contractAddress && this.config.bnb.privateKey && this.config.bnb.knownInitializer) {
        contracts.push({
          chain: 'bnb',
          address: this.config.bnb.contractAddress,
          beneficiaryAddress: this.config.bnb.knownInitializer,
          startTime: 0, // Will be loaded from contract
          recipients: [], // Will be loaded from contract
          lastDistributionTime: 0,
          isActive: true,
          distributedPeriods: new Set<number>(),
          totalDistributed: '0',
          lastCheckedAmount: '0'
        });
        console.log(`✅ Configured BNB contract: ${this.config.bnb.contractAddress}`);
      } else {
        console.log(`⚠️  BNB contract not configured - missing private key, contract address, or initializer`);
      }

      // Добавляем все сконфигурированные контракты
      contracts.forEach(contract => {
        const id = this.addVestingContract(contract);
        console.log(`✅ Loaded ${contract.chain.toUpperCase()} vesting contract: ${id}`);
        
        // Загружаем данные контракта асинхронно
        this.loadContractData(id).catch(error => {
          const errorMessage = this.getErrorMessage(error);
          console.error(`❌ Error loading contract data for ${id}:`, errorMessage);
        });
      });

      if (contracts.length === 0) {
        console.log(`⚠️  No contracts loaded! Please check your environment configuration.`);
        console.log(`   Required for Solana: SOLANA_PRIVATE_KEY, SOLANA_VESTING_PDA`);
        console.log(`   Required for BNB: BNB_PRIVATE_KEY, BNB_CONTRACT_ADDRESS, KNOWN_INITIALIZER`);
      } else {
        console.log(`📋 Total contracts loaded: ${contracts.length}`);
      }
      
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.error('❌ Error loading vesting contracts:', errorMessage);
    }
  }

  // Асинхронная загрузка данных контракта
  private async loadContractData(contractId: string) {
    const contract = this.vestingContracts.get(contractId);
    if (!contract) return;

    try {
      console.log(`🔄 Loading contract data for ${contractId}...`);
      
      if (contract.chain === 'solana') {
        await this.loadSolanaContractData(contract);
      } else if (contract.chain === 'bnb') {
        await this.loadBNBContractData(contract);
      }
      
      console.log(`✅ Contract data loaded for ${contractId}`);
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.error(`❌ Failed to load contract data for ${contractId}:`, errorMessage);
    }
  }

  // Загрузка данных Solana контракта
  private async loadSolanaContractData(contract: VestingContract) {
    try {
      const connection = new Connection(this.config.solana.rpcUrl, 'confirmed');
      const vestingPDA = new PublicKey(contract.address);
      
      console.log(`📊 Fetching Solana vesting data from ${contract.address}...`);
      
      const vestingAccountInfo = await connection.getAccountInfo(vestingPDA);
      if (!vestingAccountInfo) {
        console.warn(`⚠️  Solana vesting account not found: ${contract.address}`);
        return;
      }
      
      const vestingAccount = this.parseVestingAccount(vestingAccountInfo.data);
      
      if (!vestingAccount.isInitialized) {
        console.warn(`⚠️  Solana vesting account not initialized: ${contract.address}`);
        return;
      }
      
      // Обновляем время старта
      contract.startTime = vestingAccount.startTime;
      
      console.log(`✅ Solana contract data loaded:`);
      console.log(`   - Initialized: ${vestingAccount.isInitialized}`);
      console.log(`   - Start time: ${contract.startTime > 0 ? new Date(contract.startTime * 1000).toLocaleString() : 'Not funded'}`);
      console.log(`   - Total amount: ${vestingAccount.totalAmount} tokens`);
      console.log(`   - Recipients: ${vestingAccount.recipientCount}`);

      // Если контракт не профинансирован, проверяем периодически
      if (vestingAccount.startTime === 0) {
        console.log(`⏳ Solana vesting not funded yet, will check again later`);
        setTimeout(() => this.loadContractData(contract.id), 60000);
        return;
      }

      // Обновляем получателей из vesting аккаунта
      contract.recipients = vestingAccount.recipients.map(r => ({
        wallet: r.wallet,
        percentage: r.percentage
      }));

      // Определяем уже распределенные периоды на основе claimed amounts
      const totalClaimed = vestingAccount.recipients.reduce((sum, r) => sum + BigInt(r.claimedAmount), 0n);
      const totalAmount = BigInt(vestingAccount.totalAmount);
      
      if (totalClaimed > 0n) {
        const claimedPercentage = Number((totalClaimed * 100n) / totalAmount);
        
        console.log(`   - Claimed percentage: ${claimedPercentage}%`);
        
        // Определяем какие периоды уже были распределены
        if (claimedPercentage >= 95) contract.distributedPeriods.add(100);
        if (claimedPercentage >= 45) contract.distributedPeriods.add(50);
        if (claimedPercentage >= 18) contract.distributedPeriods.add(20);
        if (claimedPercentage >= 8) contract.distributedPeriods.add(10);
        
        contract.totalDistributed = totalClaimed.toString();
      }
      
      console.log(`✅ Loaded ${vestingAccount.recipients.length} recipients for Solana contract`);
      console.log(`   - Total distributed: ${totalClaimed.toString()} (${contract.distributedPeriods.size} periods)`);
      console.log(`   - Distributed periods: [${Array.from(contract.distributedPeriods).join(', ')}]`);

    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.warn(`⚠️  Could not load Solana contract data: ${errorMessage}`);
    }
  }

  // Загрузка данных BNB контракта
  private async loadBNBContractData(contract: VestingContract) {
    try {
      const provider = new ethers.JsonRpcProvider(this.config.bnb.rpcUrl);
      const vestingABI = [
        'function getVestingSchedule(address beneficiary) external view returns (bool isInitialized, address token, uint256 startTime, uint256 cliffDuration, uint256 vestingDuration, uint256 totalAmount, uint256 claimedAmount, uint8 recipientCount)',
        'function getRecipients(address beneficiary) external view returns (tuple(address wallet, uint8 percentage)[])',
        'function getClaimableAmount(address beneficiary) external view returns (uint256)'
      ];
      
      console.log(`📊 Fetching BNB vesting data from ${contract.address}...`);
      
      const vestingContract = new ethers.Contract(
        contract.address,
        vestingABI,
        provider
      );
      
      // Получаем расписание вестинга
      const schedule = await vestingContract.getVestingSchedule(contract.beneficiaryAddress);
      
      if (!schedule.isInitialized) {
        console.warn(`⚠️  No vesting schedule found for beneficiary ${contract.beneficiaryAddress}`);
        return;
      }

      // Обновляем время старта
      contract.startTime = Number(schedule.startTime);
      
      // Проверяем доступные для клейма токены
      const claimableAmount = await vestingContract.getClaimableAmount(contract.beneficiaryAddress);
      
      console.log(`✅ BNB contract data loaded:`);
      console.log(`   - Initialized: ${schedule.isInitialized}`);
      console.log(`   - Start time: ${contract.startTime > 0 ? new Date(contract.startTime * 1000).toLocaleString() : 'Not funded'}`);
      console.log(`   - Total amount: ${ethers.formatEther(schedule.totalAmount)} tokens`);
      console.log(`   - Claimed amount: ${ethers.formatEther(schedule.claimedAmount)} tokens`);
      console.log(`   - Claimable now: ${ethers.formatEther(claimableAmount)} tokens`);
      console.log(`   - Recipients: ${schedule.recipientCount}`);

      // Если контракт не профинансирован, проверяем периодически
      if (contract.startTime === 0) {
        console.log(`⏳ BNB vesting not funded yet, will check again later`);
        setTimeout(() => this.loadContractData(contract.id), 60000);
        return;
      }

      // Определяем уже распределенные периоды на основе claimed amount
      if (schedule.claimedAmount > 0n) {
        const claimedPercentage = Number((schedule.claimedAmount * 100n) / schedule.totalAmount);
        
        console.log(`   - Claimed percentage: ${claimedPercentage}%`);
        
        // Определяем какие периоды уже были распределены
        if (claimedPercentage >= 95) contract.distributedPeriods.add(100);
        if (claimedPercentage >= 45) contract.distributedPeriods.add(50);
        if (claimedPercentage >= 18) contract.distributedPeriods.add(20);
        if (claimedPercentage >= 8) contract.distributedPeriods.add(10);
        
        contract.totalDistributed = schedule.claimedAmount.toString();
      }

      // Получаем получателей
      try {
        const recipients = await vestingContract.getRecipients(contract.beneficiaryAddress);
        
        contract.recipients = recipients.map((r: any) => ({
          wallet: r.wallet,
          percentage: Number(r.percentage)
        }));

        console.log(`✅ Loaded ${contract.recipients.length} recipients for BNB contract`);
        console.log(`   - Total distributed: ${schedule.claimedAmount.toString()} (${contract.distributedPeriods.size} periods)`);
        console.log(`   - Distributed periods: [${Array.from(contract.distributedPeriods).join(', ')}]`);
        console.log(`   - Contract active: ${contract.isActive}`);
      } catch (recipientError) {
        const errorMessage = this.getErrorMessage(recipientError);
        console.warn(`  ⚠️  Could not load recipients: ${errorMessage}`);
      }

    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      console.warn(`⚠️  Could not load BNB contract data: ${errorMessage}`);
    }
  }

  // Геттеры для внешнего использования
  getStats() {
    return {
      isRunning: this.isRunning,
      totalContracts: this.vestingContracts.size,
      checkInterval: this.checkInterval,
      activeContracts: Array.from(this.vestingContracts.values()).filter(c => c.isActive).length
    };
  }

  getContracts() {
    return Array.from(this.vestingContracts.values());
  }

  // Методы с правильными именами для совместимости с сервером
  getVestingContracts(): VestingContract[] {
    return Array.from(this.vestingContracts.values());
  }

  // Добавление нового контракта для мониторинга
  addVestingContract(contractData: Omit<VestingContract, 'id'>) {
    const id = `${contractData.chain}_${contractData.address}_${Date.now()}`;
    const contract: VestingContract = { 
      ...contractData, 
      id,
      distributedPeriods: contractData.distributedPeriods || new Set<number>(),
      totalDistributed: contractData.totalDistributed || '0',
      lastCheckedAmount: contractData.lastCheckedAmount || '0'
    };
    this.vestingContracts.set(id, contract);
    console.log(`✅ Added new ${contract.chain} contract: ${id}`);
    this.emit('contractAdded', contract);
    return id;
  }

  // Добавление нового контракта (альтернативное имя)
  addContract(contractData: Omit<VestingContract, 'id'>) {
    return this.addVestingContract(contractData);
  }

  // Удаление контракта
  removeContract(id: string) {
    const removed = this.vestingContracts.delete(id);
    if (removed) {
      console.log(`🗑️ Removed contract: ${id}`);
    }
    return removed;
  }

  // Обновление контракта
  updateContract(id: string, updates: Partial<VestingContract>) {
    const contract = this.vestingContracts.get(id);
    if (contract) {
      Object.assign(contract, updates);
      console.log(`🔄 Updated contract: ${id}`);
      return true;
    }
    return false;
  }

  // Метод для ручной сброса состояния распределения (для отладки)
  resetDistributionState(contractId: string) {
    const contract = this.vestingContracts.get(contractId);
    if (contract) {
      contract.distributedPeriods.clear();
      contract.totalDistributed = '0';
      contract.lastDistributionTime = 0;
      console.log(`🔄 Reset distribution state for contract: ${contractId}`);
      return true;
    }
    return false;
  }

  // Метод для ручной реактивации контракта
  reactivateContract(contractId: string): boolean {
    const contract = this.vestingContracts.get(contractId);
    if (contract) {
      contract.isActive = true;
      console.log(`🔄 Manually reactivated contract: ${contractId}`);
      return true;
    }
    return false;
  }

  // Метод для ручной деактивации контракта  
  deactivateContract(contractId: string): boolean {
    const contract = this.vestingContracts.get(contractId);
    if (contract) {
      contract.isActive = false;
      console.log(`⏸️  Manually deactivated contract: ${contractId}`);
      return true;
    }
    return false;
  }

  // Метод для проверки статуса всех контрактов
  getContractStatuses() {
    const statuses = Array.from(this.vestingContracts.values()).map(contract => ({
      id: contract.id,
      chain: contract.chain,
      isActive: contract.isActive,
      distributedPeriods: Array.from(contract.distributedPeriods),
      totalDistributed: contract.totalDistributed,
      startTime: contract.startTime,
      lastDistributionTime: contract.lastDistributionTime,
    }));
    
    console.log('📊 Contract statuses:', statuses);
    return statuses;
  }
}

export default AutoDistributionService;