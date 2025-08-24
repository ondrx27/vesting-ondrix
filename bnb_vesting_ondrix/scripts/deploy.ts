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

  // Deploy Vesting Contract (ProductionTokenVesting)
  console.log("\n2. Deploying ProductionTokenVesting...");
  const ProductionTokenVesting = await ethers.getContractFactory("ProductionTokenVesting");
  const productionTokenVesting = await ProductionTokenVesting.deploy();
  await productionTokenVesting.waitForDeployment();
  const productionTokenVestingAddress = await productionTokenVesting.getAddress();
  console.log("ProductionTokenVesting deployed to:", productionTokenVestingAddress);

  // Set up initial configuration
  console.log("\n3. Initial setup...");
  
  // Validate test token
  console.log("Validating test token...");
  const validateTx = await (productionTokenVesting as any).validateToken(testTokenAddress, true);
  await validateTx.wait();
  console.log("Test token validated successfully");
  
  // Authorize deployer as initializer (owner can do this initially)
  console.log("Authorizing deployer as initializer...");
  const authTx = await (productionTokenVesting as any).authorizeInitializer(deployer.address, true);
  await authTx.wait();
  console.log("Deployer authorized as initializer");

  // Save deployment info
  console.log("\n4. Deployment Summary:");
  console.log("=====================");
  console.log("TestToken:", testTokenAddress);
  console.log("ProductionTokenVesting:", productionTokenVestingAddress);
  console.log("Deployer:", deployer.address);
  console.log("Network:", await deployer.provider.getNetwork());

  return { testToken, productionTokenVesting, testTokenAddress, productionTokenVestingAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });