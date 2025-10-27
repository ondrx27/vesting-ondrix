# Environment Variables Setup

## Required Environment Variables

### BNB Chain Configuration
```env
BNB_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545
BNB_CONTRACT_ADDRESS=0xYourContractAddress
BNB_CHAIN_ID=97
BNB_PRIVATE_KEY=0xYourPrivateKey
```

### Solana Configuration
```env
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=YourProgramId
SOLANA_PRIVATE_KEY=YourSolanaPrivateKey
SOLANA_VESTING_PDA=YourVestingPDAAddress
```

### Optional Configuration
```env
KNOWN_INITIALIZER=0xea755aBa09CaAc2F73C4b6288256FF4Ae88beFbC
```

## Important Notes

- **SOLANA_VESTING_PDA**: This is the Program Derived Address (PDA) for your vesting account. It's generated when you initialize the vesting contract and contains all vesting data including recipients, amounts, and schedules.

- **Basis Points**: The new contract uses basis points (0-10000) instead of percentages (0-100) for higher precision. 10000 basis points = 100%.

- **Token Decimals**: Solana tokens use 9 decimals, BNB tokens use 18 decimals. The frontend automatically handles this conversion.

## Security

- Never commit private keys to version control
- Use environment files (.env) that are ignored by git
- Store sensitive data securely in production environments