use solana_program::{
    program_error::ProgramError,
    pubkey::Pubkey,
    program_pack::{IsInitialized, Pack, Sealed},
};

pub const MAX_RECIPIENTS: usize = 10;

#[derive(Debug, Clone, Copy)]
pub struct Recipient {
    pub wallet: Pubkey,
    pub percentage: u8,
    pub claimed_amount: u64,
    pub last_claim_time: i64,
}

impl Default for Recipient {
    fn default() -> Self {
        Self {
            wallet: Pubkey::default(),
            percentage: 0,
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
    /// Процент выпуска в TGE (Token Generation Event)
    pub tge_percentage: u8,
}

impl Default for VestingSchedule {
    fn default() -> Self {
        Self {
            cliff_period: 0,
            vesting_period: 0,
            tge_percentage: 0,
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
    /// Флаг экстренной отмены
    pub is_revoked: bool,
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
    // ✅ Обновленный размер с новыми полями
    const LEN: usize = 1 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 1 + 8 + (MAX_RECIPIENTS * 49);
    //                is_init + initializer + mint + vault + start_time + total_amount + cliff + vesting + tge% + count + revoked + finalized + last_dist_time + recipients

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
        
        let tge_percentage = src[129];
        let recipient_count = src[130];
        let is_revoked = src[131] != 0;
        
        // ✅ НОВЫЕ ПОЛЯ
        let is_finalized = src[132] != 0;
        let last_distribution_time = i64::from_le_bytes(
            src[133..141].try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?
        );

        let mut recipients = [Recipient::default(); MAX_RECIPIENTS];
        let mut offset = 141; // Обновленный offset
        
        for i in 0..MAX_RECIPIENTS {
            let wallet = Pubkey::new_from_array(
                src[offset..offset + 32].try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?
            );
            let percentage = src[offset + 32];
            let claimed_amount = u64::from_le_bytes(
                src[offset + 33..offset + 41].try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?
            );
            let last_claim_time = i64::from_le_bytes(
                src[offset + 41..offset + 49].try_into()
                    .map_err(|_| ProgramError::InvalidAccountData)?
            );
            
            recipients[i] = Recipient { 
                wallet, 
                percentage, 
                claimed_amount,
                last_claim_time,
            };
            offset += 49;
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
                tge_percentage,
            },
            recipients,
            recipient_count,
            is_revoked,
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
        dst[129] = self.schedule.tge_percentage;
        dst[130] = self.recipient_count;
        dst[131] = if self.is_revoked { 1 } else { 0 };
        
        // ✅ НОВЫЕ ПОЛЯ
        dst[132] = if self.is_finalized { 1 } else { 0 };
        dst[133..141].copy_from_slice(&self.last_distribution_time.to_le_bytes());

        let mut offset = 141; // Обновленный offset
        for recipient in &self.recipients {
            dst[offset..offset + 32].copy_from_slice(recipient.wallet.as_ref());
            dst[offset + 32] = recipient.percentage;
            dst[offset + 33..offset + 41].copy_from_slice(&recipient.claimed_amount.to_le_bytes());
            dst[offset + 41..offset + 49].copy_from_slice(&recipient.last_claim_time.to_le_bytes());
            offset += 49;
        }
    }
}