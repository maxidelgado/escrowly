'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { EscrowStatus, useEscrowlyProgram } from './api';

interface EscrowlyCardProps {
  amount: number;
  mint: string;
  sender: string;
  intermediary: string;
  receiver: string;
  arbitrator: string;
  userRole: 'arbitrator' | 'intermediary' | 'receiver' | 'sender';
  status: EscrowStatus;
  deadline: number;
}

export function EscrowCard({
  amount,
  mint,
  sender,
  intermediary,
  receiver,
  arbitrator,
  userRole,
  status,
  deadline,
}: EscrowlyCardProps) {
  const { confirm, cancel, release, revoke, dispute, resolveDispute } = useEscrowlyProgram();
  const [isProcessing, setIsProcessing] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const secondsLeft = deadline - now;

      if (secondsLeft <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const days = Math.floor(secondsLeft / 86400);
      const hours = Math.floor((secondsLeft % 86400) / 3600);
      const minutes = Math.floor((secondsLeft % 3600) / 60);
      const seconds = secondsLeft % 60;

      setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [deadline]);

  const handleAction = async (action: () => Promise<void>, successMsg: string, errorMsg: string) => {
    setIsProcessing(true);
    try {
      await action();
      toast.success(successMsg);
    } catch (error) {
      toast.error(errorMsg);
      console.error(errorMsg, error);
    } finally {
      setIsProcessing(false);
    }
  };

  const allowedActionsMap: Record<EscrowStatus, Record<string, Array<{ label: string; action: () => Promise<any>; confirmMsg?: boolean }>>> = {
    pending: {
      sender: [
        { label: 'Cancel Escrow', action: () => cancel.mutateAsync({ mint, intermediary, receiver, arbitrator }), confirmMsg: true },
      ],
      receiver: [
        { label: 'Confirm', action: () => confirm.mutateAsync({ mint, sender, intermediary, receiver, arbitrator }) },
      ],
      intermediary: [
        { label: 'Confirm', action: () => confirm.mutateAsync({ mint, sender, intermediary, receiver, arbitrator }) },
      ],
    },
    confirmed: {
      sender: [
        { label: 'Release Escrow', action: () => release.mutateAsync({ mint, sender, receiver, arbitrator }), confirmMsg: true },
      ],
      receiver: [
        { label: 'Raise Dispute', action: () => dispute.mutateAsync({ mint, sender, intermediary, receiver, arbitrator }), confirmMsg: true },
      ],
      intermediary: [
        { label: 'Raise Dispute', action: () => dispute.mutateAsync({ mint, sender, intermediary, receiver, arbitrator }), confirmMsg: true },
      ],
    },
    disputed: {
      arbitrator: [
        { label: 'Release in Dispute', action: () => resolveDispute.mutateAsync({ mint, sender, intermediary, receiver, arbitrator, resolution: 'release'}), confirmMsg: true },
        { label: 'Cancel in Dispute', action: () => resolveDispute.mutateAsync({ mint, sender, intermediary, receiver, arbitrator, resolution: 'cancel'}), confirmMsg: true },
      ],
    },
    released: {},
    cancelled: {},
  };

  const roleActions = allowedActionsMap[status]?.[userRole] || [];

  return (
    <div className="card card-bordered border-base-300 border-4 text-neutral-content">
      <div className="card-body items-center text-center">
        <h2 className="card-title mb-2">Escrow</h2>
        <p className="text-sm text-gray-300 mb-4">{amount} SOL</p>
        <p className="text-xs mb-2">Status: <strong>{status}</strong></p>
        <p className="text-xs mb-2">Deadline: <strong>{timeLeft}</strong></p>

        <div className="text-left text-xs w-full mb-4 text-gray-400 space-y-1">
          <div><strong>Sender:</strong> {sender}</div>
          <div><strong>Receiver:</strong> {receiver}</div>
          <div><strong>Intermediary:</strong> {intermediary}</div>
          <div><strong>Arbitrator:</strong> {arbitrator}</div>
          <div><strong>Mint:</strong> {mint}</div>
          <div><strong>Amount:</strong> {amount}</div>
          <div><strong>Role:</strong> {userRole}</div>
        </div>

        <div className="card-actions flex flex-col gap-2 w-full">
          {roleActions.length > 0 ? roleActions.map(({ label, action, confirmMsg }, idx) => (
            <button
              key={idx}
              className="btn btn-sm btn-outline w-full"
              onClick={() =>
                confirmMsg
                  ? window.confirm(`Are you sure you want to ${label.toLowerCase()}?`) &&
                    handleAction(action, `${label} successful`, `${label} failed`)
                  : handleAction(action, `${label} successful`, `${label} failed`)
              }
              disabled={isProcessing}
            >
              {label} {isProcessing && '...'}
            </button>
          )) : (
            <span className="text-xs text-gray-500">No actions available</span>
          )}
        </div>
      </div>
    </div>
  );
}

