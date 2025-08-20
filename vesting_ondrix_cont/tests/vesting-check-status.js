
// check-status.js - Utility script to check vesting contract status
const {
    Connection,
    PublicKey,
    Keypair,
    SYSVAR_CLOCK_PUBKEY,
} = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');

const RPC_URL = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('ARcHZreUMoaJxgVxMLi7KLQX7xw3pqPsHgDk54uRY8vK');
const MINT_ADDRESS = new PublicKey('CaYYqEzktvpPXkqpFeUGrs5kt6QDk7vmnb5GVzydDJJb');
const INITIALIZER_KEYPAIR = Keypair.fromSecretKey(Uint8Array.from([121,57,255,6,112,96,247,20,173,144,245,221,185,78,101,113,207,219,147,111,45,236,157,151,173,203,143,55,221,30,40,148,109,97,131,212,128,246,139,74,2,92,61,150,14,249,22,118,144,216,76,1,17,4,254,205,67,217,187,163,42,252,14,128]));

async function main() {
    const connection = new Connection(RPC_URL, 'confirmed');
    const initializer = INITIALIZER_KEYPAIR.publicKey;

    console.log('=== Vesting Contract Status ===');
    console.log('Initializer:', initializer.toString());

    // 1. Calculate PDA addresses
    const [vestingPDA] = await PublicKey.findProgramAddress(
        [Buffer.from('vesting'), initializer.toBuffer()],
        PROGRAM_ID
    );
    const [vaultPDA] = await PublicKey.findProgramAddress(
        [Buffer.from('vault'), vestingPDA.toBuffer()],
        PROGRAM_ID
    );
    const [vaultAuthority] = await PublicKey.findProgramAddress(
        [Buffer.from('authority'), vestingPDA.toBuffer()],
        PROGRAM_ID
    );
    
    console.log('Vesting PDA:', vestingPDA.toString());
    console.log('Vault PDA:', vaultPDA.toString());
    console.log('Vault Authority:', vaultAuthority.toString());

    // 2. Check if vesting account exists
    const vestingPdaInfo = await connection.getAccountInfo(vestingPDA);
    if (!vestingPdaInfo) {
        console.log('❌ Vesting PDA does not exist. Run initialize script first.');
        return;
    }

    // 3. Parse vesting account data
    console.log('\n=== Vesting Account Data ===');
    const isInitialized = vestingPdaInfo.data[0] === 1;
    const mint = new PublicKey(vestingPdaInfo.data.slice(1, 33));
    const vault = new PublicKey(vestingPdaInfo.data.slice(33, 65));
    const startTime = Number(vestingPdaInfo.data.readBigInt64LE(65));
    const cliffDuration = Number(vestingPdaInfo.data.readBigInt64LE(73));
    const vestingDuration = Number(vestingPdaInfo.data.readBigInt64LE(81));
    const totalAmount = Number(vestingPdaInfo.data.readBigUInt64LE(89));
    const claimedAmount = Number(vestingPdaInfo.data.readBigUInt64LE(97));
    const recipientCount = vestingPdaInfo.data[105];

    console.log('Initialized:', isInitialized ? '✅' : '❌');
    console.log('Mint:', mint.toString());
    console.log('Vault:', vault.toString());
    console.log('Start Time:', startTime, startTime > 0 ? new Date(startTime * 1000).toISOString() : 'Not funded');
    console.log('Cliff Duration:', cliffDuration, 'seconds (', cliffDuration / (24 * 60 * 60), 'days)');
    console.log('Vesting Duration:', vestingDuration, 'seconds (', vestingDuration / (24 * 60 * 60), 'days)');
    console.log('Total Amount:', totalAmount);
    console.log('Claimed Amount:', claimedAmount);
    console.log('Recipient Count:', recipientCount);

    // 4. Parse recipients
    console.log('\n=== Recipients ===');
    const recipientsStartOffset = 106;
    for (let i = 0; i < recipientCount; i++) {
        const recipientOffset = recipientsStartOffset + (i * 41);
        const wallet = new PublicKey(vestingPdaInfo.data.slice(recipientOffset, recipientOffset + 32));
        const percentage = vestingPdaInfo.data[recipientOffset + 32];
        const lastClaimTime = Number(vestingPdaInfo.data.readBigInt64LE(recipientOffset + 33));
        
        console.log(`Recipient ${i + 1}:`);
        console.log('  Wallet:', wallet.toString());
        console.log('  Percentage:', percentage + '%');
        console.log('  Last Claim:', lastClaimTime, lastClaimTime > 0 ? new Date(lastClaimTime * 1000).toISOString() : 'Never claimed');
        
        // Check recipient's token balance
        try {
            const recipientAta = await getAssociatedTokenAddress(MINT_ADDRESS, wallet);
            const balance = await connection.getTokenAccountBalance(recipientAta);
            console.log('  Current Balance:', balance.value.uiAmount || 0);
        } catch (error) {
            console.log('  Current Balance: No ATA or 0');
        }
    }

    // 5. Check current time and vesting status
    if (startTime > 0) {
        console.log('\n=== Vesting Status ===');
        const clockInfo = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
        const currentTime = Number(clockInfo.data.readBigInt64LE(0));
        const elapsedTime = currentTime - startTime;
        
        console.log('Current Time:', currentTime, new Date(currentTime * 1000).toISOString());
        console.log('Elapsed Time:', elapsedTime, 'seconds');
        
        if (currentTime < startTime + cliffDuration) {
            const timeToCliff = (startTime + cliffDuration) - currentTime;
            console.log('Status: 🔒 In cliff period');
            console.log('Time until claimable:', timeToCliff, 'seconds (', timeToCliff / (24 * 60 * 60), 'days)');
        } else if (currentTime < startTime + vestingDuration) {
            const vestingProgress = (elapsedTime - cliffDuration) * 100 / (vestingDuration - cliffDuration);
            console.log('Status: 🔓 Vesting in progress');
            console.log('Vesting Progress:', Math.min(vestingProgress, 100).toFixed(2) + '%');
            
            const totalUnlocked = totalAmount * Math.min(vestingProgress, 100) / 100;
            const availableToClaim = totalUnlocked - claimedAmount;
            console.log('Total Unlocked:', totalUnlocked);
            console.log('Available to Claim:', availableToClaim);
        } else {
            console.log('Status: ✅ Fully vested');
            console.log('Available to Claim:', totalAmount - claimedAmount);
        }
    }

    // 6. Check vault balance
    console.log('\n=== Vault Status ===');
    try {
        const vaultBalance = await connection.getTokenAccountBalance(vaultPDA);
        console.log('Vault Balance:', vaultBalance.value.uiAmount);
        console.log('Vault Amount (raw):', vaultBalance.value.amount);
    } catch (error) {
        console.log('Vault Balance: Could not fetch -', error.message);
    }
    
    console.log('\n=== Status Check Complete ===');
}

main().catch((error) => {
    console.error('Error:', error);
});

