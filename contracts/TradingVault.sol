// SPDX-License-Identifier: MIT

// Autonomous trading vault — Phase E.
//
// Pipeline (every step on-chain, each callback fires the next request):
//   checkAndTrade()  -> JSON API agent fetches BTC price
//   _onPrice()       -> stores price + rolling history, fires Parse Website agent (news sentiment)
//   _onNews()        -> stores sentiment, fires LLM inferNumber (conviction 0-100)
//   _onDecision()    -> stores conviction, computes volatility-targeted position size,
//                       then either trades directly or asks a second LLM agent to approve/veto
//   _onVeto()        -> executes the sized trade only on "approve"
//
// Architecture principle: the AI provides the directional view (conviction);
// deterministic on-chain math provides the risk-adjusted sizing (volatility targeting).

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

interface ILlmAgentNumber {
    function inferNumber(
        string calldata prompt,
        string calldata system,
        int256 minValue,
        int256 maxValue,
        bool chainOfThought
    ) external returns (int256);
}

interface IParseAgent {
    function ExtractString(
        string calldata key,
        string calldata description,
        string[] calldata options,
        string calldata prompt,
        string calldata url,
        bool resolveUrl,
        uint8 numPages,
        uint8 confidenceThreshold
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
    uint256 public constant PARSE_AGENT_ID = 12875401142070969085;

    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant JSON_PRICE_PER_AGENT = 0.03 ether;
    uint256 public constant LLM_PRICE_PER_AGENT = 0.07 ether;
    uint256 public constant PARSE_PRICE_PER_AGENT = 0.10 ether;

    // --- Trading wiring ---
    address public immutable owner;
    IERC20Vault public immutable stable;
    IERC20Vault public immutable risky;
    ISimpleAMM public immutable amm;

    // --- User accounting ---
    // NOTE (known limitation): flat ledger, ignores trading P&L. See README.
    mapping(address => uint256) public deposits;
    uint256 public totalDeposited;

    // --- Strategy state ---
    uint256 public lastPrice;
    string public lastSentiment;   // audit trail
    string public lastDecision;    // "buy" / "hold" / "vetoed" — human-readable summary

    // --- Phase E: volatility targeting + conviction sizing ---
    uint256[] public priceHistory;          // rolling recent prices (8-decimals)
    uint8 public constant HISTORY_LEN = 8;  // keep last N prices
    uint256 public constant SCALE = 1e18;   // fixed-point scale
    uint256 public targetVolFP = 1e16;      // 1.0% target vol per update (owner-tunable)
    uint256 public minConviction = 55;      // conviction floor; below it = no trade
    uint256 public lastConviction;          // AI output 0-100, audit trail
    uint256 public lastVolFP;               // computed volatility, audit trail
    uint256 public lastTradeFractionFP;     // final fraction used, audit trail

    // --- Risk-veto agent (agent-to-agent composition) ---
    bool public vetoEnabled = true;
    uint256 public pendingFractionFP;       // fraction awaiting risk-officer approval

    // --- Demo determinism: owner-set market context injected into the prompt.
    // The AI still reasons; the owner only controls its inputs. Empty = live news only.
    string public scenario;

    // --- Callback routing ---
    enum RequestKind { None, Price, News, Decision, Veto }
    mapping(uint256 => RequestKind) public requestKind;

    // --- Safety guardrails ---
    bool public paused;
    uint256 public maxTradeStable;

    event PriceChecked(uint256 indexed requestId, uint256 price);
    event NewsAnalyzed(uint256 indexed requestId, string sentiment);
    event ConvictionScored(uint256 indexed requestId, uint256 conviction);
    event DecisionMade(uint256 indexed requestId, string decision);
    event VetoRequested(uint256 indexed requestId, uint256 fractionFP);
    event TradeVetoed(uint256 indexed requestId, uint256 fractionFP);
    event SizedTradeExecuted(
        uint256 conviction, uint256 volFP, uint256 fractionFP, uint256 amountIn, uint256 amountOut
    );
    event DecisionSkipped(uint256 indexed requestId, string reason);
    event ScenarioSet(string scenario);
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

    // ---------------- USER FUNCTIONS ----------------
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
            // never act on a failed/timed-out response; a failed veto check
            // means the proposed trade dies unreviewed (fail-safe).
            if (kind == RequestKind.Veto) pendingFractionFP = 0;
            emit DecisionSkipped(requestId, "agent request failed or timed out");
            return;
        }

        if (kind == RequestKind.Price) {
            _onPrice(requestId, responses[0].result);
        } else if (kind == RequestKind.News) {
            _onNews(requestId, responses[0].result);
        } else if (kind == RequestKind.Decision) {
            _onDecision(requestId, responses[0].result);
        } else if (kind == RequestKind.Veto) {
            _onVeto(requestId, responses[0].result);
        }
    }

    // ---------------- STEP 2: price arrived -> record history, ask for news ----------------
    function _onPrice(uint256 requestId, bytes memory result) internal {
        uint256 newPrice = abi.decode(result, (uint256));
        lastPrice = newPrice;
        _pushPrice(newPrice);
        emit PriceChecked(requestId, newPrice);

        string[] memory options = new string[](3);
        options[0] = "bullish";
        options[1] = "bearish";
        options[2] = "neutral";

        // Params are byte-for-byte the combination verified standalone in NewsOracle:
        // search mode, 3 pages, confidence 50.
        bytes memory payload = abi.encodeWithSelector(
            IParseAgent.ExtractString.selector,
            "market_sentiment",                                              // key
            "The overall sentiment of the current cryptocurrency market based on recent news.", // description
            options,                                                         // constrained output
            "Latest cryptocurrency market news and overall investor sentiment today", // prompt = search term
            "https://coindesk.com/",                                         // domain to search
            true,                                                            // resolveUrl = SEARCH mode
            uint8(3),                                                        // read up to 3 found articles
            uint8(50)                                                        // confidence gate
        );

        uint256 dep = platform.getRequestDeposit() + PARSE_PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        if (address(this).balance < dep) {
            emit DecisionSkipped(requestId, "insufficient STT for news call");
            return;
        }
        uint256 newsId = platform.createRequest{value: dep}(
            PARSE_AGENT_ID, address(this), this.handleResponse.selector, payload
        );
        requestKind[newsId] = RequestKind.News;
    }

    // ---------------- STEP 3: news arrived -> ask the AI for conviction (0-100) ----------------
    function _onNews(uint256 requestId, bytes memory result) internal {
        string memory sentiment = abi.decode(result, (string));
        lastSentiment = sentiment;
        emit NewsAnalyzed(requestId, sentiment);

        string memory context = "";
        if (bytes(scenario).length > 0) {
            context = string.concat(" Additional market context: ", scenario, ".");
        }

        string memory prompt = string.concat(
            "You are a disciplined crypto trading strategy. BTC price is ",
            _toString(lastPrice / 1e8),
            " USD. News sentiment is: ",
            sentiment,
            ".",
            context,
            " Output a single integer 0-100 representing your conviction to BUY BTC now",
            " (0 = no conviction / avoid, 100 = maximum conviction).",
            " Be decisive and respond to the market context."
        );
        string memory system = "Output only an integer 0-100. No words.";

        bytes memory payload = abi.encodeWithSelector(
            ILlmAgentNumber.inferNumber.selector,
            prompt, system, int256(0), int256(100), false
        );

        uint256 dep = platform.getRequestDeposit() + LLM_PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        if (address(this).balance < dep) {
            emit DecisionSkipped(requestId, "insufficient STT for conviction call");
            return;
        }
        uint256 decisionId = platform.createRequest{value: dep}(
            LLM_AGENT_ID, address(this), this.handleResponse.selector, payload
        );
        requestKind[decisionId] = RequestKind.Decision;
    }

    // ---------------- STEP 4: conviction arrived -> size the position ----------------
    function _onDecision(uint256 requestId, bytes memory result) internal {
        int256 raw = abi.decode(result, (int256));
        if (raw < 0) raw = 0;
        if (raw > 100) raw = 100;
        uint256 conviction = uint256(raw);
        lastConviction = conviction;
        emit ConvictionScored(requestId, conviction);

        uint256 fractionFP = _sizeFractionFP(conviction);

        if (conviction < minConviction) {
            lastDecision = "hold";
            emit DecisionMade(requestId, "hold");
            emit DecisionSkipped(requestId, "conviction below floor");
            return;
        }
        if (fractionFP == 0) {
            lastDecision = "hold";
            emit DecisionMade(requestId, "hold");
            emit DecisionSkipped(requestId, "sized fraction is zero");
            return;
        }

        lastDecision = "buy";
        emit DecisionMade(requestId, "buy");

        if (vetoEnabled) {
            _requestVeto(requestId, fractionFP);
        } else {
            _executeSizedTrade(fractionFP);
        }
    }

    // ---------------- STEP 5 (optional): independent risk officer ----------------
    function _requestVeto(uint256 requestId, uint256 fractionFP) internal {
        string memory prompt = string.concat(
            "You are an independent risk officer for a crypto trading vault.",
            " Proposed trade: BUY spending ",
            _toString(fractionFP / 1e16),
            "% of available capital. Analyst conviction: ",
            _toString(lastConviction),
            "/100. Recent market volatility: ",
            _toString(lastVolFP / 1e14),
            " basis points per update. News sentiment: ",
            lastSentiment,
            ". Approve unless the trade is clearly reckless,",
            " e.g. high volatility combined with weak conviction.",
            " Respond with exactly one word: approve or veto."
        );
        string memory system = "You output only one of: approve, veto. No explanation.";

        string[] memory allowed = new string[](2);
        allowed[0] = "approve";
        allowed[1] = "veto";

        bytes memory payload = abi.encodeWithSelector(
            ILlmAgent.inferString.selector, prompt, system, false, allowed
        );

        uint256 dep = platform.getRequestDeposit() + LLM_PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        if (address(this).balance < dep) {
            // fail-safe: an unreviewed trade is skipped, not executed
            emit DecisionSkipped(requestId, "insufficient STT for veto call");
            return;
        }
        pendingFractionFP = fractionFP;
        uint256 vetoId = platform.createRequest{value: dep}(
            LLM_AGENT_ID, address(this), this.handleResponse.selector, payload
        );
        requestKind[vetoId] = RequestKind.Veto;
        emit VetoRequested(vetoId, fractionFP);
    }

    function _onVeto(uint256 requestId, bytes memory result) internal {
        string memory verdict = abi.decode(result, (string));
        uint256 fractionFP = pendingFractionFP;
        pendingFractionFP = 0;

        if (_eq(verdict, "approve")) {
            _executeSizedTrade(fractionFP);
        } else {
            lastDecision = "vetoed";
            emit TradeVetoed(requestId, fractionFP);
        }
    }

    // ---------------- Phase E math (fixed-point, SCALE = 1e18) ----------------

    // Volatility = mean absolute return over the stored price history.
    // Chosen over std-dev to avoid an on-chain sqrt; integer-friendly and defensible.
    function computeVolFP() public view returns (uint256 volFP) {
        uint256 n = priceHistory.length;
        if (n < 2) return targetVolFP; // not enough history -> neutral (size at target)
        uint256 sumAbsRetFP = 0;
        for (uint256 i = 1; i < n; i++) {
            uint256 prev = priceHistory[i - 1];
            uint256 cur = priceHistory[i];
            uint256 diff = cur > prev ? cur - prev : prev - cur;
            sumAbsRetFP += diff * SCALE / prev; // abs return, fixed-point
        }
        volFP = sumAbsRetFP / (n - 1);
        if (volFP == 0) volFP = 1; // avoid div-by-zero downstream
    }

    // final_fraction = min(target_vol / current_vol, 1.0) * (conviction / 100)
    function previewFraction(uint256 convictionPct)
        public view returns (uint256 volFP, uint256 fractionFP)
    {
        volFP = computeVolFP();
        uint256 baseFractionFP = targetVolFP * SCALE / volFP;
        if (baseFractionFP > SCALE) baseFractionFP = SCALE; // cap at 1.0 — no leverage
        uint256 convMultFP = convictionPct * SCALE / 100;
        fractionFP = baseFractionFP * convMultFP / SCALE;
    }

    function _sizeFractionFP(uint256 convictionPct) internal returns (uint256) {
        (uint256 volFP, uint256 fractionFP) = previewFraction(convictionPct);
        lastVolFP = volFP;
        lastTradeFractionFP = fractionFP;
        return fractionFP;
    }

    function _pushPrice(uint256 p) internal {
        if (priceHistory.length < HISTORY_LEN) {
            priceHistory.push(p);
        } else {
            for (uint256 i = 1; i < HISTORY_LEN; i++) {
                priceHistory[i - 1] = priceHistory[i];
            }
            priceHistory[HISTORY_LEN - 1] = p;
        }
    }

    function priceHistoryLength() external view returns (uint256) {
        return priceHistory.length;
    }

    // ---------------- the sized trade ----------------
    function _executeSizedTrade(uint256 fractionFP) internal {
        uint256 available = stable.balanceOf(address(this));
        if (available == 0 || fractionFP == 0) return;
        uint256 spend = available * fractionFP / SCALE;     // fixed-point apply
        if (spend > maxTradeStable) spend = maxTradeStable; // hard ceiling
        if (spend == 0) return;

        stable.approve(address(amm), spend);
        uint256 expectedOut = amm.getAmountOut(address(stable), spend);
        uint256 minOut = (expectedOut * 95) / 100;          // 5% slippage floor
        uint256 received = amm.swap(address(stable), spend, minOut);
        emit SizedTradeExecuted(lastConviction, lastVolFP, fractionFP, spend, received);
    }

    // ---------------- OWNER CONTROLS ----------------
    function setPaused(bool s) external onlyOwner { paused = s; emit Paused(s); }
    function setMaxTrade(uint256 m) external onlyOwner { maxTradeStable = m; }
    function setTargetVol(uint256 fp) external onlyOwner { targetVolFP = fp; }
    function setMinConviction(uint256 c) external onlyOwner { minConviction = c; }
    function setVetoEnabled(bool v) external onlyOwner { vetoEnabled = v; }
    function setScenario(string calldata s) external onlyOwner { scenario = s; emit ScenarioSet(s); }

    // Seed/replace the price history (demo: show the vol throttle; tests: fixtures).
    function seedPriceHistory(uint256[] calldata prices) external onlyOwner {
        delete priceHistory;
        for (uint256 i = 0; i < prices.length && i < HISTORY_LEN; i++) {
            priceHistory.push(prices[i]);
        }
    }

    // Testnet escape hatches: a redeployed vault carries nothing over, so recover
    // STT fuel / stranded tokens from the old instance before redeploying.
    function rescueFuel(uint256 amount) external onlyOwner {
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "RESCUE_FAILED");
    }
    function rescueToken(address token, uint256 amount) external onlyOwner {
        IERC20Vault(token).transfer(owner, amount);
    }

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

    // unspent agent deposits are refunded here; without receive() they'd be lost
    receive() external payable {}
}
