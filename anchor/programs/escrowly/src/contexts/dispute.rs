use anchor_lang::prelude::*;
use crate::states::{Escrow, EscrowStatus};

#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.mint.key().as_ref(),
            escrow.sender.key().as_ref(),
            escrow.intermediary.key().as_ref(),
            escrow.receiver.key().as_ref(),
            escrow.arbitrator.key().as_ref(),
        ],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub clock: Sysvar<'info, Clock>,
}

#[error_code]
pub enum DisputeError {
    #[msg("Escrow is not in a state that can be disputed.")]
    InvalidEscrowState,
}

impl<'info> Dispute<'info> {
    pub fn dispute(&mut self) -> Result<()> {
        if self.escrow.status != EscrowStatus::Pending && self.escrow.status != EscrowStatus::Confirmed {
            return Err(DisputeError::InvalidEscrowState.into());
        }
        self.escrow.status = EscrowStatus::Disputed;
        emit!(DisputeEvent {
            escrow: self.escrow.key(),
            initiated_by: self.signer.key(),
            timestamp: self.clock.unix_timestamp,
        });
        Ok(())
    }
}

#[event]
pub struct DisputeEvent {
    pub escrow: Pubkey,
    pub initiated_by: Pubkey,
    pub timestamp: i64,
}

