import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Contract addresses
const TEST_TOKEN_ADDRESS = "0xA6Fe6abb1E74C58e443817c8736840Af015F1a00";
const VESTING_ADDRESS = "0x9b9eB8fDeb65e9DC4AECCC5c62377a16ebdF5252";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Checking balances with account:", deployer.address);

  // Load contracts
  const testToken = await ethers.getContractAt("TestToken", TEST_TOKEN_ADDRESS);
  const vesting = await ethers.getContractAt("ProductionTokenVesting", VESTING_ADDRESS);

  try {
    console.log("\n=== TOKEN BALANCES ===");
    
    // 1. Check vesting contract balance
    const vestingBalance = await testToken.balanceOf(VESTING_ADDRESS);
    console.log(`Vesting Contract: ${ethers.formatEther(vestingBalance)} tokens`);
    
    // 2. Check deployer balance
    const deployerBalance = await testToken.balanceOf(deployer.address);
    console.log(`Deployer (${deployer.address}): ${ethers.formatEther(deployerBalance)} tokens`);

    // 3. Check all recipients balances
    console.log("\n=== RECIPIENT BALANCES ===");
    const recipients = await vesting.getRecipients(deployer.address);
    let totalRecipientBalance = 0n;
    
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const balance = await testToken.balanceOf(recipient.wallet);
      totalRecipientBalance += balance;
      console.log(`Recipient ${i + 1} (${recipient.basisPoints/100}%): ${recipient.wallet}`);
      console.log(`  Balance: ${ethers.formatEther(balance)} tokens`);
    }
    
    console.log(`\nTotal Recipient Balance: ${ethers.formatEther(totalRecipientBalance)} tokens`);

    // 4. Show vesting progress
    console.log("\n=== VESTING PROGRESS ===");
    const progress = await vesting.getVestingProgress(deployer.address);
    const schedule = await vesting.getVestingSchedule(deployer.address);
    
    const currentTime = Math.floor(Date.now() / 1000);
    const startTime = Number(schedule.startTime);
    const cliffEnd = startTime + Number(schedule.cliffDuration);
    const vestingEnd = startTime + Number(schedule.vestingDuration);
    
    console.log(`Start Time: ${new Date(startTime * 1000).toLocaleString()}`);
    console.log(`Cliff End: ${new Date(cliffEnd * 1000).toLocaleString()}`);
    console.log(`Vesting End: ${new Date(vestingEnd * 1000).toLocaleString()}`);
    console.log(`Current Time: ${new Date(currentTime * 1000).toLocaleString()}`);
    
    console.log(`\nElapsed Time: ${Number(progress.elapsedTime) / (24 * 60 * 60)} days`);
    console.log(`Unlocked: ${progress.unlockedPercentage}% (${ethers.formatEther(progress.unlockedAmount)} tokens)`);
    console.log(`Claimed: ${ethers.formatEther(schedule.claimedAmount)} tokens`);
    console.log(`Claimable Now: ${ethers.formatEther(progress.claimableAmount)} tokens`);
    console.log(`Remaining: ${ethers.formatEther(progress.remainingAmount)} tokens`);

    // 5. Summary
    console.log("\n=== SUMMARY ===");
    const totalSupplied = Number(ethers.formatEther(schedule.totalAmount));
    const totalClaimed = Number(ethers.formatEther(schedule.claimedAmount));
    const inVesting = Number(ethers.formatEther(vestingBalance));
    const withRecipients = Number(ethers.formatEther(totalRecipientBalance));
    
    console.log(`Total Supplied to Vesting: ${totalSupplied} tokens`);
    console.log(`Total Claimed by Recipients: ${totalClaimed} tokens`);
    console.log(`Still in Vesting Contract: ${inVesting} tokens`);
    console.log(`With Recipients: ${withRecipients} tokens`);
    
    // Verification
    const expectedInVesting = totalSupplied - totalClaimed;
    const balanceMatch = Math.abs(inVesting - expectedInVesting) < 0.001;
    
    console.log(`\n✅ Balance Check: ${balanceMatch ? 'PASSED' : 'FAILED'}`);
    if (!balanceMatch) {
      console.log(`Expected in vesting: ${expectedInVesting}, Actual: ${inVesting}`);
    }

  } catch (error) {
    console.error("❌ Error checking balances:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });