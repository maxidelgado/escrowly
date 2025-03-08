'use client';

import { EscrowCard } from './escrow-card';

export interface EscrowlyListProps {
  amount: number;
  mint: string;
  sender: string;
  intermediary: string;
  receiver: string;
  userRole: 'intermediary' | 'receiver' | 'sender';
}

export function ListEscrows({ amount, mint, sender, intermediary, receiver, userRole }: EscrowlyListProps) {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
          <EscrowCard
                amount={amount}
                mint={mint}
                userRole={userRole} 
                sender={sender} 
                intermediary={intermediary} 
                receiver={receiver}
          />
      </div>
    </div>
  );
}


