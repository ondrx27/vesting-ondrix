const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
} = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const fs = require('fs');

// Конфигурация
const CONFIG = {
    RPC_URL: 'https://api.devnet.solana.com',
    PROGRAM_ID: '7rQ34mQvgAmq15uZxZKDApB7xhap7y8ovrBxn4xomatY',
    TOKEN_MINT: 'CaYYqEzktvpPXkqpFeUGrs5kt6QDk7vmnb5GVzydDJJb',
    
    // Параметры вестинга
    CLIFF_PERIOD: 300,      // 5 минут cliff
    VESTING_PERIOD: 1200,   // 20 минут общий период
    TGE_BASIS_POINTS: 2000, // 20% TGE в basis points (2000 = 20%)
    NONCE: Date.now(),      // Уникальный nonce для множественных контractов
    
    // Получатели (должны быть в сумме 10000 basis points = 100%)
    RECIPIENTS: [
        { 
            wallet: '7Nuz5oH3xQE2ksiJ84GJXvQJBcZzjfSmci6RmkJHZFAx',
            basisPoints: 2500  // 25%
        },
        { 
            wallet: '9sRRkYzseywA5zjLd2tqZLAgNgK6X4MVbagrNTmM8jAw', 
            basisPoints: 2500  // 25%
        },
        { 
            wallet: 'CiK1qipeLb4PuTbSUHLAocYqiSwR5TXPgWmBurFwzQFG', 
            basisPoints: 2500  // 25%
        },
        { 
            wallet: '5ZrKZrma1wy89ti3d5vDFkcdQYkdJmFwLh1X9ATGCyFq', 
            basisPoints: 2500  // 25%
        },
    ],
};

const connection = new Connection(CONFIG.RPC_URL);
const programId = new PublicKey(CONFIG.PROGRAM_ID);
const mint = new PublicKey(CONFIG.TOKEN_MINT);

// Load wallet - используем предоставленный приватный ключ
const payer = Keypair.fromSecretKey(
    new Uint8Array([121,57,255,6,112,96,247,20,173,144,245,221,185,78,101,113,207,219,147,111,45,236,157,151,173,203,143,55,221,30,40,148,109,97,131,212,128,246,139,74,2,92,61,150,14,249,22,118,144,216,76,1,17,4,254,205,67,217,187,163,42,252,14,128])
);

function createInitializeInstruction(
    programId,
    initializer,
    vestingPDA,
    vaultPDA,
    mint,
    recipients,
    cliffPeriod,
    vestingPeriod,
    tgeBasisPoints,
    nonce
) {
    // Рассчитываем размер данных: 28 байт базовых + 34 байта на каждого получателя
    // 1 byte instruction + 1 byte count + 8 bytes cliff + 8 bytes vesting + 2 bytes tge_basis_points + 8 bytes nonce + recipients * 34
    const dataSize = 28 + (recipients.length * 34);
    const data = Buffer.alloc(dataSize);
    
    let offset = 0;
    
    // Инструкция 0 = Initialize
    data[offset++] = 0;
    
    // Количество получателей
    data[offset++] = recipients.length;
    
    // Cliff period (8 байт, little endian)
    data.writeBigInt64LE(BigInt(cliffPeriod), offset);
    offset += 8;
    
    // Vesting period (8 байт, little endian)
    data.writeBigInt64LE(BigInt(vestingPeriod), offset);
    offset += 8;
    
    // TGE basis points (2 байта, little endian)
    data.writeUInt16LE(tgeBasisPoints, offset);
    offset += 2;
    
    // Nonce (8 байт, little endian)
    data.writeBigUInt64LE(BigInt(nonce), offset);
    offset += 8;
    
    // Получатели (34 байта каждый: 32 байта pubkey + 2 байта basis points)
    for (const recipient of recipients) {
        data.set(recipient.wallet.toBuffer(), offset);
        offset += 32;
        data.writeUInt16LE(recipient.basisPoints, offset);
        offset += 2;
    }
    
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: initializer, isSigner: true, isWritable: true },      // 0. Initializer
            { pubkey: vestingPDA, isSigner: false, isWritable: true },     // 1. Vesting PDA
            { pubkey: vaultPDA, isSigner: false, isWritable: true },       // 2. Vault PDA
            { pubkey: mint, isSigner: false, isWritable: false },          // 3. Mint
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 4. System Program
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },        // 5. Token Program
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },      // 6. Rent Sysvar
        ],
        data,
    });
}

async function initializeVesting() {
    console.log('🚀 ИНИЦИАЛИЗАЦИЯ VESTING КОНТРАКТА');
    console.log('=' .repeat(50));
    
    try {
        // Проверяем баланс
        const balance = await connection.getBalance(payer.publicKey);
        console.log('💰 Баланс инициализатора:', balance / 1e9, 'SOL');
        
        if (balance < 10000000) { // 0.01 SOL
            throw new Error('Недостаточно SOL для инициализации');
        }
        
        // Конвертируем получателей
        const recipients = CONFIG.RECIPIENTS.map(r => ({
            wallet: new PublicKey(r.wallet),
            basisPoints: r.basisPoints
        }));
        
        // Проверяем сумму basis points
        const totalBasisPoints = recipients.reduce((sum, r) => sum + r.basisPoints, 0);
        if (totalBasisPoints !== 10000) {
            throw new Error(`Сумма basis points должна быть 10000 (100%), получили ${totalBasisPoints}`);
        }
        
        console.log('📋 Получатели:');
        recipients.forEach((r, i) => {
            console.log(`  ${i + 1}. ${r.wallet.toBase58()} - ${r.basisPoints} basis points (${r.basisPoints/100}%)`);
        });
        
        // Рассчитываем PDAs с nonce для уникальности
        const nonce = CONFIG.NONCE;
        const nonceBuffer = Buffer.allocUnsafe(8);
        nonceBuffer.writeBigUInt64LE(BigInt(nonce));
        
        const [vestingPDA, vestingBump] = await PublicKey.findProgramAddress(
            [Buffer.from('vesting'), payer.publicKey.toBuffer(), nonceBuffer],
            programId
        );
        
        const [vaultPDA, vaultBump] = await PublicKey.findProgramAddress(
            [Buffer.from('vault'), vestingPDA.toBuffer()],
            programId
        );
        
        console.log('📍 PDAs:');
        console.log('  Nonce:', nonce);
        console.log('  Vesting PDA:', vestingPDA.toBase58());
        console.log('  Vault PDA:', vaultPDA.toBase58());
        console.log('  Vesting Bump:', vestingBump);
        console.log('  Vault Bump:', vaultBump);
        
        // Проверяем что PDAs еще не инициализированы
        const vestingAccountInfo = await connection.getAccountInfo(vestingPDA);
        if (vestingAccountInfo) {
            throw new Error('Vesting PDA уже инициализирован! Используйте другой initializer.');
        }
        
        // Создаем инструкцию инициализации
        const initInstruction = createInitializeInstruction(
            programId,
            payer.publicKey,
            vestingPDA,
            vaultPDA,
            mint,
            recipients,
            CONFIG.CLIFF_PERIOD,
            CONFIG.VESTING_PERIOD,
            CONFIG.TGE_BASIS_POINTS,
            nonce
        );
        
        console.log('\n📝 Параметры вестинга:');
        console.log('  Токен:', CONFIG.TOKEN_MINT);
        console.log('  Cliff период:', CONFIG.CLIFF_PERIOD, 'секунд');
        console.log('  Общий период:', CONFIG.VESTING_PERIOD, 'секунд');
        console.log('  TGE:', CONFIG.TGE_BASIS_POINTS, 'basis points (' + (CONFIG.TGE_BASIS_POINTS/100) + '%)');
        
        // Отправляем транзакцию
        console.log('\n🔄 Отправка транзакции...');
        const transaction = new Transaction().add(initInstruction);
        
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [payer],
            { commitment: 'confirmed' }
        );
        
        console.log('✅ ИНИЦИАЛИЗАЦИЯ УСПЕШНА!');
        console.log('📜 Подпись транзакции:', signature);
        console.log('🌐 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        
        // Сохраняем данные для следующих скриптов
        const vestingData = {
            programId: CONFIG.PROGRAM_ID,
            tokenMint: CONFIG.TOKEN_MINT,
            initializer: payer.publicKey.toBase58(),
            vestingPDA: vestingPDA.toBase58(),
            vaultPDA: vaultPDA.toBase58(),
            recipients: CONFIG.RECIPIENTS,
            cliffPeriod: CONFIG.CLIFF_PERIOD,
            vestingPeriod: CONFIG.VESTING_PERIOD,
            tgeBasisPoints: CONFIG.TGE_BASIS_POINTS,
            nonce: nonce,
            initSignature: signature,
            timestamp: new Date().toISOString(),
        };
        
        fs.writeFileSync('./vesting-data.json', JSON.stringify(vestingData, null, 2));
        console.log('💾 Данные сохранены в vesting-data.json');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error.message);
        process.exit(1);
    }
}

initializeVesting();