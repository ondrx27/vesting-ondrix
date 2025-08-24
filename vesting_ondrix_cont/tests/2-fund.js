const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SYSVAR_CLOCK_PUBKEY,
} = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
    getAccount,
    getAssociatedTokenAddress,
} = require('@solana/spl-token');
const fs = require('fs');

// Загружаем данные из файла инициализации
let vestingData;
try {
    vestingData = JSON.parse(fs.readFileSync('./vesting-data.json', 'utf8'));
    console.log('📂 Загружены данные vesting из vesting-data.json');
} catch (error) {
    console.error('❌ Файл vesting-data.json не найден. Сначала запустите 1-initialize.js');
    process.exit(1);
}

// Конфигурация фандинга
const FUNDING_CONFIG = {
    // Количество токенов для фандинга (в базовых единицах, учитывая 9 decimals)
    AMOUNT: '1000000000000000', // 1,000,000 токенов (1,000,000 * 10^9 = 1,000,000,000,000,000)
};

const connection = new Connection('https://api.devnet.solana.com');
const programId = new PublicKey(vestingData.programId);

// Load wallet - используем предоставленный приватный ключ
const payer = Keypair.fromSecretKey(
    new Uint8Array([121,57,255,6,112,96,247,20,173,144,245,221,185,78,101,113,207,219,147,111,45,236,157,151,173,203,143,55,221,30,40,148,109,97,131,212,128,246,139,74,2,92,61,150,14,249,22,118,144,216,76,1,17,4,254,205,67,217,187,163,42,252,14,128])
);

function createFundInstruction(
    programId,
    funder,
    sourceTokenAccount,
    vaultPDA,
    vestingPDA,
    amount
) {
    // Создаем данные инструкции: 1 байт (инструкция) + 8 байт (amount)
    const data = Buffer.alloc(9);
    
    // Инструкция 1 = Fund
    data[0] = 1;
    
    // Amount (8 байт, little endian)
    data.writeBigUInt64LE(BigInt(amount), 1);
    
    return new TransactionInstruction({
        programId,
        keys: [
            { pubkey: funder, isSigner: true, isWritable: true },                    // 0. Funder
            { pubkey: sourceTokenAccount, isSigner: false, isWritable: true },      // 1. Source Token Account
            { pubkey: vaultPDA, isSigner: false, isWritable: true },                // 2. Vault PDA
            { pubkey: vestingPDA, isSigner: false, isWritable: true },              // 3. Vesting PDA
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },       // 4. Token Program
            { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },    // 5. Clock Sysvar
        ],
        data,
    });
}

async function fundVesting() {
    console.log('💰 ФАНДИНГ VESTING КОНТРАКТА');
    console.log('=' .repeat(50));
    
    try {
        // Проверяем что инициализатор совпадает
        if (vestingData.initializer !== payer.publicKey.toBase58()) {
            console.error('❌ Фандер должен быть тем же что и инициализатор!');
            console.log('  Инициализатор:', vestingData.initializer);
            console.log('  Текущий фандер:', payer.publicKey.toBase58());
            process.exit(1);
        }
        
        console.log('📋 Данные vesting:');
        console.log('  Vesting PDA:', vestingData.vestingPDA);
        console.log('  Vault PDA:', vestingData.vaultPDA);
        console.log('  Токен:', vestingData.tokenMint);
        console.log('  Фандер/Инициализатор:', payer.publicKey.toBase58());
        
        // Автоматически находим ATA payer'а для данного токена
        const mint = new PublicKey(vestingData.tokenMint);
        const sourceTokenAccount = await getAssociatedTokenAddress(mint, payer.publicKey);
        
        console.log('🔍 Ищем токен аккаунт:', sourceTokenAccount.toBase58());
        
        // Проверяем баланс source аккаунта
        try {
            const sourceAccount = await getAccount(connection, sourceTokenAccount);
            console.log('✅ Токен аккаунт найден!');
            console.log('💰 Баланс:', sourceAccount.amount.toString(), 'базовых единиц');
            console.log('  Человеко-читаемый баланс:', (Number(sourceAccount.amount) / 1e9).toFixed(2), 'токенов');
            console.log('  Владелец:', sourceAccount.owner.toBase58());
            console.log('  Mint:', sourceAccount.mint.toBase58());
            
            // Проверяем что mint совпадает
            if (sourceAccount.mint.toBase58() !== vestingData.tokenMint) {
                throw new Error(`Mint не совпадает! Ожидается: ${vestingData.tokenMint}, получен: ${sourceAccount.mint.toBase58()}`);
            }
            
            // Проверяем что владелец это наш payer
            if (sourceAccount.owner.toBase58() !== payer.publicKey.toBase58()) {
                throw new Error(`Владелец токен аккаунта не совпадает! Ожидается: ${payer.publicKey.toBase58()}, получен: ${sourceAccount.owner.toBase58()}`);
            }
            
            // Проверяем что у нас достаточно токенов
            if (BigInt(sourceAccount.amount) < BigInt(FUNDING_CONFIG.AMOUNT)) {
                throw new Error(`Недостаточно токенов! Нужно: ${FUNDING_CONFIG.AMOUNT}, есть: ${sourceAccount.amount}`);
            }
            
        } catch (error) {
            if (error.message.includes('could not find account')) {
                console.error('❌ Токен аккаунт не найден!');
                console.log('💡 Убедитесь что у вас есть токены CaYYqEzktvpPXkqpFeUGrs5kt6QDk7vmnb5GVzydDJJb');
                console.log('💡 Проверьте баланс: spl-token balance CaYYqEzktvpPXkqpFeUGrs5kt6QDk7vmnb5GVzydDJJb');
            } else {
                console.error('❌ Ошибка проверки токен аккаунта:', error.message);
            }
            process.exit(1);
        }
        
        // Проверяем что vesting account существует и не профинансирован
        const vestingPDA = new PublicKey(vestingData.vestingPDA);
        const vestingAccountInfo = await connection.getAccountInfo(vestingPDA);
        
        if (!vestingAccountInfo) {
            throw new Error('Vesting аккаунт не найден! Сначала выполните инициализацию.');
        }
        
        console.log('✅ Vesting аккаунт найден, размер:', vestingAccountInfo.data.length, 'байт');
        
        // Создаем инструкцию фандинга
        const vaultPDA = new PublicKey(vestingData.vaultPDA);
        
        const fundInstruction = createFundInstruction(
            programId,
            payer.publicKey,
            sourceTokenAccount,
            vaultPDA,
            vestingPDA,
            FUNDING_CONFIG.AMOUNT
        );
        
        console.log('\n📝 Параметры фандинга:');
        console.log('  Количество (базовые единицы):', FUNDING_CONFIG.AMOUNT);
        console.log('  Количество (токены):', (Number(FUNDING_CONFIG.AMOUNT) / 1e9).toFixed(2));
        console.log('  Source аккаунт:', sourceTokenAccount.toBase58());
        console.log('  Vault PDA:', vaultPDA.toBase58());
        
        // Отправляем транзакцию
        console.log('\n🔄 Отправка транзакции фандинга...');
        const transaction = new Transaction().add(fundInstruction);
        
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [payer],
            { commitment: 'confirmed' }
        );
        
        console.log('✅ ФАНДИНГ УСПЕШЕН!');
        console.log('📜 Подпись транзакции:', signature);
        console.log('🌐 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        
        // Обновляем данные
        vestingData.fundAmount = FUNDING_CONFIG.AMOUNT;
        vestingData.fundSignature = signature;
        vestingData.fundTimestamp = new Date().toISOString();
        vestingData.funded = true;
        
        fs.writeFileSync('./vesting-data.json', JSON.stringify(vestingData, null, 2));
        console.log('💾 Данные обновлены в vesting-data.json');
        
        console.log('\n🎯 Теперь можно запускать 3-claim.js для распределения токенов!');
        
    } catch (error) {
        console.error('❌ Ошибка фандинга:', error.message);
        process.exit(1);
    }
}

fundVesting();