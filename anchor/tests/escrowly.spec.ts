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
import { before } from "node:test";

describe("escrow", () => {
  // 0. Set provider, connection and program.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const program = anchor.workspace.Escrowly as anchor.Program<Escrowly>;

  // ---------- Global Mint Setup ----------
  // Create a single mint used across flows.
  const mint = Keypair.generate();
  // We'll mint tokens into the sender's ATA in the first (normal) flow.
  
  const logTx = async (signature: string) => {
    console.log(
      `Transaction: https://explorer.solana.com/tx/${signature}?cluster=localnet`
    );
    return signature;
  };

  it("Airdrop and create mint", async () => {
    // Airdrop SOL to payer (provider wallet will cover fees).
    const airdropSignature = await connection.requestAirdrop(
      provider.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSignature);

    // Create mint account and initialize the mint.
    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const tx = new Transaction();
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, 6, provider.publicKey, null)
    );
    await provider.sendAndConfirm(tx, [mint]).then(logTx);
  });

  // ---------- Normal Flow: Initialize, Confirm, Release, and Failed Cancel ----------
  describe("Normal Flow", () => {
    // Use fixed global keypairs for the normal flow.
    const sender = Keypair.generate();
    const intermediary = Keypair.generate();
    const receiver = Keypair.generate();
    const arbitrator = Keypair.generate();

    // Derive sender's and intermediary's associated token accounts.
    const senderAta = getAssociatedTokenAddressSync(mint.publicKey, sender.publicKey);
    const intermediaryAta = getAssociatedTokenAddressSync(mint.publicKey, intermediary.publicKey);

    // Derive the escrow PDA using seeds: ["escrow", mint, sender, intermediary, receiver, arbitrator].
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

    // Derive the vault address (ATA for escrow).
    const vault = getAssociatedTokenAddressSync(mint.publicKey, escrowPDA, true);

    it("Airdrop and setup accounts for Normal Flow", async () => {
      // Airdrop to sender, intermediary, receiver, and arbitrator.
      for (const kp of [sender, intermediary, receiver, arbitrator]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
      // Create associated token accounts for sender and intermediary.
      const tx = new Transaction();
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          senderAta,
          sender.publicKey,
          mint.publicKey
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          intermediaryAta,
          intermediary.publicKey,
          mint.publicKey
        )
      );
      // Mint tokens to sender.
      tx.add(
        createMintToInstruction(mint.publicKey, senderAta, provider.publicKey, 1e9)
      );
      await provider.sendAndConfirm(tx, [sender]).then(logTx);
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
              clock: ""
          })
          .signers([sender])
          .rpc();
        throw new Error("Cancel should have failed because release was already initiated");
      } catch (err) {
        console.log("Cancel failed as expected:", err);
      }
    });
  });

  // ---------- Revoke Confirmation Flow ----------
  describe("Revoke Confirmation Flow", () => {
    // New keypairs for this flow.
    const sender2 = Keypair.generate();
    const intermediary2 = Keypair.generate();
    const receiver2 = Keypair.generate();
    const arbitrator2 = Keypair.generate();

    let senderAta2: PublicKey;
    let escrowPDA2: PublicKey;
    let vault2: PublicKey;

    before(async () => {
      // Airdrop funds.
      for (const kp of [sender2, intermediary2, receiver2, arbitrator2]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
      // Create ATAs for sender2 and intermediary2.
      senderAta2 = getAssociatedTokenAddressSync(mint.publicKey, sender2.publicKey);
      const intermediaryAta2 = getAssociatedTokenAddressSync(mint.publicKey, intermediary2.publicKey);
      const tx = new Transaction();
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          senderAta2,
          sender2.publicKey,
          mint.publicKey
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          intermediaryAta2,
          intermediary2.publicKey,
          mint.publicKey
        )
      );
      // Mint tokens to sender2.
      tx.add(createMintToInstruction(mint.publicKey, senderAta2, provider.publicKey, 1e9));
      await provider.sendAndConfirm(tx, [sender2]).then(logTx);

      // Derive PDA and vault for this flow.
      [escrowPDA2] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          mint.publicKey.toBuffer(),
          sender2.publicKey.toBuffer(),
          intermediary2.publicKey.toBuffer(),
          receiver2.publicKey.toBuffer(),
          arbitrator2.publicKey.toBuffer(),
        ],
        program.programId
      );
      vault2 = getAssociatedTokenAddressSync(mint.publicKey, escrowPDA2, true);

      // Initialize escrow.
      const senderAmount = 1e6;
      const deadline = Math.floor(Date.now() / 1000) + 60;
      await program.methods
        .initialize(new anchor.BN(senderAmount), new anchor.BN(deadline))
        .accountsStrict({
          sender: sender2.publicKey,
          intermediary: intermediary2.publicKey,
          receiver: receiver2.publicKey,
          arbitrator: arbitrator2.publicKey,
          mint: mint.publicKey,
          senderAta: senderAta2,
          escrow: escrowPDA2,
          vault: vault2,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender2])
        .rpc()
        .then(logTx);
    });

    it("Confirm (intermediary) then revoke and reconfirm", async () => {
      // intermediary confirms.
      await program.methods
        .confirm({ intermediary: {} })
        .accountsStrict({
          escrow: escrowPDA2,
          signer: intermediary2.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([intermediary2])
        .rpc()
        .then(logTx);

      // intermediary revokes confirmation.
      await program.methods
        .revoke({ intermediary: {} })
        .accountsStrict({
          escrow: escrowPDA2,
          signer: intermediary2.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([intermediary2])
        .rpc()
        .then(logTx);

      // intermediary confirms again.
      await program.methods
        .confirm({ intermediary: {} })
        .accountsStrict({
          escrow: escrowPDA2,
          signer: intermediary2.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([intermediary2])
        .rpc()
        .then(logTx);
    });
  });

  // ---------- Dispute and Resolve Flow – Release Resolution ----------
  describe("Dispute and Resolve Flow - Release Resolution", () => {
    // New keypairs for this flow.
    const sender3 = Keypair.generate();
    const intermediary3 = Keypair.generate();
    const receiver3 = Keypair.generate();
    const arbitrator3 = Keypair.generate();

    let senderAta3: PublicKey;
    let intermediaryAta3: PublicKey;
    let escrowPDA3: PublicKey;
    let vault3: PublicKey;

    before(async () => {
      // Airdrop funds.
      for (const kp of [sender3, intermediary3, receiver3, arbitrator3]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
      // Create ATAs for sender3 and intermediary3.
      senderAta3 = getAssociatedTokenAddressSync(mint.publicKey, sender3.publicKey);
      intermediaryAta3 = getAssociatedTokenAddressSync(mint.publicKey, intermediary3.publicKey);
      let tx = new Transaction();
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          senderAta3,
          sender3.publicKey,
          mint.publicKey
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          intermediaryAta3,
          intermediary3.publicKey,
          mint.publicKey
        )
      );
      tx.add(createMintToInstruction(mint.publicKey, senderAta3, provider.publicKey, 1e6));
      await provider.sendAndConfirm(tx, [sender3]).then(logTx);

      // Derive PDA and vault.
      [escrowPDA3] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          mint.publicKey.toBuffer(),
          sender3.publicKey.toBuffer(),
          intermediary3.publicKey.toBuffer(),
          receiver3.publicKey.toBuffer(),
          arbitrator3.publicKey.toBuffer(),
        ],
        program.programId
      );
      vault3 = getAssociatedTokenAddressSync(mint.publicKey, escrowPDA3, true);

      // Initialize escrow.
      const senderAmount = 1e6;
      const deadline = Math.floor(Date.now() / 1000) + 60;
      await program.methods
        .initialize(new anchor.BN(senderAmount), new anchor.BN(deadline))
        .accountsStrict({
          sender: sender3.publicKey,
          intermediary: intermediary3.publicKey,
          receiver: receiver3.publicKey,
          arbitrator: arbitrator3.publicKey,
          mint: mint.publicKey,
          senderAta: senderAta3,
          escrow: escrowPDA3,
          vault: vault3,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender3])
        .rpc()
        .then(logTx);

      // Have both intermediary and receiver confirm.
      await program.methods
        .confirm({ intermediary: {} })
        .accountsStrict({
          escrow: escrowPDA3,
          signer: intermediary3.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([intermediary3])
        .rpc()
        .then(logTx);
      await program.methods
        .confirm({ receiver: {} })
        .accountsStrict({
          escrow: escrowPDA3,
          signer: receiver3.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([receiver3])
        .rpc()
        .then(logTx);

      // Initiate dispute.
      await program.methods
        .dispute()
        .accountsStrict({
          escrow: escrowPDA3,
          signer: sender3.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([sender3])
        .rpc()
        .then(logTx);
    });

    it("Resolve dispute with release resolution", async () => {
      // Resolve dispute with a "release" resolution.
      await program.methods
        .resolveDispute({ release: {} })
        .accountsStrict({
          arbitrator: arbitrator3.publicKey,
          escrow: escrowPDA3,
          vault: vault3,
          intermediaryAta: intermediaryAta3,
          // For release resolution, senderWallet is not used.
          senderWallet: sender3.publicKey,
          intermediaryWallet: intermediary3.publicKey,
          senderAta: senderAta3,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([arbitrator3])
        .rpc()
        .then(logTx);
    });
  });

  // ---------- Dispute and Resolve Flow – Cancel Resolution ----------
  describe("Dispute and Resolve Flow - Cancel Resolution", () => {
    // New keypairs for this flow.
    const sender4 = Keypair.generate();
    const intermediary4 = Keypair.generate();
    const receiver4 = Keypair.generate();
    const arbitrator4 = Keypair.generate();

    let senderAta4: PublicKey;
    let escrowPDA4: PublicKey;
    let vault4: PublicKey;
    let intermediaryAta4: PublicKey;

    before(async () => {
      // Airdrop funds.
      for (const kp of [sender4, intermediary4, receiver4, arbitrator4]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
      // Create ATAs for sender4 and intermediary4.
      senderAta4 = getAssociatedTokenAddressSync(mint.publicKey, sender4.publicKey);
      intermediaryAta4 = getAssociatedTokenAddressSync(mint.publicKey, intermediary4.publicKey);
      let tx = new Transaction();
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          senderAta4,
          sender4.publicKey,
          mint.publicKey
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          intermediaryAta4,
          intermediary4.publicKey,
          mint.publicKey
        )
      );
      tx.add(createMintToInstruction(mint.publicKey, senderAta4, provider.publicKey, 1e6));
      await provider.sendAndConfirm(tx, [sender4]).then(logTx);

      // Derive PDA and vault.
      [escrowPDA4] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          mint.publicKey.toBuffer(),
          sender4.publicKey.toBuffer(),
          intermediary4.publicKey.toBuffer(),
          receiver4.publicKey.toBuffer(),
          arbitrator4.publicKey.toBuffer(),
        ],
        program.programId
      );
      vault4 = getAssociatedTokenAddressSync(mint.publicKey, escrowPDA4, true);

      // Initialize escrow with a deadline in the past (to allow cancellation).
      const senderAmount = 1e6;
      const deadline = Math.floor(Date.now() / 1000) - 60;
      await program.methods
        .initialize(new anchor.BN(senderAmount), new anchor.BN(deadline))
        .accountsStrict({
          sender: sender4.publicKey,
          intermediary: intermediary4.publicKey,
          receiver: receiver4.publicKey,
          arbitrator: arbitrator4.publicKey,
          mint: mint.publicKey,
          senderAta: senderAta4,
          escrow: escrowPDA4,
          vault: vault4,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender4])
        .rpc()
        .then(logTx);

      // No confirmations; initiate dispute.
      await program.methods
        .dispute()
        .accountsStrict({
          escrow: escrowPDA4,
          signer: sender4.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([sender4])
        .rpc()
        .then(logTx);
    });

    it("Resolve dispute with cancel resolution", async () => {
      await program.methods
        .resolveDispute({ cancel: {} })
        .accountsStrict({
          arbitrator: arbitrator4.publicKey,
          escrow: escrowPDA4,
          vault: vault4,
          intermediaryAta: intermediaryAta4,
          senderWallet: sender4.publicKey,
          intermediaryWallet: intermediary4.publicKey,
          senderAta: senderAta4,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([arbitrator4])
        .rpc()
        .then(logTx);
    });
  });

  // ---------- Cancel Flow (Non-disputed) ----------
  describe("Cancel Flow", () => {
    // New keypairs for this flow.
    const sender5 = Keypair.generate();
    const intermediary5 = Keypair.generate();
    const receiver5 = Keypair.generate();
    const arbitrator5 = Keypair.generate();

    let senderAta5: PublicKey;
    let escrowPDA5: PublicKey;
    let vault5: PublicKey;

    before(async () => {
      // Airdrop funds.
      for (const kp of [sender5, intermediary5, receiver5, arbitrator5]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
      // Create sender's ATA.
      senderAta5 = getAssociatedTokenAddressSync(mint.publicKey, sender5.publicKey);
      const tx = new Transaction();
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          provider.publicKey,
          senderAta5,
          sender5.publicKey,
          mint.publicKey
        )
      );
      await provider.sendAndConfirm(tx, [sender5]).then(logTx);

      // Derive PDA and vault.
      [escrowPDA5] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          mint.publicKey.toBuffer(),
          sender5.publicKey.toBuffer(),
          intermediary5.publicKey.toBuffer(),
          receiver5.publicKey.toBuffer(),
          arbitrator5.publicKey.toBuffer(),
        ],
        program.programId
      );
      vault5 = getAssociatedTokenAddressSync(mint.publicKey, escrowPDA5, true);

      // Initialize escrow with a past deadline to allow cancellation.
      const senderAmount = 1e6;
      const deadline = Math.floor(Date.now() / 1000) - 60;
      await program.methods
        .initialize(new anchor.BN(senderAmount), new anchor.BN(deadline))
        .accountsStrict({
          sender: sender5.publicKey,
          intermediary: intermediary5.publicKey,
          receiver: receiver5.publicKey,
          arbitrator: arbitrator5.publicKey,
          mint: mint.publicKey,
          senderAta: senderAta5,
          escrow: escrowPDA5,
          vault: vault5,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender5])
        .rpc()
        .then(logTx);
    });

    it("Cancel escrow successfully", async () => {
      await program.methods
        .cancel()
        .accountsStrict({
            sender: sender5.publicKey,
            mint: mint.publicKey,
            senderAta: senderAta5,
            escrow: escrowPDA5,
            vault: vault5,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            clock: ""
        })
        .signers([sender5])
        .rpc()
        .then(logTx);
    });
  });
});

