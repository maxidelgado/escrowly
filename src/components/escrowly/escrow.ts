import * as anchor from "@coral-xyz/anchor";
import { getEscrowlyProgram, getEscrowlyProgramId } from '@project/anchor';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { randomBytes } from "crypto";

export interface EscrowlyLibConfig {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
}

export class EscrowlyLib {
  provider: anchor.AnchorProvider;
  connection: anchor.web3.Connection;
  program: anchor.Program;

  constructor() {
    anchor.setProvider(anchor.AnchorProvider.env());
    this.provider = anchor.getProvider() as anchor.AnchorProvider;
    this.connection = provider.connection;
    this.program = anchor.workspace.Escrowly as anchor.Program<Escrowly>;
  }

  /**
   * Logs and returns the transaction signature.
   */
  private async logTx(signature: string): Promise<string> {
    console.log(`Transaction: https://explorer.solana.com/tx/${signature}?cluster=localnet`);
    return signature;
  }

  /**
   * Returns the associated token account for a given mint and owner.
   */
  public getAssociatedTokenAddress(
    mint: PublicKey,
    owner: PublicKey,
    allowOwnerOffCurve: boolean = false
  ): PublicKey {
    return getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve);
  }

  /**
   * Derives the escrow PDA using a provided seed buffer (e.g. 8 random bytes).
   * Optionally, you can change the constant seed string ("state" by default).
   */
  public deriveEscrowPda(seedBuffer: Buffer, seedString: string = "state"): PublicKey {
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('state'), seedBuffer],
      this.program.programId
    );
    return escrowPda;
  }

  /**
   * Returns the vault address which is the associated token account for the escrow PDA.
   */
  public getVaultAddress(mint: PublicKey, escrowPda: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(mint, escrowPda, true);
  }

  /**
   * Performs SOL airdrops to the provided keypairs, creates and initializes a mint,
   * creates associated token accounts for sender and intermediary, and mints tokens to the sender.
   * All values (including the airdrop amount, mint decimals, and initial mint amount) are provided via parameters.
   */
  public async airdropAndCreateMint(params: {
    sender: Keypair;
    intermediary: Keypair;
    receiver: Keypair;
    mint: Keypair;
    mintAuthority: PublicKey;
    initialMintAmount: number;
    decimals?: number;
    airdropAmount?: number;
  }): Promise<void> {
    const { sender, intermediary, receiver, mint, mintAuthority, initialMintAmount } = params;
    const tokenDecimals = params.decimals ?? 6;
    const airdropAmount = params.airdropAmount ?? 2 * LAMPORTS_PER_SOL;

    // Airdrop SOL to sender, intermediary, and receiver.
    const airdropSenderSig = await this.connection.requestAirdrop(sender.publicKey, airdropAmount);
    await this.connection.confirmTransaction(airdropSenderSig);
    const airdropIntermediarySig = await this.connection.requestAirdrop(intermediary.publicKey, airdropAmount);
    await this.connection.confirmTransaction(airdropIntermediarySig);
    const airdropReceiverSig = await this.connection.requestAirdrop(receiver.publicKey, airdropAmount);
    await this.connection.confirmTransaction(airdropReceiverSig);

    // Create mint account and initialize the mint.
    const lamports = await getMinimumBalanceForRentExemptMint(this.connection);
    const tx = new Transaction();
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: this.provider.publicKey as PublicKey,
        newAccountPubkey: mint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, tokenDecimals, mintAuthority, null)
    );

    // Create associated token accounts for sender and intermediary.
    const senderAta = getAssociatedTokenAddressSync(mint.publicKey, sender.publicKey);
    const intermediaryAta = getAssociatedTokenAddressSync(mint.publicKey, intermediary.publicKey);
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.provider.publicKey as PublicKey,
        senderAta,
        sender.publicKey,
        mint.publicKey
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        this.provider.publicKey as PublicKey,
        intermediaryAta,
        intermediary.publicKey,
        mint.publicKey
      )
    );

    // Mint tokens to the sender.
    tx.add(
      createMintToInstruction(mint.publicKey, senderAta, mintAuthority, initialMintAmount)
    );

    await this.provider.sendAndConfirm(tx, [mint, sender]);
  }

  /**
   * Initializes an escrow with the provided seed (as a Buffer), deposit amount, and deadline.
   * The necessary account addresses (senderAta, vault, etc.) are derived internally.
   */
  public async initializeEscrow(params: {
    seedBuffer: Buffer;
    senderAmount: number;
    deadline: number;
    sender: Keypair;
    intermediary: Keypair;
    receiver: Keypair;
    mint: PublicKey;
    seedString?: string;
  }): Promise<string> {
    const senderAta = this.getAssociatedTokenAddress(params.mint, params.sender.publicKey);
    const intermediaryAta = this.getAssociatedTokenAddress(params.mint, params.intermediary.publicKey);
    const escrowPda = this.deriveEscrowPda(params.seedBuffer, params.seedString ?? "state");
    const vault = this.getVaultAddress(params.mint, escrowPda);

    const initializeAccounts = {
      sender: params.sender.publicKey,
      intermediary: params.intermediary.publicKey,
      receiver: params.receiver.publicKey,
      mint: params.mint,
      senderAta,
      escrow: escrowPda,
      vault,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    // Convert the seed buffer to a BN using little-endian format.
    const seedBN = new anchor.BN(params.seedBuffer, "le");

    const txSignature = await this.program.methods
      .initialize(seedBN, new anchor.BN(params.senderAmount), new anchor.BN(params.deadline))
      .accounts(initializeAccounts)
      .signers([params.sender])
      .rpc();
    return this.logTx(txSignature);
  }

  /**
   * Confirms the escrow. The role parameter determines whether the "intermediary" or "receiver" variant of the method is called.
   */
  public async confirmEscrow(params: {
    role: "intermediary" | "receiver";
    escrow: PublicKey;
    signer: Keypair;
  }): Promise<string> {
    const confirmAccounts = {
      escrow: params.escrow,
      signer: params.signer.publicKey,
    };

    const methodArg = params.role === "intermediary" ? { intermediary: {} } : { receiver: {} };

    const txSignature = await this.program.methods
      .confirm(methodArg)
      .accounts(confirmAccounts)
      .signers([params.signer])
      .rpc();
    return this.logTx(txSignature);
  }

  /**
   * Releases the escrow. The caller (e.g. intermediary or receiver) must pass in all required account addresses.
   */
  public async releaseEscrow(params: {
    escrow: PublicKey;
    caller: Keypair;
    intermediaryWallet: PublicKey;
    vault: PublicKey;
    intermediaryAta: PublicKey;
    mint: PublicKey;
  }): Promise<string> {
    const releaseAccounts = {
      caller: params.caller.publicKey,
      escrow: params.escrow,
      intermediaryWallet: params.intermediaryWallet,
      vault: params.vault,
      intermediaryAta: params.intermediaryAta,
      mint: params.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    const txSignature = await this.program.methods
      .release()
      .accounts(releaseAccounts)
      .signers([params.caller])
      .rpc();
    return this.logTx(txSignature);
  }

  /**
   * Cancels the escrow. The sender’s keypair and the required associated accounts must be provided.
   */
  public async cancelEscrow(params: {
    escrow: PublicKey;
    sender: Keypair;
    mint: PublicKey;
    senderAta: PublicKey;
    vault: PublicKey;
  }): Promise<string> {
    const cancelAccounts = {
      sender: params.sender.publicKey,
      mint: params.mint,
      senderAta: params.senderAta,
      escrow: params.escrow,
      vault: params.vault,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    const txSignature = await this.program.methods
      .cancel()
      .accounts(cancelAccounts)
      .signers([params.sender])
      .rpc();
    return this.logTx(txSignature);
  }
}

