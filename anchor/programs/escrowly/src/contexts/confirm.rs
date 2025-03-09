use anchor_lang::prelude::*;
use crate::states::{Escrow, EscrowStatus};

#[derive(Accounts)]
pub struct Confirm<'info> {
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

/// The party roles eligible to confirm.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum Role {
    Intermediary,
    Receiver,
}

#[error_code]
pub enum ConfirmError {
    #[msg("Unauthorized signer for confirmation.")]
    Unauthorized,
    #[msg("Confirmation already provided.")]
    AlreadyConfirmed,
    #[msg("Confirmation period has expired.")]
    ConfirmationPeriodExpired,
    #[msg("Invalid escrow state for confirmation.")]
    InvalidEscrowState,
}

impl<'info> Confirm<'info> {
    pub fn confirm(&mut self, role: Role) -> Result<()> {
        let current_time = self.clock.unix_timestamp;
        if current_time > self.escrow.deadline {
            return Err(ConfirmError::ConfirmationPeriodExpired.into());
        }
        if self.escrow.status != EscrowStatus::Pending {
            return Err(ConfirmError::InvalidEscrowState.into());
        }
        match role {
            Role::Intermediary => {
                if self.signer.key() != self.escrow.intermediary {
                    return Err(ConfirmError::Unauthorized.into());
                }
                if self.escrow.intermediary_confirmed {
                    return Err(ConfirmError::AlreadyConfirmed.into());
                }
                self.escrow.intermediary_confirmed = true;
            }
            Role::Receiver => {
                if self.signer.key() != self.escrow.receiver {
                    return Err(ConfirmError::Unauthorized.into());
                }
                if self.escrow.receiver_confirmed {
                    return Err(ConfirmError::AlreadyConfirmed.into());
                }
                self.escrow.receiver_confirmed = true;
            }
        }
        // When both confirmations exist, update the state.
        if self.escrow.intermediary_confirmed && self.escrow.receiver_confirmed {
            self.escrow.status = EscrowStatus::Confirmed;
        }
        emit!(ConfirmEvent {
            escrow: self.escrow.key(),
            role: role.clone(),
            timestamp: current_time,
        });
        Ok(())
    }
}

#[event]
pub struct ConfirmEvent {
    pub escrow: Pubkey,
    pub role: Role,
    pub timestamp: i64,
}

