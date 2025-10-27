"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BNBService = void 0;
// backend/src/services/bnb.ts
const ethers_1 = require("ethers");
const contracts_1 = require("../config/contracts");
const validation_1 = require("../utils/validation");
const logger_1 = require("../utils/logger");
const errorHandler_1 = require("../utils/errorHandler");
class BNBService {
    constructor() {
        this.config = (0, contracts_1.getContractConfig)().bnb;
        this.provider = new ethers_1.ethers.JsonRpcProvider(this.config.rpcUrl);
        this.wallet = new ethers_1.ethers.Wallet(this.config.privateKey, this.provider);
        this.contract = new ethers_1.ethers.Contract(this.config.contractAddress, contracts_1.BNB_VESTING_ABI, this.wallet);
    }
    async verifyUserPermission(userAddress, beneficiaryAddress) {
        try {
            logger_1.logger.debug('Verifying user permission', {
                userAddress,
                beneficiaryAddress,
                initializer: contracts_1.KNOWN_ADDRESSES.initializer
            });
            // Check if user is the initializer
            if ((0, validation_1.isAddressEqual)(userAddress, contracts_1.KNOWN_ADDRESSES.initializer, 'bnb')) {
                return {
                    allowed: true,
                    role: 'initializer'
                };
            }
            // Check if user is a recipient
            const recipients = await this.contract.getRecipients(beneficiaryAddress);
            for (let i = 0; i < recipients.length; i++) {
                if ((0, validation_1.isAddressEqual)(userAddress, recipients[i].wallet, 'bnb')) {
                    return {
                        allowed: true,
                        role: 'recipient',
                        recipientIndex: i
                    };
                }
            }
            return {
                allowed: false,
                role: 'none'
            };
        }
        catch (error) {
            logger_1.logger.error('Error verifying user permission', { error, userAddress, beneficiaryAddress });
            return {
                allowed: false,
                role: 'none'
            };
        }
    }
    async getVestingInfo(beneficiaryAddress) {
        try {
            const [schedule, claimableAmount, recipients] = await Promise.all([
                this.contract.getVestingSchedule(beneficiaryAddress),
                this.contract.getClaimableAmount(beneficiaryAddress),
                this.contract.getRecipients(beneficiaryAddress)
            ]);
            return {
                schedule,
                claimableAmount,
                recipients: recipients.map((r) => ({
                    wallet: r.wallet,
                    basisPoints: Number(r.basisPoints),
                    percentage: Number(r.basisPoints) / 100 // Convert basis points to percentage
                }))
            };
        }
        catch (error) {
            logger_1.logger.error('Error getting vesting info', { error, beneficiaryAddress });
            throw error;
        }
    }
    async getRecipientClaimInfo(beneficiaryAddress, recipientAddress) {
        try {
            const canClaim = await this.contract.canClaim(beneficiaryAddress, recipientAddress);
            const claimableAmount = await this.contract.getRecipientClaimableAmount(beneficiaryAddress, recipientAddress);
            return {
                canClaim,
                claimableAmount,
                recipientAddress
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to get recipient claim info', { error, beneficiaryAddress, recipientAddress });
            return {
                canClaim: false,
                claimableAmount: 0n,
                recipientAddress
            };
        }
    }
    async executeClaim(beneficiaryAddress, userAddress) {
        const startTime = Date.now();
        try {
            logger_1.logger.info('Starting BNB claim execution', {
                beneficiaryAddress,
                userAddress
            });
            // Check user permissions to determine claim method
            const permission = await this.verifyUserPermission(userAddress, beneficiaryAddress);
            if (!permission.allowed) {
                return {
                    success: false,
                    error: 'User not authorized to claim for this beneficiary',
                    timestamp: new Date().toISOString()
                };
            }
            // Get vesting information
            const vestingInfo = await this.getVestingInfo(beneficiaryAddress);
            if (vestingInfo.claimableAmount === 0n) {
                return {
                    success: false,
                    error: 'No tokens available to claim',
                    timestamp: new Date().toISOString()
                };
            }
            // Check gas price and estimate gas
            const gasPrice = await this.provider.getFeeData();
            logger_1.logger.debug('Gas estimation', {
                gasPrice: gasPrice.gasPrice?.toString(),
                maxFeePerGas: gasPrice.maxFeePerGas?.toString()
            });
            let gasEstimate;
            let tx;
            if (permission.role === 'initializer') {
                // ✅ RESTORED: Backend BNB distribution from beneficiary
                logger_1.logger.info('Executing BNB distribution from initializer/beneficiary');
                gasEstimate = await this.contract.distributeTokens.estimateGas(beneficiaryAddress);
                tx = await this.contract.distributeTokens(beneficiaryAddress, {
                    gasLimit: gasEstimate + BigInt(50000),
                    gasPrice: gasPrice.gasPrice
                });
            }
            else if (permission.role === 'recipient') {
                // ✅ CHANGED: Recipients should use frontend direct claim, not backend
                logger_1.logger.info('Recipient claim request - redirecting to frontend direct claim');
                return {
                    success: false,
                    error: 'Recipients should use the "Claim My Tokens" button on the website for direct MetaMask claiming. Backend claims are only for initializers.',
                    timestamp: new Date().toISOString()
                };
            }
            else {
                return {
                    success: false,
                    error: 'User role not supported for claiming',
                    timestamp: new Date().toISOString()
                };
            }
            logger_1.logger.info('Transaction submitted', {
                txHash: tx.hash,
                gasLimit: (gasEstimate + BigInt(50000)).toString(),
                method: permission.role === 'initializer' ? 'distributeTokens' : 'claimTokens'
            });
            // Wait for confirmation
            const receipt = await tx.wait(1);
            if (!receipt || receipt.status !== 1) {
                throw new Error('Transaction failed or was reverted');
            }
            logger_1.logger.info('Transaction confirmed', {
                txHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed?.toString()
            });
            // Calculate distribution amounts based on role
            let distributionAmounts;
            let totalDistributed;
            if (permission.role === 'initializer') {
                // Initializer distributes to all recipients
                distributionAmounts = vestingInfo.recipients.map((recipient) => {
                    const percentage = recipient.percentage || (recipient.basisPoints / 100);
                    return {
                        address: recipient.wallet,
                        amount: ((vestingInfo.claimableAmount * BigInt(Math.floor(percentage))) / 100n).toString(),
                        percentage: percentage
                    };
                });
                totalDistributed = vestingInfo.claimableAmount.toString();
            }
            else {
                // Recipient gets only their share
                const recipientData = vestingInfo.recipients[permission.recipientIndex];
                const percentage = recipientData.percentage || (recipientData.basisPoints / 100);
                const recipientShare = (vestingInfo.claimableAmount * BigInt(Math.floor(percentage))) / 100n;
                distributionAmounts = [{
                        address: userAddress,
                        amount: recipientShare.toString(),
                        percentage: percentage
                    }];
                totalDistributed = recipientShare.toString();
            }
            const executionTime = Date.now() - startTime;
            logger_1.logger.info('BNB claim completed successfully', {
                executionTime: `${executionTime}ms`,
                distributedAmount: totalDistributed,
                recipientCount: distributionAmounts.length,
                role: permission.role
            });
            return {
                success: true,
                transactionHash: receipt.hash,
                distributedAmount: totalDistributed,
                recipients: distributionAmounts,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            const executionTime = Date.now() - startTime;
            // Log error with full details
            errorHandler_1.ErrorHandler.logAndGetSafeError(error, 'BNB claim execution', {
                executionTime: `${executionTime}ms`,
                beneficiaryAddress,
                userAddress
            });
            // Get safe blockchain-specific error message
            const safeError = errorHandler_1.ErrorHandler.handleBlockchainError(error, 'bnb');
            return {
                success: false,
                error: safeError.message,
                timestamp: new Date().toISOString()
            };
        }
    }
    // Health check for BNB service
    async healthCheck() {
        try {
            // Check if we can connect to the provider
            const blockNumber = await this.provider.getBlockNumber();
            // Check if our wallet has some balance for gas
            const balance = await this.provider.getBalance(this.wallet.address);
            // Check if we can read from the contract
            const code = await this.provider.getCode(this.config.contractAddress);
            if (code === '0x') {
                return {
                    healthy: false,
                    error: 'Contract not found at specified address'
                };
            }
            if (balance === 0n) {
                logger_1.logger.warn('Executor wallet has zero balance', {
                    wallet: this.wallet.address
                });
            }
            logger_1.logger.debug('BNB service health check passed', {
                blockNumber,
                walletBalance: ethers_1.ethers.formatEther(balance),
                contractAddress: this.config.contractAddress
            });
            return { healthy: true };
        }
        catch (error) {
            logger_1.logger.error('BNB service health check failed', error);
            const safeError = errorHandler_1.ErrorHandler.logAndGetSafeError(error, 'BNB service health check', {}, 'BNB service unavailable');
            return {
                healthy: false,
                error: safeError.message
            };
        }
    }
}
exports.BNBService = BNBService;
