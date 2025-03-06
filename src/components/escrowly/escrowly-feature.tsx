'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletButton } from '../solana/solana-provider';
import { AppHero, ellipsify } from '../ui/ui-layout';
import { ExplorerLink } from '../cluster/cluster-ui';
import { EscrowlyCreate, EscrowlyList } from './escrowly-ui';
import { useEscrowlyProgram } from './escrowly-data-access';

export default function EscrowlyFeature() {
  const { publicKey } = useWallet();
  const { programId } = useEscrowlyProgram();

  // Local state for addresses provided via textboxes.
  const [mint, setMint] = useState('');
  const [intermediary, setIntermediary] = useState('');
  const [receiver, setReceiver] = useState('');
  const [addressesSet, setAddressesSet] = useState(false);

  const handleSetAddresses = (e: React.FormEvent) => {
    e.preventDefault();
    if (mint && intermediary && receiver) {
      setAddressesSet(true);
    } else {
      alert('Please enter all addresses.');
    }
  };

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

  // If addresses have not been set, show a form for user input.
  if (!addressesSet) {
    return (
      <div className="max-w-xl mx-auto mt-8">
        <h2 className="text-2xl mb-4">Enter Escrow Addresses</h2>
        <form onSubmit={handleSetAddresses} className="space-y-4">
          <div>
            <label htmlFor="mint" className="block mb-1">
              Mint Address
            </label>
            <input
              type="text"
              id="mint"
              value={mint}
              onChange={(e) => setMint(e.target.value)}
              className="input input-bordered w-full"
              placeholder="Enter mint address"
            />
          </div>
          <div>
            <label htmlFor="intermediary" className="block mb-1">
              Intermediary Address
            </label>
            <input
              type="text"
              id="intermediary"
              value={intermediary}
              onChange={(e) => setIntermediary(e.target.value)}
              className="input input-bordered w-full"
              placeholder="Enter intermediary address"
            />
          </div>
          <div>
            <label htmlFor="receiver" className="block mb-1">
              Receiver Address
            </label>
            <input
              type="text"
              id="receiver"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              className="input input-bordered w-full"
              placeholder="Enter receiver address"
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Set Addresses
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <AppHero
        title="Escrowly"
        subtitle="Manage your escrows: create a new escrow, confirm participation, release funds, or cancel an escrow."
      >
        <p className="mb-6">
          <ExplorerLink
            path={`account/${programId.toString()}`}
            label={ellipsify(programId.toString())}
          />
        </p>
        <EscrowlyCreate mint={mint} intermediary={intermediary} receiver={receiver} />
      </AppHero>
      <EscrowlyList mint={mint} intermediary={intermediary} />
    </div>
  );
}

