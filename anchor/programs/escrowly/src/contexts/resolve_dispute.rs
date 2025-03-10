use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, close_account, TransferChecked, CloseAccount, Mint, Token, TokenAccount};
use crate::states::{Escrow, EscrowStatus};

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub arbitrator: Signer<'info>,
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
    /// Destination for refunding the sender.
    /// CHECK: This account is unchecked because it is only used as the destination for refunded tokens. No sensitive data is read or written.
    #[account(mut)]
    pub sender_wallet: UncheckedAccount<'info>,
    /// Destination for releasing funds to the intermediary.
    /// CHECK: This account is unchecked because it is only used as the destination for refunded tokens. No sensitive data is read or written.
    #[account(mut)]
    pub intermediary_wallet: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow.sender
    )]
    pub sender_ata: Account<'info, TokenAccount>,
    pub mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum DisputeResolution {
    Release, // Transfer funds to intermediary.
    Cancel,  // Refund funds to sender.
}

#[error_code]
pub enum ResolveDisputeError {
    #[msg("Escrow is not in a disputed state.")]
    InvalidEscrowState,
}

impl<'info> ResolveDispute<'info> {
    pub fn resolve_dispute(&mut self, resolution: DisputeResolution) -> Result<()> {
        if self.escrow.status != EscrowStatus::Disputed {
            return Err(ResolveDisputeError::InvalidEscrowState.into());
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
        match resolution {
            DisputeResolution::Release => {
                transfer_checked(
                    self.into_release_context().with_signer(&[signer_seeds]),
                    self.escrow.amount,
                    self.mint.decimals,
                )?;
                close_account(self.into_close_context_release().with_signer(&[signer_seeds]))?;
                self.escrow.status = EscrowStatus::Released;
                emit!(DisputeResolvedEvent {
                    escrow: self.escrow.key(),
                    resolution: "Released".to_string(),
                });
            },
            DisputeResolution::Cancel => {
                transfer_checked(
                    self.into_refund_context().with_signer(&[signer_seeds]),
                    self.escrow.amount,
                    self.mint.decimals,
                )?;
                close_account(self.into_close_context_refund().with_signer(&[signer_seeds]))?;
                self.escrow.status = EscrowStatus::Cancelled;
                emit!(DisputeResolvedEvent {
                    escrow: self.escrow.key(),
                    resolution: "Cancelled".to_string(),
                });
            },
        }
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
    fn into_close_context_release(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.intermediary_wallet.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
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
    fn into_close_context_refund(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.sender_wallet.to_account_info(),
            authority: self.escrow.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

#[event]
pub struct DisputeResolvedEvent {
    pub escrow: Pubkey,
    pub resolution: String,
}

