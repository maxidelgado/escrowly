'use client';

import { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { ExplorerLink } from '../cluster/cluster-ui';
import { ellipsify } from '../ui/ui-layout';
import { useEscrowlyProgram } from './escrowly-data-access';

export interface EscrowlyCreateProps {
  mint: string;
  intermediary: string;
  receiver: string;
}

export function EscrowlyCreate({
  mint,
  intermediary,
  receiver,
}: EscrowlyCreateProps) {
  const { initialize } = useEscrowlyProgram();
  const [isPending, setIsPending] = useState(false);

  const handleInitialize = async () => {
    setIsPending(true);
    try {
      const senderAmount = 333;
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
      disabled={isPending || initialize.isLoading}
    >
      Create Escrow {isPending && '...'}
    </button>
  );
}

export interface EscrowlyListProps {
  mint: string;
  intermediary: string;
}

export function EscrowlyList({ mint, intermediary }: EscrowlyListProps) {
  const { accounts, confirm, release, cancel } = useEscrowlyProgram();

  if (accounts.isLoading) {
    return <span className="loading loading-spinner loading-lg"></span>;
  }
  if (!accounts.data || accounts.data.length === 0) {
    return (
      <div className="text-center">
        <h2 className="text-2xl">No escrow accounts found.</h2>
        <p>Create one above to get started.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        {accounts.data.map(({ publicKey, account }) => (
          <EscrowlyCard
            key={publicKey.toString()}
            escrowPda={publicKey}
            escrowData={account}
            mint={mint}
            intermediary={intermediary}
          />
        ))}
      </div>
    </div>
  );
}

interface EscrowlyCardProps {
  escrowPda: PublicKey;
  escrowData: any;
  mint: string;
  intermediary: string;
}

function EscrowlyCard({
  escrowPda,
  escrowData,
  mint,
  intermediary,
}: EscrowlyCardProps) {
  const { confirm, release, cancel } = useEscrowlyProgram();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleConfirm = async (role: 'intermediary' | 'receiver') => {
    setIsConfirming(true);
    try {
      await confirm.mutateAsync({
        escrowPda: escrowPda.toString(),
        role,
      });
    } catch (error) {
      console.error(`Confirm as ${role} failed`, error);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleRelease = async () => {
    setIsReleasing(true);
    try {
      await release.mutateAsync({
        escrowPda: escrowPda.toString(),
        mint,
        intermediary,
      });
    } catch (error) {
      console.error('Release escrow failed', error);
    } finally {
      setIsReleasing(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel this escrow?'))
      return;
    setIsCancelling(true);
    try {
      await cancel.mutateAsync({
        escrowPda: escrowPda.toString(),
        mint,
      });
    } catch (error) {
      console.error('Cancel escrow failed', error);
    } finally {
      setIsCancelling(false);
    }
  };

  // Assuming escrowData contains a "state" field.
  const escrowState = escrowData?.state || 'Unknown';

  return (
    <div className="card card-bordered border-base-300 border-4 text-neutral-content">
      <div className="card-body items-center text-center">
        <h2 className="card-title text-3xl">State: {escrowState}</h2>
        <div className="card-actions flex flex-col gap-2">
          <button
            className="btn btn-outline"
            onClick={() => handleConfirm('intermediary')}
            disabled={isConfirming}
          >
            Confirm as Intermediary {isConfirming && '...'}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => handleConfirm('receiver')}
            disabled={isConfirming}
          >
            Confirm as Receiver {isConfirming && '...'}
          </button>
          <button
            className="btn btn-outline"
            onClick={handleRelease}
            disabled={isReleasing}
          >
            Release Escrow {isReleasing && '...'}
          </button>
          <button
            className="btn btn-secondary btn-outline"
            onClick={handleCancel}
            disabled={isCancelling}
          >
            Cancel Escrow {isCancelling && '...'}
          </button>
        </div>
        <p className="mt-4">
          <ExplorerLink
            path={`account/${escrowPda.toString()}`}
            label={ellipsify(escrowPda.toString())}
          />
        </p>
      </div>
    </div>
  );
}

