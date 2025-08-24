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
    createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token');
const fs = require('fs');

// Загружаем данные из файла
let vestingData;
try {
    vestingData = JSON.parse(fs.readFileSync('./vesting-data.json', 'utf8'));
    console.log('📂 Загружены данные vesting из vesting-data.json');
} catch (error) {
    console.error('❌ Файл vesting-data.json не найден. Сначала запустите 1-initialize.js и 2-fund.js');
    process.exit(1);
}

const connection = new Connection('https://api.devnet.solana.com');
const programId = new PublicKey(vestingData.programId);

// Load wallet - используем предоставленный приватный ключ
const payer = Keypair.fromSecretKey(
    new Uint8Array([121,57,255,6,112,96,247,20,173,144,245,221,185,78,101,113,207,219,147,111,45,236,157,151,173,203,143,55,221,30,40,148,109,97,131,212,128,246,139,74,2,92,61,150,14,249,22,118,144,216,76,1,17,4,254,205,67,217,187,163,42,252,14,128])
);

function createClaimInstruction(
    programId,
    initializer,
    vestingPDA,
    vaultPDA,
    vaultAuthority,
    recipientATAs
) {
    // Создаем данные инструкции: только 1 байт (инструкция)
    const data = Buffer.alloc(1);
    
    // Инструкция 2 = Claim
    data[0] = 2;
    
    // Создаем массив аккаунтов
    const keys = [
        { pubkey: initializer, isSigner: true, isWritable: true },         // 0. Initializer (signer)
        { pubkey: vestingPDA, isSigner: false, isWritable: true },         // 1. Vesting PDA
        { pubkey: vaultPDA, isSigner: false, isWritable: true },           // 2. Vault PDA
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },  // 3. Token Program
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false }, // 4. Clock Sysvar
        { pubkey: vaultAuthority, isSigner: false, isWritable: false },    // 5. Vault Authority PDA
    ];
    
    // Добавляем ATA получателей (6+)
    for (const ata of recipientATAs) {
        keys.push({ pubkey: ata, isSigner: false, isWritable: true });
    }
    
    return new TransactionInstruction({
        programId,
        keys,
        data,
    });
}

async function checkTokenBalances(recipientATAs, mint) {
    console.log('\n💰 Балансы получателей:');
    for (let i = 0; i < recipientATAs.length; i++) {
        try {
            const account = await getAccount(connection, recipientATAs[i]);
            const balance = Number(account.amount);
            const humanBalance = (balance / 1e9).toFixed(6); // 9 decimals
            console.log(`  ${i + 1}. ${recipientATAs[i].toBase58()}: ${humanBalance} токенов (${balance} базовых единиц)`);
        } catch (error) {
            console.log(`  ${i + 1}. ${recipientATAs[i].toBase58()}: 0 токенов (аккаунт не найден)`);
        }
    }
}

async function claimTokens() {
    console.log('🎯 CLAIM ТОКЕНОВ ИЗ VESTING');
    console.log('=' .repeat(50));
    
    try {
        // Проверяем что контракт профинансирован
        if (!vestingData.funded) {
            console.error('❌ Vesting не профинансирован! Сначала запустите 2-fund.js');
            process.exit(1);
        }
        
        // Проверяем что caller это инициализатор
        if (vestingData.initializer !== payer.publicKey.toBase58()) {
            console.error('❌ Claim может выполнять только инициализатор!');
            console.log('  Инициализатор:', vestingData.initializer);
            console.log('  Текущий caller:', payer.publicKey.toBase58());
            process.exit(1);
        }
        
        console.log('📋 Данные vesting:');
        console.log('  Vesting PDA:', vestingData.vestingPDA);
        console.log('  Vault PDA:', vestingData.vaultPDA);
        console.log('  Токен:', vestingData.tokenMint);
        console.log('  Профинансировано:', (Number(vestingData.fundAmount) / 1e9).toFixed(2), 'токенов');
        
        const vestingPDA = new PublicKey(vestingData.vestingPDA);
        const vaultPDA = new PublicKey(vestingData.vaultPDA);
        const mint = new PublicKey(vestingData.tokenMint);
        
        // Рассчитываем vault authority PDA
        const [vaultAuthority] = await PublicKey.findProgramAddress(
            [Buffer.from('authority'), vestingPDA.toBuffer()],
            programId
        );
        console.log('  Vault Authority:', vaultAuthority.toBase58());
        
        // Создаем/получаем ATA для каждого получателя
        console.log('\n🔧 Подготовка ATA получателей:');
        const recipientATAs = [];
        
        for (let i = 0; i < vestingData.recipients.length; i++) {
            const recipient = vestingData.recipients[i];
            const recipientPubkey = new PublicKey(recipient.wallet);
            
            const ata = await getAssociatedTokenAddress(mint, recipientPubkey);
            recipientATAs.push(ata);
            
            // Обновляем под новый формат с basis points
            const percentage = recipient.basisPoints ? (recipient.basisPoints / 100) : recipient.percentage;
            console.log(`  ${i + 1}. ${recipient.wallet} (${percentage}%)`);
            console.log(`     ATA: ${ata.toBase58()}`);
            
            // Проверяем существует ли ATA, если нет - создаем
            try {
                await getAccount(connection, ata);
                console.log('     ✅ ATA существует');
            } catch (error) {
                console.log('     🔧 Создаем ATA...');
                
                const createATAInstruction = createAssociatedTokenAccountInstruction(
                    payer.publicKey,  // payer
                    ata,              // ata
                    recipientPubkey,  // owner
                    mint              // mint
                );
                
                const ataTx = new Transaction().add(createATAInstruction);
                const ataSignature = await sendAndConfirmTransaction(connection, ataTx, [payer]);
                console.log(`     ✅ ATA создан: ${ataSignature}`);
            }
        }
        
        // Проверяем текущие балансы
        await checkTokenBalances(recipientATAs, mint);
        
        // Создаем инструкцию claim
        console.log('\n🔄 Создание инструкции распределения...');
        
        const claimInstruction = createClaimInstruction(
            programId,
            payer.publicKey,      // initializer
            vestingPDA,
            vaultPDA,
            vaultAuthority,
            recipientATAs
        );
        
        console.log('📝 Параметры claim:');
        console.log('  Количество получателей:', recipientATAs.length);
        console.log('  Cliff период:', vestingData.cliffPeriod, 'секунд');
        
        // Обновляем под новый формат с basis points
        const tgePercentage = vestingData.tgeBasisPoints ? (vestingData.tgeBasisPoints / 100) : vestingData.tgePercentage;
        console.log('  TGE процент:', tgePercentage + '%');
        
        // Рассчитываем время с момента фандинга
        if (vestingData.fundTimestamp) {
            const fundTime = new Date(vestingData.fundTimestamp);
            const currentTime = new Date();
            const elapsedSeconds = Math.floor((currentTime - fundTime) / 1000);
            console.log('  Время с фандинга:', elapsedSeconds, 'секунд');
            
            if (elapsedSeconds < vestingData.cliffPeriod) {
                console.log(`  ⏳ До окончания cliff: ${vestingData.cliffPeriod - elapsedSeconds} секунд`);
                console.log(`  💡 Доступно для распределения: ${tgePercentage}% (TGE)`);
            } else {
                const vestingProgress = Math.min(100, 
                    tgePercentage + 
                    ((100 - tgePercentage) * (elapsedSeconds - vestingData.cliffPeriod) / (vestingData.vestingPeriod - vestingData.cliffPeriod))
                );
                console.log(`  💡 Доступно для распределения: ${vestingProgress.toFixed(2)}%`);
            }
        }
        
        // Отправляем транзакцию
        console.log('\n🚀 Отправка транзакции распределения...');
        const transaction = new Transaction().add(claimInstruction);
        
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [payer],
            { 
                commitment: 'confirmed',
                skipPreflight: false
            }
        );
        
        console.log('✅ РАСПРЕДЕЛЕНИЕ УСПЕШНО!');
        console.log('📜 Подпись транзакции:', signature);
        console.log('🌐 Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
        
        // Проверяем балансы после распределения
        console.log('\n🎉 Балансы после распределения:');
        await checkTokenBalances(recipientATAs, mint);
        
        // Обновляем данные
        if (!vestingData.claims) {
            vestingData.claims = [];
        }
        
        vestingData.claims.push({
            signature: signature,
            timestamp: new Date().toISOString(),
        });
        
        fs.writeFileSync('./vesting-data.json', JSON.stringify(vestingData, null, 2));
        console.log('💾 Данные обновлены в vesting-data.json');
        
    } catch (error) {
        console.error('❌ Ошибка claim:', error.message);
        
        // Выводим подробную информацию об ошибке
        if (error.logs) {
            console.log('\n📋 Логи транзакции:');
            error.logs.forEach((log, i) => {
                console.log(`  ${i}: ${log}`);
            });
        }
        
        process.exit(1);
    }
}

claimTokens();