#!/bin/bash
set -e

############################################
# 🔍 Check Required Commands
############################################
function check_dependencies() {
  echo "🔍 Checking required commands..."
  command -v solana >/dev/null 2>&1 || { echo >&2 "❌ solana CLI is required but not installed."; exit 1; }
  command -v spl-token >/dev/null 2>&1 || { echo >&2 "❌ spl-token CLI is required but not installed."; exit 1; }
  command -v jq >/dev/null 2>&1 || { echo >&2 "❌ jq is required but not installed."; exit 1; }
}

############################################
# 🔧 Configure CLI & Fee Payer
############################################
function configure_cli() {
  echo "🔧 Configuring Solana CLI for localnet..."
  solana config set --url http://localhost:8899
  if [ -f "./sender.json" ]; then
    echo "💰 Setting default fee payer to sender (sender.json)..."
    solana config set --keypair ./sender.json
  fi
}

############################################
# 🔑 Load Existing Keys (if available)
############################################
function load_keys() {
  echo "🔑 Loading existing keys (if available)..."
  if [ -f "./sender.json" ]; then
    SENDER_PUBKEY=$(solana address -k ./sender.json)
    echo "✅ Loaded sender: $SENDER_PUBKEY"
  else
    echo "⚠️  sender.json not found."
  fi
  if [ -f "./intermediary.json" ]; then
    INTERMEDIARY_PUBKEY=$(solana address -k ./intermediary.json)
    echo "✅ Loaded intermediary: $INTERMEDIARY_PUBKEY"
  else
    echo "⚠️  intermediary.json not found."
  fi
  if [ -f "./receiver.json" ]; then
    RECEIVER_PUBKEY=$(solana address -k ./receiver.json)
    echo "✅ Loaded receiver: $RECEIVER_PUBKEY"
  else
    echo "⚠️  receiver.json not found."
  fi
  if [ -f "./token.json" ]; then
    MINT_ADDRESS=$(jq -r '.commandOutput.address' token.json)
    echo "✅ Loaded token mint: $MINT_ADDRESS"
  else
    echo "⚠️  token.json not found."
  fi
  if [ -f "./sender_ata.json" ]; then
    SENDER_TOKEN_ACCOUNT=$(jq -r '.ata' sender_ata.json)
    echo "✅ Loaded sender token account: $SENDER_TOKEN_ACCOUNT"
  else
    echo "⚠️  sender_ata.json not found."
  fi
  if [ -f "./intermediary_ata.json" ]; then
    INTERMEDIARY_TOKEN_ACCOUNT=$(jq -r '.ata' intermediary_ata.json)
    echo "✅ Loaded intermediary token account: $INTERMEDIARY_TOKEN_ACCOUNT"
  else
    echo "⚠️  intermediary_ata.json not found."
  fi
  if [ -f "./receiver_ata.json" ]; then
    RECEIVER_TOKEN_ACCOUNT=$(jq -r '.ata' receiver_ata.json)
    echo "✅ Loaded receiver token account: $RECEIVER_TOKEN_ACCOUNT"
  else
    echo "⚠️  receiver_ata.json not found."
  fi

}

############################################
# 🗝️ Generate New Keypairs (Overrides Existing Keys)
############################################
function generate_keys() {
  echo "🗝️ Generating new keys..."
  solana-keygen new --outfile sender.json --silent
  solana-keygen new --outfile intermediary.json --silent
  solana-keygen new --outfile receiver.json --silent

  SENDER_PUBKEY=$(solana address -k ./sender.json)
  INTERMEDIARY_PUBKEY=$(solana address -k ./intermediary.json)
  RECEIVER_PUBKEY=$(solana address -k ./receiver.json)

  echo "✅ Generated Sender: $SENDER_PUBKEY"
  echo "✅ Generated Intermediary: $INTERMEDIARY_PUBKEY"
  echo "✅ Generated Receiver: $RECEIVER_PUBKEY"
}

############################################
# 💧 Airdrop SOL to Accounts
############################################
function airdrop_accounts() {
  echo "💧 Airdropping 10 SOL to each participant..."
  solana airdrop 10 $SENDER_PUBKEY
  solana airdrop 10 $INTERMEDIARY_PUBKEY
  solana airdrop 10 $RECEIVER_PUBKEY
}

############################################
# 📊 Print Wallet Balances
############################################
function print_balances() {
  echo "📊 Wallet balances:"
  echo "Sender: $(solana balance $SENDER_PUBKEY)"
  echo "Intermediary: $(solana balance $INTERMEDIARY_PUBKEY)"
  echo "Receiver: $(solana balance $RECEIVER_PUBKEY)"
}

############################################
# 🪙 Create or Load Token Mint
############################################
function create_token_mint() {
  if [ -f "token.json" ]; then
    echo "🪙 Token file exists. Loading token data from token.json..."
    MINT_ADDRESS=$(jq -r '.commandOutput.address' token.json)
    echo "✅ Loaded token mint: $MINT_ADDRESS"
  else
    echo "🪙 Creating new token mint..."
    # Generate a keypair for the mint and save to token.json
    spl-token create-token --output json | jq -r '.commandOutput.address' > token.json
    solana-keygen new --outfile mint_authority.json --silent
    # Use the generated keypair as the mint authority to create the mint
    spl-token create-token --mint-authority mint_authority.json --output json > token.json
    MINT_ADDRESS=$(jq -r '.commandOutput.address' token.json)
    echo "✅ Token minted: $MINT_ADDRESS. Saved to token.json"
  fi
}

############################################
# 📥 Create or Load Associated Token Account (ATA)
############################################
# Parameters:
#   $1: account label (e.g., sender, intermediary, receiver)
#   $2: owner public key
#   $3: fee payer keypair file (e.g., sender.json, intermediary.json, receiver.json)
# Sets a global variable named "${1^^}_TOKEN_ACCOUNT" (uppercase label + _TOKEN_ACCOUNT)
function create_or_load_ata() {
  local label=$1
  local ownerPubkey=$2
  local feePayerFile=$3
  local ataFile="${label}_ata.json"

  if [ -f "$ataFile" ]; then
    echo "📥 $label ATA file exists. Loading ATA from $ataFile..."
    ATA=$(jq -r '.ata' "$ataFile")
    echo "✅ Loaded ${label} ATA: $ATA"
  else
    echo "📥 Creating associated token account for $label..."
    # Run the create-account command and capture the output (which may be only a signature)
    TX_SIG=$(spl-token create-account $MINT_ADDRESS --owner $ownerPubkey --fee-payer ./$feePayerFile --output json | jq -r '.signature')
    echo "🔍 Transaction signature: $TX_SIG"
    # Now, retrieve the ATA by listing token accounts for the owner and filtering by mint.
    ATA=$(spl-token accounts --owner $ownerPubkey --output json | jq -r --arg mint "$MINT_ADDRESS" '.accounts[] | select(.mint == $mint) | .address')
    echo "{\"ata\": \"$ATA\"}" > "$ataFile"
    echo "✅ Created and saved ${label} ATA: $ATA"
  fi

  # Save the ATA into a global variable
  case $label in
    sender)
      SENDER_TOKEN_ACCOUNT=$ATA
      ;;
    intermediary)
      INTERMEDIARY_TOKEN_ACCOUNT=$ATA
      ;;
    receiver)
      RECEIVER_TOKEN_ACCOUNT=$ATA
      ;;
    *)
      echo "⚠️ Unknown label: $label"
      ;;
  esac
}

############################################
# 🔍 Retrieve Associated Token Accounts (Fallback method)
############################################
function get_token_accounts() {
  echo "🔍 Retrieving associated token accounts..."
  SENDER_TOKEN_ACCOUNT=$(spl-token accounts --owner $SENDER_PUBKEY --output json | jq -r --arg mint "$MINT_ADDRESS" '.accounts[] | select(.mint == $mint) | .address')
  INTERMEDIARY_TOKEN_ACCOUNT=$(spl-token accounts --owner $INTERMEDIARY_PUBKEY --output json | jq -r --arg mint "$MINT_ADDRESS" '.accounts[] | select(.mint == $mint) | .address')
  RECEIVER_TOKEN_ACCOUNT=$(spl-token accounts --owner $RECEIVER_PUBKEY --output json | jq -r --arg mint "$MINT_ADDRESS" '.accounts[] | select(.mint == $mint) | .address')
  
  echo "✅ Sender ATA: $SENDER_TOKEN_ACCOUNT"
  echo "✅ Intermediary ATA: $INTERMEDIARY_TOKEN_ACCOUNT"
  echo "✅ Receiver ATA: $RECEIVER_TOKEN_ACCOUNT"
}

############################################
# 🎉 Mint Tokens to Sender
############################################
function mint_tokens() {
  echo "🎉 Minting 500 tokens to sender's token account..."
  spl-token mint $MINT_ADDRESS 500 $SENDER_TOKEN_ACCOUNT --mint-authority mint_authority.json --fee-payer ./sender.json
}

############################################
# 📜 Print Summary
############################################
function print_summary() {
  echo "📜 Summary:"
  echo "Sender: $SENDER_PUBKEY"
  echo "Intermediary: $INTERMEDIARY_PUBKEY"
  echo "Receiver: $RECEIVER_PUBKEY"
  echo "Token mint: $MINT_ADDRESS"
  echo "Sender token account: $SENDER_TOKEN_ACCOUNT"
  echo "Intermediary token account: $INTERMEDIARY_TOKEN_ACCOUNT"
  echo "Receiver token account: $RECEIVER_TOKEN_ACCOUNT"
}

############################################
# 🎛️ Main Menu
############################################
function main_menu() {
  echo ""
  echo "========================================"
  echo "🔘 Select an option:"
  echo "1) Generate new keys 🗝️"
  echo "2) Airdrop SOL 💧"
  echo "3) Create/load token mint 🪙"
  echo "4) Create/load associated token accounts 📥"
  echo "5) Mint tokens (requires ATA retrieval first) 🎉"
  echo "6) Print wallet balances 📊"
  echo "7) Print summary 📜"
  echo "8) Run all steps sequentially 🚀"
  echo "0) Exit ❌"
  echo "========================================"
  read -p "Enter choice: " choice

  case $choice in
    1)
      generate_keys
      ;;
    2)
      airdrop_accounts
      ;;
    3)
      create_token_mint
      ;;
    4)
      create_or_load_ata "sender" $SENDER_PUBKEY "sender.json"
      create_or_load_ata "intermediary" $INTERMEDIARY_PUBKEY "intermediary.json"
      create_or_load_ata "receiver" $RECEIVER_PUBKEY "receiver.json"
      ;;
    5)
      # Option 5 assumes ATAs have been loaded/created.
      if [ -z "$SENDER_TOKEN_ACCOUNT" ]; then
        echo "⚠️ Sender ATA not set. Attempting to retrieve ATAs..."
        get_token_accounts
      fi
      mint_tokens
      ;;
    6)
      print_balances
      ;;
    7)
      print_summary
      ;;
    8)
      generate_keys
      airdrop_accounts
      print_balances
      create_token_mint
      create_or_load_ata "sender" $SENDER_PUBKEY "sender.json"
      create_or_load_ata "intermediary" $INTERMEDIARY_PUBKEY "intermediary.json"
      create_or_load_ata "receiver" $RECEIVER_PUBKEY "receiver.json"
      mint_tokens
      print_summary
      ;;
    0)
      exit 0
      ;;
    *)
      echo "⚠️  Invalid choice. Please try again."
      ;;
  esac
}

############################################
# Main Execution
############################################
check_dependencies
configure_cli
load_keys

# Loop the menu until user exits.
while true; do
  main_menu
done

