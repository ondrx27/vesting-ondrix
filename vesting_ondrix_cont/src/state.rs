use solana_program::{
    program_error::ProgramError,
    pubkey::Pubkey,
    program_pack::{IsInitialized, Pack, Sealed},
};

pub const MAX_RECIPIENTS: usize = 10;
pub const BASIS_POINTS_TOTAL: u16 = 10000;  // ✅ CRITICAL FIX: 10000 = 100% for precision

#[derive(Debug, Clone, Copy)]
pub struct Recipient {
    pub wallet: Pubkey,
    pub basis_points: u16,  // ✅ CRITICAL FIX: Use basis points (0-10000) for precision
    pub claimed_amount: u64,
    pub last_claim_time: i64,
}

impl Default for Recipient {
    fn default() -> Self {
        Self {
            wallet: Pubkey::default(),
            basis_points: 0,  // ✅ CRITICAL FIX: Use basis points
            claimed_amount: 0,
            last_claim_time: 0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct VestingSchedule {
    /// Cliff период в секундах от start_time
    pub cliff_period: i64,
    /// Общий период вестинга в секундах от start_time
    pub vesting_period: i64,
    /// Basis points выпуска в TGE (Token Generation Event) - 0-10000
    pub tge_basis_points: u16,  // ✅ CRITICAL FIX: Use basis points for precision
}

impl Default for VestingSchedule {
    fn default() -> Self {
        Self {
            cliff_period: 0,
            vesting_period: 0,
            tge_basis_points: 0,  // ✅ CRITICAL FIX: Use basis points
        }
    }
}

// ✅ Безопасная структура VestingAccount с дополнительными полями
pub struct VestingAccount {
    /// Флаг инициализации аккаунта
    pub is_initialized: bool,
    /// Кошелек, который инициализировал вестинг
    pub initializer: Pubkey,
    /// Адрес токена
    pub mint: Pubkey,
    /// Токен аккаунт vault
    pub vault: Pubkey,
    /// Unix timestamp когда начинается вестинг (устанавливается при фандинге)
    pub start_time: i64,
    /// Общее количество токенов для вестинга
    pub total_amount: u64,
    /// Конфигурация расписания вестинга
    pub schedule: VestingSchedule,
    /// Массив получателей
    pub recipients: [Recipient; MAX_RECIPIENTS],
    /// Фактическое количество получателей
    pub recipient_count: u8,
    // ✅ REMOVED: is_revoked flag to ensure complete immutability
    // pub is_revoked: bool, // DELETED - no termination possible
    /// ✅ НОВОЕ: Флаг финализации (предотвращает изменения после фандинга)
    pub is_finalized: bool,
    /// ✅ НОВОЕ: Время последнего распределения (для cooldown)
    pub last_distribution_time: i64,
}

impl Sealed for VestingAccount {}

impl IsInitialized for VestingAccount {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}

impl Pack for VestingAccount {
    const LEN: usize = 1 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 2 + 1 + 1 + 8 + (MAX_RECIPIENTS * 50);

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
        if src.len() != Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }

        let is_initialized = src[0] != 0;
        
        let initializer = Pubkey::new_from_array(
            src[1..33].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        
        let mint = Pubkey::new_from_array(
            src[33..65].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        
        let vault = Pubkey::new_from_array(
            src[65..97].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        
        let start_time = i64::from_le_bytes(
            src[97..105].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        
        let total_amount = u64::from_le_bytes(
            src[105..113].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        
        let cliff_period = i64::from_le_bytes(
            src[113..121].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        
        let vesting_period = i64::from_le_bytes(
            src[121..129].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        
        let tge_basis_points = u16::from_le_bytes(
            src[129..131].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        let recipient_count = src[131];
        
        let is_finalized = src[132] != 0;
        let last_distribution_time = i64::from_le_bytes(
            src[133..141].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );

        let mut recipients = [Recipient::default(); MAX_RECIPIENTS];
        let mut offset = 141; 
        
        for i in 0..MAX_RECIPIENTS {
            let wallet = Pubkey::new_from_array(
                src[offset..offset + 32].try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?
            );
            let basis_points = u16::from_le_bytes(
                src[offset + 32..offset + 34].try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?
            );
            let claimed_amount = u64::from_le_bytes(
                src[offset + 34..offset + 42].try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?
            );
            let last_claim_time = i64::from_le_bytes(
                src[offset + 42..offset + 50].try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?
            );
            
            if i < recipient_count as usize {
                recipients[i] = Recipient { 
                    wallet, 
                    basis_points, 
                    claimed_amount,
                    last_claim_time,
                };
            } else {
                recipients[i] = Recipient::default();
            }
            offset += 50; 
        }

        Ok(VestingAccount {
            is_initialized,
            initializer,
            mint,
            vault,
            start_time,
            total_amount,
            schedule: VestingSchedule {
                cliff_period,
                vesting_period,
                tge_basis_points,
            },
            recipients,
            recipient_count,
            is_finalized,
            last_distribution_time,
        })
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {
        if dst.len() != Self::LEN {
            panic!("Invalid VestingAccount slice length");
        }

        dst[0] = if self.is_initialized { 1 } else { 0 };
        dst[1..33].copy_from_slice(self.initializer.as_ref());
        dst[33..65].copy_from_slice(self.mint.as_ref());
        dst[65..97].copy_from_slice(self.vault.as_ref());
        dst[97..105].copy_from_slice(&self.start_time.to_le_bytes());
        dst[105..113].copy_from_slice(&self.total_amount.to_le_bytes());
        dst[113..121].copy_from_slice(&self.schedule.cliff_period.to_le_bytes());
        dst[121..129].copy_from_slice(&self.schedule.vesting_period.to_le_bytes());
        dst[129..131].copy_from_slice(&self.schedule.tge_basis_points.to_le_bytes());
        dst[131] = self.recipient_count;
        
        dst[132] = if self.is_finalized { 1 } else { 0 };
        dst[133..141].copy_from_slice(&self.last_distribution_time.to_le_bytes());

        let mut offset = 141; 
        for recipient in &self.recipients {
            dst[offset..offset + 32].copy_from_slice(recipient.wallet.as_ref());
            dst[offset + 32..offset + 34].copy_from_slice(&recipient.basis_points.to_le_bytes());
            dst[offset + 34..offset + 42].copy_from_slice(&recipient.claimed_amount.to_le_bytes());
            dst[offset + 42..offset + 50].copy_from_slice(&recipient.last_claim_time.to_le_bytes());
            offset += 50; 
        }
    }
}