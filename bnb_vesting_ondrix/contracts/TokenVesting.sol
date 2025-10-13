// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract ProductionTokenVesting is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct Recipient {
        address wallet;
        uint16 basisPoints;          
        uint256 claimedAmount;        
        uint256 lastClaimTime;   
    }

    struct VestingSchedule {
        bool isInitialized;
        address token;
        uint256 startTime;
        uint256 cliffDuration;
        uint256 vestingDuration;
        uint256 totalAmount;
        uint256 claimedAmount;       
        uint256 lastDistributionTime;
        Recipient[5] recipients;
        uint8 recipientCount;
        bool isFinalized;
        address authorizedFunder;
        uint16 tgeBasisPoints;        
    }

    struct TransferData {
        uint8 recipientIndex;
        uint256 amount;
    }

    uint8 public constant MAX_RECIPIENTS = 5;
    uint256 public constant DISTRIBUTION_COOLDOWN = 0 minutes;
    uint256 public constant MAX_VESTING_DURATION = 10 * 365 days;
    uint256 public constant MAX_CLIFF_DURATION = 2 * 365 days;
    uint256 public constant BASIS_POINTS_TOTAL = 10000;   
    uint256 public constant MINIMUM_VESTING_AMOUNT = 1e12;  
    
    mapping(address => VestingSchedule) public vestingSchedules;
    mapping(address => address) public recipientToBeneficiary;   
    mapping(address => bool) public authorizedInitializers;     
    mapping(address => bool) public validatedTokens;          
    mapping(address => bool) private usedVestingTokens;       
    
    event VestingInitialized(
        address indexed beneficiary, 
        address indexed token, 
        address indexed authorizedFunder,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint16 tgeBasisPoints,
        uint8 recipientCount
    );
    event VestingFunded(address indexed beneficiary, uint256 amount, uint256 startTime);
    event TokensDistributed(
        address indexed beneficiary, 
        address indexed recipient, 
        uint256 amount, 
        uint256 timestamp
    );
    event TokensClaimed(
        address indexed beneficiary,
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );
    event VestingFinalized(address indexed beneficiary);
    event TokensRescued(
        address indexed beneficiary, 
        address indexed token, 
        address indexed to, 
        uint256 amount
    );
    event InitializerAuthorized(address indexed initializer, bool authorized);
    event TokenValidated(address indexed token, bool valid);

    modifier onlyBeneficiary() {
        require(vestingSchedules[msg.sender].isInitialized, "Vesting not initialized");
        _;
    }

    modifier notFinalized() {
        require(!vestingSchedules[msg.sender].isFinalized, "Vesting is finalized");
        _;
    }

    modifier validAddress(address _addr) {
        require(_addr != address(0), "Invalid address");
        require(_addr != address(this), "Cannot be contract address");
        _;
    }

    modifier onlyRecipientOrBeneficiary(address _beneficiary) {
        require(_beneficiary != address(0), "Invalid beneficiary address");  
        bool isRecipient = recipientToBeneficiary[msg.sender] == _beneficiary;
        bool isBeneficiary = msg.sender == _beneficiary;
        require(isRecipient || isBeneficiary, "Not authorized");
        _;
    }

    modifier onlyAuthorizedInitializer() {
        require(authorizedInitializers[msg.sender] || msg.sender == owner(), "Not authorized to initialize");
        _;
    }

    modifier onlyAuthorizedFunder(address _beneficiary) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        require(
            msg.sender == schedule.authorizedFunder || 
            msg.sender == _beneficiary ||
            msg.sender == owner(), 
            "Not authorized to fund"
        );
        _;
    }

    constructor() {
        authorizedInitializers[msg.sender] = true;
    }

    function authorizeInitializer(address _initializer, bool _authorized) external onlyOwner {
        require(_initializer != address(0), "Invalid address");
        authorizedInitializers[_initializer] = _authorized;
        emit InitializerAuthorized(_initializer, _authorized);
    }

    function validateToken(address _token, bool _valid) external onlyOwner {
        require(_token != address(0), "Invalid token address");
        
        if (_valid) {
            require(_isValidERC20Token(_token), "Invalid ERC20 implementation");
        }
        
        validatedTokens[_token] = _valid;
        emit TokenValidated(_token, _valid);
    }

    function finalizeContract() external onlyOwner {
        renounceOwnership();
    }

    function _isValidERC20Token(address _token) internal view returns (bool) {
        try IERC20(_token).totalSupply() returns (uint256) {
        } catch {
            return false;
        }

        try IERC20(_token).balanceOf(address(this)) returns (uint256) {
        } catch {
            return false;
        }

        try IERC20(_token).allowance(address(this), address(this)) returns (uint256) {
        } catch {
            return false;
        }

        if (_token.code.length == 0) {
            return false; 
        }

        return true;
    }

    function initializeVesting(
        address _token,
        address _authorizedFunder,
        Recipient[] memory _recipients,
        uint256 _cliffDuration,
        uint256 _vestingDuration,
        uint16 _tgeBasisPoints
    ) external 
        onlyAuthorizedInitializer 
        validAddress(_token) 
        validAddress(_authorizedFunder)
        notFinalized 
    {
        require(!vestingSchedules[msg.sender].isInitialized, "Vesting already initialized");
        require(_recipients.length > 0 && _recipients.length <= MAX_RECIPIENTS, "Invalid recipients count");
        
        require(validatedTokens[_token], "Token not validated - contact admin");
        
        require(_vestingDuration <= MAX_VESTING_DURATION, "Vesting duration too long");
        require(_cliffDuration <= MAX_CLIFF_DURATION, "Cliff duration too long");
        require(_vestingDuration > _cliffDuration, "Vesting duration must be greater than cliff");
        require(_vestingDuration > 0, "Vesting duration must be greater than 0");
        require(_tgeBasisPoints <= BASIS_POINTS_TOTAL, "TGE basis points too high");

        uint256 totalBasisPoints = 0;
        
        for (uint8 i = 0; i < _recipients.length; i++) {
            require(_recipients[i].wallet != address(0), "Invalid recipient address");
            require(_recipients[i].wallet != address(this), "Recipient cannot be contract");
            require(_recipients[i].wallet != msg.sender, "Recipient cannot be beneficiary");
            require(_recipients[i].wallet != _authorizedFunder, "Recipient cannot be authorized funder");
            require(_recipients[i].basisPoints > 0 && _recipients[i].basisPoints <= BASIS_POINTS_TOTAL, "Invalid basis points");
            require(_recipients[i].basisPoints >= 100, "Basis points too small (min 1%)");
            
            for (uint8 j = 0; j < i; j++) {
                require(_recipients[i].wallet != _recipients[j].wallet, "Duplicate recipient");
            }
            
            require(totalBasisPoints <= type(uint256).max - _recipients[i].basisPoints, "Basis points overflow");
            totalBasisPoints += _recipients[i].basisPoints;
            
            recipientToBeneficiary[_recipients[i].wallet] = msg.sender;
        }
        require(totalBasisPoints == BASIS_POINTS_TOTAL, "Total basis points must equal 10000");

        require(!usedVestingTokens[_token], "Token already used in another vesting schedule");
        
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        schedule.isInitialized = true;
        schedule.token = _token;
        usedVestingTokens[_token] = true; 
        schedule.authorizedFunder = _authorizedFunder;
        schedule.startTime = 0;
        schedule.cliffDuration = _cliffDuration;
        schedule.vestingDuration = _vestingDuration;
        schedule.totalAmount = 0;
        schedule.claimedAmount = 0;
        schedule.lastDistributionTime = 0;
        schedule.recipientCount = uint8(_recipients.length);
        schedule.isFinalized = false;
        schedule.tgeBasisPoints = _tgeBasisPoints;
        
        for (uint8 i = 0; i < MAX_RECIPIENTS; i++) {
            if (i < _recipients.length) {
                schedule.recipients[i] = Recipient({
                    wallet: _recipients[i].wallet,
                    basisPoints: _recipients[i].basisPoints,
                    claimedAmount: 0,
                    lastClaimTime: 0
                });
            } else {
                schedule.recipients[i] = Recipient({
                    wallet: address(0),
                    basisPoints: 0,
                    claimedAmount: 0,
                    lastClaimTime: 0
                });
            }
        }

        emit VestingInitialized(
            msg.sender, 
            _token, 
            _authorizedFunder,
            _cliffDuration, 
            _vestingDuration, 
            _tgeBasisPoints,
            uint8(_recipients.length)
        );
    }

    function fundVesting(address _beneficiary, uint256 _amount) 
        external 
        validAddress(_beneficiary) 
        nonReentrant
        onlyAuthorizedFunder(_beneficiary)
    {
        require(_amount >= MINIMUM_VESTING_AMOUNT, "Amount too small for precision");
        require(_amount <= type(uint256).max / BASIS_POINTS_TOTAL, "Amount too large for calculations");
        
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        require(schedule.isInitialized, "Vesting not initialized");
        require(schedule.startTime == 0, "Vesting already funded");
        require(!schedule.isFinalized, "Vesting already finalized");

        IERC20 token = IERC20(schedule.token);
        
        require(validatedTokens[schedule.token], "Token validation revoked");
        
        uint256 balanceBefore = token.balanceOf(address(this));
        uint256 allowanceBefore = token.allowance(msg.sender, address(this));
        require(allowanceBefore >= _amount, "Insufficient allowance");

        // CEI Pattern: Calculate values first
        token.safeTransferFrom(msg.sender, address(this), _amount);

        uint256 balanceAfter = token.balanceOf(address(this));
        uint256 actualReceived = balanceAfter - balanceBefore;

        if (actualReceived < _amount) {
            require(actualReceived >= MINIMUM_VESTING_AMOUNT, "Received amount too small after fees");
            _amount = actualReceived;
        }

        // Then update all state (after knowing the actual amount)
        schedule.totalAmount = _amount;
        schedule.startTime = block.timestamp;
        schedule.isFinalized = true;

        emit VestingFunded(_beneficiary, _amount, block.timestamp);
        emit VestingFinalized(_beneficiary);
    }

    function distributeTokens() external nonReentrant onlyBeneficiary {
        _distributeAllTokens(msg.sender);
    }

    function claimTokens(address _beneficiary) 
        external 
        nonReentrant 
        validAddress(_beneficiary)
    {
        require(recipientToBeneficiary[msg.sender] == _beneficiary, "Not authorized recipient");
        _claimForRecipient(_beneficiary, msg.sender);
    }

    function _distributeAllTokens(address _beneficiary) internal {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        require(schedule.startTime > 0, "Vesting not funded");
        require(schedule.isFinalized, "Vesting not finalized");
        // TGE logic is handled in _calculateTotalUnlockedAmount
        
        _validateVestingState(_beneficiary);

        if (schedule.lastDistributionTime > 0) {
            require(
                block.timestamp >= schedule.lastDistributionTime + DISTRIBUTION_COOLDOWN,
                "Distribution cooldown active"
            );
        }

        uint256 totalClaimable = _calculateTotalClaimableAmount(_beneficiary);
        require(totalClaimable > 0, "No tokens available to distribute");

        IERC20 token = IERC20(schedule.token);
        uint256 totalDistributed = 0;

        TransferData[] memory transfers = new TransferData[](schedule.recipientCount);
        uint8 transferCount = 0;
        
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            uint256 recipientClaimable = _calculateRecipientClaimableAmount(_beneficiary, schedule.recipients[i].wallet);
            if (recipientClaimable > 0) {
                transfers[transferCount] = TransferData(i, recipientClaimable);
                transferCount++;
                totalDistributed += recipientClaimable;
            }
        }
        
        // CEI Pattern: Update state BEFORE external calls
        // First update all state variables
        for (uint8 i = 0; i < transferCount; i++) {
            Recipient storage recipient = schedule.recipients[transfers[i].recipientIndex];
            recipient.claimedAmount += transfers[i].amount;
            recipient.lastClaimTime = block.timestamp;
        }
        schedule.lastDistributionTime = block.timestamp;

        // Then do all external calls (transfers)
        for (uint8 i = 0; i < transferCount; i++) {
            Recipient storage recipient = schedule.recipients[transfers[i].recipientIndex];
            token.safeTransfer(recipient.wallet, transfers[i].amount);
            emit TokensDistributed(_beneficiary, recipient.wallet, transfers[i].amount, block.timestamp);
        }
    }

    function _claimForRecipient(address _beneficiary, address _recipient) internal {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        require(schedule.startTime > 0, "Vesting not funded");
        require(schedule.isFinalized, "Vesting not finalized");
        // TGE logic is handled in _calculateTotalUnlockedAmount
        
        _validateVestingState(_beneficiary);

        uint8 recipientIndex = _findRecipientIndex(_beneficiary, _recipient);
        require(recipientIndex != type(uint8).max, "Recipient not found");

        Recipient storage recipient = schedule.recipients[recipientIndex];
        
        if (recipient.lastClaimTime > 0) {
            require(
                block.timestamp >= recipient.lastClaimTime + DISTRIBUTION_COOLDOWN,
                "Individual claim cooldown active"
            );
        }

        uint256 claimableAmount = _calculateRecipientClaimableAmount(_beneficiary, _recipient);
        require(claimableAmount > 0, "No tokens available for recipient");

        // CEI Pattern: Update state BEFORE external call
        recipient.claimedAmount += claimableAmount;
        recipient.lastClaimTime = block.timestamp;

        // Then do external call (transfer)
        IERC20 token = IERC20(schedule.token);
        token.safeTransfer(_recipient, claimableAmount);

        emit TokensClaimed(_beneficiary, _recipient, claimableAmount, block.timestamp);
    }

    function _calculateTotalClaimableAmount(address _beneficiary) internal view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0) {
            return 0;
        }

        // Use the centralized logic that properly handles TGE + cliff
        uint256 totalUnlocked = _calculateTotalUnlockedAmount(_beneficiary);
        
        uint256 totalClaimedByRecipients = 0;
        
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            totalClaimedByRecipients += schedule.recipients[i].claimedAmount;
        }

        return totalUnlocked > totalClaimedByRecipients ? 
               totalUnlocked - totalClaimedByRecipients : 0;
    }

    function _calculateRecipientClaimableAmount(address _beneficiary, address _recipient) 
        internal 
        view 
        returns (uint256) 
    {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        uint8 recipientIndex = _findRecipientIndex(_beneficiary, _recipient);
        
        if (recipientIndex == type(uint8).max) {
            return 0;
        }

        Recipient storage recipient = schedule.recipients[recipientIndex];
        
        // Use the centralized logic that properly handles TGE + cliff
        uint256 totalUnlocked = _calculateTotalUnlockedAmount(_beneficiary);
        uint256 recipientTotalUnlocked = Math.mulDiv(totalUnlocked, recipient.basisPoints, BASIS_POINTS_TOTAL);

        return recipientTotalUnlocked > recipient.claimedAmount ? 
               recipientTotalUnlocked - recipient.claimedAmount : 0;
    }

    function _calculateTotalUnlockedAmount(address _beneficiary) internal view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0) {
            return 0;
        }

        uint256 elapsedTime = block.timestamp - schedule.startTime;
        
        uint256 tgeAmount = Math.mulDiv(schedule.totalAmount, schedule.tgeBasisPoints, BASIS_POINTS_TOTAL);
        
        if (block.timestamp < schedule.startTime + schedule.cliffDuration) {
            return tgeAmount;
        }

        if (elapsedTime >= schedule.vestingDuration) {
            return schedule.totalAmount;
        }

        uint256 vestingAmount = schedule.totalAmount - tgeAmount;
        uint256 vestingElapsed = elapsedTime - schedule.cliffDuration;
        uint256 remainingVesting = schedule.vestingDuration - schedule.cliffDuration;
        
        uint256 linearVested = Math.mulDiv(vestingAmount, vestingElapsed, remainingVesting);
        
        return tgeAmount + linearVested;
    }

    function _validateVestingState(address _beneficiary) internal view {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0) {
            return;
        }
        
        uint256 totalClaimedByRecipients = 0;
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            totalClaimedByRecipients += schedule.recipients[i].claimedAmount;
        }
        
        require(totalClaimedByRecipients <= schedule.totalAmount, "State inconsistency: claimed exceeds total");
        
        IERC20 token = IERC20(schedule.token);
        uint256 contractBalance = token.balanceOf(address(this));
        uint256 remainingVesting = schedule.totalAmount - totalClaimedByRecipients;
        
        require(contractBalance >= remainingVesting, "Insufficient contract balance for vesting");
    }

    function _findRecipientIndex(address _beneficiary, address _recipient) internal view returns (uint8) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            if (schedule.recipients[i].wallet == _recipient) {
                return i;
            }
        }
        
        return type(uint8).max; 
    }

    function rescueTokens(
        address _token,
        address _to,
        uint256 _amount
    ) external nonReentrant onlyBeneficiary validAddress(_token) validAddress(_to) {
        require(_amount > 0, "Amount must be greater than 0");
        
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        
        require(_token != schedule.token, "Cannot rescue vesting tokens");
        require(!usedVestingTokens[_token], "Cannot rescue token used in any vesting schedule");
        
        IERC20 token = IERC20(_token);
        uint256 contractBalance = token.balanceOf(address(this));
        require(contractBalance >= _amount, "Insufficient token balance");
        
        
        token.safeTransfer(_to, _amount);
        
        emit TokensRescued(msg.sender, _token, _to, _amount);
    }

    function canDistribute(address _beneficiary) external view returns (bool) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0 || !schedule.isFinalized) {
            return false;
        }

        if (schedule.lastDistributionTime > 0) {
            if (block.timestamp < schedule.lastDistributionTime + DISTRIBUTION_COOLDOWN) {
                return false;
            }
        }

        return _calculateTotalClaimableAmount(_beneficiary) > 0;
    }

    function canClaim(address _beneficiary, address _recipient) external view returns (bool) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0 || !schedule.isFinalized) {
            return false;
        }

        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            if (schedule.recipients[i].wallet == _recipient) {
                Recipient storage recipient = schedule.recipients[i];
                
                if (recipient.lastClaimTime > 0) {
                    if (block.timestamp < recipient.lastClaimTime + DISTRIBUTION_COOLDOWN) {
                        return false;
                    }
                }
                
                return _calculateRecipientClaimableAmount(_beneficiary, _recipient) > 0;
            }
        }
        
        return false;
    }

    function getVestingSchedule(address _beneficiary) external view returns (
        bool isInitialized,
        address token,
        address authorizedFunder,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint256 totalAmount,
        uint256 claimedAmount,
        uint16 tgeBasisPoints,
        uint8 recipientCount
    ) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        uint256 actualClaimedAmount = 0;
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            actualClaimedAmount += schedule.recipients[i].claimedAmount;
        }
        
        return (
            schedule.isInitialized,
            schedule.token,
            schedule.authorizedFunder,
            schedule.startTime,
            schedule.cliffDuration,
            schedule.vestingDuration,
            schedule.totalAmount,
            actualClaimedAmount,
            schedule.tgeBasisPoints,
            schedule.recipientCount
        );
    }

    function getRecipients(address _beneficiary) external view returns (Recipient[] memory) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        Recipient[] memory recipients = new Recipient[](schedule.recipientCount);
        
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            recipients[i] = schedule.recipients[i];
        }
        
        return recipients;
    }

    function getClaimableAmount(address _beneficiary) external view returns (uint256) {
        return _calculateTotalClaimableAmount(_beneficiary);
    }

    function getRecipientClaimableAmount(address _beneficiary, address _recipient) 
        external 
        view 
        returns (uint256) 
    {
        return _calculateRecipientClaimableAmount(_beneficiary, _recipient);
    }

    function getVestingProgress(address _beneficiary) external view returns (
        uint256 elapsedTime,
        uint256 unlockedPercentage,
        uint256 unlockedAmount,
        uint256 claimableAmount,
        uint256 remainingAmount
    ) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0) {
            return (0, 0, 0, 0, 0);
        }

        elapsedTime = block.timestamp > schedule.startTime ? 
                     block.timestamp - schedule.startTime : 0;
        
        if (elapsedTime < schedule.cliffDuration) {
            unlockedPercentage = 0;
        } else if (elapsedTime >= schedule.vestingDuration) {
            unlockedPercentage = 100;
        } else {
            uint256 vestingElapsed = elapsedTime - schedule.cliffDuration;
            uint256 remainingVesting = schedule.vestingDuration - schedule.cliffDuration;
            unlockedPercentage = Math.mulDiv(vestingElapsed, 100, remainingVesting);
        }
        
        unlockedAmount = _calculateTotalUnlockedAmount(_beneficiary);
        claimableAmount = _calculateTotalClaimableAmount(_beneficiary);
        
        uint256 totalClaimedByRecipients = 0;
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            totalClaimedByRecipients += schedule.recipients[i].claimedAmount;
        }
        
        remainingAmount = schedule.totalAmount > totalClaimedByRecipients ? 
                         schedule.totalAmount - totalClaimedByRecipients : 0;
    }

    function getBeneficiaryForRecipient(address _recipient) external view returns (address) {
        return recipientToBeneficiary[_recipient];
    }

    function isAuthorizedInitializer(address _initializer) external view returns (bool) {
        return authorizedInitializers[_initializer];
    }

    function isTokenValidated(address _token) external view returns (bool) {
        return validatedTokens[_token];
    }

    function isVestingImmutable() external pure returns (bool) {
        return true; 
    }
}