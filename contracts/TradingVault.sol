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

interface ILlmAgent {
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory);
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
    uint256 public constant LLM_AGENT_ID = 12847293847561029384;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant JSON_PRICE_PER_AGENT = 0.03 ether;
    uint256 public constant LLM_PRICE_PER_AGENT = 0.07 ether;

    // --- Trading wiring ---
    address public immutable owner;
    IERC20Vault public immutable stable;
    IERC20Vault public immutable risky;
    ISimpleAMM public immutable amm;

    // --- User accounting ---
    mapping(address => uint256) public deposits;
    uint256 public totalDeposited;

    // --- Strategy state ---
    uint256 public lastPrice;
    string public lastDecision; // "buy" / "sell" / "hold" — for your audit trail
    string public scenario; // owner-injectable context for demos

    // --- Callback routing ---
    enum RequestKind { None, Price, Decision }
    mapping(uint256 => RequestKind) public requestKind;

    // --- Safety guardrails ---
    bool public paused;
    uint256 public maxTradeStable;

    event PriceChecked(uint256 indexed requestId, uint256 price);
    event DecisionMade(uint256 indexed requestId, string decision);
    event TradeExecuted(string decision, uint256 amountIn, uint256 amountOut);
    event DecisionSkipped(uint256 indexed requestId, string reason);
    event Paused(bool status);

    modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }
    modifier notPaused() { require(!paused, "PAUSED"); _; }

    constructor(
        address platform_, address stable_, address risky_,
        address amm_, uint256 maxTradeStable_
    ) {
        platform = IAgentRequester(platform_);
        owner = msg.sender;
        stable = IERC20Vault(stable_);
        risky = IERC20Vault(risky_);
        amm = ISimpleAMM(amm_);
        maxTradeStable = maxTradeStable_;
    }

    // ---------------- USER FUNCTIONS (unchanged) ----------------
    function deposit(uint256 amount) external notPaused {
        require(amount > 0, "ZERO");
        stable.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        totalDeposited += amount;
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "INSUFFICIENT");
        deposits[msg.sender] -= amount;
        totalDeposited -= amount;
        stable.transfer(msg.sender, amount);
    }

    // ---------------- STEP 1: ask for the price ----------------
    function checkAndTrade() external payable notPaused returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            "bitcoin.usd",
            uint8(8)
        );
        uint256 dep = platform.getRequestDeposit() + JSON_PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        require(msg.value >= dep, "UNDERFUNDED");

        requestId = platform.createRequest{value: dep}(
            JSON_API_AGENT_ID, address(this), this.handleResponse.selector, payload
        );
        requestKind[requestId] = RequestKind.Price;
    }

    // ---------------- THE CALLBACK: routes on request kind ----------------
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external override {
        require(msg.sender == address(platform), "ONLY_PLATFORM");
        RequestKind kind = requestKind[requestId];
        require(kind != RequestKind.None, "UNKNOWN_REQUEST");
        delete requestKind[requestId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            return; // never act on a failed/timed-out response
        }

        if (kind == RequestKind.Price) {
            _onPrice(requestId, responses[0].result);
        } else if (kind == RequestKind.Decision) {
            _onDecision(requestId, responses[0].result);
        }
    }

    // ---------------- STEP 2: price arrived -> ask the AI ----------------
    function _onPrice(uint256 requestId, bytes memory result) internal {
        uint256 newPrice = abi.decode(result, (uint256));
        lastPrice = newPrice;
        emit PriceChecked(requestId, newPrice);

        // Build the prompt. We hand the model the current price and ask for a verdict.
        string memory prompt = string.concat(
            "You are a disciplined crypto trading strategy. The current BTC price is ",
            _toString(newPrice / 1e8),
            " USD.",
            bytes(scenario).length > 0
                ? string.concat(" Market context: ", scenario, ".")
                : "",
            " Respond with exactly one word: buy, sell, or hold. Be conservative: prefer hold unless there is a clear reason."
        );
        string memory system = "You output only one of: buy, sell, hold. No explanation.";

        string[] memory allowed = new string[](3);
        allowed[0] = "buy";
        allowed[1] = "sell";
        allowed[2] = "hold";

        bytes memory payload = abi.encodeWithSelector(
            ILlmAgent.inferString.selector,
            prompt, system, false, allowed
        );

        uint256 dep = platform.getRequestDeposit() + LLM_PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        // NOTE: this spends the vault's own STT balance (see funding note below).
        if (address(this).balance < dep) {
    emit DecisionSkipped(requestId, "insufficient STT for LLM call");
    return; // keep the price we already stored; don't revert it
}
        
        uint256 decisionId = platform.createRequest{value: dep}(
            LLM_AGENT_ID, address(this), this.handleResponse.selector, payload
        );
        requestKind[decisionId] = RequestKind.Decision;
    }

    // ---------------- STEP 3: AI verdict arrived -> maybe trade ----------------
    function _onDecision(uint256 requestId, bytes memory result) internal {
        string memory decision = abi.decode(result, (string));
        lastDecision = decision;
        emit DecisionMade(requestId, decision);

        if (_eq(decision, "buy")) {
            _executeTrade();
        }
        // "sell" and "hold" handled later / left as no-op for Phase C
    }

    function _executeTrade() internal {
        uint256 available = stable.balanceOf(address(this));
        if (available == 0) return;
        uint256 spend = available < maxTradeStable ? available : maxTradeStable;

        stable.approve(address(amm), spend);
        uint256 expectedOut = amm.getAmountOut(address(stable), spend);
        uint256 minOut = (expectedOut * 95) / 100;
        uint256 received = amm.swap(address(stable), spend, minOut);
        emit TradeExecuted(lastDecision, spend, received);
    }

    // ---------------- OWNER CONTROLS ----------------
    function setPaused(bool s) external onlyOwner { paused = s; emit Paused(s); }
    function setMaxTrade(uint256 m) external onlyOwner { maxTradeStable = m; }
    function setScenario(string calldata s) external onlyOwner { scenario = s; }

    // ---------------- helpers ----------------
    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v; uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory bstr = new bytes(len);
        uint256 k = len;
        while (v != 0) { k--; bstr[k] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(bstr);
    }

    receive() external payable {}
}