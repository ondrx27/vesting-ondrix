import { expect } from "chai";
import { ethers } from "hardhat";
import { TokenVesting, TestToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("TokenVesting", function () {
  let tokenVesting: TokenVesting;
  let testToken: TestToken;
  let owner: SignerWithAddress;
  let recipient1: SignerWithAddress;
  let recipient2: SignerWithAddress;
  let recipient3: SignerWithAddress;
  let recipient4: SignerWithAddress;
  let recipient5: SignerWithAddress;

  beforeEach(async function () {
    [owner, recipient1, recipient2, recipient3, recipient4, recipient5] = await ethers.getSigners();

    // Deploy test token
    const TestToken = await ethers.getContractFactory("TestToken");
    testToken = await TestToken.deploy();

    // Deploy vesting contract
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    tokenVesting = await TokenVesting.deploy();
  });

  describe("Initialization", function () {
    it("Should initialize vesting with valid recipients", async function () {
      const recipients = [
        { wallet: recipient1.address, percentage: 10 },
        { wallet: recipient2.address, percentage: 20 },
        { wallet: recipient3.address, percentage: 30 },
        { wallet: recipient4.address, percentage: 20 },
        { wallet: recipient5.address, percentage: 20 },
      ];

      await expect(tokenVesting.initializeVesting(await testToken.getAddress(), recipients))
        .to.emit(tokenVesting, "VestingInitialized");

      const schedule = await tokenVesting.getVestingSchedule(owner.address);
      expect(schedule.isInitialized).to.be.true;
      expect(schedule.token).to.equal(await testToken.getAddress());
    });

    it("Should reject invalid percentage totals", async function () {
      const recipients = [
        { wallet: recipient1.address, percentage: 10 },
        { wallet: recipient2.address, percentage: 20 },
        { wallet: recipient3.address, percentage: 30 },
        { wallet: recipient4.address, percentage: 20 },
        { wallet: recipient5.address, percentage: 25 }, // Total = 105%
      ];

      await expect(
        tokenVesting.initializeVesting(await testToken.getAddress(), recipients)
      ).to.be.revertedWith("Total percentage must equal 100");
    });
  });

  describe("Funding", function () {
    beforeEach(async function () {
      const recipients = [
        { wallet: recipient1.address, percentage: 10 },
        { wallet: recipient2.address, percentage: 20 },
        { wallet: recipient3.address, percentage: 30 },
        { wallet: recipient4.address, percentage: 20 },
        { wallet: recipient5.address, percentage: 20 },
      ];
      
      await tokenVesting.initializeVesting(await testToken.getAddress(), recipients);
    });

    it("Should fund vesting successfully", async function () {
      const fundAmount = ethers.parseEther("1000");
      
      await testToken.approve(await tokenVesting.getAddress(), fundAmount);
      
      await expect(tokenVesting.fundVesting(owner.address, fundAmount))
        .to.emit(tokenVesting, "VestingFunded");

      const schedule = await tokenVesting.getVestingSchedule(owner.address);
      expect(schedule.totalAmount).to.equal(fundAmount);
      expect(schedule.startTime).to.be.greaterThan(0);
    });
  });

  describe("Claiming", function () {
    beforeEach(async function () {
      const recipients = [
        { wallet: recipient1.address, percentage: 10 },
        { wallet: recipient2.address, percentage: 20 },
        { wallet: recipient3.address, percentage: 30 },
        { wallet: recipient4.address, percentage: 20 },
        { wallet: recipient5.address, percentage: 20 },
      ];
      
      await tokenVesting.initializeVesting(await testToken.getAddress(), recipients);
      
      const fundAmount = ethers.parseEther("1000");
      await testToken.approve(await tokenVesting.getAddress(), fundAmount);
      await tokenVesting.fundVesting(owner.address, fundAmount);
    });

    it("Should not allow claiming before vesting starts", async function () {
      await expect(tokenVesting.claimTokens()).to.be.revertedWith("No tokens available to claim");
    });

    it("Should allow claiming after 30 seconds", async function () {
      // Fast forward 30 seconds
      await ethers.provider.send("evm_increaseTime", [30]);
      await ethers.provider.send("evm_mine", []);

      const initialBalance1 = await testToken.balanceOf(recipient1.address);
      
      await expect(tokenVesting.claimTokens())
        .to.emit(tokenVesting, "TokensClaimed");

      const finalBalance1 = await testToken.balanceOf(recipient1.address);
      expect(finalBalance1).to.be.greaterThan(initialBalance1);
    });
  });

  describe("View Functions", function () {
    it("Should return correct unlocked percentage", async function () {
      expect(await tokenVesting.getUnlockedPercentage(0)).to.equal(0);
      expect(await tokenVesting.getUnlockedPercentage(30)).to.equal(10);
      expect(await tokenVesting.getUnlockedPercentage(60)).to.equal(20);
      expect(await tokenVesting.getUnlockedPercentage(300)).to.equal(100);
    });
  });
});