"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolanaService = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const contracts_1 = require("../config/contracts");
const validation_1 = require("../utils/validation");
const logger_1 = require("../utils/logger");
const errorHandler_1 = require("../utils/errorHandler");
class SolanaService {
    constructor() {
        this.config = (0, contracts_1.getContractConfig)().solana;
        this.connection = new web3_js_1.Connection(this.config.rpcUrl, 'confirmed');
        const keyArray = JSON.parse(this.config.privateKey);
        this.keypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(keyArray));
        this.programId = new web3_js_1.PublicKey(this.config.programId);
    }
    async verifyUserPermission(userAddress, vestingPDA) {
        try {
            logger_1.logger.debug('Verifying Solana user permission', {
                userAddress,
                vestingPDA
            });
            const vestingAccount = await this.getVestingAccountData(vestingPDA);
            if (!vestingAccount) {
                return { allowed: false, role: 'none' };
            }
            if ((0, validation_1.isAddressEqual)(userAddress, vestingAccount.initializer, 'solana')) {
                return {
                    allowed: true,
                    role: 'initializer'
                };
            }
            for (let i = 0; i < vestingAccount.recipients.length; i++) {
                if ((0, validation_1.isAddressEqual)(userAddress, vestingAccount.recipients[i].wallet, 'solana')) {
                    return {
                        allowed: true,
                        role: 'recipient',
                        recipientIndex: i
                    };
                }
            }
            return { allowed: false, role: 'none' };
        }
        catch (error) {
            logger_1.logger.error('Error verifying Solana user permission', { error, userAddress, vestingPDA });
            return { allowed: false, role: 'none' };
        }
    }
    async getVestingAccountData(vestingPDA) {
        try {
            const publicKey = new web3_js_1.PublicKey(vestingPDA);
            const accountInfo = await this.connection.getAccountInfo(publicKey);
            if (!accountInfo) {
                return null;
            }
            return this.parseVestingAccount(accountInfo.data);
        }
        catch (error) {
            logger_1.logger.error('Error getting vesting account data', { error, vestingPDA });
            return null;
        }
    }
    parseVestingAccount(data) {
        try {
            // ✅ UPDATED: Expected size with basis points (u16 instead of u8) and new fields
            if (data.length < 640) { // Updated minimum size
                throw new Error(`Invalid account data length: ${data.length}, expected at least 640`);
            }
            let offset = 0;
            const isInitialized = data[offset] !== 0;
            offset += 1;
            const initializer = new web3_js_1.PublicKey(data.slice(offset, offset + 32)).toString();
            offset += 32;
            const mint = new web3_js_1.PublicKey(data.slice(offset, offset + 32)).toString();
            offset += 32;
            const vault = new web3_js_1.PublicKey(data.slice(offset, offset + 32)).toString();
            offset += 32;
            const startTime = Number(this.readInt64LE(data, offset));
            offset += 8;
            const totalAmount = this.readUint64LE(data, offset);
            offset += 8;
            const cliffPeriod = Number(this.readInt64LE(data, offset));
            offset += 8;
            const vestingPeriod = Number(this.readInt64LE(data, offset));
            offset += 8;
            // ✅ UPDATED: TGE basis points (u16 instead of u8)
            const tgeBasisPoints = data.readUInt16LE(offset);
            offset += 2;
            const recipientCount = data[offset];
            offset += 1;
            // ✅ UPDATED: New fields from contract
            const isFinalized = data[offset] !== 0;
            offset += 1;
            const lastDistributionTime = Number(this.readInt64LE(data, offset));
            offset += 8;
            const recipients = [];
            for (let i = 0; i < Math.min(recipientCount, 10); i++) {
                // ✅ UPDATED: Each recipient now 50 bytes (32 + 2 + 8 + 8)
                if (offset + 50 > data.length) {
                    logger_1.logger.warn(`Not enough data for recipient ${i}, stopping parsing`);
                    break;
                }
                const wallet = new web3_js_1.PublicKey(data.slice(offset, offset + 32)).toString();
                offset += 32;
                // ✅ UPDATED: Basis points (u16) instead of percentage (u8)
                const basisPoints = data.readUInt16LE(offset);
                offset += 2;
                const claimedAmount = this.readUint64LE(data, offset);
                offset += 8;
                const lastClaimTime = Number(this.readInt64LE(data, offset));
                offset += 8;
                if (basisPoints > 0) {
                    recipients.push({
                        wallet,
                        basisPoints, // ✅ UPDATED: Use basis points
                        claimedAmount: claimedAmount.toString(),
                        lastClaimTime
                    });
                }
            }
            return {
                isInitialized,
                initializer,
                mint,
                vault,
                startTime,
                totalAmount: totalAmount.toString(),
                cliffPeriod,
                vestingPeriod,
                tgeBasisPoints, // ✅ UPDATED: Use basis points
                recipients,
                recipientCount,
                isFinalized, // ✅ UPDATED: New field
                lastDistributionTime // ✅ UPDATED: New field
            };
        }
        catch (error) {
            logger_1.logger.error('Error parsing Solana vesting account', error);
            return null;
        }
    }
    readUint64LE(buffer, offset) {
        const low = buffer.readUInt32LE(offset);
        const high = buffer.readUInt32LE(offset + 4);
        return BigInt(low) + (BigInt(high) << 32n);
    }
    readInt64LE(buffer, offset) {
        const value = this.readUint64LE(buffer, offset);
        if (value >= 0x8000000000000000n) {
            return value - 0x10000000000000000n;
        }
        return value;
    }
    calculateVestedAmount(totalAmount, currentTime, startTime, cliffPeriod, vestingPeriod, tgeBasisPoints) {
        // ✅ UPDATED: Use proper TGE + linear vesting calculation with basis points
        if (currentTime < startTime) {
            return 0n;
        }
        const elapsed = currentTime - startTime;
        // Calculate TGE amount using basis points (10000 = 100%)
        const tgeAmount = (totalAmount * BigInt(tgeBasisPoints)) / 10000n;
        // If still before cliff, only TGE is available
        if (elapsed < cliffPeriod) {
            return tgeAmount;
        }
        // If vesting period is complete, return all tokens
        if (elapsed >= vestingPeriod) {
            return totalAmount;
        }
        // Linear vesting between cliff and end
        const vestingAmount = totalAmount - tgeAmount;
        const vestingDuration = vestingPeriod - cliffPeriod;
        const vestingElapsed = elapsed - cliffPeriod;
        const linearVested = (vestingAmount * BigInt(vestingElapsed)) / BigInt(vestingDuration);
        return tgeAmount + linearVested;
    }
    async executeClaim(vestingPDA, userAddress) {
        const startTime = Date.now();
        try {
            logger_1.logger.info('Starting Solana claim execution', {
                vestingPDA,
                userAddress
            });
            // Check user permissions - only initializer can claim for Solana
            const permission = await this.verifyUserPermission(userAddress, vestingPDA);
            if (!permission.allowed || permission.role !== 'initializer') {
                return {
                    success: false,
                    error: 'Only the initializer can execute claims for Solana vesting',
                    timestamp: new Date().toISOString()
                };
            }
            const vestingData = await this.getVestingAccountData(vestingPDA);
            if (!vestingData) {
                return {
                    success: false,
                    error: 'Vesting account not found',
                    timestamp: new Date().toISOString()
                };
            }
            // ✅ REMOVED: isRevoked check since field was deleted from contract for immutability
            // Vesting can never be revoked now - this ensures complete immutability after finalization
            if (vestingData.startTime === 0) {
                return {
                    success: false,
                    error: 'Vesting not funded yet',
                    timestamp: new Date().toISOString()
                };
            }
            const currentTime = Math.floor(Date.now() / 1000);
            const totalAmount = BigInt(vestingData.totalAmount);
            const vestedAmount = this.calculateVestedAmount(totalAmount, currentTime, vestingData.startTime, vestingData.cliffPeriod, vestingData.vestingPeriod, vestingData.tgeBasisPoints);
            const totalClaimed = vestingData.recipients.reduce((sum, recipient) => {
                return sum + BigInt(recipient.claimedAmount);
            }, 0n);
            const claimableAmount = vestedAmount - totalClaimed;
            if (claimableAmount <= 0n) {
                return {
                    success: false,
                    error: 'No tokens available to claim at this time',
                    timestamp: new Date().toISOString()
                };
            }
            logger_1.logger.info('Claimable amount calculated', {
                vestedAmount: vestedAmount.toString(),
                totalClaimed: totalClaimed.toString(),
                claimableAmount: claimableAmount.toString(),
                elapsedTime: currentTime - vestingData.startTime,
                currentTime,
                startTime: vestingData.startTime
            });
            // Create transaction with compute budget first
            const transaction = new web3_js_1.Transaction();
            transaction.add(web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({ units: 1000000 }));
            const mintPubkey = new web3_js_1.PublicKey(vestingData.mint);
            const vestingPubkey = new web3_js_1.PublicKey(vestingPDA);
            const vaultPubkey = new web3_js_1.PublicKey(vestingData.vault);
            // Calculate vault authority PDA (same as in 3-claim.js)
            const [vaultAuthority] = await web3_js_1.PublicKey.findProgramAddress([Buffer.from('authority'), vestingPubkey.toBuffer()], this.programId);
            logger_1.logger.info('Vault authority calculated', {
                vaultAuthority: vaultAuthority.toBase58()
            });
            // Create/check ATAs for all recipients
            const recipientATAs = [];
            logger_1.logger.info('Preparing recipient ATAs', {
                recipientCount: vestingData.recipients.length
            });
            for (let i = 0; i < vestingData.recipients.length; i++) {
                const recipient = vestingData.recipients[i];
                const recipientPubkey = new web3_js_1.PublicKey(recipient.wallet);
                const ata = await (0, spl_token_1.getAssociatedTokenAddress)(mintPubkey, recipientPubkey);
                recipientATAs.push(ata);
                logger_1.logger.debug(`Processing recipient ${i + 1}`, {
                    wallet: recipient.wallet,
                    basisPoints: recipient.basisPoints,
                    percentage: recipient.basisPoints / 100, // ✅ UPDATED: Show as percentage for logging
                    ata: ata.toBase58()
                });
                try {
                    await (0, spl_token_1.getAccount)(this.connection, ata);
                    logger_1.logger.debug(`ATA exists for ${recipient.wallet}`);
                }
                catch {
                    logger_1.logger.info(`Creating ATA for ${recipient.wallet}`);
                    transaction.add((0, spl_token_1.createAssociatedTokenAccountInstruction)(this.keypair.publicKey, // payer
                    ata, // ata
                    recipientPubkey, // owner  
                    mintPubkey // mint
                    ));
                }
            }
            // Create claim instruction (instruction 2 as per 3-claim.js)
            const claimInstruction = new web3_js_1.TransactionInstruction({
                programId: this.programId,
                keys: [
                    { pubkey: this.keypair.publicKey, isSigner: true, isWritable: true }, // 0. Initializer (signer)
                    { pubkey: vestingPubkey, isSigner: false, isWritable: true }, // 1. Vesting PDA
                    { pubkey: vaultPubkey, isSigner: false, isWritable: true }, // 2. Vault PDA
                    { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 3. Token Program
                    { pubkey: web3_js_1.SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false }, // 4. Clock Sysvar
                    { pubkey: vaultAuthority, isSigner: false, isWritable: false }, // 5. Vault Authority PDA
                    ...recipientATAs.map((ata) => ({
                        pubkey: ata,
                        isSigner: false,
                        isWritable: true
                    })) // 6+. Recipient ATAs
                ],
                data: Buffer.from([2]) // Instruction 2 = Claim
            });
            transaction.add(claimInstruction);
            logger_1.logger.info('Sending Solana claim transaction', {
                instructionCount: transaction.instructions.length,
                recipientATACount: recipientATAs.length,
                signer: this.keypair.publicKey.toBase58()
            });
            const signature = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, transaction, [this.keypair], {
                commitment: 'confirmed',
                preflightCommitment: 'confirmed',
                skipPreflight: false
            });
            logger_1.logger.info('Solana transaction confirmed', {
                signature,
                slot: await this.connection.getSlot()
            });
            // ✅ UPDATED: Calculate distribution amounts using basis points
            const distributionAmounts = vestingData.recipients.map((recipient) => {
                const share = (claimableAmount * BigInt(recipient.basisPoints)) / 10000n;
                return {
                    address: recipient.wallet,
                    amount: share.toString(),
                    percentage: recipient.basisPoints / 100 // Convert basis points to percentage for display
                };
            });
            const executionTime = Date.now() - startTime;
            logger_1.logger.info('Solana claim completed successfully', {
                executionTime: `${executionTime}ms`,
                distributedAmount: claimableAmount.toString(),
                recipientCount: vestingData.recipients.length,
                role: 'initializer'
            });
            return {
                success: true,
                transactionHash: signature,
                distributedAmount: claimableAmount.toString(),
                recipients: distributionAmounts,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            const executionTime = Date.now() - startTime;
            // Log error with full details
            errorHandler_1.ErrorHandler.logAndGetSafeError(error, 'Solana claim execution', {
                executionTime: `${executionTime}ms`,
                vestingPDA,
                userAddress,
                logs: error.logs || []
            });
            // Get safe blockchain-specific error message
            const safeError = errorHandler_1.ErrorHandler.handleBlockchainError(error, 'solana');
            return {
                success: false,
                error: safeError.message,
                timestamp: new Date().toISOString()
            };
        }
    }
    async healthCheck() {
        try {
            const slot = await this.connection.getSlot();
            const balance = await this.connection.getBalance(this.keypair.publicKey);
            if (balance === 0) {
                logger_1.logger.warn('Executor keypair has zero balance', {
                    publicKey: this.keypair.publicKey.toString()
                });
            }
            logger_1.logger.debug('Solana service health check passed', {
                slot,
                balance: balance / 1e9,
                publicKey: this.keypair.publicKey.toString()
            });
            return { healthy: true };
        }
        catch (error) {
            logger_1.logger.error('Solana service health check failed', error);
            return {
                healthy: false,
                error: errorHandler_1.ErrorHandler.getSafeErrorMessage(error, 'Solana service unavailable')
            };
        }
    }
}
exports.SolanaService = SolanaService;
