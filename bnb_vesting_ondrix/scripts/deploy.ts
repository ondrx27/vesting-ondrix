import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Starting deployment...");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)));

  // Deploy Test Token
  console.log("\n1. Deploying TestToken...");
  const TestToken = await ethers.getContractFactory("TestToken");
  const testToken = await TestToken.deploy();
  await testToken.waitForDeployment();
  const testTokenAddress = await testToken.getAddress();
  console.log("TestToken deployed to:", testTokenAddress);

  // Deploy Vesting Contract (changed from "TokenVesting" to "SecureTokenVesting")
  console.log("\n2. Deploying SecureTokenVesting...");
  const SecureTokenVesting = await ethers.getContractFactory("SecureTokenVesting");
  const secureTokenVesting = await SecureTokenVesting.deploy();
  await secureTokenVesting.waitForDeployment();
  const secureTokenVestingAddress = await secureTokenVesting.getAddress();
  console.log("SecureTokenVesting deployed to:", secureTokenVestingAddress);

  // Save deployment info
  console.log("\n3. Deployment Summary:");
  console.log("=====================");
  console.log("TestToken:", testTokenAddress);
  console.log("SecureTokenVesting:", secureTokenVestingAddress);
  console.log("Deployer:", deployer.address);
  console.log("Network:", await deployer.provider.getNetwork());

  return { testToken, secureTokenVesting, testTokenAddress, secureTokenVestingAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });