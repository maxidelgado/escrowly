use anchor_lang::prelude::*;
use crate::states::Escrow;

#[derive(Accounts)]
pub struct Confirm<'info> {
    // The signer must be either the intermediary or receiver.
    pub signer: Signer<'info>,

    #[account(
        mut, 
        seeds = [
            b"state",
            escrow.mint.key().as_ref(),
            escrow.sender.key().as_ref(),
            escrow.intermediary.key().as_ref(),
            escrow.receiver.key().as_ref(),
        ], 
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
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
}

impl<'info> Confirm<'info> {
    pub fn confirm(&mut self, role: Role) -> Result<()> {
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
        Ok(())
    }
}

