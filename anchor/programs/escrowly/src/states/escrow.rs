use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    Pending,
    Confirmed,
    Disputed,
    Cancelled,
    Released,
}

#[account]
pub struct Escrow {
    pub bump: u8,
    pub sender: Pubkey,
    pub intermediary: Pubkey,
    pub receiver: Pubkey,
    pub arbitrator: Pubkey,  // The designated dispute resolver.
    pub mint: Pubkey,
    pub amount: u64,
    pub deadline: i64,
    pub intermediary_confirmed: bool,
    pub receiver_confirmed: bool,
    pub status: EscrowStatus,
}

impl Escrow {
    // Calculation of the required account space.
    pub const INIT_SPACE: usize = 8  // Discriminator
        + 1                     // bump
        + 32 * 5                // sender, intermediary, receiver, arbitrator, mint
        + 8                     // amount
        + 8                     // deadline
        + 1                     // intermediary_confirmed
        + 1                     // receiver_confirmed
        + 1;                    // status (enum stored as a u8)
}

