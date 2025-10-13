use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    program::{invoke_signed, invoke},
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
    program_pack::Pack,
};
use spl_token::{
    instruction::{initialize_account2, transfer},
    state::{Account as TokenAccount, Mint},
};
use spl_associated_token_account::get_associated_token_address;
use std::collections::HashSet;

use crate::instruction::{VestingInstruction, RecipientData};
use crate::state::{VestingAccount, Recipient, VestingSchedule, MAX_RECIPIENTS, BASIS_POINTS_TOTAL};
use crate::errors::VestingError;


const MAX_VESTING_DURATION: i64 = 4 * 365 * 24 * 60 * 60; 
const MAX_CLIFF_DURATION: i64 = 365 * 24 * 60 * 60;        
const DISTRIBUTION_COOLDOWN: i64 = 60;                     

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
            tge_basis_points,
            nonce
        } => {
            process_initialize_vesting(
                program_id,
                accounts,
                recipients,
                cliff_period,
                vesting_period,
                tge_basis_points,
                nonce
            )
        }
        VestingInstruction::Fund(amount) => {
            process_fund(program_id, accounts, amount)
        }
        VestingInstruction::Claim => {
            process_distribute_to_all(program_id, accounts)
        }
    }
}

fn process_initialize_vesting(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    recipients: Vec<RecipientData>,
    cliff_period: i64,
    vesting_period: i64,
    tge_basis_points: u16,
    nonce: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let initializer = next_account_info(account_info_iter)?;
    let vesting_pda = next_account_info(account_info_iter)?;
    let vault_pda = next_account_info(account_info_iter)?;
    let mint = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;
    let token_program = next_account_info(account_info_iter)?;
    let rent_info = next_account_info(account_info_iter)?;

    if !initializer.is_signer {
        return Err(VestingError::NotSigner.into());
    }

    if !vesting_pda.data_is_empty() {
        return Err(VestingError::AlreadyInitialized.into());
    }
    
    if vesting_pda.owner != &solana_program::system_program::ID {
        return Err(VestingError::InvalidAccountOwner.into());
    }
    
    if vault_pda.owner != &solana_program::system_program::ID {
        return Err(VestingError::InvalidAccountOwner.into());
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

    if mint.owner != &spl_token::ID {
        return Err(VestingError::InvalidMint.into());
    }
    let _mint_info = Mint::unpack(&mint.data.borrow())?;

    if vesting_period > MAX_VESTING_DURATION {
        return Err(VestingError::VestingDurationTooLong.into());
    }

    if cliff_period > MAX_CLIFF_DURATION {
        return Err(VestingError::CliffDurationTooLong.into());
    }

    if cliff_period >= vesting_period {
        return Err(VestingError::CliffExceedsVesting.into());
    }

    if tge_basis_points > BASIS_POINTS_TOTAL {
        return Err(VestingError::InvalidPercentage.into());
    }

    if recipients.is_empty() || recipients.len() > MAX_RECIPIENTS {
        return Err(VestingError::InvalidRecipientCount.into());
    }
    
    let total_basis_points: u32 = recipients.iter()
        .map(|r| r.basis_points as u32)
        .sum();
    if total_basis_points != BASIS_POINTS_TOTAL as u32 {
        return Err(VestingError::InvalidTotalPercentage.into());
    }

    let mut seen_wallets = HashSet::new();
    for recipient in &recipients {
        if recipient.wallet == Pubkey::default() {
            return Err(VestingError::InvalidRecipientWallet.into());
        }
        if !seen_wallets.insert(recipient.wallet) {
            return Err(VestingError::DuplicateRecipient.into());
        }
        if recipient.basis_points == 0 {
            return Err(VestingError::ZeroPercentage.into());
        }
    }

    let (vesting_address, vesting_bump) = 
        Pubkey::find_program_address(&[b"vesting", initializer.key.as_ref(), &nonce.to_le_bytes()], program_id);
    let (vault_address, vault_bump) = 
        Pubkey::find_program_address(&[b"vault", vesting_address.as_ref()], program_id);
    
    if vesting_pda.key != &vesting_address || vault_pda.key != &vault_address {
        return Err(VestingError::InvalidPDA.into());
    }

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
        &[&[b"vesting", initializer.key.as_ref(), &nonce.to_le_bytes(), &[vesting_bump]]],
    )?;

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

    let mut fixed_recipients = [Recipient::default(); MAX_RECIPIENTS];
    for (i, recipient) in recipients.iter().enumerate() {
        if i >= MAX_RECIPIENTS { break; }
        fixed_recipients[i] = Recipient {
            wallet: recipient.wallet,
            basis_points: recipient.basis_points, 
            claimed_amount: 0,
            last_claim_time: 0,
        };
    }

    let vesting = VestingAccount {
        is_initialized: true,
        initializer: *initializer.key,
        mint: *mint.key,
        vault: *vault_pda.key,
        start_time: 0, 
        total_amount: 0, 
        schedule: VestingSchedule {
            cliff_period,
            vesting_period,
            tge_basis_points,
        },
        recipients: fixed_recipients,
        recipient_count: recipients.len() as u8,
        is_finalized: false,
        last_distribution_time: 0, 
    };

    vesting.pack_into_slice(&mut vesting_pda.data.borrow_mut());
    
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

    if !funder.is_signer {
        return Err(VestingError::NotSigner.into());
    }

    if vesting_pda.owner != program_id {
        return Err(VestingError::InvalidAccountOwner.into());
    }
    if vault_pda.owner != &spl_token::ID {
        return Err(VestingError::InvalidAccountOwner.into());
    }
    if source_token.owner != &spl_token::ID {
        return Err(VestingError::InvalidAccountOwner.into());
    }

    if clock.key != &solana_program::sysvar::clock::ID {
        return Err(VestingError::InvalidClockSysvar.into());
    }

    if token_program.key != &spl_token::ID {
        return Err(VestingError::InvalidTokenProgram.into());
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

    if vesting.is_finalized {
        return Err(VestingError::VestingFinalized.into());
    }

    let (vault_address, _) = 
        Pubkey::find_program_address(&[b"vault", vesting_pda.key.as_ref()], program_id);
    if vault_pda.key != &vault_address {
        return Err(VestingError::InvalidPDA.into());
    }

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

    let clock = Clock::from_account_info(clock)?;
    vesting.start_time = clock.unix_timestamp;
    vesting.total_amount = amount;
    vesting.is_finalized = true;
    vesting.pack_into_slice(&mut vesting_pda.data.borrow_mut());
    
    Ok(())
}

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
    
    let recipient_atas: Vec<&AccountInfo> = account_info_iter.collect();

    if !initializer.is_signer {
        return Err(VestingError::NotSigner.into());
    }

    if vesting_pda.owner != program_id {
        return Err(VestingError::InvalidAccountOwner.into());
    }
    if vault_pda.owner != &spl_token::ID {
        return Err(VestingError::InvalidAccountOwner.into());
    }
    if token_program.key != &spl_token::ID {
        return Err(VestingError::InvalidTokenProgram.into());
    }
    if clock.key != &solana_program::sysvar::clock::ID {
        return Err(VestingError::InvalidClockSysvar.into());
    }

    let mut vesting = VestingAccount::unpack_from_slice(&vesting_pda.data.borrow())?;
    
    if !vesting.is_initialized {
        return Err(VestingError::NotInitialized.into());
    }
    
    if vesting.initializer != *initializer.key {
        return Err(VestingError::NotInitializer.into());
    }
    
    
    if vesting.start_time == 0 {
        return Err(VestingError::NotFunded.into());
    }

    if !vesting.is_finalized {
        return Err(VestingError::NotFinalized.into());
    }

    let clock = Clock::from_account_info(clock)?;
    let current_time = clock.unix_timestamp;
    
    if vesting.last_distribution_time > 0 {
        let time_since_last = current_time - vesting.last_distribution_time;
        if time_since_last < DISTRIBUTION_COOLDOWN {
            return Err(VestingError::DistributionCooldown.into());
        }
    }

    let (vault_address, _) = 
        Pubkey::find_program_address(&[b"vault", vesting_pda.key.as_ref()], program_id);
    if vault_pda.key != &vault_address {
        return Err(VestingError::InvalidPDA.into());
    }

    let (vault_authority_key, auth_bump) = 
        Pubkey::find_program_address(&[b"authority", vesting_pda.key.as_ref()], program_id);
    
    if vault_authority.key != &vault_authority_key {
        return Err(VestingError::InvalidAuthority.into());
    }

    if recipient_atas.len() != vesting.recipient_count as usize {
        return Err(VestingError::InvalidATACount.into());
    }

    let vault_account = TokenAccount::unpack(&vault_pda.data.borrow())?;
    if vault_account.owner != vault_authority_key {
        return Err(VestingError::InvalidTokenOwner.into());
    }
    if vault_account.mint != vesting.mint {
        return Err(VestingError::MintMismatch.into());
    }

    let mut total_distributed = 0u64;

    let mut transfer_instructions: Vec<(usize, u64, &AccountInfo)> = Vec::with_capacity(MAX_RECIPIENTS);
    let mut pending_updates: Vec<(usize, u64, i64)> = Vec::with_capacity(MAX_RECIPIENTS);
    
    for (i, recipient) in vesting.recipients.iter().take(vesting.recipient_count as usize).enumerate() {
        
        if recipient.wallet == Pubkey::default() || recipient.basis_points == 0 {
            continue;
        }

        let recipient_total = (vesting.total_amount as u128 * recipient.basis_points as u128 / BASIS_POINTS_TOTAL as u128) as u64;
        let vested_amount = calculate_vested_amount(
            recipient_total,
            current_time,
            vesting.start_time,
            &vesting.schedule,
        );
        
        let claimable = vested_amount.saturating_sub(recipient.claimed_amount);
        
        if claimable == 0 {
            continue;
        }

        let expected_ata = get_associated_token_address(&recipient.wallet, &vesting.mint);
        let recipient_ata = recipient_atas[i];
        
        if recipient_ata.key != &expected_ata {
            return Err(VestingError::InvalidRecipientATA.into());
        }

        let ata_account = TokenAccount::unpack(&recipient_ata.data.borrow())?;
        if ata_account.owner != recipient.wallet {
            return Err(VestingError::InvalidRecipientATA.into());
        }
        if ata_account.mint != vesting.mint {
            return Err(VestingError::MintMismatch.into());
        }

        transfer_instructions.push((i, claimable, recipient_ata));
    }

    for (recipient_index, claimable, recipient_ata) in transfer_instructions.iter() {
        invoke_signed(
            &transfer(
                token_program.key,
                vault_pda.key,
                recipient_ata.key,
                &vault_authority_key,
                &[],
                *claimable,
            )?,
            &[
                vault_pda.clone(),
                (*recipient_ata).clone(),
                vault_authority.clone(),
                token_program.clone(),
            ],
            &[&[b"authority", vesting_pda.key.as_ref(), &[auth_bump]]],
        )?;
        
        pending_updates.push((*recipient_index, *claimable, current_time));
        total_distributed += *claimable;
    }

    for (recipient_index, claimed_amount, claim_time) in pending_updates {
        vesting.recipients[recipient_index].claimed_amount += claimed_amount;
        vesting.recipients[recipient_index].last_claim_time = claim_time;
    }
    
    vesting.last_distribution_time = current_time;
    
    vesting.pack_into_slice(&mut vesting_pda.data.borrow_mut());
    
    if total_distributed == 0 {
        return Ok(());
    }
    
    Ok(())
}

fn calculate_vested_amount(
    total_amount: u64,
    current_time: i64,
    start_time: i64,
    schedule: &VestingSchedule,
) -> u64 {
    if current_time < start_time {
        return 0;
    }

    let elapsed = current_time - start_time;
    
    let tge_amount = (total_amount as u128 * schedule.tge_basis_points as u128 / BASIS_POINTS_TOTAL as u128) as u64;
    
    if elapsed < schedule.cliff_period {
        return tge_amount;
    }
    
    if elapsed >= schedule.vesting_period {
        return total_amount;
    }
    
    let vesting_amount = total_amount - tge_amount;
    let vesting_duration = schedule.vesting_period - schedule.cliff_period;
    let vesting_elapsed = elapsed - schedule.cliff_period;
    
    let linear_vested = (vesting_amount as u128 * vesting_elapsed as u128 / vesting_duration as u128) as u64;

    tge_amount + linear_vested
}