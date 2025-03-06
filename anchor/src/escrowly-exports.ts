// Here we export some useful types and functions for interacting with the Anchor program.
import { AnchorProvider, Program } from '@coral-xyz/anchor'
import { Cluster, PublicKey } from '@solana/web3.js'
import EscrowlyIDL from '../target/idl/escrowly.json'
import type { Escrowly } from '../target/types/escrowly'

// Re-export the generated IDL and type
export { Escrowly, EscrowlyIDL }

// The programId is imported from the program IDL.
export const ESCROWLY_PROGRAM_ID = new PublicKey(EscrowlyIDL.address)

// This is a helper function to get the Escrowly Anchor program.
export function getEscrowlyProgram(provider: AnchorProvider, address?: PublicKey) {
  return new Program({ ...EscrowlyIDL, address: address ? address.toBase58() : EscrowlyIDL.address } as Escrowly, provider)
}

// This is a helper function to get the program ID for the Escrowly program depending on the cluster.
export function getEscrowlyProgramId(cluster: Cluster) {
  switch (cluster) {
    case 'devnet':
    case 'testnet':
      // This is the program ID for the Escrowly program on devnet and testnet.
      return new PublicKey('')
    case 'mainnet-beta':
    default:
      return ESCROWLY_PROGRAM_ID
  }
}
