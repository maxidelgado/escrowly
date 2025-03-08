use anchor_lang::prelude::*;
use anchor_spl::{
    token::{close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};
use crate::states::Escrow;

#[error_code]
pub enum ReleaseError {
    #[msg("Both parties have not confirmed the release.")]
    NotFullyConfirmed,
    #[msg("Release already initiated.")]
    AlreadyReleased,
}


#[derive(Accounts)]
pub struct Release<'info> {
    // Caller must be either intermediary or receiver.
    #[account(mut)]
    pub caller: Signer<'info>,
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
    /// CHECK: This account is unchecked because we only use its public key to verify it matches
    /// the escrow's intermediary. It is only used as the destination for closing the vault,
    /// so no sensitive data is read or written.
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
}

impl<'info> Release<'info> {
    pub fn release(&mut self) -> Result<()> {
        // Ensure that both the intermediary and receiver have confirmed.
        if !self.escrow.intermediary_confirmed || !self.escrow.receiver_confirmed {
            return Err(ReleaseError::NotFullyConfirmed.into());
        }
        // Prevent re-entrancy.
        if self.escrow.is_release_initiated {
            return Err(ReleaseError::AlreadyReleased.into());
        }
        self.escrow.is_release_initiated = true;

        // Derive the signer seeds based on the new PDA derivation:
        // [b"escrow", sender, intermediary, receiver, bump]
        let signer_seeds: &[&[u8]] = &[
            b"state",
            self.escrow.mint.as_ref(),
            self.escrow.sender.as_ref(),
            self.escrow.intermediary.as_ref(),
            self.escrow.receiver.as_ref(),
            &[self.escrow.bump],
        ];

        // Transfer the escrowed USDT from the vault to the intermediary’s token account.
        transfer_checked(
            self.into_release_context().with_signer(&[signer_seeds]),
            self.escrow.amount,
            self.mint.decimals,
        )?;

        // Close the vault account and return any remaining lamports to the intermediary.
        close_account(self.into_close_context().with_signer(&[signer_seeds]))
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

