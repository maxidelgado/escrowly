'use client';

import * as anchor from '@coral-xyz/anchor';
import { getEscrowlyProgram, getEscrowlyProgramId } from '@project/anchor';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SystemProgram, Cluster, PublicKey } from '@solana/web3.js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import toast from 'react-hot-toast';
import { useCluster } from '../cluster/cluster-data-access';
import { useAnchorProvider } from '../solana/solana-provider';
import { useTransactionToast } from '../ui/ui-layout';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from 'bn.js';

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
      return await program.account.escrow.all();
    },
  });

  // Query for the program account info
  const getProgramAccount = useQuery({
    queryKey: ['get-program-account', { cluster }],
    queryFn: async () => {
      return await connection.getParsedAccountInfo(programId);
    },
  });

  // Derive escrow PDA 
  const deriveEscrowPda = (mint: PublicKey, sender: PublicKey, intermediary: PublicKey, receiver: PublicKey) => {
    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("state"),
        mint.toBuffer(),
        sender.toBuffer(),
        intermediary.toBuffer(),
        receiver.toBuffer(),
      ]        
      , program.programId
    )    ;
    return escrowPda;
  }  

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
      senderAmount: number;
      deadline: number;
      mint: string;
      intermediary: string;
      receiver: string;
    }) => {
      if (!publicKey) throw new Error('Wallet not connected');
      
      // Use the provided addresses.
      const mintPublicKey = new PublicKey(mint);
      const senderPublicKey = new PublicKey(publicKey);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);

      const escrowPDA = deriveEscrowPda(mintPublicKey, senderPublicKey, intermediaryPublicKey, receiverPublicKey);
      const vault = getAssociatedTokenAddressSync(mintPublicKey, escrowPDA, true);
      const senderAta = getAssociatedTokenAddressSync(mintPublicKey, senderPublicKey);

      // Set deposit amount and a deadline 60 seconds from now.
    return await program.methods
      .initialize(new anchor.BN(senderAmount), new anchor.BN(deadline))
      .accountsStrict({
          sender: senderPublicKey,             // The sender who is cancelling.
          intermediary: intermediaryPublicKey, // The intermediary.
          receiver: receiverPublicKey,         // The receiver.
          mint: mintPublicKey,                 // The token mint.
          senderAta: senderAta,                 // Sender's associated token account.
          escrow: escrowPDA,                    // The escrow PDA derived with seeds: [b"state", mint, sender, intermediary, receiver]
          vault: vault,                         // The vault holding the tokens.
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
      toast.error('Failed to initialize escrow');
      console.error(error);
    },
  });

  // Confirm escrow mutation.
  // Role must be either "intermediary" or "receiver".
  const confirm = useMutation({
    mutationKey: ['escrowly', 'confirm', { cluster }],
    mutationFn: async ({
      mint,
      sender,
      intermediary,
      receiver,
      role,
    }: {
      mint: string;
      sender: string;
      intermediary: string;
      receiver: string;
      role: 'intermediary' | 'receiver';
    }) => {
      if (!publicKey) throw new Error('Wallet not connected');
      
      const senderPublicKey = new PublicKey(sender);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);
      const escrowPDA = deriveEscrowPda(mintPublicKey, senderPublicKey, intermediaryPublicKey, receiverPublicKey);

      let signerRole; 
      let signer;
      if (role === 'intermediary') {
        signerRole = { intermediary: {}} 
        signer = intermediaryPublicKey
      } else {
        signerRole = { receiver: {}}
        signer = receiverPublicKey
      }

      return await program.methods
        .confirm(signerRole)
        .accountsStrict({
          escrow: escrowPDA,
          signer: signer, 
      })
        .rpc();
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
      mint,
      sender,
      receiver,
    }: {
      mint: string;
      sender: string;
      receiver: string;
    }) => {
      if (!publicKey) throw new Error('Wallet not connected');

      const senderPublicKey = new PublicKey(sender);
      const intermediaryPublicKey = new PublicKey(publicKey);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);

      const escrowPDA = deriveEscrowPda(mintPublicKey, senderPublicKey, intermediaryPublicKey, receiverPublicKey);
      const vault = getAssociatedTokenAddressSync(mintPublicKey, escrowPDA, true);
      const intermediaryAta = getAssociatedTokenAddressSync(mintPublicKey, intermediaryPublicKey);
      
      return await program.methods
        .release()
        .accountsStrict({
        caller: intermediaryPublicKey,                // Caller (must be intermediary or receiver)
        escrow: escrowPDA,                // The escrow PDA derived using [b"state", mint, sender, intermediary, receiver]
        intermediaryWallet: intermediaryPublicKey,    // Used to receive any remaining lamports from closing the vault
        vault: vault,                     // Vault token account holding escrowed tokens
        intermediaryAta: intermediaryAta, // Intermediary's associated token account for the mint
        mint: mint,                       // The token mint
        tokenProgram: TOKEN_PROGRAM_ID,   // The SPL Token program
      })
        .rpc();
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
      mint,
      intermediary,
      receiver,
    }: {
      mint: string;
      intermediary: string;
      receiver: string;
    }) => {
      if (!publicKey) throw new Error('Wallet not connected');
      const senderPublicKey = new PublicKey(publicKey);
      const intermediaryPublicKey = new PublicKey(intermediary);
      const receiverPublicKey = new PublicKey(receiver);
      const mintPublicKey = new PublicKey(mint);

      const escrowPDA = deriveEscrowPda(mintPublicKey, senderPublicKey, intermediaryPublicKey, receiverPublicKey);
      const vault = getAssociatedTokenAddressSync(mintPublicKey, escrowPDA, true);
      const senderAta = getAssociatedTokenAddressSync(mintPublicKey, senderPublicKey);

      return await program.methods
        .cancel()
        .accountsStrict({
          sender: senderPublicKey,             // The sender who is cancelling.
          mint: mintPublicKey,                 // The token mint.
          senderAta: senderAta,                 // Sender's associated token account.
          escrow: escrowPDA,                    // The escrow PDA derived with seeds: [b"state", mint, sender, intermediary, receiver]
          vault: vault,                         // The vault holding the tokens.
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
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

  const userEscrows = useQuery({
  queryKey: ['user-escrows', publicKey?.toBase58(), { cluster }],
  enabled: !!publicKey,
  queryFn: async () => {
    if (!publicKey) throw new Error('Wallet not connected');

   return [{
   account: {
          amount: new BN(123),
          mint: new PublicKey('5kx6QokDyjn7uHA5DHB19hbJygxwzCbYQ25ZzdZwQEmL'),
          sender: new PublicKey('GqgLwn6XfEc2RHGC7CRDgxxbRm7ejnwVnAdSddKio667'),
          intermediary: new PublicKey('AgGaV1PYMERTsSaUHCPD4dGtC29iieNx1pcRgabibcaB'),
          receiver: new PublicKey('5rtCCBF9weoGp5SjTJCGX7phS9UMTd73aPZhsqpBVkMH'),
          userRole: 'intermediary'
        }
    }]
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
    userEscrows,
  };
}

