import { EscrowCard } from "@/components/escrowly/escrow-card";

export default function IntermediaryConfirm() {
  return (<EscrowCard 
    amount={123} 
    mint="5kx6QokDyjn7uHA5DHB19hbJygxwzCbYQ25ZzdZwQEmL" 
    sender="GqgLwn6XfEc2RHGC7CRDgxxbRm7ejnwVnAdSddKio667" 
    intermediary="AgGaV1PYMERTsSaUHCPD4dGtC29iieNx1pcRgabibcaB" 
    receiver="5rtCCBF9weoGp5SjTJCGX7phS9UMTd73aPZhsqpBVkMH" 
    userRole="receiver"
  />
  );
}
