import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Contract addresses (update after deployment)
const TEST_TOKEN_ADDRESS = "0x1510f2Ed43Dfc354B0f1406d3384aFE187f3A6a2";
const VESTING_ADDRESS = "0x966235Bc0A3C1B258860E8C6ef35f26914811a7b";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Interacting with contracts using account:", deployer.address);

  // Load contracts - CHANGED from "TokenVesting" to "SecureTokenVesting"
  const testToken = await ethers.getContractAt("TestToken", TEST_TOKEN_ADDRESS);
  const vesting = await ethers.getContractAt("SecureTokenVesting", VESTING_ADDRESS);

  // Read addresses from .env
  const rawRecipients = [
    { addr: process.env.RECIPIENT_1, percent: 10 },
    { addr: process.env.RECIPIENT_2, percent: 20 },
    { addr: process.env.RECIPIENT_3, percent: 30 },
    { addr: process.env.RECIPIENT_4, percent: 20 },
    { addr: process.env.RECIPIENT_5, percent: 20 },
  ];

  // Convert to Recipient objects for contract
  const recipients = rawRecipients.map(r => ({
    wallet: r.addr || deployer.address,
    percentage: r.percent,
  }));

  console.log("Recipients:", recipients);

  // Settings for cliff and vesting duration
  const cliffDuration = 5 * 60;    // 5 minutes
  const vestingDuration = 20 * 60; // 20 minutes

  try {
    // 1. Initialize vesting
    console.log("\n1. Initializing vesting...");
    const initTx = await vesting.initializeVesting(
      TEST_TOKEN_ADDRESS,
      recipients,
      cliffDuration,
      vestingDuration
    );
    await initTx.wait();
    console.log("✅ Vesting initialized!");

    // 2. Approve tokens
    const fundAmount = ethers.parseEther("1000"); // 1000 tokens
    console.log("\n2. Approving tokens for funding...");
    const approveTx = await testToken.approve(VESTING_ADDRESS, fundAmount);
    await approveTx.wait();
    console.log("✅ Tokens approved!");

    // 3. Fund vesting
    console.log("\n3. Funding vesting...");
    const fundTx = await vesting.fundVesting(deployer.address, fundAmount);
    await fundTx.wait();
    console.log("✅ Vesting funded!");

    // 4. Check status
    console.log("\n4. Checking vesting status...");
    const schedule = await vesting.getVestingSchedule(deployer.address);
    console.log("Vesting Schedule:", {
      isInitialized: schedule.isInitialized,
      token: schedule.token,
      startTime: schedule.startTime.toString(),
      cliffDuration: schedule.cliffDuration.toString(),
      vestingDuration: schedule.vestingDuration.toString(),
      totalAmount: ethers.formatEther(schedule.totalAmount),
      claimedAmount: ethers.formatEther(schedule.claimedAmount),
      recipientCount: schedule.recipientCount,
    });

    // 5. Get recipients list
    const contractRecipients = await vesting.getRecipients(deployer.address);
    console.log("Recipients from contract:", contractRecipients);

    // 6. Check if we can distribute tokens immediately (for testing)
    console.log("\n6. Checking distribution availability...");
    const canDistribute = await vesting.canDistribute(deployer.address);
    console.log("Can distribute:", canDistribute);
    
    if (canDistribute) {
      console.log("✅ Tokens are ready for distribution!");
    } else {
      console.log("⏳ Need to wait for cliff period to end or next vesting period");
    }

  } catch (error) {
    console.error("❌ Error during interaction:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });