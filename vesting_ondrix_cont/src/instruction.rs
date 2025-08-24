use solana_program::{
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::state::{MAX_RECIPIENTS, BASIS_POINTS_TOTAL};

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

#[derive(Debug)]
pub enum VestingInstruction {
    InitializeVesting {
        recipients: Vec<RecipientData>,
        cliff_period: i64,
        vesting_period: i64,
        tge_basis_points: u16,
        nonce: u64,  
    },
    Fund(u64),
    Claim,
    
}

#[derive(Debug, Clone)]
pub struct RecipientData {
    pub wallet: Pubkey,
    pub basis_points: u16,  
}

impl VestingInstruction {
    pub fn try_from(data: &[u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(InstructionError::InvalidInstructionData.into());
        }

        match data[0] {
            0 => {
                if data.len() < 28 { 
                    return Err(InstructionError::InvalidInstructionData.into());
                }
                
                let recipient_count = data[1] as usize;
                if recipient_count == 0 || recipient_count > MAX_RECIPIENTS {
                    return Err(InstructionError::InvalidRecipientCount.into());
                }
                
                let cliff_period = i64::from_le_bytes(
                    data[2..10].try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?
                );
                let vesting_period = i64::from_le_bytes(
                    data[10..18].try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?
                );
                let tge_basis_points = u16::from_le_bytes(
                    data[18..20].try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?
                );
                let nonce = u64::from_le_bytes(
                    data[20..28].try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?
                );
                
                let recipient_data_size = recipient_count.saturating_mul(34);
                let expected_len = 28_usize.saturating_add(recipient_data_size);
                
                if recipient_data_size / 34 != recipient_count {
                    return Err(InstructionError::InvalidInstructionData.into());
                }
                
                if data.len() != expected_len {
                    return Err(InstructionError::InvalidInstructionData.into());
                }
                
                let mut recipients = Vec::with_capacity(recipient_count.min(MAX_RECIPIENTS));
                let mut offset = 28; 
                
                for _ in 0..recipient_count {
                    let wallet_bytes: [u8; 32] = data[offset..offset + 32]
                        .try_into()
                        .map_err(|_| InstructionError::InvalidInstructionData)?;
                    let wallet = Pubkey::new_from_array(wallet_bytes);
                    let basis_points = u16::from_le_bytes(
                        data[offset + 32..offset + 34].try_into()
                            .map_err(|_| InstructionError::InvalidInstructionData)?
                    );
                    
                    recipients.push(RecipientData {
                        wallet,
                        basis_points,  
                    });
                    
                    offset += 34;  
                }
                
                let total_basis_points: u32 = recipients.iter()
                    .map(|r| r.basis_points as u32)
                    .sum();
                if total_basis_points != BASIS_POINTS_TOTAL as u32 {
                    return Err(InstructionError::InvalidTotalPercentage.into());
                }
                
                Ok(VestingInstruction::InitializeVesting { 
                    recipients,
                    cliff_period,
                    vesting_period,
                    tge_basis_points,  
                    nonce,  
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
                Ok(VestingInstruction::Claim)
            }
            _ => Err(InstructionError::InvalidInstructionData.into()),
        }
    }
}