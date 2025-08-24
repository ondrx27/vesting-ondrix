import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

// Contract addresses (update after deployment)
const TEST_TOKEN_ADDRESS = "0x2B55A4C03EC89Ce4A7d46A3A84794824A6a03C26";
const VESTING_ADDRESS = "0x581105A2F4899A0Dd943EceDaB981e25BEf755F9";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Interacting with contracts using account:", deployer.address);

  // Load contracts - Using ProductionTokenVesting
  const testToken = await ethers.getContractAt("TestToken", TEST_TOKEN_ADDRESS);
  const vesting = await ethers.getContractAt("ProductionTokenVesting", VESTING_ADDRESS);

  // Read addresses from .env - Using basis points (10000 = 100%)
  const rawRecipients = [
    { addr: process.env.RECIPIENT_1, basisPoints: 1000 },  // 10%
    { addr: process.env.RECIPIENT_2, basisPoints: 2000 },  // 20%
    { addr: process.env.RECIPIENT_3, basisPoints: 3000 },  // 30%
    { addr: process.env.RECIPIENT_4, basisPoints: 2000 },  // 20%
    { addr: process.env.RECIPIENT_5, basisPoints: 2000 },  // 20%
  ];

  // Convert to Recipient objects for contract
  const recipients = rawRecipients.map(r => ({
    wallet: r.addr || deployer.address,
    basisPoints: r.basisPoints,
    claimedAmount: 0,    // Initially 0
    lastClaimTime: 0     // Initially 0
  }));

  console.log("Recipients:", recipients);

  // Settings for cliff and vesting duration - TEST PERIODS
  const cliffDuration = 5 * 60;       // 5 minutes cliff
  const vestingDuration = 20 * 60;    // 20 minutes total vesting
  
  console.log("⏰ Test Vesting Schedule:");
  console.log("  Cliff: 5 minutes (no claiming)");
  console.log("  5 min: 10% unlocked");
  console.log("  10 min: 20% unlocked"); 
  console.log("  15 min: 50% unlocked");
  console.log("  20 min: 100% unlocked");

  try {
    // 1. Validate token first (owner only)
    console.log("\n1. Validating token...");
    const validateTx = await (vesting as any).validateToken(TEST_TOKEN_ADDRESS, true);
    await validateTx.wait();
    console.log("✅ Token validated!");

    // 2. Authorize deployer as initializer (owner only)
    console.log("\n2. Authorizing initializer...");
    const authTx = await (vesting as any).authorizeInitializer(deployer.address, true);
    await authTx.wait();
    console.log("✅ Initializer authorized!");

    // 3. Initialize vesting
    console.log("\n3. Initializing vesting...");
    const initTx = await (vesting as any).initializeVesting(
      TEST_TOKEN_ADDRESS,
      deployer.address, // authorized funder
      recipients,
      cliffDuration,
      vestingDuration
    );
    await initTx.wait();
    console.log("✅ Vesting initialized!");

    // 4. Approve tokens
    const fundAmount = ethers.parseEther("1000"); // 1000 tokens
    console.log("\n4. Approving tokens for funding...");
    const approveTx = await testToken.approve(VESTING_ADDRESS, fundAmount);
    await approveTx.wait();
    console.log("✅ Tokens approved!");

    // 5. Fund vesting
    console.log("\n5. Funding vesting...");
    const fundTx = await vesting.fundVesting(deployer.address, fundAmount);
    await fundTx.wait();
    console.log("✅ Vesting funded!");

    // 6. Check status
    console.log("\n6. Checking vesting status...");
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

    // 7. Get recipients list
    const contractRecipients = await vesting.getRecipients(deployer.address);
    console.log("Recipients from contract:", contractRecipients);

    // 8. Check if we can distribute tokens immediately (for testing)
    console.log("\n8. Checking distribution availability...");
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