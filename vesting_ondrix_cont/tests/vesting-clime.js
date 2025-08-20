/**
 * Script 3: Distribute Tokens (Secure Version - Initializer Only)
 * This script allows ONLY the original initializer to distribute vested tokens to recipients
 * Recipients CANNOT claim tokens themselves - only centralised distribution
 */

const {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SYSVAR_CLOCK_PUBKEY,
    ComputeBudgetProgram,
} = require('@solana/web3.js');
const { 
    TOKEN_PROGRAM_ID, 
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount,
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// ================== CONFIGURATION ==================
const CONFIG = {
    RPC_URL: 'https://api.devnet.solana.com',
    PROGRAM_ID: '5Q45ww8uwWsnLpZa8ivFFp6ENfVFHE9yCARTs1CJ3xZB',
    MINT_ADDRESS: 'CaYYqEzktvpPXkqpFeUGrs5kt6QDk7vmnb5GVzydDJJb',
    
    // 🔒 SECURITY: Only the original initializer can run this script
    INITIALIZER_KEYPAIR_PATH: '/home/ssofixd/.config/solana/id.json',
    
    // PDA and funding files
    PDA_FILE_PATH: './vesting_pda.json',
    FUNDING_FILE_PATH: './vesting_funding.json',
    
    // Distribution settings
    AUTO_CREATE_ATA: true, // Automatically create recipient ATAs if they don't exist
};

// ================== HELPER FUNCTIONS ==================

/**
 * Load keypair from file
 */
function loadKeypair(keypairPath) {
    const absolutePath = path.resolve(keypairPath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Keypair file not found: ${absolutePath}`);
    }
    const keypairData = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

/**
 * Load PDA addresses from file
 */
function loadPDAAddresses() {
    const absolutePath = path.resolve(CONFIG.PDA_FILE_PATH);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`PDA file not found: ${absolutePath}. Please run initialization script first.`);
    }
    const pdaData = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return {
        vestingPDA: new PublicKey(pdaData.vestingPDA),
        vaultPDA: new PublicKey(pdaData.vaultPDA),
        originalInitializer: pdaData.initializer ? new PublicKey(pdaData.initializer) : null,
    };
}

/**
 * Load funding info
 */
function loadFundingInfo() {
    const absolutePath = path.resolve(CONFIG.FUNDING_FILE_PATH);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Funding file not found: ${absolutePath}. Please run funding script first.`);
    }
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

/**
 * ✅ Парсер вестинг аккаунта с новыми полями
 */
function parseVestingAccount(data) {
    if (!data || data.length < 141) {
        throw new Error('Invalid vesting account data');
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

/**
 * Calculate vested amount based on time elapsed
 */
function calculateVestedPercentage(elapsedSeconds) {
    if (elapsedSeconds < 0) return 0;
    if (elapsedSeconds < 300) return 10;      // 0-5 minutes: 10%
    if (elapsedSeconds < 600) return 20;      // 5-10 minutes: 20%
    if (elapsedSeconds < 900) return 50;      // 10-15 minutes: 50%
    return 100;                               // 15+ minutes: 100%
}

/**
 * Format token amount for display
 */
function formatTokenAmount(amount, decimals = 9) {
    return (amount / Math.pow(10, decimals)).toLocaleString();
}

/**
 * 🔒 Проверка безопасности - только инициатор может распределять
 */
function validateDistributionSecurity(vestingData, distributorKey, originalInitializer) {
    if (!vestingData.isInitialized) {
        throw new Error('Vesting not initialized');
    }
    
    if (!vestingData.isFinalized) {
        throw new Error('Vesting not finalized - please fund first');
    }
    
    if (vestingData.isRevoked) {
        throw new Error('Vesting has been revoked');
    }
    
    if (vestingData.startTime === 0) {
        throw new Error('Vesting not funded yet');
    }
    
    // 🔒 КРИТИЧЕСКАЯ ПРОВЕРКА: Только оригинальный инициатор
    if (!vestingData.initializer.equals(distributorKey)) {
        throw new Error(`SECURITY ERROR: Only the original initializer can distribute tokens!\nExpected: ${vestingData.initializer.toBase58()}\nProvided: ${distributorKey.toBase58()}`);
    }
    
    // Проверка cooldown (1 минута между распределениями)
    const currentTime = Math.floor(Date.now() / 1000);
    if (vestingData.lastDistributionTime > 0) {
        const timeSinceLastDistribution = currentTime - vestingData.lastDistributionTime;
        if (timeSinceLastDistribution < 60) {
            throw new Error(`Distribution cooldown active. Please wait ${60 - timeSinceLastDistribution} more seconds.`);
        }
    }
    
    console.log('✅ Distribution security validation passed');
}

/**
 * Create recipient ATA if it doesn't exist
 */
async function ensureRecipientATA(connection, mintAddress, recipientPublicKey, payer) {
    const ata = await getAssociatedTokenAddress(mintAddress, recipientPublicKey);
    
    try {
        await getAccount(connection, ata);
        return { ata, needsCreation: false };
    } catch (error) {
        console.log(`  📝 Need to create ATA for ${recipientPublicKey.toBase58()}`);
        return { ata, needsCreation: true };
    }
}

// ================== MAIN FUNCTION ==================

async function distributeTokens() {
    console.log('========================================');
    console.log('  SECURE TOKEN DISTRIBUTION (INITIALIZER ONLY)');
    console.log('========================================\n');
    
    try {
        // Load configuration
        const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const mintAddress = new PublicKey(CONFIG.MINT_ADDRESS);
        
        // 🔒 Load ONLY the initializer keypair
        console.log('🔒 Loading initializer keypair (SECURITY CHECK)...');
        const initializer = loadKeypair(CONFIG.INITIALIZER_KEYPAIR_PATH);
        console.log('Initializer:', initializer.publicKey.toBase58());
        
        // Load PDA addresses and funding info
        console.log('\nLoading contract information...');
        const { vestingPDA, vaultPDA, originalInitializer } = loadPDAAddresses();
        const fundingInfo = loadFundingInfo();
        
        console.log('Vesting PDA:', vestingPDA.toBase58());
        console.log('Vault PDA:', vaultPDA.toBase58());
        if (originalInitializer) {
            console.log('Original Initializer:', originalInitializer.toBase58());
        }
        
        // Get current vesting state
        console.log('\n📊 Checking vesting state...');
        const vestingAccountInfo = await connection.getAccountInfo(vestingPDA);
        if (!vestingAccountInfo) {
            throw new Error('Vesting account not found');
        }
        
        const vestingData = parseVestingAccount(vestingAccountInfo.data);
        
        // 🔒 КРИТИЧЕСКАЯ ПРОВЕРКА БЕЗОПАСНОСТИ
        validateDistributionSecurity(vestingData, initializer.publicKey, originalInitializer);
        
        // Display current status
        console.log('✅ Vesting Status:');
        console.log('  - Initialized:', vestingData.isInitialized);
        console.log('  - Finalized:', vestingData.isFinalized);
        console.log('  - Total Amount:', formatTokenAmount(vestingData.totalAmount), 'tokens');
        console.log('  - Recipients:', vestingData.recipientCount);
        console.log('  - Start Time:', new Date(vestingData.startTime * 1000).toISOString());
        console.log('  - Last Distribution:', vestingData.lastDistributionTime === 0 ? 'Never' : new Date(vestingData.lastDistributionTime * 1000).toISOString());
        
        // Calculate current vesting status
        const currentTime = Math.floor(Date.now() / 1000);
        const elapsedTime = currentTime - vestingData.startTime;
        const vestedPercentage = calculateVestedPercentage(elapsedTime);
        
        console.log('\n⏰ Current Vesting Status:');
        console.log('  - Elapsed Time:', Math.floor(elapsedTime / 60), 'minutes');
        console.log('  - Vested Percentage:', vestedPercentage, '%');
        
        // Calculate distribution amounts for each recipient
        console.log('\n💰 Distribution Calculation:');
        const distributionData = [];
        let totalDistributable = 0;
        
        for (const recipient of vestingData.recipients) {
            const recipientTotalAllocation = (vestingData.totalAmount * recipient.percentage) / 100;
            const vestedAmount = (recipientTotalAllocation * vestedPercentage) / 100;
            const claimableAmount = vestedAmount - recipient.claimedAmount;
            
            distributionData.push({
                wallet: recipient.wallet,
                percentage: recipient.percentage,
                totalAllocation: recipientTotalAllocation,
                vestedAmount,
                claimedAmount: recipient.claimedAmount,
                claimableAmount,
                publicKey: new PublicKey(recipient.wallet),
            });
            
            totalDistributable += claimableAmount;
            
            console.log(`  ${recipient.wallet.substring(0, 8)}...${recipient.wallet.substring(36)}:`);
            console.log(`    - Allocation: ${recipient.percentage}% (${formatTokenAmount(recipientTotalAllocation)} tokens)`);
            console.log(`    - Vested: ${formatTokenAmount(vestedAmount)} tokens`);
            console.log(`    - Claimed: ${formatTokenAmount(recipient.claimedAmount)} tokens`);
            console.log(`    - Claimable: ${formatTokenAmount(claimableAmount)} tokens`);
        }
        
        console.log(`\n📊 Total Distributable: ${formatTokenAmount(totalDistributable)} tokens`);
        
        if (totalDistributable === 0) {
            console.log('\n✅ No tokens available for distribution at this time.');
            console.log('Either all vested tokens have been distributed, or no new tokens have vested yet.');
            return;
        }
        
        // Check SOL balance for fees
        const solBalance = await connection.getBalance(initializer.publicKey);
        console.log('\n💰 Initializer SOL balance:', solBalance / 1e9, 'SOL');
        
        if (solBalance < 0.01 * 1e9) {
            throw new Error('Insufficient SOL balance for transaction fees (need at least 0.01 SOL)');
        }
        
        // Prepare recipient ATAs
        console.log('\n📝 Preparing recipient accounts...');
        const accountsToCreate = [];
        const recipientATAs = [];
        
        for (const recipientData of distributionData) {
            if (recipientData.claimableAmount > 0) {
                const { ata, needsCreation } = await ensureRecipientATA(
                    connection,
                    mintAddress,
                    recipientData.publicKey,
                    initializer.publicKey
                );
                
                recipientATAs.push(ata);
                
                if (needsCreation && CONFIG.AUTO_CREATE_ATA) {
                    accountsToCreate.push(
                        createAssociatedTokenAccountInstruction(
                            initializer.publicKey,
                            ata,
                            recipientData.publicKey,
                            mintAddress
                        )
                    );
                }
            } else {
                recipientATAs.push(null); // Placeholder for recipients with no claimable amount
            }
        }
        
        // Derive vault authority PDA
        const [vaultAuthority] = await PublicKey.findProgramAddress(
            [Buffer.from('authority'), vestingPDA.toBuffer()],
            programId
        );
        
        // Create distribution instruction
        console.log('\n🔨 Creating distribution instruction...');
        const distributionData_instruction = Buffer.alloc(1);
        distributionData_instruction[0] = 2; // Claim/Distribute instruction
        
        // Build accounts array for distribution instruction
        const distributionAccounts = [
            { pubkey: initializer.publicKey, isSigner: true, isWritable: true },
            { pubkey: vestingPDA, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: vaultAuthority, isSigner: false, isWritable: false },
        ];
        
        // Add recipient ATAs
        recipientATAs.forEach(ata => {
            if (ata) {
                distributionAccounts.push({ pubkey: ata, isSigner: false, isWritable: true });
            }
        });
        
        const distributionInstruction = new TransactionInstruction({
            programId: programId,
            keys: distributionAccounts,
            data: distributionData_instruction,
        });
        
        // Create transaction
        console.log('\n📤 Sending distribution transaction...');
        const transaction = new Transaction().add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
            ...accountsToCreate, // Create ATAs if needed
            distributionInstruction
        );
        
        // Get recent blockhash
        const { blockhash } = await connection.getRecentBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = initializer.publicKey;
        
        // Sign and send
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [initializer],
            {
                commitment: 'confirmed',
                preflightCommitment: 'confirmed',
            }
        );
        
        console.log('\n✅ Tokens distributed successfully!');
        console.log('🔒 Only the original initializer could execute this distribution');
        console.log('Transaction signature:', signature);
        console.log('View on Solana Explorer:');
        console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        
        // Verify distribution
        console.log('\n🔍 Verifying distribution...');
        const updatedVestingInfo = await connection.getAccountInfo(vestingPDA);
        const updatedVestingData = parseVestingAccount(updatedVestingInfo.data);
        
        console.log('Updated last distribution time:', new Date(updatedVestingData.lastDistributionTime * 1000).toISOString());
        console.log('Distribution completed by:', updatedVestingData.initializer.toBase58());
        
        // Save distribution log
        const distributionLog = {
            timestamp: new Date().toISOString(),
            distributedBy: initializer.publicKey.toBase58(),
            transactionSignature: signature,
            totalDistributed: totalDistributable,
            vestedPercentage,
            recipients: distributionData.filter(r => r.claimableAmount > 0).map(r => ({
                wallet: r.wallet,
                amount: r.claimableAmount,
                percentage: r.percentage,
            })),
        };
        
        const logPath = `./distribution_log_${Date.now()}.json`;
        fs.writeFileSync(logPath, JSON.stringify(distributionLog, null, 2));
        console.log(`\nDistribution log saved to ${logPath}`);
        
        console.log('\n🔒 Security Summary:');
        console.log('- ✅ Only original initializer could execute this distribution');
        console.log('- ✅ Recipients cannot claim tokens themselves');
        console.log('- ✅ All tokens follow the vesting schedule strictly');
        console.log('- ✅ 1-minute cooldown enforced between distributions');
        console.log('- ✅ No emergency functions available');
        
    } catch (error) {
        console.error('\n❌ Error distributing tokens:', error.message);
        if (error.logs) {
            console.error('Transaction logs:', error.logs);
        }
        process.exit(1);
    }
}

// Run the distribution
distributeTokens().then(() => {
    console.log('\n✨ Secure distribution script completed');
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});