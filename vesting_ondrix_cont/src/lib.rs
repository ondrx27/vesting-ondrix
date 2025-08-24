mod instruction;
pub mod processor;
mod state;
pub mod errors;

use solana_program::entrypoint;

pub use crate::processor::process_instruction;

entrypoint!(process_instruction);
