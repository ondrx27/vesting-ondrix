mod instruction;
pub mod processor;
mod state;

use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    pubkey::Pubkey,
};

pub use crate::processor::process_instruction;

entrypoint!(process_instruction);
