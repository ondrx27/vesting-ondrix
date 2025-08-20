import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Contract addresses
const TEST_TOKEN_ADDRESS = "0xC4d9A812E045F0856352DF9036BFf1135349ED9a";
const VESTING_ADDRESS = "0x17Bc153eCc2f37ee4d183dc4A3a35E38A77A8f89";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🔍 Checking vesting status for account:", deployer.address);

  // Load contracts - CHANGED from "TokenVesting" to "SecureTokenVesting"
  const testToken = await ethers.getContractAt("TestToken", TEST_TOKEN_ADDRESS);
  const vesting = await ethers.getContractAt("SecureTokenVesting", VESTING_ADDRESS);

  try {
    // 1. Check current vesting status
    console.log("\n=== VESTING SCHEDULE ===");
    const schedule = await vesting.getVestingSchedule(deployer.address);
    
    if (!schedule.isInitialized) {
      console.log("❌ No vesting schedule found for this address");
      return;
    }

    console.log("- Initialized:", schedule.isInitialized);
    console.log("- Token:", schedule.token);
    console.log("- Start Time:", schedule.startTime > 0 ? 
                 new Date(Number(schedule.startTime) * 1000).toLocaleString() : "Not funded yet");
    console.log("- Cliff Duration:", Number(schedule.cliffDuration) / 60, "minutes");
    console.log("- Vesting Duration:", Number(schedule.vestingDuration) / 60, "minutes");
    console.log("- Total Amount:", ethers.formatEther(schedule.totalAmount), "tokens");
    console.log("- Claimed Amount:", ethers.formatEther(schedule.claimedAmount), "tokens");
    console.log("- Recipients:", schedule.recipientCount);

    if (schedule.startTime == 0n) {
      console.log("\n⚠️  Vesting not funded yet!");
      return;
    }

    // 2. Check current vesting progress
    console.log("\n=== VESTING PROGRESS ===");
    const progress = await vesting.getVestingProgress(deployer.address);
    
    console.log("- Elapsed Time:", Math.floor(Number(progress.elapsedTime) / 60), "minutes");
    console.log("- Unlocked Percentage:", progress.unlockedPercentage.toString() + "%");
    console.log("- Unlocked Amount:", ethers.formatEther(progress.unlockedAmount), "tokens");
    console.log("- Claimable Amount:", ethers.formatEther(progress.claimableAmount), "tokens");
    console.log("- Remaining Amount:", ethers.formatEther(progress.remainingAmount), "tokens");

    // 3. Show recipients and potential distributions
    console.log("\n=== RECIPIENTS ===");
    const recipients = await vesting.getRecipients(deployer.address);
    
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const currentBalance = await testToken.balanceOf(recipient.wallet);
      console.log(`- ${recipient.wallet}:`);
      console.log(`  Percentage: ${recipient.percentage}%`);
      console.log(`  Current Balance: ${ethers.formatEther(currentBalance)} tokens`);
      
      if (progress.claimableAmount > 0n) {
        const share = (progress.claimableAmount * BigInt(recipient.percentage)) / 100n;
        console.log(`  Would Receive: ${ethers.formatEther(share)} tokens`);
      }
    }

    // 4. Check if we can distribute tokens
    const claimableAmount = await vesting.getClaimableAmount(deployer.address);
    const canDistribute = await vesting.canDistribute(deployer.address);
    
    console.log("\n=== DISTRIBUTION STATUS ===");
    console.log("- Claimable Amount:", ethers.formatEther(claimableAmount), "tokens");
    console.log("- Can Distribute:", canDistribute);
    
    if (canDistribute && claimableAmount > 0n) {
      console.log("✅ TOKENS AVAILABLE TO DISTRIBUTE!");
      console.log("- This will distribute tokens to all recipients based on their percentages");
      console.log("- Only you (beneficiary) can distribute your tokens");
      
      console.log("\n🚨 DISTRIBUTING TOKENS...");
      console.log("This will distribute", ethers.formatEther(claimableAmount), "tokens to all recipients!");

      // CHANGED: Use distributeTokens() instead of claimTokens()
      const distributeTx = await vesting.distributeTokens();
      console.log("Transaction hash:", distributeTx.hash);
      console.log("Waiting for confirmation...");
      await distributeTx.wait();
      console.log("✅ Tokens distributed successfully!");
      
      // Show updated balances
      console.log("\n=== UPDATED BALANCES ===");
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const newBalance = await testToken.balanceOf(recipient.wallet);
        console.log(`- ${recipient.wallet}: ${ethers.formatEther(newBalance)} tokens`);
      }
      
    } else {
      console.log("❌ No tokens available to distribute at this time");
      
      if (!canDistribute) {
        console.log("\nReasons why distribution is not available:");
        
        // Check various conditions
        const currentTime = Math.floor(Date.now() / 1000);
        const startTime = Number(schedule.startTime);
        const cliffEnd = startTime + Number(schedule.cliffDuration);
        
        if (currentTime < cliffEnd) {
          const remainingCliff = cliffEnd - currentTime;
          console.log(`⏳ Still in cliff period. Wait ${Math.ceil(remainingCliff / 60)} minutes`);
          console.log(`📅 Cliff ends: ${new Date(cliffEnd * 1000).toLocaleString()}`);
        } else {
          console.log("⏳ All available tokens for current period have been distributed");
          console.log("💡 Wait for the next vesting period");
        }
      }
    }

    // 5. Show current period
    console.log("\n=== CURRENT PERIOD ===");
    try {
      const currentPeriod = await vesting.getCurrentPeriod(deployer.address);
      console.log("Current Period:", currentPeriod);
    } catch (error) {
      console.log("Could not get current period");
    }

    // 6. Show next unlock info
    console.log("\n=== NEXT UNLOCK ===");
    try {
      const nextUnlock = await vesting.getNextUnlock(deployer.address);
      if (nextUnlock.timeRemaining > 0n) {
        const nextTime = new Date(Number(nextUnlock.nextUnlockTime) * 1000);
        const remainingMinutes = Math.ceil(Number(nextUnlock.timeRemaining) / 60);
        console.log(`Next unlock: ${nextUnlock.nextUnlockPercentage}% in ${remainingMinutes} minutes`);
        console.log(`Unlock time: ${nextTime.toLocaleString()}`);
      } else {
        console.log("🎉 All tokens have been unlocked!");
      }
    } catch (error) {
      console.log("Could not get next unlock info");
    }

    // 7. Show vesting timeline with current status
    console.log("\n=== VESTING TIMELINE ===");
    const periods = [
      { minutes: 5, percentage: 10 },
      { minutes: 10, percentage: 20 },
      { minutes: 15, percentage: 50 },
      { minutes: 20, percentage: 100 }
    ];
    
    const currentMinutes = Math.floor(Number(progress.elapsedTime) / 60);
    const currentUnlockedPct = Number(progress.unlockedPercentage);
    
    for (const p of periods) {
      const unlockTime = new Date((Number(schedule.startTime) + p.minutes * 60) * 1000);
      let status = "⏳ PENDING";
      
      if (currentMinutes >= p.minutes) {
        if (currentUnlockedPct >= p.percentage) {
          status = Number(schedule.claimedAmount) > 0 ? "✅ DISTRIBUTED" : "🟡 AVAILABLE";
        }
      }
      
      console.log(`${p.percentage.toString().padStart(3)}% unlock at ${p.minutes.toString().padStart(2)} min (${unlockTime.toLocaleTimeString()}) - ${status}`);
    }

  } catch (error: any) {
    console.error("❌ Error:", error);
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    if (error.code === 'CALL_EXCEPTION') {
      console.error("This might be a contract interaction issue. Check:");
      console.error("- Contract address is correct");
      console.error("- You have a vesting schedule initialized");
      console.error("- Vesting has been funded");
      console.error("- Network connection is stable");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });