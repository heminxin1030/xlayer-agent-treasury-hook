// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice User-owned treasury that grants an AI agent bounded authority over selected Uniswap v4 LP opportunities.
contract AgentTreasuryVault {
    enum StrategyMode {
        Conservative,
        Balanced,
        Aggressive
    }

    struct PoolPolicy {
        bool allowed;
        bool autoMode;
        address token0;
        address token1;
        uint16 maxCapitalBps;
        uint16 minRangeWidth;
        uint8 maxDailyActions;
        StrategyMode mode;
        uint64 authorizedAt;
    }

    struct Proposal {
        bytes32 poolId;
        bytes32 actionId;
        int24 tickLower;
        int24 tickUpper;
        uint16 capitalBps;
        uint64 createdAt;
        string rationale;
    }

    address public owner;
    address public agent;
    address public hook;
    bool public paused;
    bool private executing;

    mapping(bytes32 poolId => PoolPolicy policy) public poolPolicies;
    mapping(address target => bool allowed) public allowedTargets;
    mapping(bytes32 actionId => bool executed) public executedActions;
    mapping(bytes32 poolId => uint64 day) public actionDay;
    mapping(bytes32 poolId => uint8 count) public actionCount;
    mapping(bytes32 actionId => Proposal proposal) public proposals;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AgentUpdated(address indexed previousAgent, address indexed newAgent);
    event HookUpdated(address indexed previousHook, address indexed newHook);
    event PauseUpdated(bool paused);
    event TargetUpdated(address indexed target, bool allowed);
    event PoolAuthorized(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        StrategyMode mode,
        uint16 maxCapitalBps,
        uint16 minRangeWidth,
        uint8 maxDailyActions,
        bool autoMode
    );
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event AgentProposal(
        bytes32 indexed actionId,
        bytes32 indexed poolId,
        int24 tickLower,
        int24 tickUpper,
        uint16 capitalBps,
        string rationale
    );
    event TreasuryActionExecuted(bytes32 indexed actionId, bytes32 indexed poolId, address indexed target);

    error NotOwner();
    error NotAgentOrOwner();
    error NotHook();
    error Paused();
    error ZeroAddress();
    error PoolNotAllowed();
    error CapitalTooHigh();
    error RangeTooNarrow();
    error DailyLimitExceeded();
    error TargetNotAllowed();
    error ActionAlreadyExecuted();
    error ReentrantCall();
    error CallFailed(bytes data);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgentOrOwner() {
        if (msg.sender != agent && msg.sender != owner) revert NotAgentOrOwner();
        _;
    }

    modifier whenActive() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (executing) revert ReentrantCall();
        executing = true;
        _;
        executing = false;
    }

    constructor(address initialOwner, address initialAgent, address initialHook) {
        if (initialOwner == address(0) || initialAgent == address(0) || initialHook == address(0)) {
            revert ZeroAddress();
        }
        owner = initialOwner;
        agent = initialAgent;
        hook = initialHook;
        emit OwnershipTransferred(address(0), initialOwner);
        emit AgentUpdated(address(0), initialAgent);
        emit HookUpdated(address(0), initialHook);
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    function setHook(address newHook) external onlyOwner {
        if (newHook == address(0)) revert ZeroAddress();
        emit HookUpdated(hook, newHook);
        hook = newHook;
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit PauseUpdated(nextPaused);
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        allowedTargets[target] = allowed;
        emit TargetUpdated(target, allowed);
    }

    function authorizePool(
        bytes32 poolId,
        address token0,
        address token1,
        StrategyMode mode,
        uint16 maxCapitalBps,
        uint16 minRangeWidth,
        uint8 maxDailyActions,
        bool autoMode
    ) external onlyOwner {
        if (token0 == address(0) || token1 == address(0)) revert ZeroAddress();
        if (maxCapitalBps > 10_000) revert CapitalTooHigh();
        if (maxDailyActions == 0) revert DailyLimitExceeded();

        poolPolicies[poolId] = PoolPolicy({
            allowed: true,
            autoMode: autoMode,
            token0: token0,
            token1: token1,
            maxCapitalBps: maxCapitalBps,
            minRangeWidth: minRangeWidth,
            maxDailyActions: maxDailyActions,
            mode: mode,
            authorizedAt: uint64(block.timestamp)
        });

        emit PoolAuthorized(poolId, token0, token1, mode, maxCapitalBps, minRangeWidth, maxDailyActions, autoMode);
    }

    function deposit(address token, uint256 amount) external whenActive {
        if (token == address(0)) revert ZeroAddress();
        require(IERC20Minimal(token).transferFrom(msg.sender, address(this), amount), "TRANSFER_FROM_FAILED");
        emit Deposited(token, msg.sender, amount);
    }

    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        require(IERC20Minimal(token).transfer(to, amount), "TRANSFER_FAILED");
        emit Withdrawn(token, to, amount);
    }

    function submitProposal(
        bytes32 actionId,
        bytes32 poolId,
        int24 tickLower,
        int24 tickUpper,
        uint16 capitalBps,
        string calldata rationale
    ) external onlyAgentOrOwner whenActive {
        _validatePolicy(poolId, tickLower, tickUpper, capitalBps, false);

        proposals[actionId] = Proposal({
            poolId: poolId,
            actionId: actionId,
            tickLower: tickLower,
            tickUpper: tickUpper,
            capitalBps: capitalBps,
            createdAt: uint64(block.timestamp),
            rationale: rationale
        });

        emit AgentProposal(actionId, poolId, tickLower, tickUpper, capitalBps, rationale);
    }

    function executeTreasuryAction(
        bytes32 actionId,
        bytes32 poolId,
        int24 tickLower,
        int24 tickUpper,
        uint16 capitalBps,
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyAgentOrOwner whenActive nonReentrant returns (bytes memory result) {
        if (executedActions[actionId]) revert ActionAlreadyExecuted();
        _validatePolicy(poolId, tickLower, tickUpper, capitalBps, false);

        if (target != address(0)) {
            if (!allowedTargets[target]) revert TargetNotAllowed();
            (bool ok, bytes memory returned) = target.call{value: value}(data);
            if (!ok) revert CallFailed(returned);
            result = returned;
        }

        if (!executedActions[actionId]) {
            executedActions[actionId] = true;
            _countAction(poolId);
        }

        emit TreasuryActionExecuted(actionId, poolId, target);
    }

    function validateHookAction(bytes32 poolId, bytes32 actionId, int24 tickLower, int24 tickUpper, uint16 capitalBps)
        external
        returns (bool)
    {
        if (msg.sender != hook) revert NotHook();
        _validatePolicy(poolId, tickLower, tickUpper, capitalBps, false);
        if (executedActions[actionId]) revert ActionAlreadyExecuted();
        executedActions[actionId] = true;
        _countAction(poolId);
        return true;
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20Minimal(token).balanceOf(address(this));
    }

    function _validatePolicy(bytes32 poolId, int24 tickLower, int24 tickUpper, uint16 capitalBps, bool countAction)
        internal
    {
        PoolPolicy memory policy = poolPolicies[poolId];
        if (!policy.allowed) revert PoolNotAllowed();
        if (capitalBps > policy.maxCapitalBps) revert CapitalTooHigh();
        if (tickUpper <= tickLower || uint24(tickUpper - tickLower) < policy.minRangeWidth) revert RangeTooNarrow();

        if (countAction) {
            _countAction(poolId);
        }
    }

    function _countAction(bytes32 poolId) internal {
        PoolPolicy memory policy = poolPolicies[poolId];
        uint64 today = uint64(block.timestamp / 1 days);
        if (actionDay[poolId] != today) {
            actionDay[poolId] = today;
            actionCount[poolId] = 0;
        }
        if (actionCount[poolId] >= policy.maxDailyActions) revert DailyLimitExceeded();
        actionCount[poolId]++;
    }
}
