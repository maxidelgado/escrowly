use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};

use crate::states::Escrow;

#[derive(Accounts)]
#[instruction(sender_amount: u64, deadline: i64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    /// The intermediary’s public key (passed in by the sender).
    /// CHECK: Not reading or writing data.
    pub intermediary: AccountInfo<'info>,
    /// The receiver’s public key (passed in by the sender).
    /// CHECK: Not reading or writing data.
    pub receiver: AccountInfo<'info>,

    /// The USDT mint.
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = sender_ata.amount >= sender_amount,
        associated_token::mint = mint,
        associated_token::authority = sender
    )]
    pub sender_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = sender,
        space = Escrow::INIT_SPACE,
        seeds = [
          b"state",
          mint.key().as_ref(),
          sender.key().as_ref(),
          intermediary.key().as_ref(),
          receiver.key().as_ref()
        ],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init_if_needed,
        payer = sender,
        associated_token::mint = mint,
        associated_token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn initialize_escrow(
        &mut self,
        bumps: &InitializeBumps, // assume this helper exists
        sender_amount: u64,
        deadline: i64,
    ) -> Result<()> {
        self.escrow.set_inner(Escrow {
            bump: bumps.escrow,
            sender: self.sender.key(),
            intermediary: self.intermediary.key(),
            receiver: self.receiver.key(),
            mint: self.mint.key(),
            amount: sender_amount,
            deadline,
            intermediary_confirmed: false,
            receiver_confirmed: false,
            is_release_initiated: false,
        });
        Ok(())
    }

    pub fn deposit(&mut self, sender_amount: u64) -> Result<()> {
        transfer_checked(
            self.into_deposit_context(),
            sender_amount,
            self.mint.decimals,
        )
    }

    fn into_deposit_context(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        let cpi_accounts = TransferChecked {
            from: self.sender_ata.to_account_info(),
            mint: self.mint.to_account_info(),
            to: self.vault.to_account_info(),
            authority: self.sender.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

