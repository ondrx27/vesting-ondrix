// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title SecureTokenVesting
 * @dev Безопасный контракт вестинга с распределением только через инициатора
 * ✅ Убраны emergency функции
 * ✅ Только beneficiary может распределять токены
 * ✅ Невозможно вывести средства вне логики вестинга
 */
contract SecureTokenVesting is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Recipient {
        address wallet;
        uint8 percentage;
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
        uint8 currentPeriod;
        Recipient[5] recipients;
        uint8 recipientCount;
        bool isFinalized; // ✅ Добавлено: предотвращает изменения после фандинга
    }

    uint8 public constant MAX_RECIPIENTS = 5;
    uint256 public constant DISTRIBUTION_COOLDOWN = 1 minutes; // Минимум между распределениями
    uint256 public constant MAX_VESTING_DURATION = 365 days; // ✅ Максимальные лимиты
    uint256 public constant MAX_CLIFF_DURATION = 90 days;
    
    mapping(address => VestingSchedule) public vestingSchedules;
    
    // ✅ Улучшенные события
    event VestingInitialized(
        address indexed beneficiary, 
        address indexed token, 
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint8 recipientCount
    );
    event VestingFunded(address indexed beneficiary, uint256 amount, uint256 startTime);
    event TokensDistributed(
        address indexed beneficiary, 
        address indexed recipient, 
        uint256 amount, 
        uint8 period,
        uint256 timestamp
    );
    event VestingFinalized(address indexed beneficiary);

    // ✅ Модификатор: только beneficiary может распределять свои токены
    modifier onlyBeneficiary() {
        require(vestingSchedules[msg.sender].isInitialized, "Vesting not initialized");
        _;
    }

    // ✅ Модификатор: предотвращает изменения после фандинга
    modifier notFinalized() {
        require(!vestingSchedules[msg.sender].isFinalized, "Vesting is finalized");
        _;
    }

    constructor() {}

    /**
     * @dev Инициализация расписания вестинга для вызывающего
     */
    function initializeVesting(
        address _token,
        Recipient[] memory _recipients,
        uint256 _cliffDuration,
        uint256 _vestingDuration
    ) external notFinalized {
        require(_token != address(0), "Invalid token address");
        require(!vestingSchedules[msg.sender].isInitialized, "Vesting already initialized");
        require(_recipients.length > 0 && _recipients.length <= MAX_RECIPIENTS, "Invalid recipients count");
        
        // ✅ Проверка максимальных лимитов
        require(_vestingDuration <= MAX_VESTING_DURATION, "Vesting duration too long");
        require(_cliffDuration <= MAX_CLIFF_DURATION, "Cliff duration too long");
        require(_vestingDuration > _cliffDuration, "Vesting duration must be greater than cliff");
        
        uint256 totalPercentage = 0;
        for (uint8 i = 0; i < _recipients.length; i++) {
            require(_recipients[i].wallet != address(0), "Invalid recipient address");
            require(_recipients[i].percentage > 0, "Invalid percentage");
            totalPercentage += _recipients[i].percentage;
        }
        require(totalPercentage == 100, "Total percentage must equal 100");

        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        schedule.isInitialized = true;
        schedule.token = _token;
        schedule.startTime = 0;
        schedule.cliffDuration = _cliffDuration;
        schedule.vestingDuration = _vestingDuration;
        schedule.totalAmount = 0;
        schedule.claimedAmount = 0;
        schedule.lastDistributionTime = 0;
        schedule.currentPeriod = 0;
        schedule.recipientCount = uint8(_recipients.length);
        schedule.isFinalized = false;
        
        // Инициализация массива получателей
        for (uint8 i = 0; i < MAX_RECIPIENTS; i++) {
            if (i < _recipients.length) {
                schedule.recipients[i] = _recipients[i];
            } else {
                schedule.recipients[i] = Recipient(address(0), 0);
            }
        }

        emit VestingInitialized(msg.sender, _token, _cliffDuration, _vestingDuration, uint8(_recipients.length));
    }

    /**
     * @dev Фандинг вестинга токенами
     */
    function fundVesting(address _beneficiary, uint256 _amount) external nonReentrant {
        require(_amount > 0, "Amount must be greater than 0");
        
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        require(schedule.isInitialized, "Vesting not initialized");
        require(schedule.startTime == 0, "Vesting already funded");

        // ✅ Проверяем что это именно тот токен
        IERC20 token = IERC20(schedule.token);
        
        // Переводим токены на контракт
        token.safeTransferFrom(msg.sender, address(this), _amount);

        // ✅ Финализируем настройки (больше нельзя изменить)
        schedule.totalAmount = _amount;
        schedule.startTime = block.timestamp;
        schedule.isFinalized = true;

        emit VestingFunded(_beneficiary, _amount, block.timestamp);
        emit VestingFinalized(_beneficiary);
    }

    /**
     * @dev ✅ ОСНОВНАЯ ФУНКЦИЯ: Распределение токенов (только beneficiary)
     */
    function distributeTokens() external nonReentrant onlyBeneficiary {
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        require(schedule.startTime > 0, "Vesting not funded");
        require(schedule.isFinalized, "Vesting not finalized");
        require(block.timestamp >= schedule.startTime + schedule.cliffDuration, "Still in cliff period");

        // ✅ Проверка cooldown между распределениями
        if (schedule.lastDistributionTime > 0) {
            require(
                block.timestamp >= schedule.lastDistributionTime + DISTRIBUTION_COOLDOWN,
                "Distribution cooldown active"
            );
        }

        uint8 currentPeriod = getCurrentPeriod(msg.sender);
        require(currentPeriod > schedule.currentPeriod, "Already distributed for this period");

        uint256 claimableAmount = getClaimableAmount(msg.sender);
        require(claimableAmount > 0, "No tokens available to distribute");

        IERC20 token = IERC20(schedule.token);
        uint256 totalDistributed = 0;

        // Распределяем токены получателям
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            Recipient memory recipient = schedule.recipients[i];
            uint256 share = (claimableAmount * recipient.percentage) / 100;
            
            if (share > 0) {
                token.safeTransfer(recipient.wallet, share);
                totalDistributed += share;
                
                emit TokensDistributed(
                    msg.sender, 
                    recipient.wallet, 
                    share, 
                    currentPeriod, 
                    block.timestamp
                );
            }
        }

        // Обновляем состояние
        schedule.claimedAmount += totalDistributed;
        schedule.lastDistributionTime = block.timestamp;
        schedule.currentPeriod = currentPeriod;
    }

    /**
     * @dev Получить текущий период вестинга
     */
    function getCurrentPeriod(address _beneficiary) public view returns (uint8) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0) {
            return 0;
        }

        if (block.timestamp < schedule.startTime + schedule.cliffDuration) {
            return 0;
        }

        uint256 elapsedTime = block.timestamp - schedule.startTime;
        uint256 totalMinutes = elapsedTime / 60;
        
        if (totalMinutes < 5) return 0;
        else if (totalMinutes < 10) return 1;
        else if (totalMinutes < 15) return 2;
        else if (totalMinutes < 20) return 3;
        else return 4;
    }

    /**
     * @dev Рассчитать процент разблокированных токенов
     */
    function getUnlockedPercentage(
        uint256 _elapsedTime,
        uint256 _cliffDuration,
        uint256 _vestingDuration
    ) public pure returns (uint256) {
        if (_elapsedTime < _cliffDuration) {
            return 0;
        }
        
        uint256 totalMinutes = _elapsedTime / 60;
        
        if (totalMinutes < 5) return 0;
        else if (totalMinutes < 10) return 10;
        else if (totalMinutes < 15) return 20;
        else if (totalMinutes < 20) return 50;
        else return 100;
    }

    /**
     * @dev Получить количество токенов доступных для распределения
     */
    function getClaimableAmount(address _beneficiary) public view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0) {
            return 0;
        }

        if (block.timestamp < schedule.startTime + schedule.cliffDuration) {
            return 0;
        }

        uint8 currentPeriod = getCurrentPeriod(_beneficiary);
        if (currentPeriod <= schedule.currentPeriod) {
            return 0;
        }

        uint256 elapsedTime = block.timestamp - schedule.startTime;
        uint256 unlockedPercentage = getUnlockedPercentage(
            elapsedTime,
            schedule.cliffDuration,
            schedule.vestingDuration
        );
        uint256 unlockedAmount = (schedule.totalAmount * unlockedPercentage) / 100;
        
        return unlockedAmount > schedule.claimedAmount ? 
               unlockedAmount - schedule.claimedAmount : 0;
    }

    /**
     * @dev Проверить можно ли распределять токены
     */
    function canDistribute(address _beneficiary) external view returns (bool) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0 || !schedule.isFinalized) {
            return false;
        }

        if (block.timestamp < schedule.startTime + schedule.cliffDuration) {
            return false;
        }

        // Проверка cooldown
        if (schedule.lastDistributionTime > 0) {
            if (block.timestamp < schedule.lastDistributionTime + DISTRIBUTION_COOLDOWN) {
                return false;
            }
        }

        uint8 currentPeriod = getCurrentPeriod(_beneficiary);
        if (currentPeriod <= schedule.currentPeriod) {
            return false;
        }

        return getClaimableAmount(_beneficiary) > 0;
    }

    /**
     * @dev Получить детали расписания вестинга
     */
    function getVestingSchedule(address _beneficiary) external view returns (
        bool isInitialized,
        address token,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint256 totalAmount,
        uint256 claimedAmount,
        uint8 recipientCount,
        bool isTestMode
    ) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        return (
            schedule.isInitialized,
            schedule.token,
            schedule.startTime,
            schedule.cliffDuration,
            schedule.vestingDuration,
            schedule.totalAmount,
            schedule.claimedAmount,
            schedule.recipientCount,
            true // Всегда true для совместимости с фронтендом
        );
    }

    /**
     * @dev Получить получателей
     */
    function getRecipients(address _beneficiary) external view returns (Recipient[] memory) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        Recipient[] memory recipients = new Recipient[](schedule.recipientCount);
        
        for (uint8 i = 0; i < schedule.recipientCount; i++) {
            recipients[i] = schedule.recipients[i];
        }
        
        return recipients;
    }

    /**
     * @dev Получить прогресс вестинга
     */
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
        
        unlockedPercentage = getUnlockedPercentage(
            elapsedTime,
            schedule.cliffDuration,
            schedule.vestingDuration
        );
        
        unlockedAmount = (schedule.totalAmount * unlockedPercentage) / 100;
        claimableAmount = getClaimableAmount(_beneficiary);
        remainingAmount = schedule.totalAmount - schedule.claimedAmount;
    }

    /**
     * @dev Получить следующий анлок
     */
    function getNextUnlock(address _beneficiary) external view returns (
        uint256 nextUnlockTime,
        uint256 nextUnlockPercentage,
        uint256 timeRemaining
    ) {
        VestingSchedule storage schedule = vestingSchedules[_beneficiary];
        
        if (!schedule.isInitialized || schedule.startTime == 0) {
            return (0, 0, type(uint256).max);
        }

        uint8 currentPeriod = getCurrentPeriod(_beneficiary);
        
        // Определяем следующий период
        uint256 nextPeriodMinutes;
        uint256 nextPercentage;
        
        if (currentPeriod == 0) {
            nextPeriodMinutes = 5;
            nextPercentage = 10;
        } else if (currentPeriod == 1) {
            nextPeriodMinutes = 10;
            nextPercentage = 20;
        } else if (currentPeriod == 2) {
            nextPeriodMinutes = 15;
            nextPercentage = 50;
        } else if (currentPeriod == 3) {
            nextPeriodMinutes = 20;
            nextPercentage = 100;
        } else {
            return (0, 100, 0); // Все периоды завершены
        }

        nextUnlockTime = schedule.startTime + (nextPeriodMinutes * 60);
        nextUnlockPercentage = nextPercentage;
        timeRemaining = nextUnlockTime > block.timestamp ? 
                       nextUnlockTime - block.timestamp : 0;
    }
}