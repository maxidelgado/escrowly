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
  const arbitrator = Keypair.generate() as anchor.web3.Keypair;
  const mint = Keypair.generate() as anchor.web3.Keypair;

  // 2. Determine associated token accounts.
  const senderAta = getAssociatedTokenAddressSync(mint.publicKey, sender.publicKey);
  const intermediaryAta = getAssociatedTokenAddressSync(mint.publicKey, intermediary.publicKey);

  // 3. Derive escrow PDA.
  const [escrowPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      mint.publicKey.toBuffer(),
      sender.publicKey.toBuffer(),
      intermediary.publicKey.toBuffer(),
      receiver.publicKey.toBuffer(),
      arbitrator.publicKey.toBuffer(),
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

  it("Initialize escrow (Normal Flow)", async () => {
      // Set deposit amount and a deadline 60 seconds from now.
      const senderAmount = 1e6;
      const deadline = Math.floor(Date.now() / 1000) + 60;
      await program.methods
        .initialize(new anchor.BN(senderAmount), new anchor.BN(deadline))
        .accountsStrict({
          sender: sender.publicKey,
          intermediary: intermediary.publicKey,
          receiver: receiver.publicKey,
          arbitrator: arbitrator.publicKey,
          mint: mint.publicKey,
          senderAta: senderAta,
          escrow: escrowPDA,
          vault: vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender])
        .rpc()
        .then(logTx);
    });

  it("Confirm escrow - intermediary", async () => {
      await program.methods
        .confirm({ intermediary: {} })
        .accountsStrict({
          escrow: escrowPDA,
          signer: intermediary.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
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
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([receiver])
        .rpc()
        .then(logTx);
    });

  it("Release escrow", async () => {
      // Only intermediary (as required) can trigger release.
      await program.methods
        .release()
        .accountsStrict({
          caller: intermediary.publicKey,
          escrow: escrowPDA,
          intermediaryWallet: intermediary.publicKey,
          vault: vault,
          intermediaryAta: intermediaryAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([intermediary])
        .rpc()
        .then(logTx);
    });

  it("Cancel escrow should fail now (Normal Flow)", async () => {
      try {
        await program.methods
          .cancel()
          .accountsStrict({
            sender: sender.publicKey,
            mint: mint.publicKey,
            senderAta: senderAta,
            escrow: escrowPDA,
            vault: vault,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY
          })
          .signers([sender])
          .rpc();
        throw new Error("Cancel should have failed because release was already initiated");
      } catch (err) {
        console.log("Cancel failed as expected:", err);
      }
    });
});

