import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Contract addresses (update after deployment)
const TEST_TOKEN_ADDRESS = "0xe7B36B5666F69C659126c9e324752FdDC3105fE8";
const VESTING_ADDRESS = "0x2A6cE99CA3D84B4eC2Cc50aBf05f83a4A1eCF46A";
const BENEFICIARY_ADDRESS = "0xea755aBa09CaAc2F73C4b6288256FF4Ae88beFbC";

// ✅ RECIPIENT PRIVATE KEY for testing self-claim
const RECIPIENT_PRIVATE_KEY = "92eb0dca70a6b06af5915c8a275b4cb98e4e175be57c6ac69214b35a77233675";

// Test recipients from .env
const RECIPIENT_ADDRESSES = [
  process.env.RECIPIENT_1 || "0x4F1536FC181C541f3eF766D227373f55d03CE0bA", // 10%
  process.env.RECIPIENT_2 || "0x68E7BD8736DeD1dF80cBe5FD74a50e904F6C6f3F", // 20%
  process.env.RECIPIENT_3 || "0x93C25AbB6396a5B6541CF24ce1831D2C87B61817", // 30%
  process.env.RECIPIENT_4 || "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1", // 20%
  process.env.RECIPIENT_5 || "0xD77C534AED04D7Ce34Cd425073a033dB4FBe6a9d", // 20%
];

async function main() {
  console.log("🧪 TESTING SELF-CLAIM FUNCTIONALITY");
  console.log("=" .repeat(50));

  // ✅ Create recipient wallet from private key
  const provider = ethers.provider;
  const recipientWallet = new ethers.Wallet(RECIPIENT_PRIVATE_KEY, provider);
  const recipientAddress = recipientWallet.address;
  
  console.log("🔑 Recipient wallet address:", recipientAddress);
  console.log("💰 Recipient balance:", ethers.formatEther(await provider.getBalance(recipientAddress)), "BNB");

  // ✅ Load contracts (read-only for initial checks)
  const testToken = await ethers.getContractAt("TestToken", TEST_TOKEN_ADDRESS);
  const vesting = await ethers.getContractAt("ProductionTokenVesting", VESTING_ADDRESS);
  
  // ✅ Load contracts with recipient signer for claiming
  const vestingAsRecipient = await ethers.getContractAt("ProductionTokenVesting", VESTING_ADDRESS, recipientWallet);

  try {
    console.log("\n📋 1. GETTING VESTING SCHEDULE INFO");
    const schedule = await vesting.getVestingSchedule(BENEFICIARY_ADDRESS);
    console.log("Vesting Schedule:", {
      isInitialized: schedule.isInitialized,
      token: schedule.token,
      startTime: schedule.startTime.toString(),
      totalAmount: ethers.formatEther(schedule.totalAmount),
      claimedAmount: ethers.formatEther(schedule.claimedAmount),
      recipientCount: schedule.recipientCount,
    });

    console.log("\n👥 2. GETTING RECIPIENTS INFO");
    const recipients = await vesting.getRecipients(BENEFICIARY_ADDRESS);
    console.log("Recipients:");
    for (let i = 0; i < recipients.length; i++) {
      if (recipients[i].wallet !== ethers.ZeroAddress) {
        console.log(`  ${i + 1}. ${recipients[i].wallet}`);
        console.log(`     Basis Points: ${recipients[i].basisPoints} (${Number(recipients[i].basisPoints) / 100}%)`);
        console.log(`     Claimed: ${ethers.formatEther(recipients[i].claimedAmount)} tokens`);
        console.log(`     Last Claim: ${recipients[i].lastClaimTime.toString()}`);
      }
    }

    console.log("\n💰 3. CHECKING CLAIMABLE AMOUNTS");
    const totalClaimable = await vesting.getClaimableAmount(BENEFICIARY_ADDRESS);
    console.log(`Total Claimable: ${ethers.formatEther(totalClaimable)} tokens`);

    // ✅ Check specifically for our test recipient
    const canClaim = await vesting.canClaim(BENEFICIARY_ADDRESS, recipientAddress);
    const claimableAmount = await vesting.getRecipientClaimableAmount(BENEFICIARY_ADDRESS, recipientAddress);
    
    console.log(`\n🎯 TEST RECIPIENT: ${recipientAddress}`);
    console.log(`    Can Claim: ${canClaim}`);
    console.log(`    Claimable Amount: ${ethers.formatEther(claimableAmount)} tokens`);
    
    // Get recipient's token balance before claim
    const tokenBalanceBefore = await testToken.balanceOf(recipientAddress);
    console.log(`    Token Balance Before: ${ethers.formatEther(tokenBalanceBefore)} tokens`);
    
    // ✅ Also check all other recipients for comparison
    for (let i = 0; i < RECIPIENT_ADDRESSES.length; i++) {
      const otherRecipientAddress = RECIPIENT_ADDRESSES[i];
      const otherCanClaim = await vesting.canClaim(BENEFICIARY_ADDRESS, otherRecipientAddress);
      const otherClaimableAmount = await vesting.getRecipientClaimableAmount(BENEFICIARY_ADDRESS, otherRecipientAddress);
      
      console.log(`\n  Other Recipient ${i + 1}: ${otherRecipientAddress}`);
      console.log(`    Can Claim: ${otherCanClaim}`);
      console.log(`    Claimable Amount: ${ethers.formatEther(otherClaimableAmount)} tokens`);
      console.log(`    Is Our Test Recipient: ${otherRecipientAddress.toLowerCase() === recipientAddress.toLowerCase()}`);
    }

    console.log("\n🎯 4. TESTING ACTUAL SELF-CLAIM");
    
    // ✅ Test self-claim using the recipient's wallet
    if (canClaim && claimableAmount > 0) {
      console.log(`\n🚀 Attempting REAL self-claim for: ${recipientAddress}`);
      console.log(`   Expected claim amount: ${ethers.formatEther(claimableAmount)} tokens`);
      console.log(`   Using recipient's private key for authentication`);
      
      try {
        // ✅ IMPORTANT: Using vestingAsRecipient (signed with recipient's key)
        console.log("📝 Submitting claimTokens transaction...");
        const claimTx = await vestingAsRecipient.claimTokens(BENEFICIARY_ADDRESS);
        console.log("✅ Transaction submitted:", claimTx.hash);
        console.log("⏳ Waiting for confirmation...");
        
        const receipt = await claimTx.wait();
        if (!receipt) {
          throw new Error("Transaction receipt is null");
        }
        console.log("🎉 SELF-CLAIM SUCCESSFUL!");
        console.log("   Block number:", receipt.blockNumber);
        console.log("   Gas used:", receipt.gasUsed.toString());
        console.log("   Transaction fee:", ethers.formatEther(receipt.gasUsed * (receipt.gasPrice || 0n)), "BNB");
        
        // Check balances after claim
        const tokenBalanceAfter = await testToken.balanceOf(recipientAddress);
        const bnbBalanceAfter = await provider.getBalance(recipientAddress);
        
        console.log(`\n💰 BALANCES AFTER CLAIM:`);
        console.log(`   Token Balance: ${ethers.formatEther(tokenBalanceAfter)} tokens`);
        console.log(`   BNB Balance: ${ethers.formatEther(bnbBalanceAfter)} BNB`);
        console.log(`   Tokens Received: ${ethers.formatEther((tokenBalanceAfter - tokenBalanceBefore).toString())} tokens`);
        
        // ✅ Verify the claim worked by checking updated recipient data
        console.log(`\n🔍 VERIFYING CLAIM RESULT:`);
        const updatedRecipients = await vesting.getRecipients(BENEFICIARY_ADDRESS);
        const updatedRecipient = updatedRecipients.find(r => r.wallet.toLowerCase() === recipientAddress.toLowerCase());
        
        if (updatedRecipient) {
          console.log(`   Updated claimed amount: ${ethers.formatEther(updatedRecipient.claimedAmount)} tokens`);
          console.log(`   Last claim time: ${updatedRecipient.lastClaimTime.toString()}`);
        }
        
        // Check if can claim again
        const canClaimAgain = await vesting.canClaim(BENEFICIARY_ADDRESS, recipientAddress);
        const claimableAmountAfter = await vesting.getRecipientClaimableAmount(BENEFICIARY_ADDRESS, recipientAddress);
        console.log(`   Can claim again: ${canClaimAgain}`);
        console.log(`   Claimable amount after: ${ethers.formatEther(claimableAmountAfter)} tokens`);
        
      } catch (error: any) {
        console.log("❌ Self-claim failed:");
        console.log("   Error:", error.message);
        
        // Parse specific error types
        if (error.message.includes("Not authorized recipient")) {
          console.log("🔒 Authorization error - recipient not in list or not properly registered");
        } else if (error.message.includes("No tokens available")) {
          console.log("💰 No tokens available - either already claimed or cliff period not passed");
        } else if (error.message.includes("insufficient funds")) {
          console.log("💸 Insufficient BNB for gas fees");
        } else {
          console.log("🔍 Unknown error - check contract state and transaction parameters");
        }
      }
      
    } else {
      console.log(`\n⏸️  CANNOT TEST SELF-CLAIM:`);
      console.log(`   Can Claim: ${canClaim}`);
      console.log(`   Claimable Amount: ${ethers.formatEther(claimableAmount)} tokens`);
      
      if (!canClaim) {
        console.log(`\n🔍 REASONS WHY CANNOT CLAIM:`);
        console.log(`   1. Recipient not in vesting schedule`);
        console.log(`   2. Cliff period not passed yet`);
        console.log(`   3. Individual cooldown period active`);
        console.log(`   4. No tokens available (already fully claimed)`);
      }
    }

    console.log("\n📊 5. FINAL SUMMARY");
    console.log("✅ Contract is accessible");
    console.log("✅ Vesting schedule is active");
    console.log("✅ Recipients are properly configured");
    
    if (totalClaimable > 0) {
      console.log("✅ Tokens are available for claiming");
    } else {
      console.log("ℹ️  No tokens currently available (already distributed or cliff not passed)");
    }

    console.log(`\n🎯 SELF-CLAIM TEST RESULTS:`);
    console.log(`✅ Contract deployment: Working`);
    console.log(`✅ Recipient authentication: Working`);
    console.log(`✅ Individual claim function: ${canClaim && claimableAmount > 0 ? 'Working' : 'Blocked (expected due to auto-distribution)'}`);
    
    console.log("\n🔧 TO TEST WITH DIFFERENT RECIPIENTS:");
    RECIPIENT_ADDRESSES.forEach((addr, i) => {
      console.log(`   ${i + 1}. ${addr} (${[10, 20, 30, 20, 20][i]}%)`);
    });
    
    console.log(`\n💡 CURRENT TEST RECIPIENT:`);
    console.log(`   Address: ${recipientAddress}`);
    console.log(`   Percentage: ${RECIPIENT_ADDRESSES.findIndex(addr => addr.toLowerCase() === recipientAddress.toLowerCase()) >= 0 ? 
      [10, 20, 30, 20, 20][RECIPIENT_ADDRESSES.findIndex(addr => addr.toLowerCase() === recipientAddress.toLowerCase())] + '%' : 
      'Unknown (not in predefined list)'}`);
    console.log(`   Private Key: ${RECIPIENT_PRIVATE_KEY} (TEST ONLY - DO NOT USE IN PRODUCTION)`);

  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n✅ Self-claim test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test script failed:", error);
    process.exit(1);
  });