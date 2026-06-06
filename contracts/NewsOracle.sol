// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    IAgentRequester,
    IAgentRequesterHandler,
    Response,
    Request,
    ResponseStatus
} from "./Interfaces/IAgentRequester.sol";

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

contract NewsOracle is IAgentRequesterHandler {
    IAgentRequester public immutable platform;
    uint256 public constant PARSE_AGENT_ID = 12875401142070969085;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant PARSE_PRICE_PER_AGENT = 0.10 ether;

    string public lastSentiment;
    uint8 public lastStatus; // 0=none, 1=success, 2=failed, 3=timedout — so we SEE failures
    mapping(uint256 => bool) public pendingRequests;

    event SentimentReceived(uint256 indexed requestId, string sentiment);
    event RequestFailed(uint256 indexed requestId, uint8 status);

    constructor(address platform_) {
        platform = IAgentRequester(platform_);
    }

    // url is a parameter so you can try different sites WITHOUT redeploying.
    function requestSentiment(string calldata url) external payable returns (uint256 requestId) {
        string[] memory options = new string[](3);
        options[0] = "bullish";
        options[1] = "bearish";
        options[2] = "neutral";

        bytes memory payload = abi.encodeWithSelector(
            IParseAgent.ExtractString.selector,
            "sentiment",                                   // key
            "Overall crypto market sentiment",             // description
            options,                                       // constrained output
            "Read these crypto news headlines and classify the overall market sentiment as bullish, bearish, or neutral.", // prompt
            url,                                           // url (passed in)
            true,                                          // resolveUrl
            uint8(1),                                      // numPages
            uint8(50)                                      // confidenceThreshold (loosened from 70)
        );

        uint256 dep = platform.getRequestDeposit() + PARSE_PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        require(msg.value >= dep, "UNDERFUNDED");

        requestId = platform.createRequest{value: dep}(
            PARSE_AGENT_ID, address(this), this.handleResponse.selector, payload
        );
        pendingRequests[requestId] = true;
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external override {
        require(msg.sender == address(platform), "ONLY_PLATFORM");
        require(pendingRequests[requestId], "UNKNOWN_REQUEST");
        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success && responses.length > 0) {
            lastSentiment = abi.decode(responses[0].result, (string));
            lastStatus = 1;
            emit SentimentReceived(requestId, lastSentiment);
        } else {
            // Record WHY it failed instead of silently dropping it.
            lastStatus = status == ResponseStatus.Failed ? 2 : 3;
            emit RequestFailed(requestId, lastStatus);
        }
    }

    receive() external payable {}
}