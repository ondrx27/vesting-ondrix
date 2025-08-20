/**
 * Script 2: Fund Vesting Contract (Updated for secure version)
 * This script funds an initialized vesting contract with tokens
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
    PROGRAM_ID: 'BQvY9rrQ4VVbWwxpoHf8i2dG6uSAACgnNpxCpQC7NRLG',
    MINT_ADDRESS: 'CaYYqEzktvpPXkqpFeUGrs5kt6QDk7vmnb5GVzydDJJb',
    
    // Amount to fund (with 9 decimals)
    FUND_AMOUNT: 1000 * 1e9, // 1000 tokens
    
    // Keypair paths
    FUNDER_KEYPAIR_PATH: '/home/ssofixd/.config/solana/id.json',
    
    // PDA file (created by initialization script)
    PDA_FILE_PATH: './vesting_pda.json',
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
        initializer: pdaData.initializer ? new PublicKey(pdaData.initializer) : null, // ✅ Загружаем инициатора
    };
}

/**
 * ✅ Обновленный парсер вестинг аккаунта (с новыми полями)
 */
function parseVestingAccount(data) {
    if (!data || data.length < 141) { // ✅ Обновленный минимальный размер
        throw new Error('Invalid vesting account data');
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
        isFinalized: data[132] === 1,        // ✅ Новое поле
        lastDistributionTime: Number(data.readBigInt64LE(133)), // ✅ Новое поле
    };
}

/**
 * Format token amount for display
 */
function formatTokenAmount(amount, decimals = 9) {
    return (amount / Math.pow(10, decimals)).toLocaleString();
}

/**
 * ✅ Проверка безопасности фандинга
 */
function validateFundingSecurity(vestingData, funder) {
    if (!vestingData.isInitialized) {
        throw new Error('Vesting account is not initialized');
    }
    
    if (vestingData.startTime !== 0) {
        throw new Error('Vesting already funded and finalized');
    }
    
    if (vestingData.isFinalized) {
        throw new Error('Vesting is already finalized');
    }
    
    console.log('✅ Funding security validation passed');
}

// ================== MAIN FUNCTION ==================

async function fundVesting() {
    console.log('========================================');
    console.log('    SECURE VESTING CONTRACT FUNDING');
    console.log('========================================\n');
    
    try {
        // Load configuration
        const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const mintAddress = new PublicKey(CONFIG.MINT_ADDRESS);
        
        // Load funder keypair
        console.log('Loading funder keypair...');
        const funder = loadKeypair(CONFIG.FUNDER_KEYPAIR_PATH);
        console.log('Funder:', funder.publicKey.toBase58());
        
        // Load PDA addresses
        console.log('\nLoading PDA addresses...');
        const { vestingPDA, vaultPDA, initializer } = loadPDAAddresses();
        console.log('Vesting PDA:', vestingPDA.toBase58());
        console.log('Vault PDA:', vaultPDA.toBase58());
        if (initializer) {
            console.log('Original Initializer:', initializer.toBase58());
        }
        
        // Check vesting account status
        console.log('\n📊 Checking secure vesting account status...');
        const vestingAccountInfo = await connection.getAccountInfo(vestingPDA);
        if (!vestingAccountInfo) {
            throw new Error('Vesting account not found. Please run initialization script first.');
        }
        
        const vestingData = parseVestingAccount(vestingAccountInfo.data);
        console.log('Vesting initialized:', vestingData.isInitialized);
        console.log('Vesting finalized:', vestingData.isFinalized);
        console.log('Recipient count:', vestingData.recipientCount);
        console.log('Vesting period:', vestingData.vestingPeriod, 'seconds');
        console.log('Is revoked:', vestingData.isRevoked);
        
        // ✅ Проверка безопасности
        validateFundingSecurity(vestingData, funder);
        
        if (vestingData.startTime !== 0) {
            console.log('\n⚠️  Warning: Vesting already funded and finalized!');
            console.log('Start time:', new Date(vestingData.startTime * 1000).toISOString());
            console.log('Total amount:', formatTokenAmount(vestingData.totalAmount), 'tokens');
            console.log('Finalized:', vestingData.isFinalized);
            console.log('Last distribution:', vestingData.lastDistributionTime === 0 ? 'Never' : new Date(vestingData.lastDistributionTime * 1000).toISOString());
            return;
        }
        
        // Get funder's token account
        console.log('\n💰 Checking funder token balance...');
        const funderATA = await getAssociatedTokenAddress(
            mintAddress,
            funder.publicKey
        );
        console.log('Funder ATA:', funderATA.toBase58());
        
        // Check if ATA exists and has sufficient balance
        let tokenBalance = BigInt(0);
        try {
            const tokenAccount = await getAccount(connection, funderATA);
            tokenBalance = tokenAccount.amount;
            console.log('Token balance:', formatTokenAmount(Number(tokenBalance)), 'tokens');
        } catch (error) {
            console.log('❌ Funder token account does not exist or has no tokens');
            throw new Error('Please ensure funder has tokens before running this script');
        }
        
        if (tokenBalance < BigInt(CONFIG.FUND_AMOUNT)) {
            throw new Error(`Insufficient token balance. Need ${formatTokenAmount(CONFIG.FUND_AMOUNT)} tokens`);
        }
        
        // Check SOL balance for fees
        const solBalance = await connection.getBalance(funder.publicKey);
        console.log('SOL balance:', solBalance / 1e9, 'SOL');
        
        if (solBalance < 0.002 * 1e9) {
            throw new Error('Insufficient SOL balance for transaction fees (need at least 0.002 SOL)');
        }
        
        // Create fund instruction data
        console.log('\n🔨 Creating secure fund instruction...');
        console.log('Amount to fund:', formatTokenAmount(CONFIG.FUND_AMOUNT), 'tokens');
        console.log('⚠️  After funding, contract will be FINALIZED (no more changes possible)');
        
        const fundData = Buffer.alloc(9);
        fundData[0] = 1; // Fund instruction
        fundData.writeBigUInt64LE(BigInt(CONFIG.FUND_AMOUNT), 1);
        
        // Create fund instruction
        const fundInstruction = new TransactionInstruction({
            programId: programId,
            keys: [
                { pubkey: funder.publicKey, isSigner: true, isWritable: true },
                { pubkey: funderATA, isSigner: false, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: vestingPDA, isSigner: false, isWritable: true },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
            ],
            data: fundData,
        });
        
        // Create transaction with compute budget
        console.log('\n📤 Sending secure funding transaction...');
        const transaction = new Transaction().add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
            fundInstruction
        );
        
        // Get recent blockhash
        const { blockhash } = await connection.getRecentBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = funder.publicKey;
        
        // Sign and send
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [funder],
            {
                commitment: 'confirmed',
                preflightCommitment: 'confirmed',
            }
        );
        
        console.log('\n✅ Secure vesting contract funded successfully!');
        console.log('🔒 Contract is now FINALIZED - no more parameter changes possible');
        console.log('Transaction signature:', signature);
        console.log('View on Solana Explorer:');
        console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        
        // Verify funding
        console.log('\n🔍 Verifying secure funding...');
        const updatedVestingInfo = await connection.getAccountInfo(vestingPDA);
        const updatedVestingData = parseVestingAccount(updatedVestingInfo.data);
        
        console.log('Start time:', new Date(updatedVestingData.startTime * 1000).toISOString());
        console.log('Total amount:', formatTokenAmount(updatedVestingData.totalAmount), 'tokens');
        console.log('Finalized:', updatedVestingData.isFinalized);
        console.log('Original initializer:', updatedVestingData.initializer.toBase58());
        
        // Display vesting schedule
        console.log('\n📅 Secure Vesting Schedule:');
        console.log('  0-5 minutes: 10% unlocked');
        console.log('  5-10 minutes: 20% unlocked');
        console.log('  10-15 minutes: 50% unlocked');
        console.log('  15-20 minutes: 100% unlocked');
        
        // Calculate unlock times
        const startTimestamp = updatedVestingData.startTime;
        console.log('\n⏰ Unlock Times:');
        console.log('  10% unlocks at:', new Date((startTimestamp + 0) * 1000).toLocaleString());
        console.log('  20% unlocks at:', new Date((startTimestamp + 300) * 1000).toLocaleString());
        console.log('  50% unlocks at:', new Date((startTimestamp + 600) * 1000).toLocaleString());
        console.log('  100% unlocks at:', new Date((startTimestamp + 900) * 1000).toLocaleString());
        
        // Save funding info
        const fundingInfo = {
            fundedAt: new Date().toISOString(),
            startTime: updatedVestingData.startTime,
            totalAmount: CONFIG.FUND_AMOUNT,
            funder: funder.publicKey.toBase58(),
            initializer: updatedVestingData.initializer.toBase58(),
            isFinalized: updatedVestingData.isFinalized,
        };
        
        const fundingPath = './vesting_funding.json';
        fs.writeFileSync(fundingPath, JSON.stringify(fundingInfo, null, 2));
        console.log(`\nFunding info saved to ${fundingPath}`);
        
        console.log('\n📌 Next Steps:');
        console.log('🔒 SECURITY IMPORTANT:');
        console.log('- Only the ORIGINAL INITIALIZER can distribute tokens');
        console.log(`- Initializer address: ${updatedVestingData.initializer.toBase58()}`);
        console.log('- Use 3_distribute_tokens.js script (must be run by initializer)');
        console.log('- Recipients CANNOT claim tokens themselves');
        console.log('- No emergency functions - tokens follow vesting schedule strictly');
        console.log('- 1-minute cooldown between distributions for security');
        
    } catch (error) {
        console.error('\n❌ Error funding secure vesting contract:', error.message);
        if (error.logs) {
            console.error('Transaction logs:', error.logs);
        }
        process.exit(1);
    }
}

// Run the funding
fundVesting().then(() => {
    console.log('\n✨ Secure funding script completed');
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});