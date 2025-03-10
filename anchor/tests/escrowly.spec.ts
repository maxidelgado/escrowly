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

describe("Normal flow", () => {
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

// ---------- Revoke Confirmation Flow ----------
describe("Revoke Confirmation Flow", () => {
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

  it("Confirm (intermediary) then revoke and reconfirm", async () => {
      // intermediary confirms.
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

      // intermediary revokes confirmation.
      await program.methods
        .revoke({ intermediary: {} })
        .accountsStrict({
          escrow: escrowPDA,
          signer: intermediary.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([intermediary])
        .rpc()
        .then(logTx);

      // intermediary confirms again.
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
  });


// ---------- Dispute and Resolve Flow – Release Resolution ----------
describe("Dispute and Resolve Flow - Release Resolution", () => { 
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

  it("Have both intermediary and receiver confirm", async () => {
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

  it("Initiate dispute", async () => {
    await program.methods
    .dispute()
    .accountsStrict({
      escrow: escrowPDA,
      signer: sender.publicKey,
      clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
    })
    .signers([sender])
    .rpc()
    .then(logTx);  
  })

  it("Resolve dispute with release resolution", async () => {
      // Resolve dispute with a "release" resolution.
      await program.methods
        .resolveDispute({ release: {} })
        .accountsStrict({
          arbitrator: arbitrator.publicKey,
          escrow: escrowPDA,
          vault: vault,
          intermediaryAta: intermediaryAta,
          // For release resolution, senderWallet is not used.
          senderWallet: sender.publicKey,
          intermediaryWallet: intermediary.publicKey,
          senderAta: senderAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([arbitrator])
        .rpc()
        .then(logTx);
    });
});

// ---------- Dispute and Resolve Flow – Cancel Resolution ----------
describe("Dispute and Resolve Flow - Cancel Resolution", () => {
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

  it("Initialize escrow", async () => {
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

  it("Initiate dispute (without confirmations)", async () => {
    await program.methods
    .dispute()
    .accountsStrict({
      escrow: escrowPDA,
      signer: sender.publicKey,
      clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
    })
    .signers([sender])
    .rpc()
    .then(logTx);  
  })

  it("Resolve dispute with cancel resolution", async () => {
      await program.methods
        .resolveDispute({ cancel: {} })
        .accountsStrict({
          arbitrator: arbitrator.publicKey,
          escrow: escrowPDA,
          vault: vault,
          intermediaryAta: intermediaryAta,
          senderWallet: sender.publicKey,
          intermediaryWallet: intermediary.publicKey,
          senderAta: senderAta,
          mint: mint.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([arbitrator])
        .rpc()
        .then(logTx);
    });
}) 

// ---------- Cancel Flow (Non-disputed) ----------
describe("Cancel Flow", () => {
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

  it("Initialize escrow", async () => {
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

  it("Cancel escrow successfully", async () => {
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
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([sender])
        .rpc()
        .then(logTx);
    });
})

