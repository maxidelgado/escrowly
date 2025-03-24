'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletButton } from '../solana/solana-provider';
import { AppHero } from '../ui/ui-layout';
import { EscrowCreate } from './escrow';

export default function Initialize() {
  const { publicKey } = useWallet();
  const [step, setStep] = useState(1);
  const [mint, setMint] = useState('');
  const [intermediary, setIntermediary] = useState('');
  const [receiver, setReceiver] = useState('');
  const [arbitrator, setArbitrator] = useState('');
  const [amount, setAmount] = useState(0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mint || !intermediary || !receiver || !arbitrator || !amount) {
      alert('Fill in all fields');
      return;
    }
    setStep(2);
  };

  if (!publicKey) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <WalletButton />
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="max-w-xl mx-auto mt-10 space-y-6">
        <h2 className="text-2xl font-semibold">Initialize a New Escrow</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { id: 'mint', label: 'Mint Address', state: mint, set: setMint },
            { id: 'intermediary', label: 'Intermediary', state: intermediary, set: setIntermediary },
            { id: 'receiver', label: 'Receiver', state: receiver, set: setReceiver },
            { id: 'arbitrator', label: 'Arbitrator', state: arbitrator, set: setArbitrator },
          ].map(({ id, label, state, set }) => (
            <div key={id}>
              <label htmlFor={id} className="block font-medium mb-1">{label}</label>
              <input
                type="text"
                id={id}
                value={state}
                onChange={(e) => set(e.target.value)}
                className="input input-bordered w-full"
                placeholder={`Enter ${label.toLowerCase()}`}
              />
            </div>
          ))}
          <div>
            <label htmlFor="amount" className="block font-medium mb-1">Amount (SOL)</label>
            <input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="input input-bordered w-full"
              placeholder="Enter amount"
              min={0}
            />
          </div>
          <button type="submit" className="btn btn-primary w-full">Continue</button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto mt-10 space-y-6">
      <AppHero title="Confirm Details" subtitle="Click to initiate your escrow transaction." />
      <div className="bg-base-200 p-6 rounded-lg space-y-4 text-sm">
        <div><strong>Mint:</strong> {mint}</div>
        <div><strong>Intermediary:</strong> {intermediary}</div>
        <div><strong>Receiver:</strong> {receiver}</div>
        <div><strong>Arbitrator:</strong> {arbitrator}</div>
        <div><strong>Amount:</strong> {amount} SOL</div>
      </div>
      <EscrowCreate amount={amount} mint={mint} intermediary={intermediary} receiver={receiver} arbitrator={arbitrator} />
      <button onClick={() => setStep(1)} className="link mt-4 text-sm">Edit details</button>
    </div>
  );
}

