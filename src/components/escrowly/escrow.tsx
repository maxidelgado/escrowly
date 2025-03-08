'use client';

import { useState } from 'react';
import { useEscrowlyProgram } from './api';

export interface EscrowCreateProps {
  amount: number;
  mint: string;
  intermediary: string;
  receiver: string;
}

export function EscrowCreate({
  amount,
  mint,
  intermediary,
  receiver,
}: EscrowCreateProps) {
  const { initialize } = useEscrowlyProgram();
  const [isPending, setIsPending] = useState(false);

  const handleInitialize = async () => {
    setIsPending(true);
    try {
      // For demo purposes, generate a random seed,
      // fixed sender deadline 60 seconds ahead.
      const senderAmount = amount * 1e9;
      const deadline = Math.floor(Date.now() / 1000) + 60;
      await initialize.mutateAsync({
        senderAmount,
        deadline,
        mint,
        intermediary,
        receiver,
      });
    } catch (error) {
      console.error('Escrow initialization failed', error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      className="btn btn-xs lg:btn-md btn-primary"
      onClick={handleInitialize}
      disabled={isPending}
    >
      Initiate Escrow {isPending && '...'}
    </button>
  );
}


