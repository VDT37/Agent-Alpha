// SPDX-License-Identifier: MIT

// A simple vault that requests the price of Bitcoin from the JSON API agent and
// trades mUSD for mETH if the price drops by more than 2% in a single price update.

// holds user deposits, has the safety guardrails, fetches a price via the JSON API agent, 
// applies a hardcoded rule, and swaps on the AMM.

pragma solidity ^0.8.20;

import {
    IAgentRequester,
    IAgentRequesterHandler,
    Response,
    Request,
    ResponseStatus
} from "./Interfaces/IAgentRequester.sol";

interface IJsonApiAgent {
    function fetchUint(string calldata url, string calldata selector, uint8 decimals)
        external returns (uint256);
}

interface IERC20Vault {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISimpleAMM {
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256);
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256);
}

contract TradingVault is IAgentRequesterHandler {
    // --- Agent platform wiring ---
    IAgentRequester public immutable platform;
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant PRICE_PER_AGENT = 0.03 ether;

    // --- Trading wiring ---
    address public immutable owner;
    IERC20Vault public immutable stable; // mUSD — what users deposit
    IERC20Vault public immutable risky;  // mETH — what we trade into
    ISimpleAMM public immutable amm;

    // --- User accounting ---
    mapping(address => uint256) public deposits; // mUSD deposited per user
    uint256 public totalDeposited;

    // --- Strategy state ---
    uint256 public lastPrice;        // last BTC price the agent reported (8 decimals)
    mapping(uint256 => bool) public pendingRequests;

    // --- Safety guardrails ---
    bool public paused;                       // circuit breaker
    uint256 public maxTradeStable;            // max mUSD spent per single trade
    uint256 public constant DROP_BPS_TRIGGER = 200; // trade if price dropped >2% (200 basis points)

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event PriceChecked(uint256 indexed requestId, uint256 price);
    event TradeExecuted(uint256 stableIn, uint256 riskyOut);
    event Paused(bool status);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier notPaused() {
        require(!paused, "PAUSED");
        _;
    }

    constructor(
        address platform_,
        address stable_,
        address risky_,
        address amm_,
        uint256 maxTradeStable_
    ) {
        platform = IAgentRequester(platform_);
        owner = msg.sender;
        stable = IERC20Vault(stable_);
        risky = IERC20Vault(risky_);
        amm = ISimpleAMM(amm_);
        maxTradeStable = maxTradeStable_;
    }

    // ---------------------------------------------------------------
    // USER FUNCTIONS
    // ---------------------------------------------------------------

    // User deposits mUSD into the vault. Must approve the vault first.
    function deposit(uint256 amount) external notPaused {
        require(amount > 0, "ZERO");
        stable.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    // Withdraw your deposited mUSD (simplified: ignores trading P&L for Phase B).
    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "INSUFFICIENT");
        deposits[msg.sender] -= amount;
        totalDeposited -= amount;
        stable.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------
    // STRATEGY: request price, then trade on the callback
    // ---------------------------------------------------------------

    // Step 1: ask the JSON API agent for the current BTC price.
    function checkAndTrade() external payable notPaused returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            "bitcoin.usd",
            uint8(8)
        );

        uint256 deposit_ = platform.getRequestDeposit() + PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        require(msg.value >= deposit_, "UNDERFUNDED");

        requestId = platform.createRequest{value: deposit_}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );
        pendingRequests[requestId] = true;
    }

    // Step 2: the agent's answer arrives here. Apply the rule, maybe trade.
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external override {
        require(msg.sender == address(platform), "ONLY_PLATFORM");
        require(pendingRequests[requestId], "UNKNOWN_REQUEST");
        delete pendingRequests[requestId];

        // Guardrail: never act on a failed/timed-out response.
        if (status != ResponseStatus.Success || responses.length == 0) {
            return;
        }

        uint256 newPrice = abi.decode(responses[0].result, (uint256));
        emit PriceChecked(requestId, newPrice);

        // DUMB RULE (Phase B): if price dropped more than the trigger since
        // last check, "buy the dip" — swap some mUSD into mETH.
        // In Phase C this whole block gets replaced by an LLM decision.
        if (lastPrice > 0 && newPrice < lastPrice) {
            uint256 dropBps = ((lastPrice - newPrice) * 10000) / lastPrice;
            if (dropBps >= DROP_BPS_TRIGGER) {
                _executeTrade();
            }
        }

        lastPrice = newPrice;
    }

    // ---------------------------------------------------------------
    // TRADE EXECUTION (guarded)
    // ---------------------------------------------------------------

    function _executeTrade() internal {
        uint256 available = stable.balanceOf(address(this));
        if (available == 0) return;

        // Guardrail: cap the size of any single trade.
        uint256 spend = available < maxTradeStable ? available : maxTradeStable;

        // Approve the AMM to pull our stable, get a quote, set a slippage floor.
        stable.approve(address(amm), spend);
        uint256 expectedOut = amm.getAmountOut(address(stable), spend);
        uint256 minOut = (expectedOut * 95) / 100; // accept down to 5% slippage

        uint256 received = amm.swap(address(stable), spend, minOut);
        emit TradeExecuted(spend, received);
    }

    // ---------------------------------------------------------------
    // OWNER CONTROLS (the circuit breaker)
    // ---------------------------------------------------------------

    function setPaused(bool status) external onlyOwner {
        paused = status;
        emit Paused(status);
    }

    function setMaxTrade(uint256 newMax) external onlyOwner {
        maxTradeStable = newMax;
    }

    // Accept the automatic STT refund from the agent platform.
    receive() external payable {}
}