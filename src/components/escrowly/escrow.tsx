'use client';

import { useState } from 'react';
import { useEscrowlyProgram } from './api';
import toast from 'react-hot-toast';

export interface EscrowCreateProps {
  amount: number;
  mint: string;
  intermediary: string;
  receiver: string;
  arbitrator: string;
}

export function EscrowCreate({
  amount,
  mint,
  intermediary,
  receiver,
  arbitrator
}: EscrowCreateProps) {
  const { initialize } = useEscrowlyProgram();
  const [isPending, setIsPending] = useState(false);

  const handleInitialize = async () => {
    setIsPending(true);
    const senderAmount = amount * 1e9;
    const deadline = Math.floor(Date.now() / 1000) + 300;
    try {
      await initialize.mutateAsync({ senderAmount, deadline, mint, intermediary, receiver, arbitrator });
      toast.success('Escrow successfully initialized!');
    } catch (error) {
      toast.error('Escrow initialization failed.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      className="btn btn-primary w-full"
      onClick={handleInitialize}
      disabled={isPending}
    >
      {isPending ? 'Initializing...' : 'Initiate Escrow'}
    </button>
  );
}

