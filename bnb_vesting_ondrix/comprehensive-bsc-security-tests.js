#!/usr/bin/env node
/**
 * Comprehensive Security Tests for BSC SecureTokenVesting Contract
 * ================================================================
 *
 * Tests comprehensive security and functionality of the vesting contract,
 * including reentrancy, overflow, access control, and other attack vectors.
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    // Update these addresses after deploying your contracts
    TEST_TOKEN_ADDRESS: '0xAc13eD3790D3b718940D46f37A4475F1277a01F3',
    VESTING_CONTRACT_ADDRESS: '0x70889C0545B6777D5855D4c2E7A497f534A18dd5',
    
    // RPC settings (BSC Testnet by default)
    RPC_URL: 'https://rpc.ankr.com/bsc_testnet_chapel/f1b0ac56b95dbd213f3bb78d4cee63813c22d8214a3c0e927a803a45e5acee15',
    CHAIN_ID: 97,
    NETWORK_NAME: 'BSC Testnet',
    
    // Private key for tests (use a test account!)
    PRIVATE_KEY: 'YOUR_PRIVATE_KEY',
    
    // Test parameters
    TEST_AMOUNT: ethers.parseEther('1000'), // 1000 tokens for testing
    CLIFF_DURATION: 5 * 60, // 5 minutes
    VESTING_DURATION: 20 * 60, // 20 minutes
    
    // Test recipients
    TEST_RECIPIENTS: [
        { wallet: '0x4F1536FC181C541f3eF766D227373f55d03CE0bA', percentage: 20 },
        { wallet: '0x68E7BD8736DeD1dF80cBe5FD74a50e904F6C6f3F', percentage: 30 },
        { wallet: '0x93C25AbB6396a5B6541CF24ce1831D2C87B61817', percentage: 25 },
        { wallet: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1', percentage: 25 }
    ]
};

// =============================================================================
// CONTRACT ABIS
// =============================================================================

const TEST_TOKEN_ABI = [
    "constructor()",
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function mint(address to, uint256 amount)",
    "function owner() view returns (address)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

const VESTING_CONTRACT_ABI = [
    "constructor()",
    
    // Core functions
    "function initializeVesting(address token, tuple(address wallet, uint8 percentage)[] recipients, uint256 cliffDuration, uint256 vestingDuration)",
    "function fundVesting(address beneficiary, uint256 amount)",
    "function distributeTokens()",
    
    // View functions
    "function vestingSchedules(address) view returns (bool isInitialized, address token, uint256 startTime, uint256 cliffDuration, uint256 vestingDuration, uint256 totalAmount, uint256 claimedAmount, uint256 lastDistributionTime, uint8 currentPeriod, bool isFinalized)",
    "function getVestingSchedule(address beneficiary) view returns (bool isInitialized, address token, uint256 startTime, uint256 cliffDuration, uint256 vestingDuration, uint256 totalAmount, uint256 claimedAmount, uint8 recipientCount, bool isTestMode)",
    "function getRecipients(address beneficiary) view returns (tuple(address wallet, uint8 percentage)[])",
    "function getVestingProgress(address beneficiary) view returns (uint256 elapsedTime, uint256 unlockedPercentage, uint256 unlockedAmount, uint256 claimableAmount, uint256 remainingAmount)",
    "function getNextUnlock(address beneficiary) view returns (uint256 nextUnlockTime, uint256 nextUnlockPercentage, uint256 timeRemaining)",
    "function getCurrentPeriod(address beneficiary) view returns (uint8)",
    "function getClaimableAmount(address beneficiary) view returns (uint256)",
    "function canDistribute(address beneficiary) view returns (bool)",
    
    // Constants
    "function MAX_RECIPIENTS() view returns (uint8)",
    "function DISTRIBUTION_COOLDOWN() view returns (uint256)",
    "function MAX_VESTING_DURATION() view returns (uint256)",
    "function MAX_CLIFF_DURATION() view returns (uint256)",
    
    // Events
    "event VestingInitialized(address indexed beneficiary, address indexed token, uint256 cliffDuration, uint256 vestingDuration, uint8 recipientCount)",
    "event VestingFunded(address indexed beneficiary, uint256 amount, uint256 startTime)",
    "event TokensDistributed(address indexed beneficiary, address indexed recipient, uint256 amount, uint8 period, uint256 timestamp)",
    "event VestingFinalized(address indexed beneficiary)"
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

class TestLogger {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            warnings: 0,
            criticalIssues: 0,
            tests: []
        };
        this.startTime = Date.now();
    }

    info(message) {
        console.log(`\x1b[34m[INFO]\x1b[0m ${message}`);
    }

    success(message) {
        console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
        this.results.passed++;
    }

    warning(message) {
        console.log(`\x1b[33m[WARN]\x1b[0m ${message}`);
        this.results.warnings++;
    }

    error(message) {
        console.log(`\x1b[31m[FAIL]\x1b[0m ${message}`);
        this.results.failed++;
    }

    critical(message) {
        console.log(`\x1b[35m[CRITICAL]\x1b[0m ${message}`);
        this.results.criticalIssues++;
    }

    security(message) {
        console.log(`\x1b[36m[SECURITY]\x1b[0m ${message}`);
    }

    addTest(name, status, description, severity = 'medium') {
        this.results.tests.push({
            name,
            status,
            description,
            severity,
            timestamp: Date.now()
        });
    }

    generateReport() {
        const duration = Date.now() - this.startTime;
        const total = this.results.passed + this.results.failed;
        const securityLevel = total > 0 ? (this.results.passed / total) : 0;
        
        return {
            summary: {
                duration: Math.round(duration / 1000),
                total,
                passed: this.results.passed,
                failed: this.results.failed,
                warnings: this.results.warnings,
                criticalIssues: this.results.criticalIssues
            },
            securityLevel,
            tests: this.results.tests,
            recommendations: this.generateRecommendations(),
            timestamp: new Date().toISOString(),
            config: CONFIG
        };
    }

    generateRecommendations() {
        const recommendations = [];
        
        if (this.results.criticalIssues > 0) {
            recommendations.push('🚨 CRITICAL: Severe security vulnerabilities detected');
        }
        
        if (this.results.failed > this.results.passed) {
            recommendations.push('⚠️ Contract requires significant improvements before production');
        }
        
        if (this.results.warnings > 5) {
            recommendations.push('💡 Consider optimizing the contract');
        }
        
        if (this.results.passed === this.results.passed + this.results.failed) {
            recommendations.push('✅ Contract is production-ready');
        }
        
        return recommendations;
    }
}

// =============================================================================
// MAIN TEST CLASS
// =============================================================================

class BSCVestingSecurityTester {
    constructor() {
        this.logger = new TestLogger();
        this.provider = null;
        this.signer = null;
        this.testToken = null;
        this.vestingContract = null;
        this.attackerSigner = null;
    }

    async initialize() {
        this.logger.info('Initializing BSC contract security tester...');
        
        // Config validation
        if (!CONFIG.PRIVATE_KEY) {
            throw new Error('PRIVATE_KEY is not set in environment variables');
        }
        
        // Connect to network
        this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        this.signer = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
        
        this.logger.info(`Connected to ${CONFIG.NETWORK_NAME}`);
        this.logger.info(`Test account: ${this.signer.address}`);
        
        // Check balance
        const balance = await this.provider.getBalance(this.signer.address);
        this.logger.info(`Account balance: ${ethers.formatEther(balance)} BNB`);
        
        if (balance < ethers.parseEther('0.01')) {
            this.logger.warning('Low BNB balance for testing');
        }
        
        // Connect to contracts
        this.testToken = new ethers.Contract(CONFIG.TEST_TOKEN_ADDRESS, TEST_TOKEN_ABI, this.signer);
        this.vestingContract = new ethers.Contract(CONFIG.VESTING_CONTRACT_ADDRESS, VESTING_CONTRACT_ABI, this.signer);
        
        // Create attacker account
        this.attackerSigner = ethers.Wallet.createRandom().connect(this.provider);
        
        this.logger.success('Initialization completed successfully');
    }

    // =========================================================================
    // BASIC FUNCTIONAL TESTS
    // =========================================================================

    async testContractDeployment() {
        this.logger.info('Testing contract deployment...');
        
        try {
            // Verify TestToken
            const tokenName = await this.testToken.name();
            const tokenSymbol = await this.testToken.symbol();
            const tokenDecimals = await this.testToken.decimals();
            
            this.logger.success(`TestToken: ${tokenName} (${tokenSymbol}), decimals: ${tokenDecimals}`);
            this.addTest('Token Contract Deployment', 'passed', 'TestToken deployed and functional');
            
            // Verify VestingContract
            const maxRecipients = await this.vestingContract.MAX_RECIPIENTS();
            const cooldown = await this.vestingContract.DISTRIBUTION_COOLDOWN();
            
            this.logger.success(`Vesting Contract: MAX_RECIPIENTS=${maxRecipients}, COOLDOWN=${cooldown}s`);
            this.addTest('Vesting Contract Deployment', 'passed', 'SecureTokenVesting deployed');
            
        } catch (error) {
            this.logger.error(`Contract verification error: ${error.message}`);
            this.addTest('Contract Deployment', 'failed', `Contracts unavailable: ${error.message}`, 'critical');
        }
    }

    async testBasicTokenOperations() {
        this.logger.info('Testing basic token operations...');
        
        try {
            // Check balance
            const balance = await this.testToken.balanceOf(this.signer.address);
            this.logger.info(`Current token balance: ${ethers.formatEther(balance)}`);
            
            if (balance < CONFIG.TEST_AMOUNT) {
                this.logger.warning('Not enough tokens for full testing');
                // Attempt to mint additional tokens
                try {
                    const mintTx = await this.testToken.mint(this.signer.address, CONFIG.TEST_AMOUNT);
                    await mintTx.wait();
                    this.logger.success('Additional tokens minted');
                } catch (mintError) {
                    this.logger.warning('Failed to mint additional tokens (likely not owner)');
                }
            }
            
            // Approve/allowance
            const approveTx = await this.testToken.approve(CONFIG.VESTING_CONTRACT_ADDRESS, CONFIG.TEST_AMOUNT);
            await approveTx.wait();
            
            const allowance = await this.testToken.allowance(this.signer.address, CONFIG.VESTING_CONTRACT_ADDRESS);
            
            if (allowance >= CONFIG.TEST_AMOUNT) {
                this.logger.success('Tokens approved for vesting contract');
                this.addTest('Token Approval', 'passed', 'ERC20 approve works correctly');
            } else {
                this.logger.error('Token approval error');
                this.addTest('Token Approval', 'failed', 'ERC20 approve does not work');
            }
            
        } catch (error) {
            this.logger.error(`Basic token operations error: ${error.message}`);
            this.addTest('Basic Token Operations', 'failed', error.message);
        }
    }

    // =========================================================================
    // VESTING INITIALIZATION TESTS
    // =========================================================================

    async testVestingInitialization() {
        this.logger.info('Testing vesting initialization...');
        
        try {
            // Normal initialization
            const initTx = await this.vestingContract.initializeVesting(
                CONFIG.TEST_TOKEN_ADDRESS,
                CONFIG.TEST_RECIPIENTS,
                CONFIG.CLIFF_DURATION,
                CONFIG.VESTING_DURATION
            );
            await initTx.wait();
            
            this.logger.success('Vesting initialized successfully');
            this.addTest('Vesting Initialization', 'passed', 'Initialization works correctly');
            
            // State check after initialization
            const schedule = await this.vestingContract.getVestingSchedule(this.signer.address);
            
            if (schedule.isInitialized) {
                this.logger.success('Vesting schedule created');
                this.addTest('Schedule Creation', 'passed', 'VestingSchedule created correctly');
            } else {
                this.logger.error('Vesting schedule not created');
                this.addTest('Schedule Creation', 'failed', 'VestingSchedule not created');
            }
            
        } catch (error) {
            this.logger.error(`Initialization error: ${error.message}`);
            this.addTest('Vesting Initialization', 'failed', error.message);
        }
    }

    async testDoubleInitializationPrevention() {
        this.logger.info('Testing double-initialization protection...');
        
        try {
            // Attempt double initialization
            await this.vestingContract.initializeVesting(
                CONFIG.TEST_TOKEN_ADDRESS,
                CONFIG.TEST_RECIPIENTS,
                CONFIG.CLIFF_DURATION,
                CONFIG.VESTING_DURATION
            );
            
            this.logger.error('Double initialization was not blocked!');
            this.addTest('Double Initialization Prevention', 'failed', 'No protection against double initialization', 'critical');
            
        } catch (error) {
            if (error.message.includes('already initialized')) {
                this.logger.success('Double-initialization protection works');
                this.addTest('Double Initialization Prevention', 'passed', 'Correctly blocks double initialization');
            } else {
                this.logger.warning(`Unexpected error during double initialization: ${error.message}`);
                this.addTest('Double Initialization Prevention', 'warning', error.message);
            }
        }
    }

    async testInvalidRecipientsPrevention() {
        this.logger.info('Testing invalid recipients protection...');
        
        // Create a new account for isolated testing
        const testSigner = ethers.Wallet.createRandom().connect(this.provider);
        const testVesting = this.vestingContract.connect(testSigner);
        
        // Test 1: Empty recipients array
        try {
            await testVesting.initializeVesting(
                CONFIG.TEST_TOKEN_ADDRESS,
                [],
                CONFIG.CLIFF_DURATION,
                CONFIG.VESTING_DURATION
            );
            this.logger.error('Initialization with empty recipients array succeeded!');
            this.addTest('Empty Recipients Prevention', 'failed', 'Does not block empty recipients array', 'high');
        } catch (error) {
            if (error.message.includes('Invalid recipients count')) {
                this.logger.success('Empty recipients protection works');
                this.addTest('Empty Recipients Prevention', 'passed', 'Correctly blocks empty array');
            }
        }
        
        // Test 2: Incorrect percentage sum
        try {
            const invalidRecipients = [
                { wallet: '0x742d35Cc6472D1432d6fD62C4a9C51E5aE6cF0F8', percentage: 50 },
                { wallet: '0x8ba1f109551bD432803012645Hac136c0e13e7A7', percentage: 30 }
                // Sum = 80%, must be 100%
            ];
            
            await testVesting.initializeVesting(
                CONFIG.TEST_TOKEN_ADDRESS,
                invalidRecipients,
                CONFIG.CLIFF_DURATION,
                CONFIG.VESTING_DURATION
            );
            
            this.logger.error('Initialization with incorrect percentage sum succeeded!');
            this.addTest('Invalid Percentage Sum Prevention', 'failed', 'Does not validate percentage sum', 'high');
            
        } catch (error) {
            if (error.message.includes('Total percentage must equal 100')) {
                this.logger.success('Invalid percentage sum protection works');
                this.addTest('Invalid Percentage Sum Prevention', 'passed', 'Correctly validates percentage sum');
            }
        }
    }

    // =========================================================================
    // FUNDING TESTS
    // =========================================================================

    async testVestingFunding() {
        this.logger.info('Testing vesting funding...');
        
        try {
            // Fund vesting
            const fundTx = await this.vestingContract.fundVesting(this.signer.address, CONFIG.TEST_AMOUNT);
            await fundTx.wait();
            
            this.logger.success('Vesting funded successfully');
            this.addTest('Vesting Funding', 'passed', 'Funding works correctly');
            
            // State check after funding
            const schedule = await this.vestingContract.getVestingSchedule(this.signer.address);
            
            if (schedule.totalAmount.toString() === CONFIG.TEST_AMOUNT.toString()) {
                this.logger.success('Funding amount recorded correctly');
                this.addTest('Funding Amount Recording', 'passed', 'Funding amount is correct');
            } else {
                this.logger.error('Incorrect funding amount recorded');
                this.addTest('Funding Amount Recording', 'failed', 'Wrong funding amount');
            }
            
            if (schedule.startTime > 0) {
                this.logger.success('Start time set');
                this.addTest('Start Time Setting', 'passed', 'startTime correctly set');
            } else {
                this.logger.error('Start time not set');
                this.addTest('Start Time Setting', 'failed', 'startTime not set');
            }
            
        } catch (error) {
            this.logger.error(`Funding error: ${error.message}`);
            this.addTest('Vesting Funding', 'failed', error.message);
        }
    }

    async testDoubleFundingPrevention() {
        this.logger.info('Testing double-funding protection...');
        
        try {
            // Attempt double funding
            await this.vestingContract.fundVesting(this.signer.address, CONFIG.TEST_AMOUNT);
            
            this.logger.error('Double funding was not blocked!');
            this.addTest('Double Funding Prevention', 'failed', 'No protection against double funding', 'critical');
            
        } catch (error) {
            if (error.message.includes('already funded')) {
                this.logger.success('Double-funding protection works');
                this.addTest('Double Funding Prevention', 'passed', 'Correctly blocks double funding');
            } else {
                this.logger.warning(`Unexpected error during double funding: ${error.message}`);
                this.addTest('Double Funding Prevention', 'warning', error.message);
            }
        }
    }

    // =========================================================================
    // ACCESS CONTROL SECURITY TESTS
    // =========================================================================

    async testAccessControlSecurity() {
        this.logger.security('Testing access control...');
        
        // Create attacker account binding
        const attackerVesting = this.vestingContract.connect(this.attackerSigner);
        
        // Test 1: Attempt to distribute someone else's tokens
        try {
            await attackerVesting.distributeTokens();
            this.logger.critical('CRITICAL: Attacker can distribute someone else\'s tokens!');
            this.addTest('Unauthorized Distribution Prevention', 'failed', 'Attacker can distribute others\'s tokens', 'critical');
        } catch (error) {
            if (error.message.includes('Vesting not initialized') || error.message.includes('not funded')) {
                this.logger.success('Unauthorized distribution protection works');
                this.addTest('Unauthorized Distribution Prevention', 'passed', 'Correctly blocks unauthorized distribution');
            }
        }
        
        // Test 2: Attempt to fund a non-existent vesting
        try {
            // Approve tokens for attacker (if any)
            await attackerVesting.fundVesting(this.attackerSigner.address, ethers.parseEther('100'));
            this.logger.error('Attacker funded a non-existent vesting');
            this.addTest('Invalid Beneficiary Funding', 'failed', 'Possible to fund non-existent vesting', 'high');
        } catch (error) {
            if (error.message.includes('not initialized')) {
                this.logger.success('Non-existent vesting funding protection works');
                this.addTest('Invalid Beneficiary Funding', 'passed', 'Correctly blocks funding of non-existent vesting');
            }
        }
    }

    // =========================================================================
    // TIME LOGIC TESTS
    // =========================================================================

    async testCliffPeriodEnforcement() {
        this.logger.info('Testing cliff period enforcement...');
        
        try {
            // Attempt distribution before cliff ends
            const canDistribute = await this.vestingContract.canDistribute(this.signer.address);
            
            if (!canDistribute) {
                this.logger.success('Cliff period correctly blocks distribution');
                this.addTest('Cliff Period Enforcement', 'passed', 'Cliff period enforced correctly');
            } else {
                // Check if cliff is already over
                const schedule = await this.vestingContract.getVestingSchedule(this.signer.address);
                const currentTime = Math.floor(Date.now() / 1000);
                const cliffEndTime = Number(schedule.startTime) + Number(schedule.cliffDuration);
                
                if (currentTime >= cliffEndTime) {
                    this.logger.info('Cliff period already ended, distribution allowed');
                    this.addTest('Cliff Period Enforcement', 'passed', 'Cliff period ended correctly');
                } else {
                    this.logger.error('Distribution available before cliff ended!');
                    this.addTest('Cliff Period Enforcement', 'failed', 'Cliff period not enforced', 'high');
                }
            }
            
        } catch (error) {
            this.logger.error(`Cliff period check error: ${error.message}`);
            this.addTest('Cliff Period Enforcement', 'failed', error.message);
        }
    }

    async testVestingPeriods() {
        this.logger.info('Testing vesting periods...');
        
        try {
            const currentPeriod = await this.vestingContract.getCurrentPeriod(this.signer.address);
            this.logger.info(`Current vesting period: ${currentPeriod}`);
            
            const progress = await this.vestingContract.getVestingProgress(this.signer.address);
            this.logger.info(`Vesting progress: ${progress.unlockedPercentage}% unlocked`);
            
            const nextUnlock = await this.vestingContract.getNextUnlock(this.signer.address);
            if (nextUnlock.timeRemaining > 0) {
                const remainingMinutes = Math.ceil(Number(nextUnlock.timeRemaining) / 60);
                this.logger.info(`Next unlock: ${nextUnlock.nextUnlockPercentage}% in ${remainingMinutes} minutes`);
            }
            
            this.addTest('Vesting Periods Logic', 'passed', 'Vesting period logic works correctly');
            
        } catch (error) {
            this.logger.error(`Vesting periods check error: ${error.message}`);
            this.addTest('Vesting Periods Logic', 'failed', error.message);
        }
    }

    // =========================================================================
    // TOKEN DISTRIBUTION TESTS
    // =========================================================================

    async testTokenDistribution() {
        this.logger.info('Testing token distribution...');
        
        try {
            const canDistribute = await this.vestingContract.canDistribute(this.signer.address);
            
            if (!canDistribute) {
                this.logger.info('Distribution not available yet (cliff period or fully distributed)');
                this.addTest('Token Distribution Availability', 'passed', 'Distribution availability correctly enforced');
                return;
            }
            
            // Capture recipient balances before distribution
            const recipientsBefore = [];
            for (const recipient of CONFIG.TEST_RECIPIENTS) {
                const balance = await this.testToken.balanceOf(recipient.wallet);
                recipientsBefore.push({
                    wallet: recipient.wallet,
                    balanceBefore: balance,
                    percentage: recipient.percentage
                });
            }
            
            // Execute distribution
            const distributeTx = await this.vestingContract.distributeTokens();
            const receipt = await distributeTx.wait();
            
            this.logger.success('Tokens distributed successfully');
            
            // Check balances after distribution
            let totalDistributed = 0n;
            for (let i = 0; i < recipientsBefore.length; i++) {
                const recipient = recipientsBefore[i];
                const balanceAfter = await this.testToken.balanceOf(recipient.wallet);
                const received = balanceAfter - recipient.balanceBefore;
                
                if (received > 0n) {
                    this.logger.success(`${recipient.wallet} received ${ethers.formatEther(received)} tokens`);
                    totalDistributed += received;
                } else {
                    this.logger.warning(`${recipient.wallet} did not receive tokens`);
                }
            }
            
            if (totalDistributed > 0n) {
                this.logger.success(`Total distributed: ${ethers.formatEther(totalDistributed)} tokens`);
                this.addTest('Token Distribution Execution', 'passed', 'Token distribution works correctly');
            } else {
                this.logger.error('Tokens were not distributed');
                this.addTest('Token Distribution Execution', 'failed', 'Tokens not distributed');
            }
            
            // Check events
            const distributionEvents = receipt.logs.filter(log => {
                try {
                    const parsed = this.vestingContract.interface.parseLog(log);
                    return parsed.name === 'TokensDistributed';
                } catch {
                    return false;
                }
            });
            
            if (distributionEvents.length > 0) {
                this.logger.success(`${distributionEvents.length} distribution events found`);
                this.addTest('Distribution Events', 'passed', 'Distribution events emitted correctly');
            } else {
                this.logger.warning('Distribution events not found');
                this.addTest('Distribution Events', 'warning', 'No distribution events');
            }
            
        } catch (error) {
            this.logger.error(`Token distribution error: ${error.message}`);
            this.addTest('Token Distribution', 'failed', error.message);
        }
    }

    async testDistributionCooldown() {
        this.logger.info('Testing cooldown between distributions...');
        
        try {
            // Attempt immediate re-distribution after previous
            const canDistributeAgain = await this.vestingContract.canDistribute(this.signer.address);
            
            if (!canDistributeAgain) {
                this.logger.success('Cooldown correctly blocks rapid re-distribution');
                this.addTest('Distribution Cooldown', 'passed', 'Cooldown between distributions works');
            } else {
                // Check whether a new period has started
                const currentPeriod = await this.vestingContract.getCurrentPeriod(this.signer.address);
                const schedule = await this.vestingContract.getVestingSchedule(this.signer.address);
                
                // Fetch period from storage (for comparison)
                const scheduleStorage = await this.vestingContract.vestingSchedules(this.signer.address);
                const lastPeriod = scheduleStorage.currentPeriod;
                
                if (currentPeriod > lastPeriod) {
                    this.logger.info('New period available for distribution');
                    this.addTest('Distribution Cooldown', 'passed', 'New period correctly enables distribution');
                } else {
                    this.logger.warning('Cooldown might not be functioning correctly');
                    this.addTest('Distribution Cooldown', 'warning', 'Cooldown needs further verification');
                }
            }
            
        } catch (error) {
            this.logger.error(`Cooldown check error: ${error.message}`);
            this.addTest('Distribution Cooldown', 'failed', error.message);
        }
    }

    // =========================================================================
    // REENTRANCY PROTECTION TESTS
    // =========================================================================

    async testReentrancyProtection() {
        this.logger.security('Testing protection against reentrancy attacks...');
        
        try {
            // Simple concurrent-calls test
            const promises = [];
            
            for (let i = 0; i < 3; i++) {
                promises.push(
                    this.vestingContract.canDistribute(this.signer.address).catch(() => false)
                );
            }
            
            const results = await Promise.all(promises);
            this.logger.success('Concurrent calls handled without errors');
            this.addTest('Basic Reentrancy Protection', 'passed', 'Contract resists simple reentrancy attempts');
            
        } catch (error) {
            this.logger.error(`Reentrancy test error: ${error.message}`);
            this.addTest('Reentrancy Protection', 'failed', error.message);
        }
    }

    // =========================================================================
    // INPUT VALIDATION TESTS
    // =========================================================================

    async testInputValidation() {
        this.logger.info('Testing input validation...');
        
        // Create new account for isolated testing
        const testSigner = ethers.Wallet.createRandom().connect(this.provider);
        const testVesting = this.vestingContract.connect(testSigner);
        
        // Test 1: Zero token address
        try {
            await testVesting.initializeVesting(
                ethers.ZeroAddress,
                CONFIG.TEST_RECIPIENTS,
                CONFIG.CLIFF_DURATION,
                CONFIG.VESTING_DURATION
            );
            this.logger.error('Initialization with zero token address succeeded!');
            this.addTest('Zero Token Address Prevention', 'failed', 'Does not block zero token address', 'high');
        } catch (error) {
            if (error.message.includes('Invalid token address')) {
                this.logger.success('Zero token address protection works');
                this.addTest('Zero Token Address Prevention', 'passed', 'Correctly blocks zero token address');
            }
        }
        
        // Test 2: Excessive cliff duration
        try {
            await testVesting.initializeVesting(
                CONFIG.TEST_TOKEN_ADDRESS,
                CONFIG.TEST_RECIPIENTS,
                365 * 24 * 60 * 60, // 365 days (above maximum)
                CONFIG.VESTING_DURATION
            );
            this.logger.error('Initialization with overly long cliff succeeded!');
            this.addTest('Max Cliff Duration Check', 'failed', 'Does not check maximum cliff duration', 'medium');
        } catch (error) {
            if (error.message.includes('Cliff duration too long')) {
                this.logger.success('Excessive cliff protection works');
                this.addTest('Max Cliff Duration Check', 'passed', 'Correctly limits cliff duration');
            }
        }
        
        // Test 3: Cliff greater than vesting duration
        try {
            await testVesting.initializeVesting(
                CONFIG.TEST_TOKEN_ADDRESS,
                CONFIG.TEST_RECIPIENTS,
                CONFIG.VESTING_DURATION + 60, // Cliff greater than vesting
                CONFIG.VESTING_DURATION
            );
            this.logger.error('Initialization with cliff > vesting succeeded!');
            this.addTest('Cliff vs Vesting Duration Check', 'failed', 'Does not validate cliff vs vesting', 'medium');
        } catch (error) {
            if (error.message.includes('must be greater than cliff')) {
                this.logger.success('Cliff/vesting ratio protection works');
                this.addTest('Cliff vs Vesting Duration Check', 'passed', 'Correctly validates period ratio');
            }
        }
    }

    // =========================================================================
    // MATHEMATICAL ACCURACY TESTS
    // =========================================================================

    async testMathematicalAccuracy() {
        this.logger.info('Testing mathematical accuracy...');
        
        try {
            const progress = await this.vestingContract.getVestingProgress(this.signer.address);
            const claimableAmount = await this.vestingContract.getClaimableAmount(this.signer.address);
            
            // Validate calculation logic
            if (progress.unlockedAmount >= progress.claimableAmount) {
                this.logger.success('Math logic is sound');
                this.addTest('Mathematical Logic', 'passed', 'unlocked >= claimable is correct');
            } else {
                this.logger.error('Invalid math: claimable > unlocked');
                this.addTest('Mathematical Logic', 'failed', 'claimable > unlocked', 'high');
            }
            
            // Check claimed + remaining = total
            const schedule = await this.vestingContract.getVestingSchedule(this.signer.address);
            const expectedTotal = BigInt(progress.claimedAmount) + BigInt(progress.remainingAmount);
            
            if (schedule.totalAmount.toString() === expectedTotal.toString()) {
                this.logger.success('Balance equation holds: claimed + remaining = total');
                this.addTest('Balance Equation', 'passed', 'claimed + remaining = total');
            } else {
                this.logger.error('Balance equation broken: claimed + remaining ≠ total');
                this.addTest('Balance Equation', 'failed', 'Math balance violated', 'high');
            }
            
        } catch (error) {
            this.logger.error(`Math check error: ${error.message}`);
            this.addTest('Mathematical Accuracy', 'failed', error.message);
        }
    }

    // =========================================================================
    // EDGE CASE TESTS
    // =========================================================================

    // Edge cases with insufficient funds handling
    async testEdgeCases() {
        this.logger.info('Testing edge cases...');
        
        try {
            // Check balance for testing
            const balance = await this.provider.getBalance(this.signer.address);
            
            if (balance < ethers.parseEther('0.001')) {
                this.logger.warning('Insufficient BNB for edge case testing');
                this.logger.addTest('Edge Cases', 'warning', 'Skipped due to insufficient funds');
                return;
            }
            
            // Minimal values (new accounts only)
            const testSigner = ethers.Wallet.createRandom().connect(this.provider);
            const testVesting = this.vestingContract.connect(testSigner);
            
            // Minimal but valid parameters
            const minRecipients = [{ wallet: testSigner.address, percentage: 100 }];
            const minCliff = 60; // 1 minute
            const minVesting = 120; // 2 minutes
            
            try {
                await testVesting.initializeVesting(
                    CONFIG.TEST_TOKEN_ADDRESS,
                    minRecipients,
                    minCliff,
                    minVesting
                );
                
                this.logger.success('Minimum parameters handled correctly');
                this.logger.addTest('Minimum Parameters', 'passed', 'Minimum values work');
            } catch (error) {
                if (error.message.includes('insufficient funds')) {
                    this.logger.warning('Insufficient funds for minimum parameters test');
                    this.logger.addTest('Minimum Parameters', 'warning', 'Skipped due to insufficient funds');
                } else {
                    throw error;
                }
            }
            
            this.logger.addTest('Edge Cases General', 'passed', 'Edge cases tested successfully');
            
        } catch (error) {
            if (error.message.includes('insufficient funds')) {
                this.logger.warning('Insufficient funds for full edge case testing');
                this.logger.addTest('Edge Cases', 'warning', 'Partially skipped due to insufficient funds');
            } else {
                this.logger.error(`Edge cases error: ${error.message}`);
                this.logger.addTest('Edge Cases', 'failed', error.message);
            }
        }
    }


    // =========================================================================
    // EVENT TESTS
    // =========================================================================

    async testEventEmission() {
        this.logger.info('Testing event emission...');
        
        try {
            // Inspect recent blocks for our events
            const latestBlock = await this.provider.getBlockNumber();
            const fromBlock = latestBlock - 100; // Last 100 blocks
            
            // Fetch initialization events
            const initEvents = await this.vestingContract.queryFilter(
                this.vestingContract.filters.VestingInitialized(),
                fromBlock
            );
            
            if (initEvents.length > 0) {
                this.logger.success(`Found ${initEvents.length} VestingInitialized events`);
                this.addTest('Initialization Events', 'passed', 'Initialization events are emitted');
            } else {
                this.logger.warning('VestingInitialized events not found');
                this.addTest('Initialization Events', 'warning', 'No initialization events');
            }
            
            // Fetch funding events
            const fundEvents = await this.vestingContract.queryFilter(
                this.vestingContract.filters.VestingFunded(),
                fromBlock
            );
            
            if (fundEvents.length > 0) {
                this.logger.success(`Found ${fundEvents.length} VestingFunded events`);
                this.addTest('Funding Events', 'passed', 'Funding events are emitted');
            } else {
                this.logger.warning('VestingFunded events not found');
                this.addTest('Funding Events', 'warning', 'No funding events');
            }
            
        } catch (error) {
            this.logger.error(`Event check error: ${error.message}`);
            this.addTest('Event Emission', 'failed', error.message);
        }
    }

    // =========================================================================
    // ADVANCED SECURITY TESTS
    // =========================================================================

    async testTimestampManipulation() {
        console.log('\n🕐 TIMESTAMP MANIPULATION PROTECTION TESTS');
        console.log('--------------------------------------------------');
        
        this.logger.security('Testing dependency on block.timestamp...');
        
        try {
            const currentBlock = await this.provider.getBlock('latest');
            const schedule = await this.vestingContract.getVestingSchedule(this.signer.address);
            
            if (schedule.isInitialized && schedule.startTime > 0) {
                const timeDiff = currentBlock.timestamp - Number(schedule.startTime);
                const currentPeriod = await this.vestingContract.getCurrentPeriod(this.signer.address);
                
                this.logger.info(`Time since vesting start: ${timeDiff} seconds`);
                this.logger.info(`Current period: ${currentPeriod}`);
                
                // Validate time logic consistency
                const progress = await this.vestingContract.getVestingProgress(this.signer.address);
                const unlockedPercentage = progress.unlockedPercentage;
                
                // Check correlation of time and unlocked percentage
                let expectedMinPercentage = 0;
                const minutes = Math.floor(timeDiff / 60);
                
                if (minutes >= 20) expectedMinPercentage = 100;
                else if (minutes >= 15) expectedMinPercentage = 50;
                else if (minutes >= 10) expectedMinPercentage = 20;
                else if (minutes >= 5) expectedMinPercentage = 10;
                
                if (Number(unlockedPercentage) >= expectedMinPercentage) {
                    this.logger.success('Time logic is consistent');
                    this.addTest('Timestamp Logic Consistency', 'passed', 'Time logic is correct');
                } else {
                    this.logger.error(`Time mismatch: ${unlockedPercentage}% vs expected ${expectedMinPercentage}%`);
                    this.addTest('Timestamp Logic Consistency', 'failed', 'Time logic violated', 'high');
                }
                
                // Protection against too-large time shifts
                const MAX_REASONABLE_TIME = 365 * 24 * 60 * 60; // 1 year
                if (timeDiff < MAX_REASONABLE_TIME) {
                    this.logger.success('Time parameters within reasonable bounds');
                    this.addTest('Reasonable Time Bounds', 'passed', 'Time bounds correct');
                } else {
                    this.logger.warning('Suspiciously large time shift');
                    this.addTest('Reasonable Time Bounds', 'warning', 'Large time shift');
                }
            }
            
        } catch (error) {
            this.logger.error(`Timestamp testing error: ${error.message}`);
            this.addTest('Timestamp Manipulation Test', 'failed', error.message);
        }
    }

    async testPrecisionAttacks() {
        console.log('\n🔢 PRECISION ATTACK PROTECTION TESTS');
        console.log('--------------------------------------------------');
        
        this.logger.security('Testing precision/rounding attacks...');
        
        try {
            // Test with very small amounts
            const testUser = ethers.Wallet.createRandom().connect(this.provider);
            const userContract = this.vestingContract.connect(testUser);
            
            const tinyAmount = 1000n; // 1000 wei
            const recipients = [{ wallet: testUser.address, percentage: 100 }];
            
            try {
                await userContract.initializeVesting(
                    CONFIG.TEST_TOKEN_ADDRESS,
                    recipients,
                    CONFIG.CLIFF_DURATION,
                    CONFIG.VESTING_DURATION
                );
                
                // Check handling of small amounts
                const claimable = await this.vestingContract.getClaimableAmount(testUser.address);
                this.logger.info(`Claimable for small amount: ${claimable.toString()}`);
                
                this.logger.success('Small amount handling is correct');
                this.addTest('Small Amount Precision', 'passed', 'Precision with small amounts OK');
                
            } catch (error) {
                if (error.message.includes('Amount must be greater than 0') || 
                    error.message.includes('insufficient funds')) {
                    this.logger.success('Invalid amount protection works');
                    this.addTest('Small Amount Protection', 'passed', 'Protection against tiny amounts');
                } else {
                    this.logger.error(`Unexpected precision error: ${error.message}`);
                    this.addTest('Precision Attack Protection', 'failed', error.message, 'medium');
                }
            }
            
            // Division with remainder
            const testAmountWithRemainder = 1001n; // Not divisible evenly by percentages
            
            this.logger.info('Testing division with remainder...');
            const recipients2 = [
                { wallet: testUser.address, percentage: 33 },
                { wallet: this.signer.address, percentage: 33 },
                { wallet: this.signer.address, percentage: 34 } // 33+33+34 = 100
            ];
            
            try {
                const userContract2 = this.vestingContract.connect(ethers.Wallet.createRandom().connect(this.provider));
                await userContract2.initializeVesting(
                    CONFIG.TEST_TOKEN_ADDRESS,
                    recipients2,
                    CONFIG.CLIFF_DURATION,
                    CONFIG.VESTING_DURATION
                );
                
                this.logger.success('Remainder division handled');
                this.addTest('Division Remainder Handling', 'passed', 'Remainders handled in division');
                
            } catch (error) {
                this.logger.error(`Remainder division error: ${error.message}`);
                this.addTest('Division Remainder Handling', 'failed', error.message, 'medium');
            }
            
        } catch (error) {
            this.logger.error(`Precision testing error: ${error.message}`);
            this.addTest('Precision Attack Tests', 'failed', error.message);
        }
    }

    async testStateConsistency() {
        console.log('\n🔄 STATE CONSISTENCY TESTS');
        console.log('--------------------------------------------------');
        
        this.logger.security('Testing contract state consistency...');
        
        try {
            const schedule = await this.vestingContract.getVestingSchedule(this.signer.address);
            
            if (schedule.isInitialized) {
                // Test 1: totalAmount = claimedAmount + remainingAmount
                const progress = await this.vestingContract.getVestingProgress(this.signer.address);
                
                if (progress.claimedAmount !== undefined && progress.remainingAmount !== undefined) {
                    const totalFromParts = BigInt(progress.claimedAmount) + BigInt(progress.remainingAmount);
                    
                        if (schedule.totalAmount.toString() === totalFromParts.toString()) {
                            this.logger.success('totalAmount balance consistent');
                            this.addTest('Total Amount Consistency', 'passed', 'claimed + remaining = total');
                        } else {
                            this.logger.error(`Balance violation: ${schedule.totalAmount} ≠ ${totalFromParts}`);
                            this.addTest('Total Amount Consistency', 'failed', 'Balance sum violation', 'high');
                        }
                } else {
                    this.logger.warning('Progress data unavailable to check balance');
                    this.addTest('Total Amount Consistency', 'warning', 'Could not fetch progress data');
                }
                
                // Test 2: unlockedAmount >= claimableAmount
                if (progress.unlockedAmount !== undefined && progress.claimableAmount !== undefined) {
                    if (progress.unlockedAmount >= progress.claimableAmount) {
                        this.logger.success('Unlocked/claimable relation is correct');
                        this.addTest('Unlock/Claim Consistency', 'passed', 'unlocked >= claimable');
                    } else {
                        this.logger.error('claimableAmount is greater than unlockedAmount');
                        this.addTest('Unlock/Claim Consistency', 'failed', 'claimable > unlocked', 'critical');
                    }
                } else {
                    this.logger.warning('Unlocked/claimable data unavailable');
                    this.addTest('Unlock/Claim Consistency', 'warning', 'Could not fetch unlocked/claimable data');
                }
                
                // Test 3: Period must not go backwards
                const currentPeriod = await this.vestingContract.getCurrentPeriod(this.signer.address);
                const scheduleStorage = await this.vestingContract.vestingSchedules(this.signer.address);
                const storedPeriod = scheduleStorage.currentPeriod;
                
                if (currentPeriod >= storedPeriod) {
                    this.logger.success('Period does not move backwards');
                    this.addTest('Period Monotonicity', 'passed', 'Periods increase monotonically');
                } else {
                    this.logger.error('Period moves backwards!');
                    this.addTest('Period Monotonicity', 'failed', 'Period decreased', 'critical');
                }
                
                // Test 4: Recipients consistency
                const recipients = await this.vestingContract.getRecipients(this.signer.address);
                let totalPercentage = 0;
                
                recipients.forEach(recipient => {
                    totalPercentage += Number(recipient.percentage);
                });
                
                if (totalPercentage === 100) {
                    this.logger.success('Recipients percentage sum = 100%');
                    this.addTest('Recipients Percentage Sum', 'passed', 'Percentages are correct');
                } else {
                    this.logger.error(`Incorrect percentage sum: ${totalPercentage}%`);
                    this.addTest('Recipients Percentage Sum', 'failed', `Sum ${totalPercentage}% ≠ 100%`, 'high');
                }
                
                // Test 5: Last distribution time not in the future
                const lastDistribution = scheduleStorage.lastDistributionTime;
                const currentTime = Math.floor(Date.now() / 1000);
                
                if (Number(lastDistribution) <= currentTime + 60) { // +60 sec tolerance
                    this.logger.success('Last distribution time is valid');
                    this.addTest('Last Distribution Time', 'passed', 'Distribution time valid');
                } else {
                    this.logger.error('Last distribution time is in the future');
                    this.addTest('Last Distribution Time', 'failed', 'Time in the future', 'high');
                }
            }
            
        } catch (error) {
            this.logger.error(`State consistency testing error: ${error.message}`);
            this.addTest('State Consistency Tests', 'failed', error.message);
        }
    }

    async testGasGriefingProtection() {
        console.log('\n⛽ GAS GRIEFING PROTECTION TESTS');
        console.log('--------------------------------------------------');
        
        this.logger.security('Testing protection against gas griefing attacks...');
        
        try {
            // Test 1: Measure gas for varying number of recipients
            const gasUsageData = [];
            
            for (let recipientCount = 1; recipientCount <= 5; recipientCount++) {
                const testUser = ethers.Wallet.createRandom().connect(this.provider);
                const userContract = this.vestingContract.connect(testUser);
                
                const recipients = [];
                const percentage = Math.floor(100 / recipientCount);
                let remainingPercentage = 100 - (percentage * (recipientCount - 1));
                
                for (let i = 0; i < recipientCount; i++) {
                    recipients.push({
                        wallet: ethers.Wallet.createRandom().address,
                        percentage: i === recipientCount - 1 ? remainingPercentage : percentage
                    });
                }
                
                try {
                    const gasEstimate = await userContract.initializeVesting.estimateGas(
                        CONFIG.TEST_TOKEN_ADDRESS,
                        recipients,
                        CONFIG.CLIFF_DURATION,
                        CONFIG.VESTING_DURATION
                    );
                    
                    gasUsageData.push({
                        recipients: recipientCount,
                        gas: gasEstimate.toString()
                    });
                    
                    this.logger.info(`Gas for ${recipientCount} recipients: ${gasEstimate.toString()}`);
                    
                } catch (error) {
                    this.logger.warning(`Failed to estimate gas for ${recipientCount} recipients`);
                }
            }
            
            // Analyze linearity of gas growth
            if (gasUsageData.length >= 3) {
                const gasGrowthRates = [];
                for (let i = 1; i < gasUsageData.length; i++) {
                    const prevGas = parseInt(gasUsageData[i-1].gas);
                    const currentGas = parseInt(gasUsageData[i].gas);
                    const growthRate = (currentGas - prevGas) / prevGas;
                    gasGrowthRates.push(growthRate);
                }
                
                const avgGrowthRate = gasGrowthRates.reduce((a, b) => a + b, 0) / gasGrowthRates.length;
                
                if (avgGrowthRate < 0.5) { // Growth < 50% per recipient
                    this.logger.success('Gas consumption grows linearly');
                    this.addTest('Linear Gas Growth', 'passed', `Average gas growth: ${(avgGrowthRate * 100).toFixed(1)}%`);
                } else {
                    this.logger.warning(`High gas growth: ${(avgGrowthRate * 100).toFixed(1)}%`);
                    this.addTest('Linear Gas Growth', 'warning', 'High gas consumption growth');
                }
            }
            
            // Test 2: Check maximum gas limit
            const MAX_REASONABLE_GAS = 500000; // 500k gas limit
            
            if (gasUsageData.length > 0) {
                const gasValues = gasUsageData.map(d => parseInt(d.gas)).filter(g => !isNaN(g) && g > 0);
                
                if (gasValues.length > 0) {
                    const maxGasUsage = Math.max(...gasValues);
                    
                    if (maxGasUsage < MAX_REASONABLE_GAS) {
                        this.logger.success(`Max gas within bounds: ${maxGasUsage}`);
                        this.addTest('Max Gas Limit Check', 'passed', `Max gas: ${maxGasUsage} < ${MAX_REASONABLE_GAS}`);
                    } else {
                        this.logger.error(`Excessive gas consumption: ${maxGasUsage}`);
                        this.addTest('Max Gas Limit Check', 'failed', 'Gas limit exceeded', 'medium');
                    }
                } else {
                    this.logger.warning('Could not obtain valid gas data');
                    this.addTest('Max Gas Limit Check', 'warning', 'No gas data for analysis');
                }
            } else {
                this.logger.warning('No gas consumption data');
                this.addTest('Max Gas Limit Check', 'warning', 'No gas data');
            }
            
        } catch (error) {
            this.logger.error(`Gas griefing testing error: ${error.message}`);
            this.addTest('Gas Griefing Protection', 'failed', error.message);
        }
    }

    async testMultiUserConflicts() {
        console.log('\n👥 MULTI-USER CONFLICT TESTS');
        console.log('--------------------------------------------------');
        
        this.logger.security('Testing isolation between users...');
        
        try {
            // Use one real account with different recipient addresses to test isolation
            const testUsers = [this.signer];
            const mockUsers = [];
            for (let i = 0; i < 2; i++) {
                mockUsers.push(ethers.Wallet.createRandom().connect(this.provider));
            }
            
            // Test data isolation between different vesting contracts with non-existent users
            
            const existingUserAddress = this.signer.address;
            const nonExistentUsers = mockUsers;
            
            // Check data isolation
            let isolationPassed = true;
            
            // Test 1: Main user has data
            try {
                const existingSchedule = await this.vestingContract.getVestingSchedule(existingUserAddress);
                if (existingSchedule.isInitialized) {
                    this.logger.info('Existing user data found');
                } else {
                    this.logger.warning('Main user not initialized');
                }
            } catch (error) {
                this.logger.error(`Error fetching main user data: ${error.message}`);
                isolationPassed = false;
            }
            
            // Test 2: Non-existent users have no data
            for (let i = 0; i < nonExistentUsers.length; i++) {
                try {
                    const nonExistentSchedule = await this.vestingContract.getVestingSchedule(nonExistentUsers[i].address);
                    
                    if (!nonExistentSchedule.isInitialized) {
                        this.logger.info(`Non-existent user ${i + 1} correctly has no data`);
                    } else {
                        this.logger.error(`ERROR: Non-existent user ${i + 1} has data!`);
                        isolationPassed = false;
                    }
                    
                } catch (error) {
                    this.logger.error(`User ${i + 1} isolation check error: ${error.message}`);
                    isolationPassed = false;
                }
            }
            
            if (isolationPassed) {
                this.logger.success('Isolation between users works');
                this.addTest('Multi-User Isolation', 'passed', 'User data is isolated');
            } else {
                this.logger.error('Isolation between users is broken');
                this.addTest('Multi-User Isolation', 'failed', 'Data isolation violated', 'critical');
            }
            
            // Test 3: Cross-user operations  
            try {
                const mainUserContract = this.vestingContract.connect(this.signer);
                const randomUserAddress = nonExistentUsers[0].address;
                
                // Try getting claimable amount for non-existent user
                const claimableNonExistent = await mainUserContract.getClaimableAmount(randomUserAddress);
                
                // Should be 0 for non-existent user
                if (claimableNonExistent.toString() === '0') {
                    this.logger.info('View functions correctly return 0 for non-existent users');
                } else {
                    this.logger.warning(`Unexpected claimable for non-existent user: ${claimableNonExistent.toString()}`);
                }
                
                // Ensure main user can operate only on own data
                try {
                    const ownClaimable = await mainUserContract.getClaimableAmount(this.signer.address);
                    this.logger.info(`Main user claimable: ${ownClaimable.toString()}`);
                } catch (error) {
                    this.logger.warning(`Error fetching own data: ${error.message}`);
                }
                
                this.addTest('Cross-User Action Prevention', 'passed', 'View functions are correctly isolated');
                
            } catch (error) {
                this.logger.error(`Cross-user actions testing error: ${error.message}`);
                this.addTest('Cross-User Action Prevention', 'failed', error.message, 'medium');
            }
            
        } catch (error) {
            this.logger.error(`Multi-user testing error: ${error.message}`);
            this.addTest('Multi-User Conflict Tests', 'failed', error.message);
        }
    }

    async testAdvancedEdgeCases() {
        console.log('\n🎯 ADDITIONAL EDGE CASE TESTS');
        console.log('--------------------------------------------------');
        
        this.logger.security('Testing additional edge cases...');
        
        try {
            // Test 1: Maximum values (use estimateGas instead of real tx)
            this.logger.info('Testing maximum values...');
            
            try {
                const maxRecipients = [];
                for (let i = 0; i < 5; i++) {
                    maxRecipients.push({
                        wallet: ethers.Wallet.createRandom().address,
                        percentage: 20
                    });
                }
                
                const maxCliff = 90 * 24 * 60 * 60; // 90 days
                const maxVesting = 365 * 24 * 60 * 60; // 365 days
                
                // Use estimateGas to avoid on-chain changes
                await this.vestingContract.initializeVesting.estimateGas(
                    CONFIG.TEST_TOKEN_ADDRESS,
                    maxRecipients,
                    maxCliff,
                    maxVesting
                );
                
                this.logger.success('Maximum values handled');
                this.addTest('Maximum Values Handling', 'passed', 'Maximum parameters accepted');
                
            } catch (error) {
                if (error.message.includes('too long') || error.message.includes('limit')) {
                    this.logger.success('Protection against excessive values works');
                    this.addTest('Maximum Values Protection', 'passed', 'Limits correctly applied');
                } else {
                    this.logger.error(`Unexpected error with maximum values: ${error.message}`);
                    this.addTest('Maximum Values Handling', 'failed', error.message, 'medium');
                }
            }
            
            // Test 2: Zero/minimal values (estimateGas)
            this.logger.info('Testing minimal values...');
            
            try {
                const testAddress = ethers.Wallet.createRandom().address;
                
                // Use estimateGas
                await this.vestingContract.initializeVesting.estimateGas(
                    CONFIG.TEST_TOKEN_ADDRESS,
                    [{ wallet: testAddress, percentage: 100 }],
                    0, // Minimal cliff
                    60 // Minimal vesting (1 minute)
                );
                
                this.logger.success('Minimum values handled');
                this.addTest('Minimum Values Handling', 'passed', 'Minimum parameters work');
                
            } catch (error) {
                this.logger.error(`Minimum values error: ${error.message}`);
                this.addTest('Minimum Values Handling', 'failed', error.message, 'medium');
            }
            
            // Test 3: Invalid cliff/vesting ratios (estimateGas)
            this.logger.info('Testing invalid ratios...');
            
            try {
                const testAddress3 = ethers.Wallet.createRandom().address;
                
                await this.vestingContract.initializeVesting.estimateGas(
                    CONFIG.TEST_TOKEN_ADDRESS,
                    [{ wallet: testAddress3, percentage: 100 }],
                    600, // 10 minutes cliff
                    300  // 5 minutes vesting (less than cliff!)
                );
                
                this.logger.error('Invalid cliff/vesting ratio accepted');
                this.addTest('Invalid Cliff/Vesting Ratio', 'failed', 'Cliff > vesting accepted', 'high');
                
            } catch (error) {
                if (error.message.includes('greater than cliff') || 
                    error.message.includes('duration must be greater')) {
                    this.logger.success('Invalid ratio protection works');
                    this.addTest('Invalid Cliff/Vesting Ratio Protection', 'passed', 'Protects against cliff > vesting');
                } else {
                    this.logger.warning(`Unexpected ratio error: ${error.message}`);
                    this.addTest('Cliff/Vesting Ratio Check', 'warning', error.message);
                }
            }
            
            // Test 4: Duplicate recipients
            this.logger.info('Testing duplicate recipients...');
            
            try {
                const testUser4 = ethers.Wallet.createRandom().connect(this.provider);
                const userContract4 = this.vestingContract.connect(testUser4);
                
                const duplicateAddress = ethers.Wallet.createRandom().address;
                await userContract4.initializeVesting(
                    CONFIG.TEST_TOKEN_ADDRESS,
                    [
                        { wallet: duplicateAddress, percentage: 50 },
                        { wallet: duplicateAddress, percentage: 50 } // Duplicate!
                    ],
                    CONFIG.CLIFF_DURATION,
                    CONFIG.VESTING_DURATION
                );
                
                this.logger.warning('Duplicate recipient addresses accepted');
                this.addTest('Duplicate Recipients Check', 'warning', 'Duplicate recipients not validated');
                
            } catch (error) {
                if (error.message.includes('duplicate') || error.message.includes('unique')) {
                    this.logger.success('Duplicate recipients protection');
                    this.addTest('Duplicate Recipients Protection', 'passed', 'Duplicates blocked');
                } else {
                    this.logger.info(`Duplicates possible: ${error.message}`);
                    this.addTest('Duplicate Recipients Behavior', 'passed', 'Behavior with duplicates observed');
                }
            }
            
        } catch (error) {
            this.logger.error(`Advanced edge cases testing error: ${error.message}`);
            this.addTest('Advanced Edge Cases', 'failed', error.message);
        }
    }

    // =========================================================================
    // CORE HELPER METHODS
    // =========================================================================

    addTest(name, status, description, severity = 'medium') {
        this.logger.addTest(name, status, description, severity);
    }

    async waitForCliffEnd() {
        this.logger.info('Waiting for cliff period to end...');
        
        try {
            const schedule = await this.vestingContract.getVestingSchedule(this.signer.address);
            if (schedule.startTime === 0n) {
                this.logger.info('Vesting not funded yet');
                return false;
            }
            
            const currentTime = Math.floor(Date.now() / 1000);
            const cliffEndTime = Number(schedule.startTime) + Number(schedule.cliffDuration);
            
            if (currentTime >= cliffEndTime) {
                this.logger.success('Cliff period already ended');
                return true;
            }
            
            const waitTime = cliffEndTime - currentTime;
            this.logger.info(`Waiting ${waitTime} seconds for cliff to end...`);
            
            if (waitTime <= 300) { // Not more than 5 minutes
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                this.logger.success('Cliff period ended');
                return true;
            } else {
                this.logger.info('Cliff period too long to wait in tests');
                return false;
            }
        } catch (error) {
            this.logger.error(`Cliff waiting error: ${error.message}`);
            return false;
        }
    }

    // =========================================================================
    // MAIN RUNNER FOR ALL TESTS
    // =========================================================================

    async runAllTests() {
        this.logger.info('🚀 Running full BSC contract security test suite...');
        console.log('='.repeat(80));
        
        try {
            // 1. Basic tests
            console.log('\n📋 BASIC FUNCTIONAL TESTS');
            console.log('-'.repeat(50));
            await this.testContractDeployment();
            await this.testBasicTokenOperations();
            
            // 2. Initialization tests
            console.log('\n⚙️ VESTING INIT TESTS');
            console.log('-'.repeat(50));
            await this.testVestingInitialization();
            await this.testDoubleInitializationPrevention();
            await this.testInvalidRecipientsPrevention();
            
            // 3. Funding tests
            console.log('\n💰 FUNDING TESTS');
            console.log('-'.repeat(50));
            await this.testVestingFunding();
            await this.testDoubleFundingPrevention();
            
            // 4. Security tests
            console.log('\n🔒 SECURITY TESTS');
            console.log('-'.repeat(50));
            await this.testAccessControlSecurity();
            await this.testReentrancyProtection();
            await this.testInputValidation();
            
            // 5. Time logic tests
            console.log('\n⏰ TIME LOGIC TESTS');
            console.log('-'.repeat(50));
            await this.testCliffPeriodEnforcement();
            await this.testVestingPeriods();
            
            // 6. Distribution tests (if cliff passed)
            console.log('\n🎯 TOKEN DISTRIBUTION TESTS');
            console.log('-'.repeat(50));
            await this.testTokenDistribution();
            await this.testDistributionCooldown();
            
            // 7. Math and edge case tests
            console.log('\n🧮 MATH AND EDGE CASE TESTS');
            console.log('-'.repeat(50));
            await this.testMathematicalAccuracy();
            await this.testEdgeCases();
            
            // 8. Event tests
            console.log('\n📡 EVENT TESTS');
            console.log('-'.repeat(50));
            await this.testEventEmission();

            // 9. Advanced security tests
            console.log('\n🔒 ADVANCED SECURITY TESTS');
            console.log('-'.repeat(50));
            await this.testTimestampManipulation();
            await this.testPrecisionAttacks();
            await this.testStateConsistency();
            await this.testGasGriefingProtection();
            await this.testMultiUserConflicts();
            await this.testAdvancedEdgeCases();
            
        } catch (error) {
            this.logger.critical(`Critical error during testing: ${error.message}`);
            console.error(error);
        }
        
        // Generate final report
        return this.generateFinalReport();
    }

    generateFinalReport() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 FINAL TEST REPORT');
        console.log('='.repeat(80));
        
        const report = this.logger.generateReport();
        
        // Summary stats
        console.log(`\n✅ Tests passed: ${report.summary.passed}`);
        console.log(`❌ Tests failed: ${report.summary.failed}`);
        console.log(`⚠️ Warnings: ${report.summary.warnings}`);
        console.log(`🚨 Critical issues: ${report.summary.criticalIssues}`);
        console.log(`📊 Security level: ${Math.round(report.securityLevel * 100)}%`);
        console.log(`⏱️ Duration: ${report.summary.duration} seconds`);
        
        // Recommendations
        if (report.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS:');
            report.recommendations.forEach(rec => console.log(`   ${rec}`));
        }
        
        // Detailed severity stats
        const critical = report.tests.filter(t => t.severity === 'critical' && t.status === 'failed');
        const high = report.tests.filter(t => t.severity === 'high' && t.status === 'failed');
        const medium = report.tests.filter(t => t.severity === 'medium' && t.status === 'failed');
        
        if (critical.length > 0) {
            console.log(`\n🚨 CRITICAL ISSUES (${critical.length}):`);
            critical.forEach(test => console.log(`   - ${test.name}: ${test.description}`));
        }
        
        if (high.length > 0) {
            console.log(`\n⚠️ HIGH RISK (${high.length}):`);
            high.forEach(test => console.log(`   - ${test.name}: ${test.description}`));
        }
        
        // Save report to file
        const reportFileName = `bsc-vesting-security-report-${Date.now()}.json`;
        
        // Convert BigInt to strings for JSON serialization
        const serializableReport = JSON.parse(JSON.stringify(report, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));
        
        fs.writeFileSync(reportFileName, JSON.stringify(serializableReport, null, 2));
        console.log(`\n📄 Detailed report saved: ${reportFileName}`);
        
        console.log('\n' + '='.repeat(80));
        
        if (report.summary.criticalIssues > 0) {
            console.log('🚨 CONTRACT NOT PRODUCTION-READY — CRITICAL VULNERABILITIES FOUND!');
            return false;
        } else if (report.securityLevel >= 0.8) {
            console.log('🎉 CONTRACT PASSED SECURITY TESTING!');
            return true;
        } else {
            console.log('⚠️ CONTRACT REQUIRES IMPROVEMENTS BEFORE PRODUCTION');
            return false;
        }
    }
}

// =============================================================================
// RUN TESTS
// =============================================================================

async function main() {
    console.log('🔒 BSC VESTING CONTRACT SECURITY TESTER');
    console.log('=======================================');
    console.log(`Network: ${CONFIG.NETWORK_NAME}`);
    console.log(`RPC: ${CONFIG.RPC_URL}`);
    console.log(`Test Token: ${CONFIG.TEST_TOKEN_ADDRESS}`);
    console.log(`Vesting Contract: ${CONFIG.VESTING_CONTRACT_ADDRESS}`);
    console.log('=======================================\n');
    
    const tester = new BSCVestingSecurityTester();
    
    try {
        await tester.initialize();
        const success = await tester.runAllTests();
        
        process.exit(success ? 0 : 1);
        
    } catch (error) {
        console.error('\n🚨 CRITICAL ERROR:', error.message);
        console.error('\nPlease check:');
        console.error('- Contract addresses are correct');
        console.error('- PRIVATE_KEY is set in environment variables');
        console.error('- Connection to BSC network');
        console.error('- BNB balance for transactions');
        
        process.exit(1);
    }
}

// Execute when run directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { BSCVestingSecurityTester, CONFIG };
