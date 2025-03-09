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
    // and defining the intermediary, receiver, and arbitrator.
    pub fn initialize(
        ctx: Context<Initialize>,
        sender_amount: u64,
        deadline: i64,
    ) -> Result<()> {
        ctx.accounts.initialize_escrow(&ctx.bumps, sender_amount, deadline)?;
        ctx.accounts.deposit(sender_amount)
    }

    // Confirmation must occur before the deadline.
    pub fn confirm(ctx: Context<Confirm>, role: Role) -> Result<()> {
        ctx.accounts.confirm(role)
    }

    // If needed, either party may revoke their confirmation before the deadline.
    pub fn revoke(ctx: Context<Revoke>, role: Role) -> Result<()> {
        ctx.accounts.revoke(role)
    }

    // Any party may trigger a dispute (only allowed in Pending/Confirmed states).
    pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
        ctx.accounts.dispute()
    }

    // Only the designated arbitrator may resolve a dispute.
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, resolution: DisputeResolution) -> Result<()> {
        ctx.accounts.resolve_dispute(resolution)
    }

    // Only the intermediary may trigger the release once both confirmations exist.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        ctx.accounts.release()
    }

    // The sender may cancel the escrow (if conditions are met) and get a refund.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        ctx.accounts.refund_and_close_vault()
    }
}

