use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{transfer_checked, close_account, TransferChecked, CloseAccount, Mint, Token, TokenAccount};
use crate::states::{Escrow, EscrowStatus};

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = sender
    )]
    pub sender_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        has_one = sender,
        has_one = mint,
        seeds = [
            b"escrow",
            escrow.mint.key().as_ref(),
            escrow.sender.key().as_ref(),
            escrow.intermediary.key().as_ref(),
            escrow.receiver.key().as_ref(),
            escrow.arbitrator.key().as_ref(),
        ],
        bump = escrow.bump,
        close = sender
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

#[error_code]
pub enum CancelError {
    #[msg("Invalid escrow state for cancellation.")]
    InvalidEscrowState,
    #[msg("Partial confirmation present and deadline not reached; cancellation disallowed.")]
    PartialConfirmationNotExpired,
}

impl<'info> Cancel<'info> {
    pub fn refund_and_close_vault(&mut self) -> Result<()> {
        if self.escrow.status == EscrowStatus::Disputed || self.escrow.status == EscrowStatus::Released {
            return Err(CancelError::InvalidEscrowState.into());
        }
        let current_time = self.clock.unix_timestamp;
        if (self.escrow.intermediary_confirmed || self.escrow.receiver_confirmed) && current_time < self.escrow.deadline {
            return Err(CancelError::PartialConfirmationNotExpired.into());
        }
        let signer_seeds: &[&[u8]] = &[
            b"escrow",
            self.escrow.mint.as_ref(),
            self.escrow.sender.as_ref(),
            self.escrow.intermediary.as_ref(),
            self.escrow.receiver.as_ref(),
            self.escrow.arbitrator.as_ref(),
            &[self.escrow.bump],
        ];
        transfer_checked(
            self.into_refund_context().with_signer(&[signer_seeds]),
            self.escrow.amount,
            self.mint.decimals,
        )?;
        close_account(self.into_close_context().with_signer(&[signer_seeds]))?;
        self.escrow.status = EscrowStatus::Cancelled;
        emit!(CancelEvent {
            escrow: self.escrow.key(),
            timestamp: current_time,
        });
        Ok(())
    }
    fn into_refund_context(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        let cpi_accounts = TransferChecked {
            from: self.vault.to_account_info(),
            mint: self.mint.to_account_info(),
            to: self.sender_ata.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
    fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.sender.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

#[event]
pub struct CancelEvent {
    pub escrow: Pubkey,
    pub timestamp: i64,
}

