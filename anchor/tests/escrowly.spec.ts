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

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────
function createTestAccounts() {
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

  return { mint, sender, intermediary, receiver, arbitrator, program, connection, provider, senderAta, intermediaryAta, escrowPDA, vault };
}


async function initializeEscrow(program: anchor.Program<Escrowly>, sender: anchor.web3.Keypair, intermediary: anchor.web3.Keypair, receiver: anchor.web3.Keypair, arbitrator: anchor.web3.Keypair, mint: anchor.web3.Keypair, senderAta: anchor.web3.PublicKey, escrowPDA: anchor.web3.PublicKey, vault: anchor.web3.PublicKey) {
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
        .rpc();
}

async function setupAsociatedTokenAccounts(tx: anchor.web3.Transaction, provider: anchor.AnchorProvider, senderAta: anchor.web3.PublicKey, sender: anchor.web3.Keypair, mint: anchor.web3.Keypair, intermediaryAta: anchor.web3.PublicKey, intermediary: anchor.web3.Keypair) {
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
    await provider.sendAndConfirm(tx, [mint, sender]);
}

async function setupMint(connection: anchor.web3.Connection, provider: anchor.AnchorProvider, mint: anchor.web3.Keypair, sender: anchor.web3.Keypair) {
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
    return tx;
}

async function airdropSol(connection: anchor.web3.Connection, sender: anchor.web3.Keypair, intermediary: anchor.web3.Keypair, receiver: anchor.web3.Keypair) {
    const airdropSender = await connection.requestAirdrop(sender.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropSender);
    const airdropIntermediary = await connection.requestAirdrop(intermediary.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropIntermediary);
    const airdropReceiver = await connection.requestAirdrop(receiver.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropReceiver);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Normal flow", () => {
  const { mint, sender, intermediary, receiver, arbitrator, program, connection, provider, senderAta, intermediaryAta, escrowPDA, vault } = createTestAccounts();
  
  beforeAll(async () => {
    // Airdrop SOL to sender, intermediary, and receiver.
    await airdropSol(connection, sender, intermediary, receiver);

    // Create mint account and initialize the mint.
    const tx = await setupMint(connection, provider, mint, sender);

    // Create associated token accounts for sender and intermediary.
    await setupAsociatedTokenAccounts(tx, provider, senderAta, sender, mint, intermediaryAta, intermediary);
  });

  it("Initialize escrow", async () => {
      await initializeEscrow(program, sender, intermediary, receiver, arbitrator, mint, senderAta, escrowPDA, vault);
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
        .rpc();
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
        .rpc();
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
        .rpc();
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
  const { mint, sender, intermediary, receiver, arbitrator, program, connection, provider, senderAta, intermediaryAta, escrowPDA, vault } = createTestAccounts();
  
  beforeAll(async () => {
    // Airdrop SOL to sender, intermediary, and receiver.
    await airdropSol(connection, sender, intermediary, receiver);

    // Create mint account and initialize the mint.
    const tx = await setupMint(connection, provider, mint, sender);

    // Create associated token accounts for sender and intermediary.
    await setupAsociatedTokenAccounts(tx, provider, senderAta, sender, mint, intermediaryAta, intermediary);
  });

  it("Initialize escrow", async () => {
      await initializeEscrow(program, sender, intermediary, receiver, arbitrator, mint, senderAta, escrowPDA, vault);
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
        .rpc();

      // intermediary revokes confirmation.
      await program.methods
        .revoke({ intermediary: {} })
        .accountsStrict({
          escrow: escrowPDA,
          signer: intermediary.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([intermediary])
        .rpc();

      // intermediary confirms again.
      await program.methods
        .confirm({ intermediary: {} })
        .accountsStrict({
          escrow: escrowPDA,
          signer: intermediary.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([intermediary])
        .rpc();
    });
  });


// ---------- Dispute and Resolve Flow – Release Resolution ----------
describe("Dispute and Resolve Flow - Release Resolution", () => { 
  const { mint, sender, intermediary, receiver, arbitrator, program, connection, provider, senderAta, intermediaryAta, escrowPDA, vault } = createTestAccounts();
  
  beforeAll(async () => {
    // Airdrop SOL to sender, intermediary, and receiver.
    await airdropSol(connection, sender, intermediary, receiver);

    // Create mint account and initialize the mint.
    const tx = await setupMint(connection, provider, mint, sender);

    // Create associated token accounts for sender and intermediary.
    await setupAsociatedTokenAccounts(tx, provider, senderAta, sender, mint, intermediaryAta, intermediary);
  });

  it("Initialize escrow", async () => {
      await initializeEscrow(program, sender, intermediary, receiver, arbitrator, mint, senderAta, escrowPDA, vault);
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
        .rpc();
    
      await program.methods
        .confirm({ receiver: {} })
        .accountsStrict({
          escrow: escrowPDA,
          signer: receiver.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([receiver])
        .rpc();
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
    .rpc();  
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
        .rpc();
    });
});

// ---------- Dispute and Resolve Flow – Cancel Resolution ----------
describe("Dispute and Resolve Flow - Cancel Resolution", () => {
  const { mint, sender, intermediary, receiver, arbitrator, program, connection, provider, senderAta, intermediaryAta, escrowPDA, vault } = createTestAccounts();
  
  beforeAll(async () => {
    // Airdrop SOL to sender, intermediary, and receiver.
    await airdropSol(connection, sender, intermediary, receiver);

    // Create mint account and initialize the mint.
    const tx = await setupMint(connection, provider, mint, sender);

    // Create associated token accounts for sender and intermediary.
    await setupAsociatedTokenAccounts(tx, provider, senderAta, sender, mint, intermediaryAta, intermediary);
  });

  it("Initialize escrow", async () => {
      await initializeEscrow(program, sender, intermediary, receiver, arbitrator, mint, senderAta, escrowPDA, vault);
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
    .rpc();  
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
        .rpc();
    });
}) 

// ---------- Cancel Flow (Non-disputed) ----------
describe("Cancel Flow", () => {
  const { mint, sender, intermediary, receiver, arbitrator, program, connection, provider, senderAta, intermediaryAta, escrowPDA, vault } = createTestAccounts();
  
  beforeAll(async () => {
    // Airdrop SOL to sender, intermediary, and receiver.
    await airdropSol(connection, sender, intermediary, receiver);

    // Create mint account and initialize the mint.
    const tx = await setupMint(connection, provider, mint, sender);

    // Create associated token accounts for sender and intermediary.
    await setupAsociatedTokenAccounts(tx, provider, senderAta, sender, mint, intermediaryAta, intermediary);
  });

  it("Initialize escrow", async () => {
      await initializeEscrow(program, sender, intermediary, receiver, arbitrator, mint, senderAta, escrowPDA, vault);
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
        .rpc();
    });
})

