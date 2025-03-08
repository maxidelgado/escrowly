use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};

use crate::states::Escrow;

#[error_code]
pub enum CancelError {
    #[msg("Cannot cancel escrow because the release process has already been initiated.")]
    ReleaseAlreadyInitiated,
    #[msg("Partial confirmation present and deadline not reached; cancellation disallowed.")]
    PartialConfirmationNotExpired,
}

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
            b"state",
            escrow.mint.key().as_ref(),
            escrow.sender.key().as_ref(),
            escrow.intermediary.key().as_ref(),
            escrow.receiver.key().as_ref(),
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

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> Cancel<'info> {
    pub fn refund_and_close_vault(&mut self) -> Result<()> {
        // Do not allow cancellation if the release has already been initiated.
        if self.escrow.is_release_initiated {
            return Err(CancelError::ReleaseAlreadyInitiated.into());
        }

        // Get the current timestamp.
        let clock = Clock::get()?;
        // If any confirmation exists and the deadline has not yet passed, disallow cancellation.
        if (self.escrow.intermediary_confirmed || self.escrow.receiver_confirmed)
            && clock.unix_timestamp < self.escrow.deadline
        {
            return Err(CancelError::PartialConfirmationNotExpired.into());
        }

        // Derive the signer seeds based on the new PDA derivation:
        // [b"state", sender, intermediary, receiver, bump]
        let signer_seeds: &[&[u8]] = &[
            b"state",
            self.escrow.mint.as_ref(),
            self.escrow.sender.as_ref(),
            self.escrow.intermediary.as_ref(),
            self.escrow.receiver.as_ref(),
            &[self.escrow.bump],
        ];

        // Refund the sender by transferring USDT from the vault back to the sender’s token account.
        transfer_checked(
            self.into_refund_context().with_signer(&[signer_seeds]),
            self.escrow.amount,
            self.mint.decimals,
        )?;

        // Close the vault account.
        close_account(self.into_close_context().with_signer(&[signer_seeds]))
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
