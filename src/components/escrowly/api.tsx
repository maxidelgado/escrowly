"use client";

import * as anchor from "@coral-xyz/anchor";
import { getEscrowlyProgram, getEscrowlyProgramId } from "@project/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram, Cluster, PublicKey } from "@solana/web3.js";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import toast from "react-hot-toast";
import { useCluster } from "../cluster/cluster-data-access";
import { useAnchorProvider } from "../solana/solana-provider";
import { useTransactionToast } from "../ui/ui-layout";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN } from "bn.js";

export type ArbitratorRole = { arbitrator: {}};
export type SenderRole = { sender: {}};
export type IntermediaryRole = { intermediary: {}};
export type ReceiverRole = { receiver: {}};

export type DisputeResolutionCancel = { cancel: {}};
export type DisputeResolutionRelease = { release: {}};

export function useEscrowlyProgram() {
  const { connection } = useConnection();
  const { cluster } = useCluster();
  const transactionToast = useTransactionToast();
  const provider = useAnchorProvider();
  const { publicKey } = useWallet();

  const programId = useMemo(
    () => getEscrowlyProgramId(cluster.network as Cluster),
    [cluster],
  );

  const program = useMemo(
    () => getEscrowlyProgram(provider, programId),
    [provider, programId],
  );

  // Query for all escrow accounts
  const accounts = useQuery({
    queryKey: ["escrowly", "all", { cluster }],
    queryFn: async () => {
      return await program.account.escrow.all();
    },
  });

  // Query for the program account info
  const getProgramAccount = useQuery({
    queryKey: ["get-program-account", { cluster }],
    queryFn: async () => {
      return await connection.getParsedAccountInfo(programId);
    },
  });

  // Derive escrow PDA
  const deriveEscrowPda = (
    mint: PublicKey,
    sender: PublicKey,
    intermediary: PublicKey,
    receiver: PublicKey,
    arbitrator: PublicKey,
  ) => {
    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        mint.toBuffer(),
        sender.toBuffer(),
        intermediary.toBuffer(),
        receiver.toBuffer(),
        arbitrator.toBuffer(),
      ],
      program.programId,
    );
    return escrowPda;
  };

  // Initialize escrow mutation.
  // The caller must provide: seed, senderAmount, deadline, and the three addresses.
  const initialize = useMutation({
    mutationKey: ["escrowly", "initialize", { cluster }],
    mutationFn: async ({
      senderAmount,
      deadline,
      mint,
      intermediary,
      receiver,
      arbitrator,
    }: {
      senderAmount: number;
      deadline: number;
      mint: string;
      intermediary: string;
      receiver: string;
      arbitrator: string;
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      // Use the provided addresses.
      const mintPublicKey = new PublicKey(mint);
      const senderPublicKey = new PublicKey(publicKey);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);
      const arbitratorPublicKey = new PublicKey(arbitrator);

      const escrowPDA = deriveEscrowPda(
        mintPublicKey,
        senderPublicKey,
        intermediaryPublicKey,
        receiverPublicKey,
        arbitratorPublicKey,
      );
      const vault = getAssociatedTokenAddressSync(
        mintPublicKey,
        escrowPDA,
        true,
      );
      const senderAta = getAssociatedTokenAddressSync(
        mintPublicKey,
        senderPublicKey,
      );

      // Set deposit amount and a deadline 60 seconds from now.
      return await program.methods
        .initialize(new anchor.BN(senderAmount), new anchor.BN(deadline))
        .accountsStrict({
          sender: senderPublicKey, // The sender who is cancelling.
          intermediary: intermediaryPublicKey, // The intermediary.
          receiver: receiverPublicKey, // The receiver.
          arbitrator: arbitratorPublicKey, // The arbitrator.
          mint: mintPublicKey, // The token mint.
          senderAta: senderAta, // Sender's associated token account.
          escrow: escrowPDA, // The escrow PDA derived with seeds: [b"state", mint, sender, intermediary, receiver]
          vault: vault, // The vault holding the tokens.
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([])
        .rpc();
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to initialize escrow");
      console.error(error);
    },
  });

  // Confirm escrow mutation.
  // Role must be either "intermediary" or "receiver".
  const confirm = useMutation({
    mutationKey: ["escrowly", "confirm", { cluster }],
    mutationFn: async ({
      mint,
      sender,
      intermediary,
      receiver,
      arbitrator,
    }: {
      mint: string;
      sender: string;
      intermediary: string;
      receiver: string;
      arbitrator: string;
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const senderPublicKey = new PublicKey(sender);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);
      const arbitratorPublicKey = new PublicKey(arbitrator);

      const escrowPDA = deriveEscrowPda(
        mintPublicKey,
        senderPublicKey,
        intermediaryPublicKey,
        receiverPublicKey,
        arbitratorPublicKey,
      );

      let role: IntermediaryRole | ReceiverRole = { intermediary: {} };
      if (publicKey.equals(receiverPublicKey)) {
        role = { receiver: {} };
      }

      return await program.methods
        .confirm(role)
        .accountsStrict({
          escrow: escrowPDA,
          signer: publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to confirm escrow");
      console.error(error);
    },
  });

  // Release escrow mutation.
  // Requires the provided mint and intermediary address.
  const release = useMutation({
    mutationKey: ["escrowly", "release", { cluster }],
    mutationFn: async ({
      mint,
      sender,
      receiver,
      arbitrator,
    }: {
      mint: string;
      sender: string;
      receiver: string;
      arbitrator: string;
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const senderPublicKey = new PublicKey(sender);
      const intermediaryPublicKey = new PublicKey(publicKey);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);
      const arbitratorPublicKey = new PublicKey(arbitrator);

      const escrowPDA = deriveEscrowPda(
        mintPublicKey,
        senderPublicKey,
        intermediaryPublicKey,
        receiverPublicKey,
        arbitratorPublicKey,
      );
      const vault = getAssociatedTokenAddressSync(
        mintPublicKey,
        escrowPDA,
        true,
      );
      const intermediaryAta = getAssociatedTokenAddressSync(
        mintPublicKey,
        intermediaryPublicKey,
      );

      return await program.methods
        .release()
        .accountsStrict({
          caller: intermediaryPublicKey, // Caller (must be intermediary or receiver)
          escrow: escrowPDA, // The escrow PDA derived using [b"state", mint, sender, intermediary, receiver]
          intermediaryWallet: intermediaryPublicKey, // Used to receive any remaining lamports from closing the vault
          vault: vault, // Vault token account holding escrowed tokens
          intermediaryAta: intermediaryAta, // Intermediary's associated token account for the mint
          mint: mint, // The token mint
          tokenProgram: TOKEN_PROGRAM_ID, // The SPL Token program
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to release escrow");
      console.error(error);
    },
  });

  // Cancel escrow mutation.
  // Uses the provided mint address.
  const cancel = useMutation({
    mutationKey: ["escrowly", "cancel", { cluster }],
    mutationFn: async ({
      mint,
      intermediary,
      receiver,
      arbitrator,
    }: {
      mint: string;
      intermediary: string;
      receiver: string;
      arbitrator: string;
      
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const senderPublicKey = new PublicKey(publicKey);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);
      const arbitratorPublicKey = new PublicKey(arbitrator);

      const escrowPDA = deriveEscrowPda(
        mintPublicKey,
        senderPublicKey,
        intermediaryPublicKey,
        receiverPublicKey,
        arbitratorPublicKey,
      );
      const vault = getAssociatedTokenAddressSync(
        mintPublicKey,
        escrowPDA,
        true,
      );
      const senderAta = getAssociatedTokenAddressSync(
        mintPublicKey,
        senderPublicKey,
      );

      return await program.methods
        .cancel()
        .accountsStrict({
          sender: senderPublicKey, // The sender who is cancelling.
          mint: mintPublicKey, // The token mint.
          senderAta: senderAta, // Sender's associated token account.
          escrow: escrowPDA, // The escrow PDA derived with seeds: [b"state", mint, sender, intermediary, receiver]
          vault: vault, // The vault holding the tokens.
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .rpc();
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to cancel escrow");
      console.error(error);
    },
  });

  const revoke = useMutation({
    mutationKey: ["escrowly", "revoke", { cluster }],
    mutationFn: async ({
      mint,
      sender,
      intermediary,
      receiver,
      arbitrator,
    }: {
      mint: string;
      sender: string;
      intermediary: string;
      receiver: string;
      arbitrator: string;
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const senderPublicKey = new PublicKey(sender);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);
      const arbitratorPublicKey = new PublicKey(arbitrator);

      if (!publicKey.equals(intermediaryPublicKey) && !publicKey.equals(receiverPublicKey)) {
        throw new Error("You are not the intermediary or receiver");
      }

      const escrowPDA = deriveEscrowPda(
        mintPublicKey,
        senderPublicKey,
        intermediaryPublicKey,
        receiverPublicKey,
        arbitratorPublicKey,
      );

      let role: IntermediaryRole | ReceiverRole = { intermediary: {} };
      if (publicKey.equals(receiverPublicKey)) {
        role = { receiver: {} };
      }

      return await program.methods
        .revoke(role)
        .accountsStrict({
          escrow: escrowPDA,
          signer: publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([])
        .rpc();
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to revoke escrow");
      console.error(error);
    },
  });

  const dispute = useMutation({
    mutationKey: ["escrowly", "dispute", { cluster }],
    mutationFn: async ({
      mint,
      sender,
      intermediary,
      receiver,
      arbitrator,
    }: {
      mint: string;
      sender: string;
      intermediary: string;
      receiver: string;
      arbitrator: string;
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const senderPublicKey = new PublicKey(sender);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);
      const arbitratorPublicKey = new PublicKey(arbitrator);

      const escrowPDA = deriveEscrowPda(
        mintPublicKey,
        senderPublicKey,
        intermediaryPublicKey,
        receiverPublicKey,
        arbitratorPublicKey,
      );

      return await program.methods
        .dispute()
        .accountsStrict({
          escrow: escrowPDA,
          signer: publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([])
        .rpc();
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to initiate dispute");
      console.error(error);
    },
  });

  const resolveDispute = useMutation({
    mutationKey: ["escrowly", "resolve-dispute", { cluster }],
    mutationFn: async ({
      mint,
      sender,
      intermediary,
      receiver,
      arbitrator,
      resolution,
    }: {
      mint: string;
      sender: string;
      intermediary: string;
      receiver: string;
      arbitrator: string;
      resolution: DisputeResolutionCancel | DisputeResolutionRelease;
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");
      const senderPublicKey = new PublicKey(sender);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);
      const arbitratorPublicKey = new PublicKey(arbitrator);

      if (!publicKey.equals(arbitratorPublicKey)) {
        throw new Error("You are not the arbitrator"); 
      }

      const escrowPDA = deriveEscrowPda(
        mintPublicKey,
        senderPublicKey,
        intermediaryPublicKey,
        receiverPublicKey,
        arbitratorPublicKey,
      );

      const vault = getAssociatedTokenAddressSync(
        mintPublicKey,
        escrowPDA,
        true,
      );
      const senderAta = getAssociatedTokenAddressSync(
        mintPublicKey,
        senderPublicKey,
      );
      const intermediaryAta = getAssociatedTokenAddressSync(
        mintPublicKey,
        intermediaryPublicKey,
      );

      return await program.methods
        .resolveDispute(resolution)
        .accountsStrict({
          arbitrator: arbitratorPublicKey,
          escrow: escrowPDA,
          vault: vault,
          intermediaryAta: intermediaryAta,
          // For release resolution, senderWallet is not used.
          senderWallet: senderPublicKey,
          intermediaryWallet: intermediaryPublicKey,
          senderAta: senderAta,
          mint: mintPublicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([])
        .rpc();
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error("Failed to resolve dispute");
      console.error(error);
    },
  });

  const userEscrows = useQuery({
  queryKey: ["user-escrows", publicKey?.toBase58(), { cluster }],
  enabled: !!publicKey,
  queryFn: async () => {
    if (!publicKey) throw new Error("Wallet not connected");
    console.log("Fetching escrows for user:", publicKey.toBase58());

    // Fetch all Escrow accounts with a filter by the sender (user)
    const escrows = await program.account.escrow.all();

    console.log("Escrows fetched:", escrows);

    // Return data formatted similar to your mocked example
    return escrows.map((escrow) => ({
      publicKey: escrow.publicKey,
      account: {
        amount: new BN(escrow.account.amount),
        mint: escrow.account.mint,
        sender: escrow.account.sender,
        intermediary: escrow.account.intermediary,
        receiver: escrow.account.receiver,
        arbitrator: escrow.account.arbitrator,
        deadline: new BN(escrow.account.deadline),
        intermediaryConfirmed: escrow.account.intermediaryConfirmed,
        receiverConfirmed: escrow.account.receiverConfirmed,
        status: escrow.account.status,
        bump: escrow.account.bump,
      },
    }));
  },
});

  return {
    program,
    programId,
    accounts,
    getProgramAccount,
    initialize,
    confirm,
    release,
    cancel,
    revoke,
    dispute,
    resolveDispute,
    userEscrows,
  };
}
