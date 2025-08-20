/**
 * Script 1: Initialize Vesting Contract (Updated for secure version)
 * This script initializes a new vesting contract with recipients and schedule
 */

const {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SYSVAR_RENT_PUBKEY,
} = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// ================== CONFIGURATION ==================
const CONFIG = {
    RPC_URL: 'https://api.devnet.solana.com',
    PROGRAM_ID: 'BQvY9rrQ4VVbWwxpoHf8i2dG6uSAACgnNpxCpQC7NRLG',
    MINT_ADDRESS: 'CaYYqEzktvpPXkqpFeUGrs5kt6QDk7vmnb5GVzydDJJb',

    // ✅ Обновленные лимиты безопасности
    CLIFF_PERIOD: 0,        // No cliff period for testing
    VESTING_PERIOD: 1200,   // 20 minutes total (1200 seconds) - в пределах лимита
    TGE_PERCENTAGE: 0,      // No TGE, using step-based vesting
    
    // Recipients configuration
    RECIPIENTS: [
        { wallet: '7Nuz5oH3xQE2ksiJ84GJXvQJBcZzjfSmci6RmkJHZFAx', percentage: 10 },
        { wallet: '9sRRkYzseywA5zjLd2tqZLAgNgK6X4MVbagrNTmM8jAw', percentage: 20 },
        { wallet: 'CiK1qipeLb4PuTbSUHLAocYqiSwR5TXPgWmBurFwzQFG', percentage: 30 },
        { wallet: '5ZrKZrma1wy89ti3d5vDFkcdQYkdJmFwLh1X9ATGCyFq', percentage: 20 },
        { wallet: '7TxxvoicMwKPRu1yxDPQrpQDZdV89T4LNc44byCT9aP3', percentage: 20 },
    ],

    // Keypair paths
    INITIALIZER_KEYPAIR_PATH: '/home/ssofixd/.config/solana/id.json',
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
 * ✅ Обновленная валидация безопасности
 */
function validateSecurityLimits(cliffPeriod, vestingPeriod, recipients) {
    const MAX_VESTING_DURATION = 365 * 24 * 60 * 60; // 1 год
    const MAX_CLIFF_DURATION = 90 * 24 * 60 * 60;    // 90 дней
    
    if (vestingPeriod > MAX_VESTING_DURATION) {
        throw new Error(`Vesting period too long: ${vestingPeriod} > ${MAX_VESTING_DURATION} seconds`);
    }
    
    if (cliffPeriod > MAX_CLIFF_DURATION) {
        throw new Error(`Cliff period too long: ${cliffPeriod} > ${MAX_CLIFF_DURATION} seconds`);
    }
    
    if (cliffPeriod >= vestingPeriod) {
        throw new Error('Cliff period must be less than vesting period');
    }
    
    if (recipients.length > 10) {
        throw new Error('Maximum 10 recipients allowed');
    }
    
    const totalPercentage = recipients.reduce((sum, r) => sum + r.percentage, 0);
    if (totalPercentage !== 100) {
        throw new Error(`Total percentage must be 100, got ${totalPercentage}`);
    }
    
    // Проверка на дубликаты
    const uniqueWallets = new Set(recipients.map(r => r.wallet));
    if (uniqueWallets.size !== recipients.length) {
        throw new Error('Duplicate recipient wallets not allowed');
    }
    
    console.log('✅ Security validation passed');
}

/**
 * Create initialization instruction data
 */
function createInitializeInstructionData(recipients, cliffPeriod, vestingPeriod, tgePercentage) {
    // ✅ Валидация безопасности
    validateSecurityLimits(cliffPeriod, vestingPeriod, recipients);

    // Calculate data size: 1 (instruction) + 1 (count) + 8 (cliff) + 8 (vesting) + 1 (tge) + recipients * 33
    const dataSize = 19 + (recipients.length * 33);
    const data = Buffer.alloc(dataSize);
    
    // Pack instruction data
    let offset = 0;
    data[offset++] = 0; // InitializeVesting instruction
    data[offset++] = recipients.length;
    
    // Pack schedule parameters
    data.writeBigInt64LE(BigInt(cliffPeriod), offset);
    offset += 8;
    data.writeBigInt64LE(BigInt(vestingPeriod), offset);
    offset += 8;
    data[offset++] = tgePercentage;
    
    // Pack recipients
    for (const recipient of recipients) {
        const pubkey = new PublicKey(recipient.wallet);
        data.set(pubkey.toBuffer(), offset);
        offset += 32;
        data[offset++] = recipient.percentage;
    }
    
    return data;
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
 * Save PDA addresses to file for use in other scripts
 */
function savePDAAddresses(vestingPDA, vaultPDA, initializer) {
    const pdaData = {
        vestingPDA: vestingPDA.toBase58(),
        vaultPDA: vaultPDA.toBase58(),
        initializer: initializer.toBase58(), // ✅ Сохраняем инициатора для безопасности
        timestamp: new Date().toISOString(),
    };
    
    const pdaPath = './vesting_pda.json';
    fs.writeFileSync(pdaPath, JSON.stringify(pdaData, null, 2));
    console.log(`\nPDA addresses saved to ${pdaPath}`);
}

// ================== MAIN FUNCTION ==================

async function initializeVesting() {
    console.log('========================================');
    console.log('  SECURE VESTING CONTRACT INITIALIZATION');
    console.log('========================================\n');
    
    try {
        // Load configuration
        const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
        const programId = new PublicKey(CONFIG.PROGRAM_ID);
        const mintAddress = new PublicKey(CONFIG.MINT_ADDRESS);
        
        // Load initializer keypair
        console.log('Loading initializer keypair...');
        const initializer = loadKeypair(CONFIG.INITIALIZER_KEYPAIR_PATH);
        console.log('Initializer:', initializer.publicKey.toBase58());
        
        // Check initializer balance
        const balance = await connection.getBalance(initializer.publicKey);
        console.log('Initializer balance:', balance / 1e9, 'SOL');
        
        if (balance < 0.01 * 1e9) {
            throw new Error('Insufficient SOL balance for initialization (need at least 0.01 SOL)');
        }
        
        // Verify program exists
        const programInfo = await connection.getAccountInfo(programId);
        if (!programInfo) {
            throw new Error('Program not found on network. Please deploy the program first.');
        }
        
        // Verify mint exists
        const mintInfo = await connection.getAccountInfo(mintAddress);
        if (!mintInfo) {
            throw new Error('Mint address not found on network.');
        }
        
        // Derive PDA addresses
        console.log('\nDeriving PDA addresses...');
        const [vestingPDA, vestingBump] = await PublicKey.findProgramAddress(
            [Buffer.from('vesting'), initializer.publicKey.toBuffer()],
            programId
        );
        const [vaultPDA, vaultBump] = await PublicKey.findProgramAddress(
            [Buffer.from('vault'), vestingPDA.toBuffer()],
            programId
        );
        
        console.log('Vesting PDA:', vestingPDA.toBase58());
        console.log('Vault PDA:', vaultPDA.toBase58());
        console.log('Vesting Bump:', vestingBump);
        console.log('Vault Bump:', vaultBump);
        
        // Check if already initialized
        const existingVesting = await connection.getAccountInfo(vestingPDA);
        if (existingVesting) {
            console.log('\n⚠️  Warning: Vesting PDA already exists!');
            
            // ✅ Парсим с новой структурой
            const vestingData = parseVestingAccount(existingVesting.data);
            console.log('Vesting details:');
            console.log('  - Initialized:', vestingData.isInitialized);
            console.log('  - Finalized:', vestingData.isFinalized);
            console.log('  - Start time:', vestingData.startTime === 0 ? 'Not funded' : new Date(vestingData.startTime * 1000).toISOString());
            console.log('  - Recipients:', vestingData.recipientCount);
            
            console.log('Saving existing PDA addresses...');
            savePDAAddresses(vestingPDA, vaultPDA, initializer.publicKey);
            return;
        }
        
        // Display vesting configuration
        console.log('\n📋 Secure Vesting Configuration:');
        console.log('  Cliff Period:', CONFIG.CLIFF_PERIOD, 'seconds');
        console.log('  Vesting Period:', CONFIG.VESTING_PERIOD, 'seconds (20 minutes)');
        console.log('  TGE Percentage:', CONFIG.TGE_PERCENTAGE, '%');
        console.log('\n🔒 Security Features:');
        console.log('  - No emergency withdraw functions');
        console.log('  - Only initializer can distribute tokens');
        console.log('  - Contract finalizes after funding');
        console.log('  - 1-minute cooldown between distributions');
        
        console.log('\n👥 Recipients:');
        CONFIG.RECIPIENTS.forEach((r, i) => {
            console.log(`  ${i + 1}. ${r.wallet.substring(0, 8)}...${r.wallet.substring(36)}: ${r.percentage}%`);
        });
        
        // Create initialization instruction
        console.log('\n🔨 Creating secure initialization instruction...');
        const instructionData = createInitializeInstructionData(
            CONFIG.RECIPIENTS,
            CONFIG.CLIFF_PERIOD,
            CONFIG.VESTING_PERIOD,
            CONFIG.TGE_PERCENTAGE
        );
        
        const initInstruction = new TransactionInstruction({
            programId: programId,
            keys: [
                { pubkey: initializer.publicKey, isSigner: true, isWritable: true },
                { pubkey: vestingPDA, isSigner: false, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: mintAddress, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            ],
            data: instructionData,
        });
        
        // Create and send transaction
        console.log('\n📤 Sending transaction...');
        const transaction = new Transaction().add(initInstruction);
        
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
        
        console.log('\n✅ Secure vesting contract initialized successfully!');
        console.log('Transaction signature:', signature);
        console.log('View on Solana Explorer:');
        console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        
        // Save PDA addresses for other scripts
        savePDAAddresses(vestingPDA, vaultPDA, initializer.publicKey);
        
        // Display next steps
        console.log('\n📌 Next Steps:');
        console.log('1. Fund the vesting contract using 2_fund_vesting.js');
        console.log('2. Use 3_distribute_tokens.js (only initializer can run this)');
        console.log('\n🔒 Security Notes:');
        console.log('- After funding, contract parameters cannot be changed');
        console.log('- Only the initializer can distribute tokens to recipients');
        console.log('- No emergency functions - tokens follow vesting schedule strictly');
        
    } catch (error) {
        console.error('\n❌ Error initializing secure vesting contract:', error.message);
        if (error.logs) {
            console.error('Transaction logs:', error.logs);
        }
        process.exit(1);
    }
}

// Run the initialization
initializeVesting().then(() => {
    console.log('\n✨ Secure initialization script completed');
}).catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
});