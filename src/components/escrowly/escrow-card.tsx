'use client';

import { useState } from 'react';
import { DisputeResolutionCancel, DisputeResolutionRelease, IntermediaryRole, ReceiverRole, useEscrowlyProgram } from './api';

interface EscrowlyCardProps {
  amount: number;
  mint: string;
  sender: string;
  intermediary: string;
  receiver: string;
  arbitrator: string;
  userRole: 'arbitrator' | 'intermediary' | 'receiver' | 'sender';
}

export function EscrowCard({ amount, mint, sender, intermediary, receiver, arbitrator, userRole }: EscrowlyCardProps) {
  const { confirm, cancel, release, revoke, dispute, resolveDispute } = useEscrowlyProgram();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      let role: IntermediaryRole | ReceiverRole = { intermediary: {} };
      if (userRole === 'receiver') {
        role = { receiver: {} };
      }
      await confirm.mutateAsync({
        mint,
        sender,
        intermediary,
        receiver,
        arbitrator,
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
        arbitrator,
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
        arbitrator,
      });
    } catch (error) {
      console.error('Release escrow failed', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm('Are you sure you want to revoke this escrow?')) return;
    setIsProcessing(true);
    try {
      await revoke.mutateAsync({
        mint,
        sender,
        intermediary,
        receiver,
        arbitrator,
      });
    } catch (error) {
      console.error('Cancel escrow failed', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDispute = async () => {
    setIsProcessing(true);
    try {
      await dispute.mutateAsync({
        mint,
        sender,
        intermediary,
        receiver,
        arbitrator,
      });
    } catch (error) {
      console.error('Dispute escrow failed', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResolveDispute = async (resolution: DisputeResolutionRelease | DisputeResolutionCancel) => {
    setIsProcessing(true);
    try {
      await resolveDispute.mutateAsync({
        mint,
        sender,
        intermediary,
        receiver,
        arbitrator,
        resolution,
      });
    } catch (error) {
      console.error('Resolve dispute failed', error);
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
          {userRole === 'intermediary' && (
            <button className="btn btn-secondary btn-outline" onClick={handleRevoke} disabled={isProcessing}>
              Revoke Escrow {isProcessing && '...'}
            </button>
          )}
          {userRole === 'intermediary' && (
            <button className="btn btn-secondary btn-outline" onClick={() => handleDispute()} disabled={isProcessing}>
              Dispute Escrow {isProcessing && '...'}
            </button>
          )}
          {userRole === 'arbitrator' && (
            <button className="btn btn-secondary btn-outline" onClick={() => handleResolveDispute({ release: {} })} disabled={isProcessing}>
              Release in Dispute {isProcessing && '...'}
            </button>
          )}
          {userRole === 'arbitrator' && (
            <button className="btn btn-secondary btn-outline" onClick={() => handleResolveDispute({ cancel: {} })} disabled={isProcessing}>
              Cancel in Dispute {isProcessing && '...'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

