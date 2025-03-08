'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletButton } from '../solana/solana-provider';
import { AppHero } from '../ui/ui-layout';
import { EscrowCreate } from './escrow';

export default function Initialize() {
  const { publicKey } = useWallet();
  const [mint, setMint] = useState('');
  const [intermediary, setIntermediary] = useState('');
  const [receiver, setReceiver] = useState('');
  const [addressesSet, setAddressesSet] = useState(false);
  const [amount, setAmount] = useState(0);

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

  if (!addressesSet) {
    return (
      <div className="max-w-xl mx-auto mt-8">
        <h2 className="text-2xl mb-4">Sender: Enter Escrow Details</h2>
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
          <div>
            <label htmlFor="amount" className="block mb-1">
             Amount 
            </label>
            <input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="input input-bordered w-full"
              placeholder="Enter amount"
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Initialize 
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto mt-8">
      <AppHero
        title="Sender Page"
        subtitle="Initiate an escrow by providing the required details."
      />
      <div className="mt-6">
        <EscrowCreate amount={amount} mint={mint} intermediary={intermediary} receiver={receiver} />
      </div>
    </div>
  );
}

