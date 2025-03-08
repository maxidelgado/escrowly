'use client';

import { useState } from 'react';
import { useEscrowlyProgram } from './api';

interface EscrowlyCardProps {
  amount: number;
  mint: string;
  sender: string;
  intermediary: string;
  receiver: string;
  userRole: 'intermediary' | 'receiver' | 'sender';
}

export function EscrowCard({ amount, mint, sender, intermediary, receiver, userRole }: EscrowlyCardProps) {
  const { confirm, cancel, release } = useEscrowlyProgram();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      let role: 'intermediary' | 'receiver';
      if (userRole === 'intermediary') {
        role = 'intermediary';
      } else {
        role = 'receiver';
      }
      await confirm.mutateAsync({
        mint,
        sender,
        intermediary,
        receiver,
        role,
      });
    } catch (error) {
      console.error(`Confirm as ${userRole} failed`, error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel this escrow?')) return;
    setIsProcessing(true);
    try {
      await cancel.mutateAsync({
        mint,
        intermediary,
        receiver,
      });
    } catch (error) {
      console.error('Cancel escrow failed', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRelease = async () => {
    setIsProcessing(true);
    try {
      await release.mutateAsync({
        mint,
        sender,
        receiver,
      });
    } catch (error) {
      console.error('Release escrow failed', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="card card-bordered border-base-300 border-4 text-neutral-content">
      <div className="card-body items-center text-center">
        <h2 className="card-title">Escrow Transaction</h2>
        <p>Amount: {amount}</p>
        <div className="card-actions flex flex-col gap-2">
          {userRole === 'intermediary' && (
            <button className="btn btn-outline" onClick={handleConfirm} disabled={isProcessing}>
              Confirm as Intermediary {isProcessing && '...'}
            </button> 
          )}
          {userRole === 'intermediary' && (
            <button className="btn btn-outline" onClick={handleRelease} disabled={isProcessing}>
              Release Escrow {isProcessing && '...'}
            </button>
          )}
          {userRole === 'receiver' && (
            <button className="btn btn-outline" onClick={handleConfirm} disabled={isProcessing}>
              Confirm as Receiver {isProcessing && '...'}
            </button>
          )}
          {userRole === 'sender' && (
            <button className="btn btn-secondary btn-outline" onClick={handleCancel} disabled={isProcessing}>
              Cancel Escrow {isProcessing && '...'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

