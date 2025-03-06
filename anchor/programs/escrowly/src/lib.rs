#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
mod contexts;
use contexts::*;
mod states;

declare_id!("51Bdk5E5BtZn4YTVewZdPUqhg2uGPjhjbctronfPkHjr");

#[program]
pub mod escrowly {
    use super::*;

    // The sender initializes the escrow by depositing funds, setting a deadline,
    // and defining the intermediary and receiver.
    pub fn initialize(
        ctx: Context<Initialize>,
        seed: u64,
        sender_amount: u64,
        deadline: i64,
    ) -> Result<()> {
        ctx.accounts.initialize_escrow(seed, &ctx.bumps, sender_amount, deadline)?;
        ctx.accounts.deposit(sender_amount)
    }

    // Either the intermediary or receiver can confirm their approval.
    pub fn confirm(ctx: Context<Confirm>, role: Role) -> Result<()> {
        ctx.accounts.confirm(role)
    }

    // Once both parties have confirmed, release the funds to the intermediary.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        ctx.accounts.release()
    }

    // The sender can cancel (and recover funds) if allowed by the conditions.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        ctx.accounts.refund_and_close_vault()
    }
}

