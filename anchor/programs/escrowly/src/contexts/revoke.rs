use anchor_lang::prelude::*;
use crate::states::{Escrow, EscrowStatus};

#[derive(Accounts)]
pub struct Revoke<'info> {
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
pub enum RevokeError {
    #[msg("Unauthorized signer for revocation.")]
    Unauthorized,
    #[msg("No confirmation exists to revoke.")]
    NotConfirmed,
    #[msg("Revocation period has expired.")]
    RevocationPeriodExpired,
    #[msg("Invalid escrow state for revocation.")]
    InvalidEscrowState,
}

impl<'info> Revoke<'info> {
    pub fn revoke(&mut self, role: crate::contexts::confirm::Role) -> Result<()> {
        let current_time = self.clock.unix_timestamp;
        if current_time > self.escrow.deadline {
            return Err(RevokeError::RevocationPeriodExpired.into());
        }
        if self.escrow.status != EscrowStatus::Pending {
            return Err(RevokeError::InvalidEscrowState.into());
        }
        match role {
            crate::contexts::confirm::Role::Intermediary => {
                if self.signer.key() != self.escrow.intermediary {
                    return Err(RevokeError::Unauthorized.into());
                }
                if !self.escrow.intermediary_confirmed {
                    return Err(RevokeError::NotConfirmed.into());
                }
                self.escrow.intermediary_confirmed = false;
            }
            crate::contexts::confirm::Role::Receiver => {
                if self.signer.key() != self.escrow.receiver {
                    return Err(RevokeError::Unauthorized.into());
                }
                if !self.escrow.receiver_confirmed {
                    return Err(RevokeError::NotConfirmed.into());
                }
                self.escrow.receiver_confirmed = false;
            }
        }
        emit!(RevokeEvent {
            escrow: self.escrow.key(),
            role: role,
            timestamp: current_time,
        });
        Ok(())
    }
}

#[event]
pub struct RevokeEvent {
    pub escrow: Pubkey,
    pub role: crate::contexts::confirm::Role,
    pub timestamp: i64,
}

