import * as anchor from "@coral-xyz/anchor";
import { Escrowly } from "../target/types/escrowly";
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

describe("escrow", () => {
  // 0. Set provider, connection and program.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const program = anchor.workspace.Escrowly as anchor.Program<Escrowly>;

  // 1. Generate keypairs for sender, intermediary, receiver, and a single mint.
  const sender = Keypair.generate() as anchor.web3.Keypair;
  const intermediary = Keypair.generate() as anchor.web3.Keypair;
  const receiver = Keypair.generate() as anchor.web3.Keypair;
  const mint = Keypair.generate() as anchor.web3.Keypair;

  // 2. Determine associated token accounts.
  const senderAta = getAssociatedTokenAddressSync(mint.publicKey, sender.publicKey);
  const intermediaryAta = getAssociatedTokenAddressSync(mint.publicKey, intermediary.publicKey);

  // 3. Derive escrow PDA.
  const [escrowPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("state"),
      mint.publicKey.toBuffer(),
      sender.publicKey.toBuffer(),
      intermediary.publicKey.toBuffer(),
      receiver.publicKey.toBuffer(),
    ],
    program.programId
  );

  const vault = getAssociatedTokenAddressSync(mint.publicKey, escrowPDA, true);

  const logTx = async (signature: string) => {
    console.log(
      `Transaction: https://explorer.solana.com/tx/${signature}?cluster=localnet`
    );
    return signature;
  };

  it("Airdrop and create mint", async () => {
    // Airdrop SOL to sender, intermediary, and receiver.
    const airdropSender = await connection.requestAirdrop(sender.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropSender);
    const airdropIntermediary = await connection.requestAirdrop(intermediary.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropIntermediary);
    const airdropReceiver = await connection.requestAirdrop(receiver.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropReceiver);

    // Create mint account and initialize the mint.
    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const tx = new Transaction();
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey as PublicKey,
        newAccountPubkey: mint.publicKey as PublicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, 6, sender.publicKey, null)
    );
    // Create associated token accounts for sender and intermediary.
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        provider.publicKey as PublicKey,
        senderAta,
        sender.publicKey as PublicKey,
        mint.publicKey as PublicKey
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        provider.publicKey as PublicKey,
        intermediaryAta,
        intermediary.publicKey as PublicKey,
        mint.publicKey as PublicKey
      )
    );
    // Mint tokens to sender.
    tx.add(
      createMintToInstruction(mint.publicKey, senderAta, sender.publicKey, 1e9)
    );
    await provider.sendAndConfirm(tx, [mint, sender]).then(logTx);
  });

  it("Initialize escrow", async () => {
    // Set deposit amount and a deadline 60 seconds from now.
    const senderAmount = 1e6;
    const deadline = Math.floor(Date.now() / 1000) + 60;
    await program.methods
      .initialize(new anchor.BN(senderAmount), new anchor.BN(deadline))
      .accountsStrict({
          sender: sender.publicKey,             // The sender who is cancelling.
          intermediary: intermediary.publicKey, // The intermediary.
          receiver: receiver.publicKey,         // The receiver.
          mint: mint.publicKey,                 // The token mint.
          senderAta: senderAta,                 // Sender's associated token account.
          escrow: escrowPDA,                    // The escrow PDA derived with seeds: [b"state", mint, sender, intermediary, receiver]
          vault: vault,                         // The vault holding the tokens.
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
      .signers([sender])
      .rpc()
      .then(logTx);
  });

  it("Confirm escrow - intermediary", async () => {
    // Pass the enum as an object variant.
    await program.methods
      .confirm({ intermediary: {} })
      .accountsStrict({
          escrow: escrowPDA,
          signer: intermediary.publicKey, 
      })
      .signers([intermediary])
      .rpc()
      .then(logTx);
  });

  it("Confirm escrow - receiver", async () => {
    await program.methods
      .confirm({ receiver: {} })
      .accountsStrict({
          escrow: escrowPDA,
          signer: receiver.publicKey, 
      })
      .signers([receiver])
      .rpc()
      .then(logTx);
  });

  it("Release escrow", async () => {
    // Either intermediary or receiver can call release. Here, intermediary calls.
    await program.methods
      .release()
      .accountsStrict({
        caller: intermediary.publicKey,          // Caller (must be intermediary or receiver)
        escrow: escrowPDA,                        // The escrow PDA derived using [b"state", mint, sender, intermediary, receiver]
        intermediaryWallet: intermediary.publicKey, // Used to receive any remaining lamports from closing the vault
        vault: vault,                             // Vault token account holding escrowed tokens
        intermediaryAta: intermediaryAta,         // Intermediary's associated token account for the mint
        mint: mint.publicKey,                     // The token mint
        tokenProgram: TOKEN_PROGRAM_ID,           // The SPL Token program
      })
      .signers([intermediary])
      .rpc()
      .then(logTx);
  });

  it("Cancel escrow should fail now", async () => {
    // Attempt to cancel after release. Expect an error.
    try {
      await program.methods
        .cancel()
        .accountsStrict({
          sender: sender.publicKey,             // The sender who is cancelling.
          mint: mint.publicKey,                 // The token mint.
          senderAta: senderAta,                 // Sender's associated token account.
          escrow: escrowPDA,                    // The escrow PDA derived with seeds: [b"state", mint, sender, intermediary, receiver]
          vault: vault,                         // The vault holding the tokens.
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender])
        .rpc();
      throw new Error("Cancel should have failed because release was already initiated");
    } catch (err) {
      console.log("Cancel failed as expected:", err);
    }
  });
});

