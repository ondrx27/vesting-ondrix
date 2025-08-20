use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::{invoke_signed, invoke},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
    program_pack::Pack,
};
use spl_token::{
    instruction::{initialize_account2, transfer},
    state::Account as TokenAccount,
};
use spl_associated_token_account::get_associated_token_address;
use std::collections::HashSet;

use crate::instruction::{VestingInstruction, RecipientData};
use crate::state::{VestingAccount, Recipient, VestingSchedule};

#[derive(Debug, Clone, Copy)]
pub enum VestingError {
    NotSigner,
    InvalidSystemProgram,
    InvalidTokenProgram,
    InvalidRentSysvar,
    InvalidVestingPeriod,
    CliffExceedsVesting,
    InvalidPercentage,
    InvalidRecipientCount,
    InvalidTotalPercentage,
    DuplicateRecipient,
    ZeroPercentage,
    InvalidPDA,
    AlreadyInitialized,
    NotInitialized,
    AlreadyFunded,
    InvalidAmount,
    InvalidTokenOwner,
    MintMismatch,
    InsufficientFunds,
    VestingRevoked,
    NotFunded,
    InvalidAuthority,
    InvalidRecipientATA,
    NoClaimableAmount,
    UnauthorizedAccess,
    NotInitializer,
    VestingFinalized,
    DistributionCooldown,
    VestingDurationTooLong,
    CliffDurationTooLong,
}

impl From<VestingError> for ProgramError {
    fn from(e: VestingError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ✅ Константы безопасности
const MAX_VESTING_DURATION: i64 = 365 * 24 * 60 * 60; // 1 год
const MAX_CLIFF_DURATION: i64 = 90 * 24 * 60 * 60;    // 90 дней
const DISTRIBUTION_COOLDOWN: i64 = 60;                 // 1 минута между распределениями

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = VestingInstruction::try_from(instruction_data)?;

    match instruction {
        VestingInstruction::InitializeVesting { 
            recipients, 
            cliff_period,
            vesting_period,
            tge_percentage 
        } => {
            process_initialize_vesting(
                program_id,
                accounts,
                recipients,
                cliff_period,
                vesting_period,
                tge_percentage
            )
        }
        VestingInstruction::Fund(amount) => {
            process_fund(program_id, accounts, amount)
        }
        VestingInstruction::Claim => {
            // ✅ Только централизованное распределение через инициатора
            process_distribute_to_all(program_id, accounts)
        }
        // ✅ УДАЛЕНО: EmergencyWithdraw для безопасности
    }
}

fn process_initialize_vesting(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    recipients: Vec<RecipientData>,
    cliff_period: i64,
    vesting_period: i64,
    tge_percentage: u8,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let vesting_pda = next_account_info(account_info_iter)?;
    let vault_pda = next_account_info(account_info_iter)?;
    let mint = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let rent_info = next_account_info(account_info_iter)?;

    msg!("InitializeVesting: Starting secure initialization");
    
    // ✅ Проверки безопасности
    if !initializer.is_signer {
        return Err(VestingError::NotSigner.into());
    }

    if system_program.key != &solana_program::system_program::ID {
        return Err(VestingError::InvalidSystemProgram.into());
    }
    
    if token_program.key != &spl_token::ID {
        return Err(VestingError::InvalidTokenProgram.into());
    }
    
    if rent_info.key != &solana_program::sysvar::rent::ID {
        return Err(VestingError::InvalidRentSysvar.into());
    }

    // ✅ Проверка максимальных лимитов безопасности
    if vesting_period > MAX_VESTING_DURATION {
        msg!("Vesting duration too long: {} > {}", vesting_period, MAX_VESTING_DURATION);
        return Err(VestingError::VestingDurationTooLong.into());
    }

    if cliff_period > MAX_CLIFF_DURATION {
        msg!("Cliff duration too long: {} > {}", cliff_period, MAX_CLIFF_DURATION);
        return Err(VestingError::CliffDurationTooLong.into());
    }

    if cliff_period >= vesting_period {
        return Err(VestingError::CliffExceedsVesting.into());
    }

    if tge_percentage > 100 {
        return Err(VestingError::InvalidPercentage.into());
    }

    // Валидация получателей
    if recipients.is_empty() || recipients.len() > 10 {
        return Err(VestingError::InvalidRecipientCount.into());
    }
    
    let total_percentage: u16 = recipients.iter()
        .map(|r| r.percentage as u16)
        .sum();
    if total_percentage != 100 {
        return Err(VestingError::InvalidTotalPercentage.into());
    }

    // ✅ Проверка на дубликаты получателей
    let mut seen_wallets = HashSet::new();
    for recipient in &recipients {
        if !seen_wallets.insert(recipient.wallet) {
            return Err(VestingError::DuplicateRecipient.into());
        }
        if recipient.percentage == 0 {
            return Err(VestingError::ZeroPercentage.into());
        }
    }

    // Проверка и создание PDA
    let (vesting_address, vesting_bump) = 
        Pubkey::find_program_address(&[b"vesting", initializer.key.as_ref()], program_id);
    let (vault_address, vault_bump) = 
        Pubkey::find_program_address(&[b"vault", vesting_address.as_ref()], program_id);
    
    if vesting_pda.key != &vesting_address || vault_pda.key != &vault_address {
        return Err(VestingError::InvalidPDA.into());
    }

    // ✅ Проверка что аккаунт еще не инициализирован
    if !vesting_pda.data_is_empty() {
        return Err(VestingError::AlreadyInitialized.into());
    }

    // Создание vesting аккаунта
    let rent = Rent::from_account_info(rent_info)?;
    let vesting_lamports = rent.minimum_balance(VestingAccount::LEN);
    
    invoke_signed(
        &system_instruction::create_account(
            initializer.key,
            vesting_pda.key,
            vesting_lamports,
            VestingAccount::LEN as u64,
            program_id,
        ),
        &[
            initializer.clone(),
            vesting_pda.clone(),
            system_program.clone(),
        ],
        &[&[b"vesting", initializer.key.as_ref(), &[vesting_bump]]],
    )?;

    // Создание vault токен аккаунта
    let token_rent = rent.minimum_balance(TokenAccount::LEN);
    
    invoke_signed(
        &system_instruction::create_account(
            initializer.key,
            vault_pda.key,
            token_rent,
            TokenAccount::LEN as u64,
            token_program.key,
        ),
        &[
            initializer.clone(),
            vault_pda.clone(),
            system_program.clone(),
        ],
        &[&[b"vault", vesting_pda.key.as_ref(), &[vault_bump]]],
    )?;

    // Инициализация токен аккаунта с PDA authority
    let (vault_authority, auth_bump) = 
        Pubkey::find_program_address(&[b"authority", vesting_pda.key.as_ref()], program_id);
    
    invoke_signed(
        &initialize_account2(
            token_program.key,
            vault_pda.key,
            mint.key,
            &vault_authority,
        )?,
        &[
            vault_pda.clone(),
            mint.clone(),
            rent_info.clone(),
            token_program.clone(),
        ],
        &[&[b"authority", vesting_pda.key.as_ref(), &[auth_bump]]],
    )?;

    // Конвертация получателей в фиксированный массив
    let mut fixed_recipients = [Recipient::default(); 10];
    for (i, recipient) in recipients.iter().enumerate() {
        if i >= 10 { break; }
        fixed_recipients[i] = Recipient {
            wallet: recipient.wallet,
            percentage: recipient.percentage,
            claimed_amount: 0,
            last_claim_time: 0,
        };
    }

    // ✅ Инициализация данных vesting аккаунта (НЕ финализированный)
    let vesting = VestingAccount {
        is_initialized: true,
        initializer: *initializer.key,
        mint: *mint.key,
        vault: *vault_pda.key,
        start_time: 0, // Устанавливается при фандинге
        total_amount: 0, // Устанавливается при фандинге
        schedule: VestingSchedule {
            cliff_period,
            vesting_period,
            tge_percentage,
        },
        recipients: fixed_recipients,
        recipient_count: recipients.len() as u8,
        is_revoked: false,
        is_finalized: false, // ✅ Добавлено: предотвращает изменения после фандинга
        last_distribution_time: 0, // ✅ Для cooldown между распределениями
    };

    vesting.pack_into_slice(&mut vesting_pda.data.borrow_mut());
    msg!("InitializeVesting: Secure initialization completed");
    
    Ok(())
}

fn process_fund(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let funder = next_account_info(account_info_iter)?;
    let source_token = next_account_info(account_info_iter)?;
    let vault_pda = next_account_info(account_info_iter)?;
    let vesting_pda = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let clock = next_account_info(account_info_iter)?;

    msg!("Fund: Starting secure funding with amount {}", amount);

    // ✅ Проверки безопасности
    if !funder.is_signer {
        return Err(VestingError::NotSigner.into());
    }

    if amount == 0 {
        return Err(VestingError::InvalidAmount.into());
    }

    let mut vesting = VestingAccount::unpack_from_slice(&vesting_pda.data.borrow())?;
    
    if !vesting.is_initialized {
        return Err(VestingError::NotInitialized.into());
    }
    
    if vesting.start_time != 0 {
        return Err(VestingError::AlreadyFunded.into());
    }

    // ✅ Проверка что еще не финализирован
    if vesting.is_finalized {
        return Err(VestingError::VestingFinalized.into());
    }

    // Проверка vault PDA
    let (vault_address, _) = 
        Pubkey::find_program_address(&[b"vault", vesting_pda.key.as_ref()], program_id);
    if vault_pda.key != &vault_address {
        return Err(VestingError::InvalidPDA.into());
    }

    // ✅ Валидация source токен аккаунта
    let source_account = TokenAccount::unpack(&source_token.data.borrow())?;
    if source_account.owner != *funder.key {
        return Err(VestingError::InvalidTokenOwner.into());
    }
    
    if source_account.mint != vesting.mint {
        return Err(VestingError::MintMismatch.into());
    }
    
    if source_account.amount < amount {
        return Err(VestingError::InsufficientFunds.into());
    }

    // Перевод токенов в vault
    invoke(
        &transfer(
            token_program.key,
            source_token.key,
            vault_pda.key,
            funder.key,
            &[],
            amount,
        )?,
        &[
            source_token.clone(),
            vault_pda.clone(),
            funder.clone(),
            token_program.clone(),
        ],
    )?;

    // ✅ Установка времени старта и финализация
    let clock = Clock::from_account_info(clock)?;
    vesting.start_time = clock.unix_timestamp;
    vesting.total_amount = amount;
    vesting.is_finalized = true; // ✅ Финализируем - больше нельзя изменить
    vesting.pack_into_slice(&mut vesting_pda.data.borrow_mut());
    
    msg!("Fund: Secure funding completed at timestamp {}", vesting.start_time);
    
    Ok(())
}

// ✅ ОСНОВНАЯ ФУНКЦИЯ: Только инициатор может распределять токены
fn process_distribute_to_all(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let vesting_pda = next_account_info(account_info_iter)?;
    let vault_pda = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let clock = next_account_info(account_info_iter)?;
    let vault_authority = next_account_info(account_info_iter)?;
    
    // Остальные аккаунты - это ATA получателей
    let recipient_atas: Vec<&AccountInfo> = account_info_iter.collect();

    msg!("DistributeToAll: Starting secure centralized distribution");

    // ✅ КРИТИЧНАЯ ПРОВЕРКА: Только подписант может вызвать
    if !initializer.is_signer {
        return Err(VestingError::NotSigner.into());
    }

    let mut vesting = VestingAccount::unpack_from_slice(&vesting_pda.data.borrow())?;
    
    if !vesting.is_initialized {
        return Err(VestingError::NotInitialized.into());
    }
    
    // ✅ КРИТИЧНАЯ ПРОВЕРКА: Только оригинальный инициатор
    if vesting.initializer != *initializer.key {
        msg!("SECURITY ERROR: Unauthorized access attempt. Expected: {}, Got: {}", 
            vesting.initializer, initializer.key);
        return Err(VestingError::NotInitializer.into());
    }
    
    if vesting.is_revoked {
        return Err(VestingError::VestingRevoked.into());
    }
    
    if vesting.start_time == 0 {
        return Err(VestingError::NotFunded.into());
    }

    // ✅ Проверка что финализирован
    if !vesting.is_finalized {
        return Err(VestingError::VestingFinalized.into());
    }

    let clock = Clock::from_account_info(clock)?;
    let current_time = clock.unix_timestamp;
    
    // ✅ Проверка cooldown между распределениями
    if vesting.last_distribution_time > 0 {
        let time_since_last = current_time - vesting.last_distribution_time;
        if time_since_last < DISTRIBUTION_COOLDOWN {
            msg!("Distribution cooldown active. {} seconds remaining", 
                DISTRIBUTION_COOLDOWN - time_since_last);
            return Err(VestingError::DistributionCooldown.into());
        }
    }

    // Проверка vault authority PDA
    let (vault_authority_key, auth_bump) = 
        Pubkey::find_program_address(&[b"authority", vesting_pda.key.as_ref()], program_id);
    
    if vault_authority.key != &vault_authority_key {
        return Err(VestingError::InvalidAuthority.into());
    }

    // ✅ Проверка достаточного количества ATA
    if recipient_atas.len() < vesting.recipient_count as usize {
        msg!("ERROR: Not enough recipient ATAs. Need: {}, Got: {}", 
            vesting.recipient_count, recipient_atas.len());
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // ✅ Дополнительная проверка vault токенов
    let vault_account = TokenAccount::unpack(&vault_pda.data.borrow())?;
    if vault_account.mint != vesting.mint {
        return Err(VestingError::MintMismatch.into());
    }

    let mut total_distributed = 0u64;
    let mut successful_distributions = 0u8;
    
    // Обработка каждого получателя
    for i in 0..vesting.recipient_count as usize {
        let recipient = &mut vesting.recipients[i];
        
        // Пропускаем пустые слоты
        if recipient.wallet == Pubkey::default() || recipient.percentage == 0 {
            continue;
        }

        // Расчет доступных токенов для этого получателя
        let recipient_total = (vesting.total_amount as u128 * recipient.percentage as u128 / 100) as u64;
        let vested_amount = calculate_vested_amount(
            recipient_total,
            current_time,
            vesting.start_time,
            &vesting.schedule,
        );
        
        let claimable = vested_amount.saturating_sub(recipient.claimed_amount);
        
        if claimable == 0 {
            msg!("DistributeToAll: No tokens to distribute for recipient {}", i);
            continue;
        }

        // ✅ Проверка ожидаемого ATA
        let expected_ata = get_associated_token_address(&recipient.wallet, &vesting.mint);
        let recipient_ata = recipient_atas[i];
        
        if recipient_ata.key != &expected_ata {
            msg!("ERROR: Invalid ATA for recipient {}. Expected: {}, Got: {}", 
                i, expected_ata, recipient_ata.key);
            return Err(VestingError::InvalidRecipientATA.into());
        }

        // ✅ Безопасный перевод токенов
        msg!("DistributeToAll: Sending {} tokens to recipient {} ({})", 
             claimable, i, recipient.wallet);
        
        invoke_signed(
            &transfer(
                token_program.key,
                vault_pda.key,
                recipient_ata.key,
                &vault_authority_key,
                &[],
                claimable,
            )?,
            &[
                vault_pda.clone(),
                recipient_ata.clone(),
                vault_authority.clone(),
                token_program.clone(),
            ],
            &[&[b"authority", vesting_pda.key.as_ref(), &[auth_bump]]],
        )?;
        
        // Обновление данных получателя
        recipient.claimed_amount += claimable;
        recipient.last_claim_time = current_time;
        total_distributed += claimable;
        successful_distributions += 1;
        
        msg!("DistributeToAll: Successfully distributed {} tokens to recipient {}", 
             claimable, i);
    }

    if total_distributed == 0 {
        msg!("DistributeToAll: No tokens were distributed to any recipients");
        return Err(VestingError::NoClaimableAmount.into());
    }

    // ✅ Обновление времени последнего распределения
    vesting.last_distribution_time = current_time;
    vesting.pack_into_slice(&mut vesting_pda.data.borrow_mut());
    
    msg!("DistributeToAll: Successfully distributed {} tokens to {} recipients", 
         total_distributed, successful_distributions);
    
    Ok(())
}

// ✅ УДАЛЕНО: process_emergency_withdraw для безопасности

/// Расчет доступных токенов на основе времени
fn calculate_vested_amount(
    total_amount: u64,
    current_time: i64,
    start_time: i64,
    _schedule: &VestingSchedule,
) -> u64 {
    if current_time < start_time {
        return 0;
    }

    let elapsed = current_time - start_time;
    
    // ✅ Пошаговое расписание вестинга
    // 0-5 минут: 10%
    // 5-10 минут: 20%
    // 10-15 минут: 50%
    // 15-20 минут: 100%
    
    let percentage = match elapsed {
        0..=299 => 10,        // 0-5 минут (300 секунд)
        300..=599 => 20,      // 5-10 минут
        600..=899 => 50,      // 10-15 минут
        900..=1199 => 100,    // 15-20 минут
        _ => 100,             // После 20 минут
    };
    
    msg!("Vesting calculation: elapsed={} seconds, percentage={}%", elapsed, percentage);
    
    (total_amount as u128 * percentage as u128 / 100) as u64
}