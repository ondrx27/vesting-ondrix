import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Contract addresses
const TEST_TOKEN_ADDRESS = "0xe7B36B5666F69C659126c9e324752FdDC3105fE8";
const VESTING_ADDRESS = "0x2A6cE99CA3D84B4eC2Cc50aBf05f83a4A1eCF46A";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Testing TGE withdrawal with account:", deployer.address);

  // Load contracts
  const testToken = await ethers.getContractAt("TestToken", TEST_TOKEN_ADDRESS);
  const vesting = await ethers.getContractAt("ProductionTokenVesting", VESTING_ADDRESS);

  try {
    // 1. Check current vesting status
    console.log("\n=== CURRENT STATUS ===");
    const schedule = await vesting.getVestingSchedule(deployer.address);
    console.log("Total amount:", ethers.formatEther(schedule.totalAmount));
    console.log("TGE basis points:", schedule.tgeBasisPoints.toString());
    console.log("Expected TGE amount:", ethers.formatEther(schedule.totalAmount * BigInt(schedule.tgeBasisPoints) / BigInt(10000)));
    console.log("Start time:", new Date(Number(schedule.startTime) * 1000).toLocaleString());
    console.log("Current time:", new Date().toLocaleString());

    // 2. Check if we can distribute
    console.log("\n=== DISTRIBUTION CHECK ===");
    const canDistribute = await vesting.canDistribute(deployer.address);
    console.log("Can distribute:", canDistribute);
    
    const claimableAmount = await vesting.getClaimableAmount(deployer.address);
    console.log("Total claimable amount:", ethers.formatEther(claimableAmount));

    // 3. Check individual recipient claimable amounts
    console.log("\n=== INDIVIDUAL RECIPIENTS ===");
    const recipients = await vesting.getRecipients(deployer.address);
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const recipientClaimable = await vesting.getRecipientClaimableAmount(deployer.address, recipient.wallet);
      console.log(`Recipient ${i+1} (${recipient.wallet}):`, 
        `${recipient.basisPoints} basis points,`, 
        `claimable: ${ethers.formatEther(recipientClaimable)} tokens`);
    }

    // 4. Try to distribute tokens (TGE)
    if (canDistribute && claimableAmount > 0n) {
      console.log("\n=== FIRST DISTRIBUTION (TGE) ===");
      
      // Check balances before
      console.log("Balances before distribution:");
      for (let i = 0; i < recipients.length; i++) {
        const balance = await testToken.balanceOf(recipients[i].wallet);
        console.log(`  Recipient ${i+1}: ${ethers.formatEther(balance)} tokens`);
      }

      const distributeTx = await vesting.distributeTokens();
      await distributeTx.wait();
      console.log("✅ First distribution successful!");

      // Check balances after
      console.log("Balances after distribution:");
      for (let i = 0; i < recipients.length; i++) {
        const balance = await testToken.balanceOf(recipients[i].wallet);
        console.log(`  Recipient ${i+1}: ${ethers.formatEther(balance)} tokens`);
      }

      // 5. Try to distribute again immediately (should fail/return 0)
      console.log("\n=== SECOND DISTRIBUTION (SHOULD BE BLOCKED) ===");
      const canDistributeAgain = await vesting.canDistribute(deployer.address);
      const claimableAgain = await vesting.getClaimableAmount(deployer.address);
      
      console.log("Can distribute again:", canDistributeAgain);
      console.log("Claimable amount again:", ethers.formatEther(claimableAgain));

      if (claimableAgain > 0n) {
        console.log("⚠️  WARNING: Still claimable tokens found - this shouldn't happen for double TGE!");
        const distributeTx2 = await vesting.distributeTokens();
        await distributeTx2.wait();
        console.log("Second distribution completed");
      } else {
        console.log("✅ CORRECT: No tokens available for double withdrawal - protection works!");
      }

    } else {
      console.log("❌ Cannot distribute tokens yet");
    }

  } catch (error) {
    console.error("❌ Error during TGE test:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });