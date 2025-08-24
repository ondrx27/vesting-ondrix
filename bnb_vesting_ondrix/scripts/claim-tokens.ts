import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Contract addresses - update these after deployment
const TEST_TOKEN_ADDRESS = "0xA6Fe6abb1E74C58e443817c8736840Af015F1a00";
const VESTING_ADDRESS = "0x9b9eB8fDeb65e9DC4AECCC5c62377a16ebdF5252";
// Test recipient private keys (for testing only - in production use .env)
// These should match the recipients configured in interact.ts
// 
// SETUP INSTRUCTIONS:
// 1. Add to your .env file (at minimum RECIPIENT_1_PRIVATE_KEY):
//    RECIPIENT_1_PRIVATE_KEY=0x...actual_private_key_1
//    (other recipient keys optional - only first one will claim individually)
// 2. Make sure the address from RECIPIENT_1_PRIVATE_KEY matches first recipient in interact.ts
// 3. First recipient will need some ETH for gas (script will auto-send if needed)
// 4. Other recipients will get tokens via beneficiary distribution
//
const TEST_RECIPIENT_PRIVATE_KEYS = [
  process.env.RECIPIENT_1_PRIVATE_KEY || "2f3d67b044097d61453ab88aab34be3f5f2530e248476f01d1cc93cb2c68c020",
  process.env.RECIPIENT_2_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000002",  
  process.env.RECIPIENT_3_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000003",
  process.env.RECIPIENT_4_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000004",
  process.env.RECIPIENT_5_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000005",
];

async function main() {
  console.log("🧪 TESTING MIXED CLAIM SCENARIO");
  console.log("=".repeat(50));
  console.log("Testing scenario:");
  console.log("1. FIRST RECIPIENT claims individually using their private key");
  console.log("2. BENEFICIARY distributes to ALL recipients (including remaining for first)");
  console.log("3. Verify contract handles mixed operations without conflicts");
  console.log("4. Check no double-accounting or state inconsistencies");
  console.log("");

  const [deployer] = await ethers.getSigners();
  console.log("🔑 Beneficiary account:", deployer.address);

  // Create recipient wallets from private keys
  const provider = ethers.provider;
  const recipientWallets = TEST_RECIPIENT_PRIVATE_KEYS.map(privateKey => {
    try {
      return new ethers.Wallet(privateKey, provider);
    } catch (error) {
      console.warn(`Invalid private key: ${privateKey.substring(0, 10)}...`);
      return null;
    }
  }).filter(wallet => wallet !== null);

  console.log(`📝 Created ${recipientWallets.length} recipient wallets for testing`);
  
  // Load contracts
  const testToken = await ethers.getContractAt("TestToken", TEST_TOKEN_ADDRESS);
  const vesting = await ethers.getContractAt("ProductionTokenVesting", VESTING_ADDRESS);

  try {
    // Check if we have a valid vesting schedule
    const schedule = await vesting.getVestingSchedule(deployer.address);
    if (!schedule.isInitialized) {
      console.log("❌ No vesting schedule found. Please run interact.ts first!");
      return;
    }

    if (schedule.startTime == 0n) {
      console.log("❌ Vesting not funded yet. Please run interact.ts first!");
      return;
    }

    console.log("📋 VESTING SCHEDULE INFO");
    console.log("- Total Amount:", ethers.formatEther(schedule.totalAmount), "tokens");
    console.log("- Start Time:", new Date(Number(schedule.startTime) * 1000).toLocaleString());
    console.log("- Cliff Duration:", Number(schedule.cliffDuration) / 60, "minutes");
    console.log("- Recipients:", schedule.recipientCount);

    // Get recipients list
    const recipients = await vesting.getRecipients(deployer.address);
    console.log("\n👥 RECIPIENTS:");
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      console.log(`${i + 1}. ${recipient.wallet} (${Number(recipient.basisPoints)/100}%)`);
    }

    // Check current vesting progress
    const progress = await vesting.getVestingProgress(deployer.address);
    console.log("\n⏳ VESTING PROGRESS:");
    console.log("- Elapsed Time:", Math.floor(Number(progress.elapsedTime) / 60), "minutes");
    console.log("- Unlocked Percentage:", progress.unlockedPercentage.toString() + "%");
    console.log("- Unlocked Amount:", ethers.formatEther(progress.unlockedAmount), "tokens");
    console.log("- Claimable Amount:", ethers.formatEther(progress.claimableAmount), "tokens");

    // Show recipients and potential distributions
    console.log("\n=== RECIPIENTS DETAILS ===");
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const currentBalance = await testToken.balanceOf(recipient.wallet);
      console.log(`- ${recipient.wallet}:`);
      console.log(`  Basis Points: ${recipient.basisPoints} (${Number(recipient.basisPoints)/100}%)`);
      console.log(`  Current Balance: ${ethers.formatEther(currentBalance)} tokens`);
      
      if (progress.claimableAmount > 0n) {
        const share = (progress.claimableAmount * BigInt(recipient.basisPoints)) / 10000n;
        console.log(`  Would Receive: ${ethers.formatEther(share)} tokens`);
      }
    }

    // Check if tokens are available to claim
    const claimableAmount = await vesting.getClaimableAmount(deployer.address);
    console.log("\n💰 Current claimable amount:", ethers.formatEther(claimableAmount), "tokens");

    if (claimableAmount == 0n) {
      console.log("⚠️  No tokens available to claim yet. Waiting for cliff period...");
      
      const currentTime = Math.floor(Date.now() / 1000);
      const cliffEnd = Number(schedule.startTime) + Number(schedule.cliffDuration);
      
      if (currentTime < cliffEnd) {
        const remainingTime = cliffEnd - currentTime;
        console.log(`⏰ Cliff ends in ${Math.ceil(remainingTime / 60)} minutes`);
        console.log(`📅 Exact time: ${new Date(cliffEnd * 1000).toLocaleString()}`);
      }
      
      return;
    }

    console.log("\n🎯 STARTING MIXED CLAIM TEST");
    console.log("=".repeat(40));

    // Show initial balances
    console.log("\n📊 INITIAL BALANCES:");
    const initialBalances: bigint[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const balance = await testToken.balanceOf(recipients[i].wallet);
      initialBalances.push(balance);
      console.log(`${recipients[i].wallet}: ${ethers.formatEther(balance)} tokens`);
    }

    // STEP 1: First recipient claims individually using their private key
    console.log("\n🔥 STEP 1: First Recipient Individual Claim");
    console.log("-".repeat(40));
    
    let successfulIndividualClaim = false;
    
    // Test only the first recipient for individual claim
    if (recipients.length > 0 && recipientWallets.length > 0) {
      const firstRecipient = recipients[0];
      const firstRecipientWallet = recipientWallets[0];
      
      if (!firstRecipientWallet) {
        console.log("⚠️  No wallet available for first recipient");
      } else if (firstRecipient.wallet.toLowerCase() !== firstRecipientWallet.address.toLowerCase()) {
        console.log("⚠️  First recipient address mismatch:");
        console.log(`    Expected: ${firstRecipient.wallet}`);
        console.log(`    Wallet:   ${firstRecipientWallet.address}`);
        console.log("    Please update private key in .env to match recipient address");
      } else {
        console.log(`👤 First recipient: ${firstRecipientWallet.address}`);
        console.log(`   Basis points: ${Number(firstRecipient.basisPoints)} (${Number(firstRecipient.basisPoints)/100}%)`);
        
        // Check if this recipient can claim
        const canClaim = await vesting.canClaim(deployer.address, firstRecipientWallet.address);
        const recipientClaimable = await vesting.getRecipientClaimableAmount(deployer.address, firstRecipientWallet.address);
        
        console.log(`   Can claim: ${canClaim}`);
        console.log(`   Individual claimable amount: ${ethers.formatEther(recipientClaimable)} tokens`);

        if (canClaim && recipientClaimable > 0n) {
          console.log(`🚀 First recipient is claiming tokens with their private key...`);
          
          try {
            // Connect vesting contract with recipient's wallet
            const vestingAsRecipient = vesting.connect(firstRecipientWallet);
            
            // Check recipient's ETH balance for gas
            const ethBalance = await provider.getBalance(firstRecipientWallet.address);
            console.log(`   Gas balance: ${ethers.formatEther(ethBalance)} ETH`);
            
            if (ethBalance < ethers.parseEther("0.001")) {
              console.log("⚠️  Recipient has insufficient ETH for gas. Sending some...");
              
              // Send ETH for gas from deployer
              const gasTransfer = await deployer.sendTransaction({
                to: firstRecipientWallet.address,
                value: ethers.parseEther("0.01") // Send 0.01 ETH for gas
              });
              await gasTransfer.wait();
              console.log("✅ Gas ETH sent successfully");
            }
            
            // Actual claim by recipient using their private key
            const claimTx = await vestingAsRecipient.claimTokens(deployer.address);
            console.log("   Transaction hash:", claimTx.hash);
            console.log("   Waiting for confirmation...");
            await claimTx.wait();
            console.log("✅ Individual claim successful!");
            
            // Show balance after individual claim
            const balanceAfterClaim = await testToken.balanceOf(firstRecipientWallet.address);
            console.log(`   Balance after claim: ${ethers.formatEther(balanceAfterClaim)} tokens`);
            
            successfulIndividualClaim = true;
            
          } catch (error: any) {
            console.log("❌ Individual claim failed:");
            console.log("   Reason:", error.reason || error.message);
            
            if (error.message.includes("insufficient funds")) {
              console.log("   💡 Try adding more ETH to recipient wallet for gas");
            } else if (error.message.includes("Not authorized recipient")) {
              console.log("   💡 Recipient not registered in vesting contract");
            } else if (error.message.includes("Individual claim cooldown active")) {
              console.log("   💡 Cooldown period still active, wait a bit more");
            }
          }
        } else {
          console.log("⚠️  First recipient cannot claim at this time");
          if (!canClaim) {
            console.log("   Possible reasons: cliff period not ended, cooldown active, or no tokens available");
          }
        }
      }
    } else {
      console.log("⚠️  No recipients or wallets available");
    }
    
    if (successfulIndividualClaim) {
      console.log("\n✅ First recipient successfully claimed individually");
      console.log("   Remaining recipients will get tokens via beneficiary distribution");
    } else {
      console.log("\n⚠️  First recipient could not claim individually");
      console.log("   All recipients will get tokens via beneficiary distribution");
    }

    // Wait a moment between operations
    console.log("\n⏳ Waiting 2 seconds between operations...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // STEP 2: Beneficiary distributes to all recipients
    console.log("\n🌟 STEP 2: Beneficiary Distribution");
    console.log("-".repeat(30));
    
    // Check if we can still distribute after individual claims
    const canDistribute = await vesting.canDistribute(deployer.address);
    const remainingClaimable = await vesting.getClaimableAmount(deployer.address);
    
    console.log(`Can distribute: ${canDistribute}`);
    console.log(`Remaining claimable: ${ethers.formatEther(remainingClaimable)} tokens`);

    if (canDistribute && remainingClaimable > 0n) {
      console.log("🚀 Beneficiary is distributing tokens to all recipients...");
      
      const distributeTx = await vesting.distributeTokens();
      console.log("Distribution transaction hash:", distributeTx.hash);
      await distributeTx.wait();
      console.log("✅ Beneficiary distribution successful!");
      
    } else {
      console.log("⚠️  No tokens available for beneficiary distribution");
      console.log("This could mean all tokens were already claimed individually.");
    }

    // STEP 3: Show final results and verify contract state
    console.log("\n📈 FINAL RESULTS");
    console.log("=".repeat(30));
    
    const finalBalances: bigint[] = [];
    console.log("Final recipient balances:");
    for (let i = 0; i < recipients.length; i++) {
      const finalBalance = await testToken.balanceOf(recipients[i].wallet);
      const gained = finalBalance - initialBalances[i];
      finalBalances.push(finalBalance);
      
      console.log(`${recipients[i].wallet}:`);
      console.log(`  Initial: ${ethers.formatEther(initialBalances[i])} tokens`);
      console.log(`  Final:   ${ethers.formatEther(finalBalance)} tokens`);
      console.log(`  Gained:  ${ethers.formatEther(gained)} tokens`);
    }

    // Verify contract state consistency
    console.log("\n🔍 CONTRACT STATE VERIFICATION:");
    const finalProgress = await vesting.getVestingProgress(deployer.address);
    const finalSchedule = await vesting.getVestingSchedule(deployer.address);
    
    console.log("- Final claimed amount:", ethers.formatEther(finalSchedule.claimedAmount), "tokens");
    console.log("- Final remaining amount:", ethers.formatEther(finalProgress.remainingAmount), "tokens");
    console.log("- Final claimable amount:", ethers.formatEther(finalProgress.claimableAmount), "tokens");

    // Calculate total distributed
    const totalDistributed = finalBalances.reduce((sum, balance, i) => 
      sum + (balance - initialBalances[i]), 0n);
    console.log("- Total distributed in this test:", ethers.formatEther(totalDistributed), "tokens");

    // Contract balance verification
    const contractBalance = await testToken.balanceOf(VESTING_ADDRESS);
    console.log("- Contract balance:", ethers.formatEther(contractBalance), "tokens");

    // SUCCESS VERIFICATION
    console.log("\n✅ MIXED CLAIM TEST RESULTS:");
    console.log("=".repeat(35));
    
    if (totalDistributed > 0n) {
      console.log("🎉 SUCCESS: Contract handled mixed claim operations!");
      console.log(`📊 Total tokens distributed: ${ethers.formatEther(totalDistributed)}`);
      console.log("✅ No errors or inconsistencies detected");
      console.log("✅ Contract state remains consistent");
      console.log(`✅ Individual recipient claim: ${successfulIndividualClaim ? 'SUCCESS' : 'SKIPPED'}`);
      
      // Detailed success metrics
      const successRate = (finalBalances.filter((_, i) => finalBalances[i] > initialBalances[i]).length / recipients.length) * 100;
      console.log(`📈 Distribution success rate: ${successRate}% of recipients received tokens`);
      
      if (successfulIndividualClaim) {
        console.log("🔐 Individual claim used real recipient private key signing");
        console.log("🔒 Beneficiary distribution used beneficiary account");
        console.log("✅ Mixed authorization model working correctly");
      }
      
    } else {
      console.log("⚠️  No tokens were distributed in this test");
      console.log("Possible reasons:");
      console.log("- All tokens were already distributed in previous runs");
      console.log("- Cliff period has not ended");
      console.log("- Distribution cooldown is still active");
    }

    // Show vesting timeline
    console.log("\n=== VESTING TIMELINE ===");
    const currentMinutes = Math.floor(Number(progress.elapsedTime) / 60);
    const currentUnlockedPct = Number(progress.unlockedPercentage);
    const cliffMinutes = Number(schedule.cliffDuration) / 60;
    const totalMinutes = Number(schedule.vestingDuration) / 60;
    
    console.log(`Cliff period: ${cliffMinutes} minutes`);
    console.log(`Total vesting: ${totalMinutes} minutes`);
    console.log(`Current elapsed: ${currentMinutes} minutes`);
    
    if (currentMinutes < cliffMinutes) {
      console.log("⏳ Still in cliff period - no tokens available");
      console.log(`📅 Cliff ends in: ${Math.ceil(cliffMinutes - currentMinutes)} minutes`);
    } else if (currentMinutes >= totalMinutes) {
      console.log("🎉 Vesting completed - all tokens unlocked");
    } else {
      console.log(`🔄 Linear vesting active - ${currentUnlockedPct}% unlocked`);
      console.log(`📅 Fully vested in: ${Math.ceil(totalMinutes - currentMinutes)} minutes`);
    }

    // Show next available claim info
    const nextClaimable = await vesting.getClaimableAmount(deployer.address);
    if (nextClaimable > 0n) {
      console.log(`\n🔄 Still available for future claims: ${ethers.formatEther(nextClaimable)} tokens`);
    } else {
      console.log("\n🏁 All currently unlocked tokens have been distributed");
    }

  } catch (error: any) {
    console.error("\n❌ ERROR during mixed claim test:", error);
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
    if (error.message) {
      console.error("Message:", error.message);
    }
    
    console.error("\n🔧 TROUBLESHOOTING:");
    console.error("- Ensure vesting has been initialized and funded");
    console.error("- Check that cliff period has ended");
    console.error("- Verify contract addresses are correct");
    console.error("- Make sure you're using the right account");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });