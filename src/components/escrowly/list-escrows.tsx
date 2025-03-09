'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useEscrowlyProgram } from './api';
import { EscrowCard } from './escrow-card';
import { WalletButton } from '../solana/solana-provider';

export interface EscrowProps {
  amount: number;
  mint: string;
  sender: string;
  intermediary: string;
  receiver: string;
  userRole: 'intermediary' | 'receiver' | 'sender';
}

export function ListEscrows() {
  const { userEscrows } = useEscrowlyProgram();
  const { publicKey } = useWallet();

  if (userEscrows.isLoading) return <div>Loading escrows...</div>;
  if (userEscrows.isError) return <div>Error fetching escrows.</div>;

  if (!publicKey) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="hero py-[64px]">
          <div className="hero-content text-center">
            <WalletButton />
          </div>
        </div>
      </div>
    );
  }

  const escrows: EscrowProps[] = userEscrows.data?.map(({ account }) => ({
    amount: account.amount.toNumber(),
    mint: account.mint.toBase58(),
    sender: account.sender.toBase58(),
    intermediary: account.intermediary.toBase58(),
    receiver: account.receiver.toBase58(),
    userRole: account.sender.equals(publicKey!)
      ? 'sender'
      : account.receiver.equals(publicKey!)
      ? 'receiver'
      : 'intermediary',
  })) || [];

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        {escrows.map((escrow, idx) => (
          <EscrowCard
            key={idx}
            amount={escrow.amount}
            mint={escrow.mint}
            sender={escrow.sender}
            intermediary={escrow.intermediary}
            receiver={escrow.receiver}
            userRole={escrow.userRole}
          />
        ))}
      </div>
    </div>
  );
}
