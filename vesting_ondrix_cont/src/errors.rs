use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone)]
pub enum VestingError {
    #[error("Not a signer")]
    NotSigner,
    
    #[error("Invalid system program")]
    InvalidSystemProgram,
    
    #[error("Invalid token program")]
    InvalidTokenProgram,
    
    #[error("Invalid rent sysvar")]
    InvalidRentSysvar,
    
    #[error("Invalid vesting period")]
    InvalidVestingPeriod,
    
    #[error("Cliff period exceeds vesting period")]
    CliffExceedsVesting,
    
    #[error("Invalid percentage")]
    InvalidPercentage,
    
    #[error("Invalid recipient count")]
    InvalidRecipientCount,
    
    #[error("Total percentage must equal 100")]
    InvalidTotalPercentage,
    
    #[error("Duplicate recipient")]
    DuplicateRecipient,
    
    #[error("Zero percentage not allowed")]
    ZeroPercentage,
    
    #[error("Invalid PDA")]
    InvalidPDA,
    
    #[error("Already initialized")]
    AlreadyInitialized,
    
    #[error("Not initialized")]
    NotInitialized,
    
    #[error("Already funded")]
    AlreadyFunded,
    
    #[error("Invalid amount")]
    InvalidAmount,
    
    #[error("Invalid token owner")]
    InvalidTokenOwner,
    
    #[error("Mint mismatch")]
    MintMismatch,
    
    #[error("Insufficient funds")]
    InsufficientFunds,
    
    #[error("Vesting revoked")]
    VestingRevoked,
    
    #[error("Not funded")]
    NotFunded,
    
    #[error("Invalid authority")]
    InvalidAuthority,
    
    #[error("Invalid recipient ATA")]
    InvalidRecipientATA,
    
    #[error("No claimable amount")]
    NoClaimableAmount,
    
    #[error("Unauthorized access")]
    UnauthorizedAccess,
    
    #[error("Already revoked")]
    AlreadyRevoked,
    
    #[error("No tokens to withdraw")]
    NoTokensToWithdraw,
    
    #[error("Overflow in calculation")]
    Overflow,
    
    #[error("Underflow in calculation")]
    Underflow,
    
    #[error("Invalid instruction data")]
    InvalidInstructionData,
}

impl From<VestingError> for ProgramError {
    fn from(e: VestingError) -> Self {
        ProgramError::Custom(e as u32)
    }
}