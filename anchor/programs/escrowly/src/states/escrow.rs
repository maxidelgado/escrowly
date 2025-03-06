use anchor_lang::prelude::*;

#[account]
pub struct Escrow {
    pub seed: u64,
    pub bump: u8,
    pub sender: Pubkey,
    pub intermediary: Pubkey,
    pub receiver: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    /// Unix timestamp by which the sender can cancel if not fully confirmed.
    pub deadline: i64,
    pub intermediary_confirmed: bool,
    pub receiver_confirmed: bool,
    pub is_release_initiated: bool,
}

impl Escrow {
    pub const INIT_SPACE: usize = 8  // discriminator
        + 8 + 1                // seed and bump
        + 32 * 3               // sender, intermediary, receiver
        + 32                   // mint
        + 8                    // amount
        + 8                    // deadline (i64)
        + 1 + 1 + 1;           // booleans: intermediary_confirmed, receiver_confirmed, is_release_initiated
}

