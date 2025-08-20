use solana_program::{
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::state::MAX_RECIPIENTS;

#[derive(Debug)]
pub enum InstructionError {
    InvalidInstructionData,
    InvalidRecipientCount,
    InvalidTotalPercentage,
}

impl From<InstructionError> for ProgramError {
    fn from(e: InstructionError) -> Self {
        ProgramError::Custom(e as u32 + 1000)
    }
}

// ✅ Безопасная версия инструкций без emergency функций
#[derive(Debug)]
pub enum VestingInstruction {
    /// Инициализация вестинга с получателями и расписанием
    /// Accounts:
    /// 0. `[signer]` Initializer
    /// 1. `[writable]` Vesting PDA
    /// 2. `[writable]` Vault PDA
    /// 3. `[]` Mint
    /// 4. `[]` System Program
    /// 5. `[]` Token Program
    /// 6. `[]` Rent Sysvar
    InitializeVesting {
        recipients: Vec<RecipientData>,
        cliff_period: i64,
        vesting_period: i64,
        tge_percentage: u8,
    },
    
    /// Фандинг vault'а вестинга
    /// Accounts:
    /// 0. `[signer]` Funder
    /// 1. `[writable]` Source Token Account
    /// 2. `[writable]` Vault PDA
    /// 3. `[writable]` Vesting PDA
    /// 4. `[]` Token Program
    /// 5. `[]` Clock Sysvar
    Fund(u64),
    
    /// ✅ Распределение разблокированных токенов (только инициатор)
    /// Accounts:
    /// 0. `[signer]` Initializer (должен совпадать с оригинальным)
    /// 1. `[writable]` Vesting PDA
    /// 2. `[writable]` Vault PDA
    /// 3. `[]` Token Program
    /// 4. `[]` Clock Sysvar
    /// 5. `[]` Vault Authority PDA
    /// 6+ `[writable]` Recipient ATAs (в правильном порядке)
    Claim,
    
    // ✅ УДАЛЕНО: EmergencyWithdraw для безопасности
}

#[derive(Debug, Clone)]
pub struct RecipientData {
    pub wallet: Pubkey,
    pub percentage: u8,
}

impl VestingInstruction {
    pub fn try_from(data: &[u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(InstructionError::InvalidInstructionData.into());
        }

        match data[0] {
            0 => {
                // InitializeVesting с получателями и расписанием
                if data.len() < 19 {
                    return Err(InstructionError::InvalidInstructionData.into());
                }
                
                let recipient_count = data[1] as usize;
                if recipient_count == 0 || recipient_count > MAX_RECIPIENTS {
                    return Err(InstructionError::InvalidRecipientCount.into());
                }
                
                // Чтение параметров расписания
                let cliff_period = i64::from_le_bytes(
                    data[2..10].try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?
                );
                let vesting_period = i64::from_le_bytes(
                    data[10..18].try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?
                );
                let tge_percentage = data[18];
                
                // Каждый получатель занимает 33 байта (32 для pubkey + 1 для процента)
                let expected_len = 19 + (recipient_count * 33);
                if data.len() != expected_len {
                    return Err(InstructionError::InvalidInstructionData.into());
                }
                
                let mut recipients = Vec::with_capacity(recipient_count);
                let mut offset = 19;
                
                for _ in 0..recipient_count {
                    let wallet_bytes: [u8; 32] = data[offset..offset + 32]
                        .try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?;
                    let wallet = Pubkey::new_from_array(wallet_bytes);
                    let percentage = data[offset + 32];
                    
                    recipients.push(RecipientData {
                        wallet,
                        percentage,
                    });
                    
                    offset += 33;
                }
                
                // ✅ Валидация что проценты в сумме дают 100
                let total_percentage: u16 = recipients.iter()
                    .map(|r| r.percentage as u16)
                    .sum();
                if total_percentage != 100 {
                    return Err(InstructionError::InvalidTotalPercentage.into());
                }
                
                Ok(VestingInstruction::InitializeVesting { 
                    recipients,
                    cliff_period,
                    vesting_period,
                    tge_percentage,
                })
            }
            1 => {
                // Fund
                if data.len() != 9 {
                    return Err(InstructionError::InvalidInstructionData.into());
                }
                let amount = u64::from_le_bytes(
                    data[1..9].try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?
                );
                Ok(VestingInstruction::Fund(amount))
            }
            2 => {
                // ✅ Claim - только централизованное распределение
                Ok(VestingInstruction::Claim)
            }
            // ✅ УДАЛЕНО: инструкция 3 (EmergencyWithdraw) для безопасности
            _ => Err(InstructionError::InvalidInstructionData.into()),
        }
    }
}