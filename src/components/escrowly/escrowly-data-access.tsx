'use client';

import * as anchor from '@coral-xyz/anchor';
import { getEscrowlyProgram, getEscrowlyProgramId } from '@project/anchor';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Cluster, PublicKey, SystemProgram } from '@solana/web3.js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import toast from 'react-hot-toast';
import { useCluster } from '../cluster/cluster-data-access';
import { useAnchorProvider } from '../solana/solana-provider';
import { useTransactionToast } from '../ui/ui-layout';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { randomBytes } from "crypto";

export function useEscrowlyProgram() {
  const { connection } = useConnection();
  const { cluster } = useCluster();
  const transactionToast = useTransactionToast();
  const provider = useAnchorProvider();
  const { publicKey } = useWallet();
  const programId = useMemo(
    () => getEscrowlyProgramId(cluster.network as Cluster),
    [cluster]
  );
  const program = useMemo(
    () => getEscrowlyProgram(provider, programId),
    [provider, programId]
  );

  // Query for all escrow accounts
  const accounts = useQuery({
    queryKey: ['escrowly', 'all', { cluster }],
    queryFn: async () => {
      return await program.account.escrowly.all();
    },
  });

  // Query for the program account info
  const getProgramAccount = useQuery({
    queryKey: ['get-program-account', { cluster }],
    queryFn: async () => {
      return await connection.getParsedAccountInfo(programId);
    },
  });

  // Initialize escrow mutation.
  // The caller must provide: seed, senderAmount, deadline, and the three addresses.
  const initialize = useMutation({
    mutationKey: ['escrowly', 'initialize', { cluster }],
    mutationFn: async ({
      senderAmount,
      deadline,
      mint,
      intermediary,
      receiver,
    }: {
      seed: number;
      senderAmount: number;
      deadline: number;
      mint: string;
      intermediary: string;
      receiver: string;
    }) => {
      if (!publicKey) throw new Error('Wallet not connected');
      // Create an 8-byte buffer (little-endian) from the seed.
      // Generate a random 8-byte Buffer and convert it to a BN in little-endian.
      const seedBuffer = randomBytes(8);
      const seedBN = new anchor.BN(seedBuffer, "le"); // ensure little-endian interpretation

      // Derive the escrow PDA
      const [escrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('state'), seedBN.toArrayLike(Buffer, 'le', 8)],
        programId
      );

      // Use the provided addresses.
      const mintPublicKey = new PublicKey(mint);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);

      // Derive associated token accounts.
      const senderAta = getAssociatedTokenAddressSync(mintPublicKey, publicKey);
      const vault = getAssociatedTokenAddressSync(mintPublicKey, escrowPda, true);
      const intermediaryAta = getAssociatedTokenAddressSync(mintPublicKey, intermediaryPublicKey);

      const acc = {
          sender: publicKey,
          intermediary: intermediaryPublicKey,
          receiver: receiverPublicKey,
          mint: mintPublicKey,
          senderAta,
          escrow: escrowPda,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        };
        console.log("sender ", publicKey.toString(), 
                    "intermediary ", intermediaryPublicKey.toString(), 
                    "receiver ", receiverPublicKey.toString(), 
                    "escrow ", escrowPda.toString(), 
                    "vault ", vault.toString(), 
                    "mint ", mintPublicKey.toString(),
                    "senderAta ", senderAta.toString(),
                    "associatedTokenProgram ", ASSOCIATED_TOKEN_PROGRAM_ID.toString(),
                    "tokenProgram ", TOKEN_PROGRAM_ID.toString(),
                    "systemProgram ", SystemProgram.programId.toString());
                    
      // Set deposit amount and a deadline 60 seconds from now.
    await program.methods
      .initialize(seedBN, new anchor.BN(senderAmount), new anchor.BN(deadline))
      .accounts(acc)
      .signers([])
      .rpc();

      //await program.methods
      //  .initialize(seedBN, new anchor.BN(senderAmount), new anchor.BN(deadline))
      //  .accounts(acc)
      //  .rpc();
      //
      return escrowPda.toString();
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error('Failed to initialize escrow');
      console.error(error);
    },
  });

  // Confirm escrow mutation.
  // Role must be either "intermediary" or "receiver".
  const confirm = useMutation({
    mutationKey: ['escrowly', 'confirm', { cluster }],
    mutationFn: async ({
      escrowPda,
      role,
    }: {
      escrowPda: string;
      role: 'intermediary' | 'receiver';
    }) => {
      if (!publicKey) throw new Error('Wallet not connected');
      await program.methods
        .confirm({ [role]: {} })
        .accounts({
          escrow: new PublicKey(escrowPda),
          signer: publicKey,
        })
        .rpc();
      return escrowPda;
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error('Failed to confirm escrow');
      console.error(error);
    },
  });

  // Release escrow mutation.
  // Requires the provided mint and intermediary address.
  const release = useMutation({
    mutationKey: ['escrowly', 'release', { cluster }],
    mutationFn: async ({
      escrowPda,
      mint,
      intermediary,
    }: {
      escrowPda: string;
      mint: string;
      intermediary: string;
    }) => {
      if (!publicKey) throw new Error('Wallet not connected');
      const mintPublicKey = new PublicKey(mint);
      const intermediaryPublicKey = new PublicKey(intermediary);
      // Compute vault and intermediary's associated token address.
      const vault = getAssociatedTokenAddressSync(
        mintPublicKey,
        new PublicKey(escrowPda),
        true
      );
      const intermediaryAta = getAssociatedTokenAddressSync(
        mintPublicKey,
        intermediaryPublicKey
      );

      await program.methods
        .release()
        .accounts({
          caller: publicKey,
          escrow: new PublicKey(escrowPda),
          intermediaryWallet: publicKey, // Adjust if necessary.
          vault,
          intermediaryAta,
          mint: mintPublicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      return escrowPda;
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error('Failed to release escrow');
      console.error(error);
    },
  });

  // Cancel escrow mutation.
  // Uses the provided mint address.
  const cancel = useMutation({
    mutationKey: ['escrowly', 'cancel', { cluster }],
    mutationFn: async ({
      escrowPda,
      mint,
    }: {
      escrowPda: string;
      mint: string;
    }) => {
      if (!publicKey) throw new Error('Wallet not connected');
      const mintPublicKey = new PublicKey(mint);
      // Derive sender's associated token account.
      const senderAta = getAssociatedTokenAddressSync(mintPublicKey, publicKey);
      const vault = getAssociatedTokenAddressSync(
        mintPublicKey,
        new PublicKey(escrowPda),
        true
      );

      await program.methods
        .cancel()
        .accounts({
          sender: publicKey,
          mint: mintPublicKey,
          senderAta,
          escrow: new PublicKey(escrowPda),
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return escrowPda;
    },
    onSuccess: (res) => {
      transactionToast(res);
      accounts.refetch();
    },
    onError: (error: any) => {
      toast.error('Failed to cancel escrow');
      console.error(error);
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
  };
}

