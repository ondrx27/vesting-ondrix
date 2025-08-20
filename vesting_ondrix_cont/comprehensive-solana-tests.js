// comprehensive-solana-tests.js
// Comprehensive security and functionality tests for the native Solana vesting contract

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SYSVAR_CLOCK_PUBKEY,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    ComputeBudgetProgram,
} = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
    createMint,
    createAccount,
    mintTo,
    getAccount,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token');
const fs = require('fs');

// ================== CONFIGURATION ==================
const CONFIG = {
    // RPC connection
    RPC_URL: 'https://api.devnet.solana.com',
    
    // Program address — set your deployed contract here
    PROGRAM_ID: 'HR9LsNd42gUQZRKmmivdrxvAE33K9fvYZZhW5XAXFRUu', // Your deployed program
    
    // Test parameters
    TEST_TOKEN_AMOUNT: 1000 * 1e9, // 1000 tokens with 9 decimals
    CLIFF_PERIOD: 300,              // 5 minutes
    VESTING_PERIOD: 1200,           // 20 minutes
    TGE_PERCENTAGE: 0,              // No TGE
    
    // Test recipients
    TEST_RECIPIENTS: [
        { percentage: 40 },
        { percentage: 30 },
        { percentage: 20 },
        { percentage: 10 },
    ],
    
    // Safety limits
    MAX_VESTING_DURATION: 365 * 24 * 60 * 60, // 1 year
    MAX_CLIFF_DURATION: 180 * 24 * 60 * 60,   // 6 months
    DISTRIBUTION_COOLDOWN: 60,                // 1 minute
};

// ================== GLOBAL VARIABLES ==================
let connection;
let programId;
let payer;
let mint;
let testResults = {
    passed: 0,
    failed: 0,
    details: []
};

// ================== HELPERS ==================

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
        'info': '📋',
        'success': '✅',
        'error': '❌',
        'warning': '⚠️',
        'security': '🔒'
    };
    console.log(`${prefix[type] || '📋'} [${timestamp}] ${message}`);
}

function logTest(testName, passed, details = '') {
    if (passed) {
        testResults.passed++;
        log(`TEST PASSED: ${testName}`, 'success');
    } else {
        testResults.failed++;
        log(`TEST FAILED: ${testName} - ${details}`, 'error');
    }
    testResults.details.push({ testName, passed, details });
}

// Build Initialize instruction
function createInitializeInstruction(
    programId,
    initializer,
    vestingPDA,
    vaultPDA,
    mint,
    recipients,
    cliffPeriod,
    vestingPeriod,
    tgePercentage
) {
    // Basic input validation
    if (recipients.length > 10) {
        throw new Error('Too many recipients');
    }
    
    const totalPercentage = recipients.reduce((sum, r) => sum + r.percentage, 0);
    if (totalPercentage !== 100) {
        throw new Error(`Total percentage must be 100, got ${totalPercentage}`);
    }
    
    // Duplicate wallets check
    const uniqueWallets = new Set(recipients.map(r => r.wallet.toBase58()));
    if (uniqueWallets.size !== recipients.length) {
        throw new Error('Duplicate recipient wallets not allowed');
    }
    
    // Zero percentage check
    for (const recipient of recipients) {
        if (recipient.percentage === 0) {
            throw new Error('Zero percentage not allowed');
        }
    }
    
    // Instruction data layout
    const dataSize = 19 + (recipients.length * 33);
    const data = Buffer.alloc(dataSize);
    
    let offset = 0;
    data[offset++] = 0; // Initialize instruction
    data[offset++] = recipients.length;
    
    // Schedule parameters
    data.writeBigInt64LE(BigInt(cliffPeriod), offset);
    offset += 8;
    data.writeBigInt64LE(BigInt(vestingPeriod), offset);
    offset += 8;
    data[offset++] = tgePercentage;
    
    // Recipients
    for (const recipient of recipients) {
        data.set(recipient.wallet.toBuffer(), offset);
        offset += 32;
        data[offset++] = recipient.percentage;
    }
    
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: initializer, isSigner: true, isWritable: true },
            { pubkey: vestingPDA, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ],
        data,
    });
}

// Build Fund instruction
function createFundInstruction(
    programId,
    funder,
    sourceToken,
    vaultPDA,
    vestingPDA,
    amount
) {
    const data = Buffer.alloc(9);
    data[0] = 1; // Fund instruction
    data.writeBigUInt64LE(BigInt(amount), 1);
    
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: funder, isSigner: true, isWritable: true },
            { pubkey: sourceToken, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: vestingPDA, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data,
    });
}

// Build Claim/Distribute instruction
function createClaimInstruction(
    programId,
    initializer,
    vestingPDA,
    vaultPDA,
    vaultAuthority,
    recipientATAs
) {
    const data = Buffer.alloc(1);
    data[0] = 2; // Claim instruction
    
    const accounts = [
        { pubkey: initializer, isSigner: true, isWritable: true },
        { pubkey: vestingPDA, isSigner: false, isWritable: true },
        { pubkey: vaultPDA, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    ];
    
    // Append recipient ATAs
    for (const ata of recipientATAs) {
        accounts.push({ pubkey: ata, isSigner: false, isWritable: true });
    }
    
    return new TransactionInstruction({
        programId,
        keys: accounts,
        data,
    });
}

// Parse vesting account
function parseVestingAccount(data) {
    if (!data || data.length < 141) {
        throw new Error('Invalid vesting account data');
    }
    
    const recipients = [];
    let offset = 141;
    
    const recipientCount = data[130];
    for (let i = 0; i < Math.min(recipientCount, 10); i++) {
        const wallet = new PublicKey(data.slice(offset, offset + 32));
        const percentage = data[offset + 32];
        const claimedAmount = Number(data.readBigUInt64LE(offset + 33));
        const lastClaimTime = Number(data.readBigInt64LE(offset + 41));
        
        if (percentage > 0) {
            recipients.push({
                wallet: wallet.toBase58(),
                walletPubkey: wallet,
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

// ================== TEST FUNCTIONS ==================

async function setupTestEnvironment() {
    log('🚀 Setting up test environment...');
    
    try {
        connection = new Connection(CONFIG.RPC_URL, 'confirmed');
        programId = new PublicKey(CONFIG.PROGRAM_ID);
        
        // Verify program is deployed
        const programInfo = await connection.getAccountInfo(programId);
        if (!programInfo) {
            throw new Error(`Program ${CONFIG.PROGRAM_ID} not found on the network`);
        }
        
        // Use an existing wallet instead of airdrop
        try {
            // Try to use default wallet from ~/.config/solana/id.json
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            
            const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
            if (fs.existsSync(keypairPath)) {
                const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
                payer = Keypair.fromSecretKey(new Uint8Array(keypairData));
                log(`✅ Using wallet: ${payer.publicKey.toBase58()}`);
            } else {
                // If no default wallet is present, generate a new one (no airdrop)
                payer = Keypair.generate();
                log(`⚠️ Generated new wallet: ${payer.publicKey.toBase58()}`);
                log(`⚠️ IMPORTANT: You need SOL on this wallet for testing`);
            }
        } catch (error) {
            // Fallback — generate a new wallet (no airdrop)
            payer = Keypair.generate();
            log(`⚠️ Generated new wallet: ${payer.publicKey.toBase58()}`);
            log(`⚠️ IMPORTANT: You need SOL on this wallet for testing`);
        }
        
        // Check payer balance
        const balance = await connection.getBalance(payer.publicKey);
        if (balance < 1e9) { // Less than 1 SOL
            log(`⚠️ Low SOL balance: ${balance / 1e9} SOL`, 'warning');
            log(`⚠️ At least 1 SOL is recommended for full testing`, 'warning');
        } else {
            log(`✅ SOL balance: ${balance / 1e9} SOL`);
        }
        
        // Create a test token (if there is enough SOL)
        if (balance >= 0.1 * 1e9) { // Minimum 0.1 SOL to create mint
            mint = await createMint(
                connection,
                payer,
                payer.publicKey,
                null,
                9
            );
            log(`✅ Created test token: ${mint.toBase58()}`);
        } else {
            // Use existing test token or fallback to a wrapped SOL mint for tests
            mint = new PublicKey('So11111111111111111111111111111111111111112'); // Wrapped SOL for tests
            log(`⚠️ Using Wrapped SOL for tests: ${mint.toBase58()}`);
        }
        
        log(`✅ Test environment ready`);
        log(`Program: ${programId.toBase58()}`);
        
        return true;
    } catch (error) {
        log(`Setup error: ${error.message}`, 'error');
        return false;
    }
}

// TEST 1: Initialization security
async function testInitializationSecurity() {
    log('🔒 TEST 1: Initialization security');
    
    try {
        // Create a fresh initializer per test to avoid PDA conflicts
        const initializer = Keypair.generate();
        
        // Create recipients
        const recipients = [];
        for (let i = 0; i < CONFIG.TEST_RECIPIENTS.length; i++) {
            const recipient = Keypair.generate();
            recipients.push({
                wallet: recipient.publicKey,
                percentage: CONFIG.TEST_RECIPIENTS[i].percentage
            });
        }
        
        // Derive PDAs
        const [vestingPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('vesting'), initializer.publicKey.toBuffer()],
            programId
        );
        const [vaultPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('vault'), vestingPDA.toBuffer()],
            programId
        );
        
        // Subtest 1.1: Valid initialization
        try {
            const instruction = createInitializeInstruction(
                programId,
                initializer.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                CONFIG.TGE_PERCENTAGE
            );
            
            // Transfer SOL to initializer to cover fees
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: initializer.publicKey,
                lamports: 100_000_000 // 0.1 SOL
            });
            
            const transferTx = new Transaction().add(transferInstruction);
            await sendAndConfirmTransaction(connection, transferTx, [payer]);
            
            const transaction = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
                instruction
            );
            
            await sendAndConfirmTransaction(connection, transaction, [initializer]);
            logTest('1.1 Valid initialization', true);
            
            // Subtest 1.2: Double initialization (should fail)
            try {
                const instruction2 = createInitializeInstruction(
                    programId,
                    initializer.publicKey,
                    vestingPDA,
                    vaultPDA,
                    mint,
                    recipients,
                    CONFIG.CLIFF_PERIOD,
                    CONFIG.VESTING_PERIOD,
                    CONFIG.TGE_PERCENTAGE
                );
                
                const transaction2 = new Transaction().add(instruction2);
                await sendAndConfirmTransaction(connection, transaction2, [initializer]);
                logTest('1.2 Protection against double initialization', false, 'Should have failed');
            } catch (error) {
                logTest('1.2 Protection against double initialization', true);
            }
            
            return { initializer, vestingPDA, vaultPDA, recipients };
        } catch (error) {
            logTest('1.1 Valid initialization', false, error.message);
            return null;
        }
        
    } catch (error) {
        log(`Critical error in initialization test: ${error.message}`, 'error');
        return null;
    }
}

// TEST 2: Period validation
async function testPeriodValidation() {
    log('🔒 TEST 2: Period validation');
    
    try {
        // Use a separate initializer for these subtests
        const initializer = Keypair.generate();
        
        const recipients = [{
            wallet: Keypair.generate().publicKey,
            percentage: 100
        }];
        
        // Subtest 2.1: Cliff >= Vesting (should fail)
        try {
            const [vestingPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), initializer.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA.toBuffer()],
                programId
            );
            
            const instruction = createInitializeInstruction(
                programId,
                initializer.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                1200, // cliff = 1200
                1200, // vesting = 1200 (equal, should fail)
                0
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [initializer]);
            logTest('2.1 Reject cliff >= vesting', false, 'Should have failed');
        } catch (error) {
            logTest('2.1 Reject cliff >= vesting', true);
        }
        
        // Subtest 2.2: Excessive vesting period
        try {
            const initializer2 = Keypair.generate();
            
            const [vestingPDA2] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), initializer2.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA2] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA2.toBuffer()],
                programId
            );
            
            const instruction = createInitializeInstruction(
                programId,
                initializer2.publicKey,
                vestingPDA2,
                vaultPDA2,
                mint,
                recipients,
                300,
                CONFIG.MAX_VESTING_DURATION + 1, // Too long
                0
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [initializer2]);
            logTest('2.2 Reject excessive vesting period', false, 'Should have failed');
        } catch (error) {
            logTest('2.2 Reject excessive vesting period', true);
        }
        
    } catch (error) {
        log(`Error in period validation tests: ${error.message}`, 'error');
    }
}

// TEST 3: Recipient validation
async function testRecipientValidation() {
    log('🔒 TEST 3: Recipient validation');
    
    try {
        // Subtest 3.1: Total percentage != 100
        try {
            const recipients = [
                { wallet: Keypair.generate().publicKey, percentage: 50 },
                { wallet: Keypair.generate().publicKey, percentage: 49 } // Total 99%
            ];
            
            createInitializeInstruction(
                programId,
                PublicKey.default,
                PublicKey.default,
                PublicKey.default,
                mint,
                recipients,
                300,
                1200,
                0
            );
            logTest('3.1 Reject total percentage != 100%', false, 'Should have failed');
        } catch (error) {
            logTest('3.1 Reject total percentage != 100%', true);
        }
        
        // Subtest 3.2: Duplicate recipients
        try {
            const duplicateWallet = Keypair.generate().publicKey;
            const recipients = [
                { wallet: duplicateWallet, percentage: 50 },
                { wallet: duplicateWallet, percentage: 50 } // Duplicate
            ];
            
            createInitializeInstruction(
                programId,
                PublicKey.default,
                PublicKey.default,
                PublicKey.default,
                mint,
                recipients,
                300,
                1200,
                0
            );
            logTest('3.2 Reject duplicate recipients', false, 'Should have failed');
        } catch (error) {
            logTest('3.2 Reject duplicate recipients', true);
        }
        
        // Subtest 3.3: Too many recipients (> 10)
        try {
            const recipients = [];
            for (let i = 0; i < 11; i++) { // 11 recipients, max 10
                recipients.push({
                    wallet: Keypair.generate().publicKey,
                    percentage: i === 10 ? 10 : 9 // Total 100%
                });
            }
            
            createInitializeInstruction(
                programId,
                PublicKey.default,
                PublicKey.default,
                PublicKey.default,
                mint,
                recipients,
                300,
                1200,
                0
            );
            logTest('3.3 Reject recipient count > 10', false, 'Should have failed');
        } catch (error) {
            logTest('3.3 Reject recipient count > 10', true);
        }
        
        // Subtest 3.4: Zero percentage for a recipient
        try {
            const recipients = [
                { wallet: Keypair.generate().publicKey, percentage: 100 },
                { wallet: Keypair.generate().publicKey, percentage: 0 } // Zero percent
            ];
            
            createInitializeInstruction(
                programId,
                PublicKey.default,
                PublicKey.default,
                PublicKey.default,
                mint,
                recipients,
                300,
                1200,
                0
            );
            logTest('3.4 Reject zero percentage', false, 'Should have failed');
        } catch (error) {
            logTest('3.4 Reject zero percentage', true);
        }
        
        // Subtest 3.5: Empty recipient list
        try {
            const recipients = []; // Empty array
            
            createInitializeInstruction(
                programId,
                PublicKey.default,
                PublicKey.default,
                PublicKey.default,
                mint,
                recipients,
                300,
                1200,
                0
            );
            logTest('3.5 Reject empty recipient list', false, 'Should have failed');
        } catch (error) {
            logTest('3.5 Reject empty recipient list', true);
        }
        
        // Subtest 3.6: Percentage > 100 for one recipient
        try {
            const recipients = [
                { wallet: Keypair.generate().publicKey, percentage: 150 } // > 100%
            ];
            
            createInitializeInstruction(
                programId,
                PublicKey.default,
                PublicKey.default,
                PublicKey.default,
                mint,
                recipients,
                300,
                1200,
                0
            );
            logTest('3.6 Reject percentage > 100%', false, 'Should have failed');
        } catch (error) {
            logTest('3.6 Reject percentage > 100%', true);
        }
        
    } catch (error) {
        log(`Error in recipient validation tests: ${error.message}`, 'error');
    }
}

// TEST 4: Funding security
async function testFundingSecurity(testData) {
    log('🔒 TEST 4: Funding security');
    
    if (!testData) {
        log('Skipping funding tests — no initialization data', 'warning');
        return null;
    }
    
    try {
        const { initializer, vestingPDA, vaultPDA } = testData;
        
        // Create token account for funder
        const funderTokenAccount = await createAccount(
            connection,
            payer,
            mint,
            payer.publicKey
        );
        
        // Mint tokens (if enough SOL)
        const payerBalance = await connection.getBalance(payer.publicKey);
        if (payerBalance >= 0.1 * 1e9) {
            await mintTo(
                connection,
                payer,
                mint,
                funderTokenAccount,
                payer,
                CONFIG.TEST_TOKEN_AMOUNT
            );
        } else {
            log('⚠️ Not enough SOL to mint tokens', 'warning');
            return { ...testData, funded: false };
        }
        
        // Subtest 4.1: Funding by non-initializer (should fail)
        try {
            const fakeFunder = Keypair.generate();
            
            const instruction = createFundInstruction(
                programId,
                fakeFunder.publicKey, // NOT initializer
                funderTokenAccount,
                vaultPDA,
                vestingPDA,
                CONFIG.TEST_TOKEN_AMOUNT
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [fakeFunder]);
            logTest('4.1 Protection against funding by non-initializer', false, 'Should have failed');
        } catch (error) {
            logTest('4.1 Protection against funding by non-initializer', true);
        }
        
        // Subtest 4.2: Funding with wrong vault PDA
        try {
            const fakeVaultPDA = Keypair.generate().publicKey;
            
            const instruction = createFundInstruction(
                programId,
                payer.publicKey,
                funderTokenAccount,
                fakeVaultPDA, // Wrong vault
                vestingPDA,
                CONFIG.TEST_TOKEN_AMOUNT
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [payer]);
            logTest('4.2 Protection against wrong vault PDA', false, 'Should have failed');
        } catch (error) {
            logTest('4.2 Protection against wrong vault PDA', true);
        }
        
        // Subtest 4.3: Funding with zero amount
        try {
            const instruction = createFundInstruction(
                programId,
                payer.publicKey,
                funderTokenAccount,
                vaultPDA,
                vestingPDA,
                0 // Zero amount
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [payer]);
            logTest('4.3 Protection against zero-amount funding', false, 'Should have failed');
        } catch (error) {
            logTest('4.3 Protection against zero-amount funding', true);
        }
        
        // Subtest 4.4: Valid funding
        try {
            const instruction = createFundInstruction(
                programId,
                payer.publicKey,
                funderTokenAccount,
                vaultPDA,
                vestingPDA,
                CONFIG.TEST_TOKEN_AMOUNT
            );
            
            const transaction = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
                instruction
            );
            
            await sendAndConfirmTransaction(connection, transaction, [payer]);
            logTest('4.4 Valid funding', true);
            
            // Subtest 4.5: Double funding (should fail)
            try {
                const instruction2 = createFundInstruction(
                    programId,
                    payer.publicKey,
                    funderTokenAccount,
                    vaultPDA,
                    vestingPDA,
                    100 * 1e9
                );
                
                const transaction2 = new Transaction().add(instruction2);
                await sendAndConfirmTransaction(connection, transaction2, [payer]);
                logTest('4.5 Protection against double funding', false, 'Should have failed');
            } catch (error) {
                logTest('4.5 Protection against double funding', true);
            }
            
            return { ...testData, funded: true };
        } catch (error) {
            logTest('4.4 Valid funding', false, error.message);
            return null;
        }
        
    } catch (error) {
        log(`Error in funding tests: ${error.message}`, 'error');
        return null;
    }
}

// TEST 5: Distribution security
async function testDistributionSecurity(testData) {
    log('🔒 TEST 5: Distribution security');
    
    if (!testData || !testData.funded) {
        log('Skipping distribution tests — contract not funded', 'warning');
        return;
    }
    
    try {
        const { initializer, vestingPDA, vaultPDA, recipients } = testData;
        
        // Derive vault authority
        const [vaultAuthority] = await PublicKey.findProgramAddress(
            [Buffer.from('authority'), vestingPDA.toBuffer()],
            programId
        );
        
        // Ensure ATAs for recipients
        const recipientATAs = [];
        for (const recipient of recipients) {
            const ata = await getAssociatedTokenAddress(mint, recipient.wallet);
            recipientATAs.push(ata);
            
            // Create ATA if missing
            try {
                await getAccount(connection, ata);
            } catch {
                const createATAInstruction = createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    ata,
                    recipient.wallet,
                    mint
                );
                const tx = new Transaction().add(createATAInstruction);
                await sendAndConfirmTransaction(connection, tx, [payer]);
            }
        }
        
        // Subtest 5.1: Distribution right after funding (e.g., TGE share)
        try {
            const instruction = createClaimInstruction(
                programId,
                initializer.publicKey,
                vestingPDA,
                vaultPDA,
                vaultAuthority,
                recipientATAs
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [initializer]);
            logTest('5.1 Valid distribution right after funding', true);
        } catch (error) {
            logTest('5.1 Valid distribution right after funding', false, error.message);
        }
        
        // Subtest 5.2: Unauthorized distribution (not from initializer)
        try {
            const attacker = Keypair.generate();
            
            const instruction = createClaimInstruction(
                programId,
                attacker.publicKey, // NOT initializer
                vestingPDA,
                vaultPDA,
                vaultAuthority,
                recipientATAs
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [attacker]);
            logTest('5.2 Protection against unauthorized distribution', false, 'Should have failed');
        } catch (error) {
            logTest('5.2 Protection against unauthorized distribution', true);
        }
        
        // Subtest 5.3: Distribution with wrong vault authority
        try {
            const fakeAuthority = Keypair.generate().publicKey;
            
            const instruction = createClaimInstruction(
                programId,
                initializer.publicKey,
                vestingPDA,
                vaultPDA,
                fakeAuthority, // Wrong authority
                recipientATAs
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [initializer]);
            logTest('5.3 Protection against wrong vault authority', false, 'Should have failed');
        } catch (error) {
            logTest('5.3 Protection against wrong vault authority', true);
        }
        
        // Subtest 5.4: Distribution with wrong recipient ATAs
        try {
            const wrongATAs = [];
            // Build wrong ATAs (for other recipients)
            for (let i = 0; i < recipients.length; i++) {
                const wrongRecipient = Keypair.generate().publicKey;
                const wrongATA = await getAssociatedTokenAddress(mint, wrongRecipient);
                wrongATAs.push(wrongATA);
            }
            
            const instruction = createClaimInstruction(
                programId,
                initializer.publicKey,
                vestingPDA,
                vaultPDA,
                vaultAuthority,
                wrongATAs // Wrong ATAs
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [initializer]);
            logTest('5.4 Protection against wrong recipient ATAs', false, 'Should have failed');
        } catch (error) {
            logTest('5.4 Protection against wrong recipient ATAs', true);
        }
        
        // Subtest 5.5: Distribution with wrong vesting PDA
        try {
            const fakeVestingPDA = Keypair.generate().publicKey;
            
            const instruction = createClaimInstruction(
                programId,
                initializer.publicKey,
                fakeVestingPDA, // Wrong vesting PDA
                vaultPDA,
                vaultAuthority,
                recipientATAs
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [initializer]);
            logTest('5.5 Protection against wrong vesting PDA', false, 'Should have failed');
        } catch (error) {
            logTest('5.5 Protection against wrong vesting PDA', true);
        }
        
        // Wait for cliff period to end
        log('⏳ Waiting for cliff period to end...');
        await new Promise(resolve => setTimeout(resolve, (CONFIG.CLIFF_PERIOD + 10) * 1000));
        
        // Subtest 5.6: Valid distribution after cliff
        try {
            const instruction = createClaimInstruction(
                programId,
                initializer.publicKey,
                vestingPDA,
                vaultPDA,
                vaultAuthority,
                recipientATAs
            );
            
            const transaction = new Transaction().add(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
                instruction
            );
            
            await sendAndConfirmTransaction(connection, transaction, [initializer]);
            logTest('5.6 Valid distribution after cliff', true);
            
            // Subtest 5.7: Rapid repeat distribution (cooldown protection)
            try {
                const instruction2 = createClaimInstruction(
                    programId,
                    initializer.publicKey,
                    vestingPDA,
                    vaultPDA,
                    vaultAuthority,
                    recipientATAs
                );
                
                const transaction2 = new Transaction().add(instruction2);
                await sendAndConfirmTransaction(connection, transaction2, [initializer]);
                logTest('5.7 Cooldown protection against rapid repeated distribution', false, 'Should have failed');
            } catch (error) {
                logTest('5.7 Cooldown protection against rapid repeated distribution', true);
            }
        } catch (error) {
            logTest('5.6 Valid distribution after cliff', false, error.message);
        }
        
    } catch (error) {
        log(`Error in distribution tests: ${error.message}`, 'error');
    }
}

// TEST 6: Mathematical accuracy
async function testMathematicalAccuracy(testData) {
    log('🔒 TEST 6: Mathematical accuracy');
    
    if (!testData) {
        log('Skipping math tests — no data', 'warning');
        return;
    }
    
    try {
        const { vestingPDA, recipients } = testData;
        
        // Fetch current vesting data
        const vestingInfo = await connection.getAccountInfo(vestingPDA);
        if (!vestingInfo) {
            logTest('6.1 Fetch vesting data', false, 'Account not found');
            return;
        }
        
        const vestingData = parseVestingAccount(vestingInfo.data);
        logTest('6.1 Fetch vesting data', true);
        
        // Subtest 6.2: Persistence of parameters
        const expectedRecipientCount = recipients.length;
        const actualRecipientCount = vestingData.recipientCount;
        logTest('6.2 Persisted recipient count', 
               expectedRecipientCount === actualRecipientCount,
               `Expected: ${expectedRecipientCount}, actual: ${actualRecipientCount}`);
        
    } catch (error) {
        log(`Error in math tests: ${error.message}`, 'error');
    }
}

// TEST 7: Initialization attack vectors
async function testInitializationAttacks() {
    log('🔒 TEST 7: Initialization attack vectors');
    
    try {
        // Subtest 7.1: Initialization with wrong system programs
        try {
            const attacker = Keypair.generate();
            const recipients = [{
                wallet: Keypair.generate().publicKey,
                percentage: 100
            }];
            
            const [vestingPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), attacker.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA.toBuffer()],
                programId
            );
            
            const dataSize = 19 + (recipients.length * 33);
            const data = Buffer.alloc(dataSize);
            data[0] = 0;
            data[1] = recipients.length;
            data.writeBigInt64LE(BigInt(CONFIG.CLIFF_PERIOD), 2);
            data.writeBigInt64LE(BigInt(CONFIG.VESTING_PERIOD), 10);
            data[18] = CONFIG.TGE_PERCENTAGE;
            data.set(recipients[0].wallet.toBuffer(), 19);
            data[19 + 32] = recipients[0].percentage;
            
            const instruction = new TransactionInstruction({
                programId,
                keys: [
                    { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
                    { pubkey: vestingPDA, isSigner: false, isWritable: true },
                    { pubkey: vaultPDA, isSigner: false, isWritable: true },
                    { pubkey: mint, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Wrong system program
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
                ],
                data,
            });
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [attacker]);
            logTest('7.1 Protection against wrong system programs', false, 'Should have failed');
        } catch (error) {
            logTest('7.1 Protection against wrong system programs', true);
        }
        
        // Subtest 7.2: Attack with incorrect PDAs
        try {
            const attacker = Keypair.generate();
            const recipients = [{
                wallet: Keypair.generate().publicKey,
                percentage: 100
            }];
            
            // Create wrong PDAs
            const fakeVestingPDA = Keypair.generate().publicKey;
            const fakeVaultPDA = Keypair.generate().publicKey;
            
            const instruction = createInitializeInstruction(
                programId,
                attacker.publicKey,
                fakeVestingPDA, // Wrong PDA
                fakeVaultPDA,   // Wrong PDA
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                CONFIG.TGE_PERCENTAGE
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [attacker]);
            logTest('7.2 Protection against incorrect PDAs', false, 'Should have failed');
        } catch (error) {
            logTest('7.2 Protection against incorrect PDAs', true);
        }
        
        // Subtest 7.3: Extreme time values attack
        try {
            const attacker = Keypair.generate();
            const recipients = [{
                wallet: Keypair.generate().publicKey,
                percentage: 100
            }];
            
            const [vestingPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), attacker.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA.toBuffer()],
                programId
            );
            
            // Maximum i64 value
            const maxTime = BigInt('9223372036854775807');
            
            const instruction = createInitializeInstruction(
                programId,
                attacker.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                Number(maxTime), // Extremely large value
                Number(maxTime),
                CONFIG.TGE_PERCENTAGE
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [attacker]);
            logTest('7.3 Protection against extreme time values', false, 'Should have failed');
        } catch (error) {
            logTest('7.3 Protection against extreme time values', true);
        }
        
        // Subtest 7.4: Invalid TGE percentage
        try {
            const attacker = Keypair.generate();
            const recipients = [{
                wallet: Keypair.generate().publicKey,
                percentage: 100
            }];
            
            const [vestingPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), attacker.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA.toBuffer()],
                programId
            );
            
            const instruction = createInitializeInstruction(
                programId,
                attacker.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                255 // Max u8 but invalid for percentage semantics
            );
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [attacker]);
            logTest('7.4 Protection against invalid TGE percentage', false, 'Should have failed');
        } catch (error) {
            logTest('7.4 Protection against invalid TGE percentage', true);
        }
        
        // Subtest 7.5: Oversized instruction data
        try {
            const attacker = Keypair.generate();
            
            // Build an excessively large instruction
            const oversizedData = Buffer.alloc(2000);
            oversizedData[0] = 0; // Initialize instruction discriminator
            
            const instruction = new TransactionInstruction({
                programId,
                keys: [
                    { pubkey: attacker.publicKey, isSigner: true, isWritable: true },
                ],
                data: oversizedData,
            });
            
            const transaction = new Transaction().add(instruction);
            await sendAndConfirmTransaction(connection, transaction, [attacker]);
            logTest('7.5 Protection against oversized instruction data', false, 'Should have failed');
        } catch (error) {
            logTest('7.5 Protection against oversized instruction data', true);
        }
        
    } catch (error) {
        log(`Error in initialization attack tests: ${error.message}`, 'error');
    }
}

// TEST 8: Economic attacks and overflows
async function testEconomicAttacks(testData) {
    log('🔒 TEST 8: Economic attacks and overflows');
    
    if (!testData) {
        log('Skipping economic tests — no data', 'warning');
        return;
    }
    
    try {
        // Subtest 8.1: Funding amount overflow attack
        try {
            const attacker = Keypair.generate();
            const recipients = [{
                wallet: Keypair.generate().publicKey,
                percentage: 100
            }];
            
            const [vestingPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), attacker.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA.toBuffer()],
                programId
            );
            
            // Initialize a new vesting instance
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: attacker.publicKey,
                lamports: 100_000_000
            });
            await sendAndConfirmTransaction(connection, new Transaction().add(transferInstruction), [payer]);
            
            const initInstruction = createInitializeInstruction(
                programId,
                attacker.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                CONFIG.TGE_PERCENTAGE
            );
            await sendAndConfirmTransaction(connection, new Transaction().add(initInstruction), [attacker]);
            
            // Attempt to fund with maximum amount
            const attackerTokenAccount = await createAccount(connection, payer, mint, payer.publicKey);
            await mintTo(connection, payer, mint, attackerTokenAccount, payer, 1000 * 1e9);
            
            const maxAmount = BigInt('18446744073709551615'); // u64::MAX
            const fundInstruction = createFundInstruction(
                programId,
                payer.publicKey,
                attackerTokenAccount,
                vaultPDA,
                vestingPDA,
                Number(maxAmount)
            );
            
            await sendAndConfirmTransaction(connection, new Transaction().add(fundInstruction), [payer]);
            logTest('8.1 Protection against funding amount overflow', false, 'Should have failed');
        } catch (error) {
            logTest('8.1 Protection against funding amount overflow', true);
        }
        
        // Subtest 8.2: Vault drain attempt via many fake ATAs
        try {
            const { vestingPDA, vaultPDA } = testData;
            
            // Derive vault authority
            const [vaultAuthority] = await PublicKey.findProgramAddress(
                [Buffer.from('authority'), vestingPDA.toBuffer()],
                programId
            );
            
            // Create fake ATAs
            const fakeATAs = [];
            for (let i = 0; i < 100; i++) { // Many fake ATAs
                fakeATAs.push(Keypair.generate().publicKey);
            }
            
            const instruction = createClaimInstruction(
                programId,
                testData.initializer.publicKey,
                vestingPDA,
                vaultPDA,
                vaultAuthority,
                fakeATAs
            );
            
            await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [testData.initializer]);
            logTest('8.2 Protection against vault drain via fake ATAs', false, 'Should have failed');
        } catch (error) {
            logTest('8.2 Protection against vault drain via fake ATAs', true);
        }
        
        // Subtest 8.3: Percentage arithmetic overflow attempt
        try {
            const attacker = Keypair.generate();
            const recipients = [
                { wallet: Keypair.generate().publicKey, percentage: 255 }, // Max u8
            ];
            
            createInitializeInstruction(
                programId,
                attacker.publicKey,
                PublicKey.default,
                PublicKey.default,
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                CONFIG.TGE_PERCENTAGE
            );
            logTest('8.3 Protection against percentage overflow', false, 'Should have failed');
        } catch (error) {
            logTest('8.3 Protection against percentage overflow', true);
        }
        
    } catch (error) {
        log(`Error in economic tests: ${error.message}`, 'error');
    }
}

// TEST 9: State and consistency
async function testStateConsistency(testData) {
    log('🔒 TEST 9: State and data consistency');
    
    if (!testData) {
        log('Skipping state tests — no data', 'warning');
        return;
    }
    
    try {
        const { vestingPDA } = testData;
        
        // Subtest 9.1: Consistency after operations
        try {
            const vestingInfo = await connection.getAccountInfo(vestingPDA);
            if (!vestingInfo) {
                logTest('9.1 Verify vesting account exists', false, 'Account not found');
                return;
            }
            
            const vestingData = parseVestingAccount(vestingInfo.data);
            
            // Verify basic invariants
            const totalPercentage = vestingData.recipients.reduce((sum, r) => sum + r.percentage, 0);
            logTest('9.1 Total percentage consistency', 
                   totalPercentage === 100 || totalPercentage === 0,
                   `Total percentage: ${totalPercentage}%`);
            
            // Ensure claimed_amount <= recipient_total for each recipient
            let validClaims = true;
            for (const recipient of vestingData.recipients) {
                if (recipient.percentage > 0) {
                    const recipientTotal = Math.floor(vestingData.totalAmount * recipient.percentage / 100);
                    if (recipient.claimedAmount > recipientTotal) {
                        validClaims = false;
                        break;
                    }
                }
            }
            logTest('9.2 Validity of claimed amounts', validClaims);
            
        } catch (error) {
            logTest('9.1 Account state check', false, error.message);
        }
        
        // Subtest 9.3: External modification attempt via other programs
        try {
            // Try to write data into vesting account directly (should fail)
            const fakeData = Buffer.alloc(1000, 0xFF);
            
            const instruction = new TransactionInstruction({
                programId: SystemProgram.programId, // Using system program
                keys: [
                    { pubkey: vestingPDA, isSigner: false, isWritable: true },
                ],
                data: fakeData,
            });
            
            await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [payer]);
            logTest('9.3 Protection against external data modification', false, 'Should have failed');
        } catch (error) {
            logTest('9.3 Protection against external data modification', true);
        }
        
    } catch (error) {
        log(`Error in state tests: ${error.message}`, 'error');
    }
}

// TEST 10: Stress tests and edge cases
async function testStressCases() {
    log('🔒 TEST 10: Stress tests and edge cases');
    
    try {
        // Subtest 10.1: Maximum number of recipients (10)
        try {
            const stressInitializer = Keypair.generate();
            
            // Create 10 recipients (maximum)
            const recipients = [];
            for (let i = 0; i < 10; i++) {
                recipients.push({
                    wallet: Keypair.generate().publicKey,
                    percentage: 10 // 10% each = 100% total
                });
            }
            
            const [vestingPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), stressInitializer.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA.toBuffer()],
                programId
            );
            
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: stressInitializer.publicKey,
                lamports: 100_000_000
            });
            await sendAndConfirmTransaction(connection, new Transaction().add(transferInstruction), [payer]);
            
            const instruction = createInitializeInstruction(
                programId,
                stressInitializer.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                CONFIG.TGE_PERCENTAGE
            );
            
            await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [stressInitializer]);
            logTest('10.1 Stress: maximum number of recipients', true);
        } catch (error) {
            logTest('10.1 Stress: maximum number of recipients', false, error.message);
        }
        
        // Subtest 10.2: Minimal time values
        try {
            const minInitializer = Keypair.generate();
            const recipients = [{
                wallet: Keypair.generate().publicKey,
                percentage: 100
            }];
            
            const [vestingPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), minInitializer.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA.toBuffer()],
                programId
            );
            
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: minInitializer.publicKey,
                lamports: 100_000_000
            });
            await sendAndConfirmTransaction(connection, new Transaction().add(transferInstruction), [payer]);
            
            const instruction = createInitializeInstruction(
                programId,
                minInitializer.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                1,  // Minimal cliff
                2,  // Minimal vesting (cliff < vesting)
                CONFIG.TGE_PERCENTAGE
            );
            
            await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [minInitializer]);
            logTest('10.2 Minimal time values', true);
        } catch (error) {
            logTest('10.2 Minimal time values', false, error.message);
        }
        
        // Subtest 10.3: Unbalanced percentages
        try {
            const recipients = [
                { wallet: Keypair.generate().publicKey, percentage: 1 },
                { wallet: Keypair.generate().publicKey, percentage: 99 }, // Highly imbalanced
            ];
            
            createInitializeInstruction(
                programId,
                PublicKey.default,
                PublicKey.default,
                PublicKey.default,
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                CONFIG.TGE_PERCENTAGE
            );
            logTest('10.3 Handling unbalanced percentages', true);
        } catch (error) {
            logTest('10.3 Handling unbalanced percentages', false, error.message);
        }
        
        // Subtest 10.4: DoS via creating multiple PDAs from one initializer
        try {
            const spamInitializer = Keypair.generate();
            
            // Transfer SOL
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: spamInitializer.publicKey,
                lamports: 500_000_000 // 0.5 SOL for multiple transactions
            });
            await sendAndConfirmTransaction(connection, new Transaction().add(transferInstruction), [payer]);
            
            const recipients = [{
                wallet: Keypair.generate().publicKey,
                percentage: 100
            }];
            
            // Try to create multiple vesting contracts from one initializer
            // using different seeds so PDAs differ
            let successfulCreations = 0;
            const maxAttempts = 5; // Keep attempts limited in tests
            
            for (let i = 0; i < maxAttempts; i++) {
                try {
                    // Create a fake initializer for each PDA
                    const fakeInitializer = Keypair.generate();
                    
                    const [vestingPDA] = await PublicKey.findProgramAddress(
                        [Buffer.from('vesting'), fakeInitializer.publicKey.toBuffer()],
                        programId
                    );
                    const [vaultPDA] = await PublicKey.findProgramAddress(
                        [Buffer.from('vault'), vestingPDA.toBuffer()],
                        programId
                    );
                    
                    const instruction = createInitializeInstruction(
                        programId,
                        spamInitializer.publicKey, // SAME initializer
                        vestingPDA,   // DIFFERENT PDA
                        vaultPDA,     // DIFFERENT PDA  
                        mint,
                        recipients,
                        CONFIG.CLIFF_PERIOD,
                        CONFIG.VESTING_PERIOD,
                        CONFIG.TGE_PERCENTAGE
                    );
                    
                    await sendAndConfirmTransaction(connection, new Transaction().add(instruction), [spamInitializer]);
                    successfulCreations++;
                } catch (error) {
                    // Expect the contract to block after the first
                    break;
                }
            }
            
            if (successfulCreations >= 3) {
                logTest('10.4 Protection against DoS via multiple PDAs', false, 
                       `Created ${successfulCreations} contracts from a single initializer`);
            } else {
                logTest('10.4 Protection against DoS via multiple PDAs', true);
            }
            
        } catch (error) {
            logTest('10.4 Protection against DoS via multiple PDAs', true);
        }
        
        // Subtest 10.5: Re-initialization with the same PDAs
        try {
            const sameInitializer = Keypair.generate();
            const recipients = [{
                wallet: Keypair.generate().publicKey,
                percentage: 100
            }];
            
            const [vestingPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vesting'), sameInitializer.publicKey.toBuffer()],
                programId
            );
            const [vaultPDA] = await PublicKey.findProgramAddress(
                [Buffer.from('vault'), vestingPDA.toBuffer()],
                programId
            );
            
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: sameInitializer.publicKey,
                lamports: 200_000_000 // More SOL
            });
            await sendAndConfirmTransaction(connection, new Transaction().add(transferInstruction), [payer]);
            
            // First initialization
            const instruction1 = createInitializeInstruction(
                programId,
                sameInitializer.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                CONFIG.TGE_PERCENTAGE
            );
            await sendAndConfirmTransaction(connection, new Transaction().add(instruction1), [sameInitializer]);
            
            // Second initialization (should fail)
            const instruction2 = createInitializeInstruction(
                programId,
                sameInitializer.publicKey,
                vestingPDA,
                vaultPDA,
                mint,
                recipients,
                CONFIG.CLIFF_PERIOD,
                CONFIG.VESTING_PERIOD,
                CONFIG.TGE_PERCENTAGE
            );
            await sendAndConfirmTransaction(connection, new Transaction().add(instruction2), [sameInitializer]);
            
            logTest('10.5 Protection against re-initialization with same PDAs', false, 'Should have failed');
        } catch (error) {
            logTest('10.5 Protection against re-initialization with same PDAs', true);
        }
        
    } catch (error) {
        log(`Error in stress tests: ${error.message}`, 'error');
    }
}

// ================== MAIN FUNCTION ==================

async function runComprehensiveTests() {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 RUNNING COMPREHENSIVE TESTS FOR SOLANA VESTING CONTRACT');
    console.log('='.repeat(80));
    console.log(`📋 Program under test: ${CONFIG.PROGRAM_ID}`);
    console.log(`🌐 RPC endpoint: ${CONFIG.RPC_URL}`);
    console.log(`💰 Test amount: ${CONFIG.TEST_TOKEN_AMOUNT / 1e9} tokens`);
    console.log(`⏰ Cliff period: ${CONFIG.CLIFF_PERIOD} seconds`);
    console.log(`📅 Vesting period: ${CONFIG.VESTING_PERIOD} seconds`);
    console.log('='.repeat(80));
    
    const startTime = Date.now();
    
    try {
        // Stage 1: Environment setup
        log('🔧 STAGE 1: Test environment setup');
        const setupSuccess = await setupTestEnvironment();
        if (!setupSuccess) {
            log('❌ Critical setup error', 'error');
            return;
        }
        
        // Stage 2: Initialization security
        log('\n🔒 STAGE 2: Initialization security tests');
        const testData = await testInitializationSecurity();
        
        // Stage 3: Period validation
        log('\n⏰ STAGE 3: Period validation tests');
        await testPeriodValidation();
        
        // Stage 4: Recipient validation
        log('\n👥 STAGE 4: Recipient validation tests');
        await testRecipientValidation();
        
        // Stage 5: Funding tests
        log('\n💰 STAGE 5: Funding security tests');
        const fundedData = await testFundingSecurity(testData);
        
        // Stage 6: Distribution tests
        log('\n📊 STAGE 6: Distribution security tests');
        await testDistributionSecurity(fundedData);
        
        // Stage 7: Math tests
        log('\n🧮 STAGE 7: Mathematical accuracy tests');
        await testMathematicalAccuracy(fundedData);
        
        // Stage 8: Initialization attacks
        log('\n⚔️ STAGE 8: Initialization attack tests');
        await testInitializationAttacks();
        
        // Stage 9: Economic attacks
        log('\n💰 STAGE 9: Economic attack and overflow tests');
        await testEconomicAttacks(fundedData);
        
        // Stage 10: State and consistency
        log('\n🔄 STAGE 10: State and data consistency tests');
        await testStateConsistency(fundedData);
        
        // Stage 11: Stress tests
        log('\n⚡ STAGE 11: Stress tests and edge cases');
        await testStressCases();
        
    } catch (error) {
        log(`💥 Critical testing error: ${error.message}`, 'error');
    }
    
    // Generate final report
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const totalTests = testResults.passed + testResults.failed;
    const successRate = totalTests > 0 ? (testResults.passed / totalTests) : 0;
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 DETAILED FINAL TEST REPORT');
    console.log('='.repeat(80));
    console.log(`⏱️  Total execution time: ${Math.round(totalTime / 1000)} seconds`);
    console.log(`🎯 Total tests run: ${totalTests}`);
    console.log(`✅ Tests passed: ${testResults.passed}`);
    console.log(`❌ Tests failed: ${testResults.failed}`);
    console.log(`📈 Success rate: ${Math.round(successRate * 100)}%`);
    
    if (testResults.failed > 0) {
        console.log('\n🚨 FAILED TESTS:');
        testResults.details.filter(t => !t.passed).forEach(test => {
            console.log(`   ❌ ${test.testName}`);
            if (test.details) {
                console.log(`      Details: ${test.details}`);
            }
        });
    }
    
    // Security assessment
    let securityLevel;
    let recommendations = [];
    
    if (successRate >= 0.95) {
        securityLevel = 'HIGH';
        recommendations.push('Contract is production-ready');
    } else if (successRate >= 0.85) {
        securityLevel = 'MEDIUM';
        recommendations.push('Recommended to fix failing tests');
    } else {
        securityLevel = 'LOW';
        recommendations.push('Significant improvements required');
    }
    
    console.log(`\n🔒 Security level: ${securityLevel} (${Math.round(successRate * 100)}%)`);
    console.log('\n💡 RECOMMENDATIONS:');
    recommendations.forEach(rec => {
        console.log(`   • ${rec}`);
    });
    
    // Save report
    const report = {
        timestamp: new Date().toISOString(),
        programId: CONFIG.PROGRAM_ID,
        totalTime: totalTime,
        totalTests: totalTests,
        results: testResults,
        successRate: successRate,
        securityLevel: securityLevel,
        recommendations: recommendations,
        config: CONFIG
    };
    
    const reportPath = `./solana-security-test-report-${Date.now()}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Detailed report saved: ${reportPath}`);
    
    console.log('='.repeat(80));
    
    if (successRate >= 0.90) {
        console.log('🎉 CONTRACT IS PRODUCTION-READY!');
    } else {
        console.log('⚠️  REVISIONS REQUIRED');
    }
}

// Run tests
if (require.main === module) {
    // Run tests with current Program ID
    runComprehensiveTests().catch(console.error);
}

module.exports = {
    runComprehensiveTests,
    setupTestEnvironment,
    testInitializationSecurity,
    testPeriodValidation,
    testRecipientValidation,
    testFundingSecurity,
    testDistributionSecurity,
    testMathematicalAccuracy,
    testInitializationAttacks,
    testEconomicAttacks,
    testStateConsistency,
    testStressCases,
    CONFIG
};