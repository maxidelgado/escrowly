use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, close_account, TransferChecked, CloseAccount, Mint, Token, TokenAccount};
use crate::states::{Escrow, EscrowStatus};

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
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
    /// CHECK: Must match escrow's intermediary.
    #[account(mut, constraint = intermediary_wallet.key() == escrow.intermediary)]
    pub intermediary_wallet: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow.intermediary
    )]
    pub intermediary_ata: Account<'info, TokenAccount>,
    pub mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[error_code]
pub enum ReleaseError {
    #[msg("Both parties have not confirmed the release.")]
    NotFullyConfirmed,
    #[msg("Unauthorized: Only intermediary can trigger release.")]
    Unauthorized,
}

impl<'info> Release<'info> {
    pub fn release(&mut self) -> Result<()> {
        if self.escrow.status != EscrowStatus::Confirmed {
            return Err(ReleaseError::NotFullyConfirmed.into());
        }
        if self.caller.key() != self.escrow.intermediary {
            return Err(ReleaseError::Unauthorized.into());
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
            self.into_release_context().with_signer(&[signer_seeds]),
            self.escrow.amount,
            self.mint.decimals,
        )?;
        close_account(self.into_close_context().with_signer(&[signer_seeds]))?;
        self.escrow.status = EscrowStatus::Released;
        emit!(ReleaseEvent {
            escrow: self.escrow.key(),
            timestamp: self.clock.unix_timestamp,
        });
        Ok(())
    }
    fn into_release_context(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        let cpi_accounts = TransferChecked {
            from: self.vault.to_account_info(),
            mint: self.mint.to_account_info(),
            to: self.intermediary_ata.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
    fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.intermediary_wallet.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

#[event]
pub struct ReleaseEvent {
    pub escrow: Pubkey,
    pub timestamp: i64,
}

